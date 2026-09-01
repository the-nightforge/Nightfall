import { afterEach, describe, expect, it, vi } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { DISCONNECT_GRACE_MS } from "../src/game/discussion-skip";
import type { Room, RoomMember } from "../src/rooms/store";
import { ROOM_SCAFFOLD } from "./helpers/room";
import { GAME_STATE_SCAFFOLD } from "./helpers/game-state";
import { NIGHT_SCAFFOLD } from "./helpers/night";

vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: () => undefined,
  persistRoom: async () => undefined,
  setAbandonCheckTimer: (_code: string, fn: () => void, ms: number) => setTimeout(fn, ms),
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

const { resetIfAbandoned, scheduleAbandonedRoomCheck } = await import("../src/rooms/service");

function soloVsBotsRoom(host: Partial<RoomMember>): Room {
  const state: GameState = {
    ...GAME_STATE_SCAFFOLD,
    phase: "NIGHT",
    round: 1,
    phaseEndsAt: Date.now() + 30_000,
    players: [
      { id: "host", name: "Host", role: "VILLAGER", alive: true, isBot: false },
      { id: "bot1", name: "Bot 1", role: "WEREWOLF", alive: true, isBot: true },
      { id: "bot2", name: "Bot 2", role: "WEREWOLF", alive: true, isBot: true },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    winner: null,
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
    code: "SOLO1",
    hostId: "host",
    status: "IN_GAME",
    members: [
      { playerId: "host", name: "Host", ready: true, connected: true, isBot: false, ...host },
      { playerId: "bot1", name: "Bot 1", ready: true, connected: false, isBot: true },
      { playerId: "bot2", name: "Bot 2", ready: true, connected: false, isBot: true },
    ],
    config: { ...state.config },
    engine: new GameEngine(state),
    chatLog: [],
    createdAt: 0,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("resetIfAbandoned", () => {
  it("không đụng phòng còn ít nhất một người thật đang kết nối", () => {
    const room = soloVsBotsRoom({ connected: true, disconnectedAt: null });
    resetIfAbandoned(room);
    expect(room.status).toBe("IN_GAME");
  });

  it("về lobby khi không còn người thật nào kết nối", () => {
    const room = soloVsBotsRoom({ connected: false, disconnectedAt: Date.now() });
    resetIfAbandoned(room);
    expect(room.status).toBe("LOBBY");
  });
});

describe("scheduleAbandonedRoomCheck - không được xoá ván chỉ vì rớt mạng thoáng qua", () => {
  it("KHÔNG reset ngay lập tức khi người chơi thật duy nhất vừa rớt mạng", async () => {
    vi.useFakeTimers();
    const room = soloVsBotsRoom({ connected: false, disconnectedAt: Date.now() });

    scheduleAbandonedRoomCheck(room);

    // Đúng bug đã sửa: gọi resetIfAbandoned ngay tại thời điểm rớt mạng luôn
    // thấy "chưa ai kết nối" và xoá ván tức khắc, dù chỉ là tải lại trang.
    expect(room.status).toBe("IN_GAME");

    await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS + 500);
    expect(room.status).toBe("LOBBY");
  });

  it("người chơi quay lại trong khoảng ân hạn thì ván được giữ nguyên", async () => {
    vi.useFakeTimers();
    const room = soloVsBotsRoom({ connected: false, disconnectedAt: Date.now() });

    scheduleAbandonedRoomCheck(room);

    await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS / 2);
    const host = room.members.find((m) => m.playerId === "host")!;
    host.connected = true;
    host.disconnectedAt = null;

    await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS + 500);
    expect(room.status).toBe("IN_GAME");
  });
});
