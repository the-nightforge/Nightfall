import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { GameEngine, generateWarnings, PRESET_DECKS } from "@masoi/game-engine";
import type { Room } from "../src/rooms/store";
import { createRoom, allRooms } from "../src/rooms/store";
import { buildSnapshot } from "../src/rooms/snapshot";

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));
vi.mock("../src/db", () => ({ prisma: {} }));
vi.mock("../src/redis", () => ({
  redis: { set: async () => undefined, get: async () => null, del: async () => undefined },
  getPlayerRoom: async () => null,
  updateSessionRoom: async () => undefined,
}));
vi.mock("../src/rooms/store", async () => {
  const actual = await vi.importActual<typeof import("../src/rooms/store")>("../src/rooms/store");
  return {
    ...actual,
  };
});

function makeMembers(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    playerId: `p${i + 1}`,
    name: `P${i + 1}`,
    ready: true,
    connected: true,
    isBot: false,
  }));
}

function makeRoomWithConfig(playerCount: number, configOverrides: Partial<typeof DEFAULT_ROOM_CONFIG>): Room {
  const baseMembers = makeMembers(playerCount);
  const host = baseMembers[0];
  // createRoom uses generateRoomCode, bypass and construct manually to avoid redis
  const room: Room = {
    code: `TEST${playerCount}`,
    hostId: host.playerId,
    status: "LOBBY",
    members: baseMembers,
    config: { ...DEFAULT_ROOM_CONFIG, ...configOverrides } as any,
    engine: null,
    chatLog: [],
    createdAt: Date.now(),
  };
  // inject into global rooms map via createRoom side effect? Instead manually push to allRooms
  // allRooms returns live map; we need to add via actual store
  // Use createRoom to properly register then override
  // Simpler: directly use the room object for service tests via mocking getRoom
  return room;
}

describe("balance warning snapshot", () => {
  it("exposes balanceWarning in snapshot", () => {
    const room: Room = {
      code: "SNAP1",
      hostId: "p1",
      status: "LOBBY",
      members: makeMembers(6),
      config: { ...DEFAULT_ROOM_CONFIG, werewolves: 4 } as any,
      engine: null,
      chatLog: [],
      createdAt: 0,
    };
    const snap = buildSnapshot(room, "p1");
    expect(snap.balanceWarning).toBeDefined();
    expect(snap.balanceWarning!.blocking).toBe(true);
    expect(snap.balanceWarning!.warnings.length).toBeGreaterThan(0);
    expect(snap.balanceWarning!.score).toBeGreaterThanOrEqual(0);
    expect(snap.balanceWarning!.score).toBeLessThanOrEqual(100);
  });

  it("snapshot balanced preset not blocking", () => {
    const room: Room = {
      code: "SNAP2",
      hostId: "p1",
      status: "LOBBY",
      members: makeMembers(6),
      config: { ...PRESET_DECKS[6] },
      engine: null,
      chatLog: [],
      createdAt: 0,
    };
    const snap = buildSnapshot(room, "p1");
    expect(snap.balanceWarning).toBeDefined();
    expect(snap.balanceWarning!.blocking).toBe(false);
  });
});

describe("balance validation service", () => {
  it("block start when unbalanced RANKED throws BALANCE_UNSTABLE (6 players with 4 werewolves)", async () => {
    // generateWarnings should flag 4 wolves on 6 as blocking
    const cfg = { ...DEFAULT_ROOM_CONFIG, werewolves: 4, mode: "ranked" as const } as any;
    const w = generateWarnings(cfg, 6);
    expect(w.blocking).toBe(true);

    // Also test via roomService.start with mocked store
    const { roomService } = await import("../src/rooms/service");
    const { getRoom } = await import("../src/rooms/store");
    // Create a room via store so getRoomSyncByPlayer can find it
    const hostId = "host-ranked";
    const members = makeMembers(6).map((m, idx) => idx === 0 ? { ...m, playerId: hostId, name: "Host" } : m);
    // Manually create room entry
    const room: Room = {
      code: "RANK01",
      hostId,
      status: "LOBBY",
      members,
      config: cfg,
      engine: null,
      chatLog: [],
      createdAt: 0,
    };
    // Inject into allRooms map
    const { createRoom: cr } = await import("../src/rooms/store");
    // Use internal map by directly calling createRoom then overwriting
    const tmp = cr("RANK01", members[0]);
    Object.assign(tmp, room);
    // ensure host matches
    tmp.hostId = hostId;

    expect(() => roomService.start(hostId)).toThrow(/BALANCE_UNSTABLE/);
  });

  it("allow start when CHAOS even unbalanced", async () => {
    const cfgRanked = { ...DEFAULT_ROOM_CONFIG, werewolves: 2, seer: false, guard: false, witch: false, hunter: false, cursed: false, mode: "chaos" as const } as any;
    const w = generateWarnings(cfgRanked, 6);
    // This config should be blocking due to infoPower/score diff
    expect(w.blocking).toBe(true);

    const { roomService } = await import("../src/rooms/service");
    const hostId = "host-chaos";
    const members = makeMembers(6).map((m, idx) => idx === 0 ? { ...m, playerId: hostId, name: "HostChaos" } : m);
    const room: Room = {
      code: "CHAOS1",
      hostId,
      status: "LOBBY",
      members,
      config: cfgRanked,
      engine: null,
      chatLog: [],
      createdAt: 0,
    };
    const { createRoom: cr } = await import("../src/rooms/store");
    const tmp = cr("CHAOS1", members[0]);
    Object.assign(tmp, room);
    tmp.hostId = hostId;

    // For CHAOS, start should NOT throw BALANCE_UNSTABLE; may still throw other validation but we chose a config that passes validate
    expect(() => roomService.start(hostId)).not.toThrow(/BALANCE_UNSTABLE/);
    // It should throw due to not ready? We set ready true, so it should try to start game. Let's ensure members ready
    // If it attempts to start, it will create engine. That may succeed or throw other error, but not BALANCE_UNSTABLE.
    // We verify no BALANCE_UNSTABLE
    try {
      roomService.start(hostId);
    } catch (e: any) {
      expect(e.message).not.toMatch(/BALANCE_UNSTABLE/);
    }
  });

  it("updateConfig blocks RANKED unbalanced", async () => {
    const { roomService } = await import("../src/rooms/service");
    const hostId = "host-update";
    const members = makeMembers(6).map((m, idx) => idx === 0 ? { ...m, playerId: hostId, name: "HostUpd" } : m);
    const { createRoom: cr } = await import("../src/rooms/store");
    const tmp = cr("UPD01", members[0]);
    // override members to have correct hostId
    tmp.members = members;
    tmp.hostId = hostId;
    tmp.status = "LOBBY";
    tmp.config = { ...DEFAULT_ROOM_CONFIG, mode: "ranked" as const } as any;

    const badConfig = { ...DEFAULT_ROOM_CONFIG, werewolves: 4, mode: "ranked" as const } as any;
    expect(() => roomService.updateConfig(hostId, badConfig)).toThrow(/BALANCE_UNSTABLE/);

    const chaosBad = { ...DEFAULT_ROOM_CONFIG, werewolves: 2, seer: false, guard: false, witch: false, hunter: false, mode: "chaos" as const } as any;
    // For chaos, updateConfig should not throw BALANCE_UNSTABLE (but may still validate)
    // Use a config that passes basic validation but is balance blocking; chaos should allow
    expect(() => roomService.updateConfig(hostId, chaosBad)).not.toThrow(/BALANCE_UNSTABLE/);
  });
});
