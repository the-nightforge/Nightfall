import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Attempt, DayDecision } from "../src/bots/types";
import type { Room } from "../src/rooms/store";
import { scheduleDayBots, submitDiscussionSkip } from "../src/game/machine";
import { pendingVote } from "../src/game/bot-room-state";
import { clearDiscussionSkipVotes } from "../src/game/discussion-skip";

const brainControl = vi.hoisted(() => ({
  decideDay: vi.fn(),
  resolveDay: undefined as ((attempt: Attempt<DayDecision>) => void) | undefined,
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

vi.mock("../src/db", () => ({ prisma: {} }));

vi.mock("../src/bots", async () => {
  const actual = await vi.importActual<typeof import("../src/bots")>("../src/bots");
  return {
    ...actual,
    botBrain: () => ({
      name: "deferred-day-brain",
      decideNight: vi.fn(),
      decideDay: brainControl.decideDay,
    }),
  };
});

function discussionRoom(): Room {
  const state: GameState = {
    phase: "DAY_DISCUSSION",
    round: 1,
    phaseEndsAt: Date.now() + DEFAULT_ROOM_CONFIG.discussionSeconds * 1_000,
    players: [
      { id: "human1", name: "Người 1", role: "VILLAGER", alive: true, isBot: false },
      { id: "human2", name: "Người 2", role: "SEER", alive: true, isBot: false },
      { id: "bot", name: "Bot Sói", role: "WEREWOLF", alive: true, isBot: true },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    winner: null,
    night: {
      killTarget: null,
      actedWolves: [],
      guardTarget: null,
      healTonight: false,
      poisonTarget: null,
      seerResults: {},
    },
    votes: {},
    guardPrevious: null,
    healUsed: false,
    poisonUsed: false,
    lastNightDeaths: [],
    nightHistory: [],
    lastEliminated: null,
    log: [],
  };

  return {
    code: "ABCDE",
    hostId: "human1",
    status: "IN_GAME",
    members: [
      { playerId: "human1", name: "Người 1", ready: true, connected: true, isBot: false },
      { playerId: "human2", name: "Người 2", ready: true, connected: true, isBot: false },
      { playerId: "bot", name: "Bot Sói", ready: true, connected: false, isBot: true },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: new GameEngine(state),
    chatLog: [],
    createdAt: 0,
  };
}

describe("scheduleDayBots", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    brainControl.resolveDay = undefined;
    brainControl.decideDay.mockReset();
    brainControl.decideDay.mockImplementation(
      () => new Promise<Attempt<DayDecision>>((resolve) => {
        brainControl.resolveDay = resolve;
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    pendingVote.delete("ABCDE");
    clearDiscussionSkipVotes("ABCDE");
  });

  it("bỏ kết quả AI đang chạy nếu người thật skip sang bỏ phiếu", async () => {
    const room = discussionRoom();
    scheduleDayBots(room);

    const botDelay = Math.floor(room.config.discussionSeconds * 1_000 / 2);
    await vi.advanceTimersByTimeAsync(botDelay);
    expect(brainControl.decideDay).toHaveBeenCalledTimes(1);

    submitDiscussionSkip(room, "human1", true);
    submitDiscussionSkip(room, "human2", true);
    expect(room.engine!.getState().phase).toBe("VOTING");

    brainControl.resolveDay?.({
      ok: true,
      value: { chat: "Tin thảo luận đã lỗi thời", voteTargetId: "human1" },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(room.chatLog).toEqual([]);
    expect(pendingVote.get(room.code)?.has("bot")).toBe(false);
  });
});
