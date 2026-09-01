import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";
import {
  markVoiceJoined,
  resetVoiceState,
  setVoiceAdmin,
  type VoiceAdmin,
} from "../src/voice/service";

const roomHolder = vi.hoisted(() => ({ room: null as Room | null }));

vi.mock("../src/rooms/store", () => ({
  allRooms: () => (roomHolder.room ? [roomHolder.room] : []),
  clearRoomTimers: () => undefined,
  createRoom: () => undefined,
  deletePersistedRoom: async () => undefined,
  getRoom: (code: string) => (roomHolder.room?.code === code ? roomHolder.room : undefined),
  loadRoomFromRedis: async () => null,
  persistRoom: async () => undefined,
  removeRoom: () => undefined,
  setRoomTimer: () => undefined,
}));

vi.mock("../src/redis", () => ({
  getPlayerRoom: async () => null,
  updateSessionRoom: async () => undefined,
}));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));

vi.mock("../src/db", () => ({
  prisma: {},
}));

const { roomService } = await import("../src/rooms/service");

interface Call {
  kind: "update" | "remove" | "delete";
  identity?: string;
}

function fakeAdmin() {
  const calls: Call[] = [];
  const admin: VoiceAdmin = {
    createRoom: async () => undefined,
    updateParticipant: async (_r, identity) => {
      calls.push({ kind: "update", identity });
    },
    removeParticipant: async (_r, identity) => {
      calls.push({ kind: "remove", identity });
    },
    deleteRoom: async () => {
      calls.push({ kind: "delete" });
    },
  };
  return { admin, calls };
}

function gameState(): GameState {
  return {
    phase: "DAY_DISCUSSION",
    round: 1,
    phaseEndsAt: Date.now() + 60_000,
    players: [
      { id: "host", name: "Host", role: "VILLAGER", alive: true, isBot: false },
      { id: "leaver", name: "Rời", role: "SEER", alive: true, isBot: false },
      { id: "other", name: "Khác", role: "WEREWOLF", alive: true, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG, voice: true },
    winner: null,
    night: {
      killTarget: null,
      actedWolves: [],
      skippedWolves: [],
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
    trial: null,
    log: [],
  } as unknown as GameState;
}

function makeRoom(inGame: boolean): Room {
  return {
    code: "ABCDE",
    hostId: "host",
    status: inGame ? "IN_GAME" : "LOBBY",
    members: [
      { playerId: "host", name: "Host", ready: true, connected: true, isBot: false },
      { playerId: "leaver", name: "Rời", ready: true, connected: true, isBot: false },
      { playerId: "other", name: "Khác", ready: true, connected: true, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG, voice: true },
    engine: inGame ? new GameEngine(gameState()) : null,
    chatLog: [],
    createdAt: 0,
    kickedPlayerIds: [],
  } as unknown as Room;
}

beforeEach(() => {
  resetVoiceState();
});

afterEach(() => {
  resetVoiceState();
  setVoiceAdmin(null);
  roomHolder.room = null;
});

describe("rời phòng giữa ván - ca mic ma", () => {
  /**
   * `leave()` đánh dấu người rời là ĐÃ CHẾT rồi loại họ khỏi `room.members`.
   * Vòng đồng bộ quyền duyệt theo `room.members`, nên nếu không đá khỏi voice
   * ngay tại đây thì họ không bao giờ được duyệt tới nữa: vẫn ngồi trong room
   * LiveKit, vẫn giữ quyền nói của lúc còn sống, nghe và nói được với người
   * sống tới hết ván.
   */
  it("đá người rời khỏi room voice", async () => {
    const { admin, calls } = fakeAdmin();
    setVoiceAdmin(admin);
    roomHolder.room = makeRoom(true);
    markVoiceJoined("ABCDE", "leaver");

    await roomService.leave("leaver");
    await new Promise((resolve) => setImmediate(resolve));

    expect(calls).toContainEqual({ kind: "remove", identity: "leaver" });
  });

  it("không đụng tới người còn ở lại", async () => {
    const { admin, calls } = fakeAdmin();
    setVoiceAdmin(admin);
    roomHolder.room = makeRoom(true);
    markVoiceJoined("ABCDE", "leaver");
    markVoiceJoined("ABCDE", "other");

    await roomService.leave("leaver");
    await new Promise((resolve) => setImmediate(resolve));

    expect(calls.filter((c) => c.kind === "remove")).toEqual([
      { kind: "remove", identity: "leaver" },
    ]);
  });
});

describe("bị đuổi khỏi phòng chờ", () => {
  it("đá luôn khỏi voice, không đợi hết pha", async () => {
    const { admin, calls } = fakeAdmin();
    setVoiceAdmin(admin);
    roomHolder.room = makeRoom(false);
    markVoiceJoined("ABCDE", "other");

    await roomService.kick("host", "other");
    await new Promise((resolve) => setImmediate(resolve));

    expect(calls).toContainEqual({ kind: "remove", identity: "other" });
  });
});

describe("host bật tắt voice", () => {
  it("tắt voice thì xoá hẳn room", async () => {
    const { admin, calls } = fakeAdmin();
    setVoiceAdmin(admin);
    roomHolder.room = makeRoom(false);

    roomService.updateConfig("host", { ...DEFAULT_ROOM_CONFIG, voice: false });
    await new Promise((resolve) => setImmediate(resolve));

    expect(calls).toContainEqual({ kind: "delete" });
  });

  it("đổi cấu hình khác mà voice vẫn bật thì KHÔNG xoá room", async () => {
    const { admin, calls } = fakeAdmin();
    setVoiceAdmin(admin);
    roomHolder.room = makeRoom(false);

    roomService.updateConfig("host", { ...DEFAULT_ROOM_CONFIG, voice: true, nightSeconds: 45 });
    await new Promise((resolve) => setImmediate(resolve));

    expect(calls.filter((c) => c.kind === "delete")).toEqual([]);
  });

  it("phòng vốn đã tắt voice thì không xoá gì cả", async () => {
    const { admin, calls } = fakeAdmin();
    setVoiceAdmin(admin);
    const room = makeRoom(false);
    room.config = { ...DEFAULT_ROOM_CONFIG, voice: false };
    roomHolder.room = room;

    roomService.updateConfig("host", { ...DEFAULT_ROOM_CONFIG, voice: false });
    await new Promise((resolve) => setImmediate(resolve));

    expect(calls).toEqual([]);
  });
});
