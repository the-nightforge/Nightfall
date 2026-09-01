import { afterEach, describe, expect, it, vi } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { DISCONNECT_GRACE_MS } from "../src/game/discussion-skip";
import type { Room, RoomMember } from "../src/rooms/store";
import { RoomError, roomService } from "../src/rooms/service";
import { ROOM_SCAFFOLD } from "./helpers/room";
import { GAME_STATE_SCAFFOLD } from "./helpers/game-state";
import { NIGHT_SCAFFOLD } from "./helpers/night";

const roomHolder = vi.hoisted(() => ({ room: null as Room | null }));

vi.mock("../src/rooms/store", () => ({
  allRooms: () => (roomHolder.room ? [roomHolder.room] : []),
  clearRoomTimers: () => undefined,
  getRoom: (code: string) => (roomHolder.room?.code === code ? roomHolder.room : undefined),
  persistRoom: async () => undefined,
  setRoomTimer: () => undefined,
}));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));

vi.mock("../src/db", () => ({
  prisma: { gameResult: { create: () => Promise.resolve() } },
}));

vi.mock("../src/voice/service", () => ({
  destroyVoiceRoom: async () => undefined,
  syncVoicePermissions: async () => undefined,
}));

function roomAt(phase: GameState["phase"], host: Partial<RoomMember>): Room {
  const state: GameState = {
    ...GAME_STATE_SCAFFOLD,
    phase,
    round: 3,
    phaseEndsAt: null,
    players: [
      { id: "host", name: "Host", role: "VILLAGER", alive: true, isBot: false },
      { id: "b", name: "B", role: "SEER", alive: true, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    winner: phase === "GAME_OVER" ? "village" : null,
    night: {
      ...NIGHT_SCAFFOLD,
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
    hunterReaction: null,
    hunterShots: [],
    log: [],
  } as GameState;

  return {
    ...ROOM_SCAFFOLD,
    code: "OVER1",
    hostId: "host",
    status: "IN_GAME",
    members: [
      { playerId: "host", name: "Host", ready: true, connected: true, isBot: false, ...host },
      { playerId: "b", name: "B", ready: true, connected: true, isBot: false },
    ],
    config: { ...state.config },
    engine: new GameEngine(state),
    chatLog: [],
    createdAt: 0,
  };
}

afterEach(() => {
  roomHolder.room = null;
  vi.useRealTimers();
});

describe("ai được bấm Chơi lại ở màn kết thúc", () => {
  it("chủ phòng còn online: chỉ chủ phòng reset được", () => {
    const room = roomAt("GAME_OVER", { connected: true, disconnectedAt: null });
    roomHolder.room = room;

    expect(() => roomService.reset("b")).toThrow(RoomError);
    roomService.reset("host");
    expect(room.status).toBe("LOBBY");
  });

  it("chủ phòng vừa rớt mạng, còn trong khoảng ân hạn: người khác vẫn bị chặn", () => {
    vi.useFakeTimers();
    const now = Date.now();
    const room = roomAt("GAME_OVER", { connected: false, disconnectedAt: now - (DISCONNECT_GRACE_MS - 1_000) });
    roomHolder.room = room;

    expect(() => roomService.reset("b")).toThrow(RoomError);
    expect(room.status).toBe("IN_GAME");
  });

  it("chủ phòng rớt mạng quá lâu ở màn kết thúc: người khác được bấm Chơi lại", () => {
    vi.useFakeTimers();
    const now = Date.now();
    const room = roomAt("GAME_OVER", { connected: false, disconnectedAt: now - DISCONNECT_GRACE_MS });
    roomHolder.room = room;

    roomService.reset("b");
    expect(room.status).toBe("LOBBY");
  });

  it("chủ phòng rớt mạng quá lâu nhưng ván đang diễn ra (chưa GAME_OVER): người khác vẫn bị chặn", () => {
    vi.useFakeTimers();
    const now = Date.now();
    const room = roomAt("DAY_DISCUSSION", { connected: false, disconnectedAt: now - DISCONNECT_GRACE_MS });
    roomHolder.room = room;

    expect(() => roomService.reset("b")).toThrow(RoomError);
    expect(room.status).toBe("IN_GAME");
  });
});
