import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";

/**
 * Phát bắn Thợ Săn do lõi deterministic chốt, không còn nhà cung cấp nào tham
 * gia. Não giả dưới đây chỉ còn hai method sinh lời nói; nếu một trong hai bị
 * gọi trong pha Thợ Săn thì đã có lời gọi mạng ở đường không được có.
 */
const brainControl = vi.hoisted(() => ({
  renderDaySpeech: vi.fn(),
}));

vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: () => undefined,
  persistRoom: async () => undefined,
  setRoomTimer: (_code: string, fn: () => void, ms: number) => setTimeout(fn, ms),
}));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));

vi.mock("../src/db", () => ({
  prisma: {
    gameResult: {
      create: async () => undefined,
    },
  },
}));

vi.mock("../src/bots", async () => {
  const actual = await vi.importActual<typeof import("../src/bots")>("../src/bots");
  return {
    ...actual,
    botBrain: () => ({
      name: "speech-only",
      renderDaySpeech: brainControl.renderDaySpeech,
    }),
  };
});

import { continueAfterDeathResult } from "../src/game/machine";

function hunterRoom(): Room {
  const state: GameState = {
    phase: "NIGHT_RESULT",
    round: 2,
    phaseEndsAt: 8_000,
    phaseStartedAt: 0,
    players: [
      { id: "hunter", name: "Thợ Săn", role: "HUNTER", alive: false, isBot: true },
      { id: "wolf", name: "Sói", role: "WEREWOLF", alive: true, isBot: false },
      { id: "villager", name: "Dân", role: "VILLAGER", alive: true, isBot: false },
      { id: "villager-2", name: "Dân 2", role: "VILLAGER", alive: true, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG, hunter: true },
    winner: null,
    night: {
      wolfVotes: {},
      killTarget: null,
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
    lastNightDeaths: [{ playerId: "hunter", name: "Thợ Săn" }],
    nightHistory: [],
    lastEliminated: null,
    trial: null,
    lastTrial: null,
    hunterReaction: { hunterId: "hunter", source: "night", resolved: false },
    hunterShots: [],
    log: [],
  };

  return {
    code: "HUNT1",
    hostId: "villager",
    status: "IN_GAME",
    members: state.players.map((player) => ({
      playerId: player.id,
      name: player.name,
      ready: true,
      connected: !player.isBot,
      isBot: player.isBot,
    })),
    config: { ...state.config },
    engine: new GameEngine(state),
    chatLog: [],
    createdAt: 0,
  };
}

describe("Hunter bot scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    brainControl.renderDaySpeech.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("nộp đúng một phát bắn trước hạn chót 15 giây, không gọi nhà cung cấp nào", async () => {
    const room = hunterRoom();
    const submit = vi.spyOn(room.engine!, "submitHunterShot");

    continueAfterDeathResult(room, "night");

    await vi.advanceTimersByTimeAsync(14_999);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(room.engine?.state.hunterShots).toHaveLength(1);
    expect(brainControl.renderDaySpeech).not.toHaveBeenCalled();

    // Hạn chót toàn cục nổ sau đó không được nộp thêm lần hai.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("không còn mục tiêu hợp lệ thì vẫn chốt pha bằng một phát bắn rỗng", async () => {
    const room = hunterRoom();
    for (const player of room.engine!.state.players) {
      if (player.id !== "hunter") player.alive = false;
    }

    continueAfterDeathResult(room, "night");
    await vi.advanceTimersByTimeAsync(20_000);

    expect(room.engine?.state.hunterShots).toHaveLength(1);
    expect(room.engine?.state.hunterShots[0].target).toBeNull();
  });
});
