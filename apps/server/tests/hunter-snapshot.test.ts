import { afterEach, describe, expect, it, vi } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";

const redisMocks = vi.hoisted(() => ({
  get: vi.fn<() => Promise<string | null>>(),
  set: vi.fn(async () => "OK"),
  del: vi.fn(async () => 1),
}));

vi.mock("../src/redis", () => ({
  redis: redisMocks,
  getPlayerRoom: async () => null,
  updateSessionRoom: async () => undefined,
}));

vi.mock("../src/db", () => ({ prisma: {} }));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));

import { buildSnapshot } from "../src/rooms/snapshot";
import { createRoom, loadRoomFromRedis, removeRoom } from "../src/rooms/store";
import { roomService } from "../src/rooms/service";

function hunterState(phase: GameState["phase"]): GameState {
  return {
    phase,
    round: 2,
    phaseEndsAt: 20_000,
    players: [
      { id: "hunter", name: "Thợ Săn", role: "HUNTER", alive: false, isBot: false },
      { id: "wolf", name: "Sói", role: "WEREWOLF", alive: true, isBot: false },
      { id: "seer", name: "Tiên Tri", role: "SEER", alive: true, isBot: false },
      { id: "villager", name: "Dân", role: "VILLAGER", alive: true, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG, hunter: true },
    winner: phase === "GAME_OVER" ? "village" : null,
    night: {
      wolfVotes: {},
      killTarget: null,
      wolvesLocked: false,
      guardTarget: null,
      healTonight: false,
      poisonTarget: null,
      witchSkipped: false,
      seerResults: {},
    },
    votes: {},
    guardPrevious: null,
    healUsed: false,
    poisonUsed: false,
    lastNightDeaths: [],
    nightHistory: [],
    lastEliminated: null,
    hunterReaction:
      phase === "HUNTER_SHOT" ? { hunterId: "hunter", source: "night", resolved: false } : null,
    hunterShots: [
      {
        round: 1,
        hunter: { id: "hunter", name: "Thợ Săn" },
        target: { id: "wolf", name: "Sói" },
        source: "night",
      },
    ],
    log: [],
  };
}

function snapshotRoom(phase: GameState["phase"]): Room {
  const state = hunterState(phase);
  return {
    code: "SNAP1",
    hostId: "villager",
    status: "IN_GAME",
    members: state.players.map((player) => ({
      playerId: player.id,
      name: player.name,
      ready: true,
      connected: true,
      isBot: false,
    })),
    config: { ...state.config },
    engine: new GameEngine(state),
    chatLog: [],
    createdAt: 0,
  };
}

afterEach(() => {
  redisMocks.get.mockReset();
  for (const code of ["OLD01", "OLD02", "CFG01"]) removeRoom(code);
});

describe("Hunter snapshot privacy", () => {
  it("allows only the pending Hunter to act without revealing other secret roles", () => {
    const room = snapshotRoom("HUNTER_SHOT");
    const hunter = buildSnapshot(room, "hunter");
    const observer = buildSnapshot(room, "villager");

    expect(hunter.hunterShot).toEqual({
      hunterId: "hunter",
      hunterName: "Thợ Săn",
      canAct: true,
      resolved: false,
    });
    expect(observer.hunterShot?.canAct).toBe(false);
    expect(hunter.players.find((player) => player.id === "wolf")?.role).toBeUndefined();
    expect(observer.players.find((player) => player.id === "seer")?.role).toBeUndefined();
    expect(hunter.hunterShots).toEqual([]);
    expect(observer.hunterShots).toEqual([]);
  });

  it("publishes the complete Hunter recap only after game over", () => {
    const snapshot = buildSnapshot(snapshotRoom("GAME_OVER"), "villager");

    expect(snapshot.hunterShot).toBeNull();
    expect(snapshot.hunterShots).toEqual([
      {
        round: 1,
        hunter: { id: "hunter", name: "Thợ Săn" },
        target: { id: "wolf", name: "Sói" },
        source: "night",
      },
    ]);
  });
});

describe("Hunter config compatibility", () => {
  it("normalizes a legacy persisted lobby config in both room and engine state", async () => {
    const state = hunterState("ROLE_REVEAL");
    const { hunter: _roomHunter, ...oldRoomConfig } = state.config;
    const { hunter: _engineHunter, ...oldEngineConfig } = state.config;
    redisMocks.get.mockResolvedValueOnce(
      JSON.stringify({
        code: "OLD01",
        hostId: "villager",
        status: "LOBBY",
        members: snapshotRoom("ROLE_REVEAL").members,
        config: oldRoomConfig,
        engineState: { ...state, config: oldEngineConfig },
        chatLog: [],
        createdAt: 0,
      }),
    );

    const room = await loadRoomFromRedis("OLD01");

    expect(room?.config.hunter).toBe(false);
    expect(room?.engine?.state.config.hunter).toBe(false);
  });

  it("keeps the existing restart policy while normalizing a legacy in-game room", async () => {
    const state = hunterState("HUNTER_SHOT");
    const { hunter: _hunter, ...oldConfig } = state.config;
    redisMocks.get.mockResolvedValueOnce(
      JSON.stringify({
        code: "OLD02",
        hostId: "villager",
        status: "IN_GAME",
        members: snapshotRoom("HUNTER_SHOT").members,
        config: oldConfig,
        engineState: { ...state, config: oldConfig },
        chatLog: [],
        createdAt: 0,
      }),
    );

    const room = await loadRoomFromRedis("OLD02");

    expect(room?.config.hunter).toBe(false);
    expect(room?.status).toBe("LOBBY");
    expect(room?.engine).toBeNull();
    expect(room?.members.every((member) => !member.ready)).toBe(true);
  });

  it("counts Hunter in the server-side special-role guard", () => {
    createRoom("CFG01", {
      playerId: "host",
      name: "Chủ phòng",
      ready: false,
      connected: true,
      isBot: false,
    });

    expect(() =>
      roomService.updateConfig("host", {
        ...DEFAULT_ROOM_CONFIG,
        werewolves: 10,
        seer: true,
        guard: true,
        witch: true,
        hunter: true,
      }),
    ).toThrow("Cấu hình vai trò không hợp lệ");
  });
});
