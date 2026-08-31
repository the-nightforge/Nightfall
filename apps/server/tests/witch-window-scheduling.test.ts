import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";
import { clearBotSession } from "../src/bots/session-registry";
import { scheduleNightBots } from "../src/game/machine";

/**
 * Cửa sổ riêng của Phù Thuỷ dài 15s, KHÔNG dài bằng `nightSeconds`.
 *
 * Đêm có hai chặng: chặng Sói dài `nightSeconds` (schema cho tới 120s), rồi
 * `lockWolves` mở thêm đúng `WITCH_WINDOW_MS` cho Phù Thuỷ. Khi độ trễ rải bot
 * còn tính theo `nightSeconds`, mốc hẹn của Phù Thuỷ ở phòng đêm-dài rơi ra
 * SAU `endNight` và lượt của cô ta mất trắng - lõi quyết định đúng nhưng không
 * ai kịp nộp. Bài này khoá lại đúng khoảng cách đó.
 */

vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: () => undefined,
  persistRoom: async () => undefined,
  setRoomTimer: (_code: string, fn: () => void, ms: number) => setTimeout(fn, ms),
}));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));

vi.mock("../src/db", () => ({ prisma: {} }));

const WITCH_WINDOW_MS = 15_000;
/** Đêm dài nhất schema cho phép - đúng cấu hình làm lộ lỗi. */
const LONG_NIGHT_SECONDS = 120;

function witchWindowRoom(): Room {
  const state: GameState = {
    phase: "NIGHT",
    round: 1,
    phaseStartedAt: Date.now(),
    // `lockWolves` gọi `extendPhase(WITCH_WINDOW_MS)`, nên đây là hạn chót THẬT
    // của chặng đang mở, bất kể đêm dài bao nhiêu.
    phaseEndsAt: Date.now() + WITCH_WINDOW_MS,
    players: [
      { id: "wolf", name: "Sói", role: "WEREWOLF", alive: true, isBot: true },
      { id: "witch", name: "Phù Thuỷ", role: "WITCH", alive: true, isBot: true },
      { id: "villager", name: "Dân", role: "VILLAGER", alive: true, isBot: true },
      { id: "villager2", name: "Dân 2", role: "VILLAGER", alive: true, isBot: true },
    ],
    config: {
      ...DEFAULT_ROOM_CONFIG,
      werewolves: 1,
      seer: false,
      guard: false,
      witch: true,
      nightSeconds: LONG_NIGHT_SECONDS,
    },
    winner: null,
    night: {
      wolfVotes: { wolf: "villager" },
      killTarget: "villager",
      // Đã khoá phiếu Sói: đây chính là lúc cửa sổ Phù Thuỷ mở.
      wolvesLocked: true,
      guardTarget: null,
      healTonight: false,
      poisonTarget: null,
      witchSkipped: false,
      seerResults: {},
    },
    votes: {},
    voteMutations: [],
    dayVoteHistory: [],
    guardPrevious: null,
    healUsed: false,
    poisonUsed: false,
    lastNightDeaths: [],
    nightHistory: [],
    lastEliminated: null,
    trial: null,
    lastTrial: null,
    hunterReaction: null,
    hunterShots: [],
    log: [],
  };

  return {
    code: "WITCH1",
    hostId: "wolf",
    status: "IN_GAME",
    members: state.players.map((player) => ({
      playerId: player.id,
      name: player.name,
      ready: true,
      connected: true,
      isBot: true,
    })),
    config: { ...DEFAULT_ROOM_CONFIG, nightSeconds: LONG_NIGHT_SECONDS },
    engine: new GameEngine(state),
    chatLog: [],
    createdAt: 0,
  };
}

describe("scheduleNightBots · cửa sổ Phù Thuỷ", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearBotSession("WITCH1");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("Phù Thuỷ kịp quyết trong cửa sổ 15s dù đêm được cấu hình dài 120s", async () => {
    const room = witchWindowRoom();

    scheduleNightBots(room);
    await vi.advanceTimersByTimeAsync(WITCH_WINDOW_MS);

    const night = room.engine!.state.night;
    const decided = night.witchSkipped || night.healTonight || night.poisonTarget !== null;
    expect(decided).toBe(true);
  });
});
