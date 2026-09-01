import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Attempt, DaySpeechDecision } from "../src/bots/types";
import type { Room } from "../src/rooms/store";
import { scheduleDayBots, submitDiscussionSkip } from "../src/game/machine";
import { clearDiscussionSkipVotes } from "../src/game/discussion-skip";
import { ROOM_SCAFFOLD } from "./helpers/room";
import { NIGHT_SCAFFOLD } from "./helpers/night";
import { GAME_STATE_SCAFFOLD } from "./helpers/game-state";

const brainControl = vi.hoisted(() => ({
  renderDaySpeech: vi.fn(),
  resolveDay: undefined as ((attempt: Attempt<DaySpeechDecision>) => void) | undefined,
}));

const runtimeControl = vi.hoisted(() => ({ recordSpeech: vi.fn() }));

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

/**
 * Runtime giả luôn muốn nói: test này kiểm tra việc BỎ kết quả cũ, không kiểm
 * tra xác suất im lặng theo personality.
 */
vi.mock("../src/bots/session-registry", async () => {
  const engine = await vi.importActual<typeof import("@masoi/game-engine")>(
    "@masoi/game-engine",
  );
  const intention = {
    kind: "ACCUSE" as const,
    targetId: "human1",
    confidence: 0.9,
    evidence: [],
    tone: "FIRM" as const,
  };
  const runtime = {
    state: {
      speechMemory: [] as unknown[],
      speechSequence: 0,
      repliedMessageIds: [] as string[],
    },
    style: engine.deriveSpeechStyle({
      aggressiveness: 0.5,
      talkativeness: 0.9,
      riskTolerance: 0.5,
      deceptionSkill: 0.5,
      analyticalSkill: 0.5,
      loyalty: 0.5,
      stubbornness: 0.5,
    }),
    weights: engine.DEFAULT_BOT_WEIGHTS,
    observe: () => undefined,
    decideVote: () => ({
      kind: "VOTE" as const,
      choice: { type: "PLAYER" as const, targetId: "human1" },
      confidence: 0.9,
      evidence: [],
    }),
    decideSpeech: () => intention,
    recordSpeech: runtimeControl.recordSpeech,
  };
  return {
    botSessionFor: () => ({ runtimeFor: () => runtime, rngFor: () => () => 0.5 }),
    startBotSession: () => undefined,
    clearBotSession: () => undefined,
  };
});

vi.mock("../src/bots", async () => {
  const actual = await vi.importActual<typeof import("../src/bots")>("../src/bots");
  return {
    ...actual,
    botBrain: () => ({
      name: "deferred-day-brain",
      renderDaySpeech: brainControl.renderDaySpeech,
    }),
  };
});

function discussionRoom(): Room {
  const state: GameState = {
    ...GAME_STATE_SCAFFOLD,
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
      ...NIGHT_SCAFFOLD,
      killTarget: null,
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
    log: [],
  };

  return {
    ...ROOM_SCAFFOLD,
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
    runtimeControl.recordSpeech.mockReset();
    brainControl.renderDaySpeech.mockReset();
    brainControl.renderDaySpeech.mockImplementation(
      () => new Promise<Attempt<DaySpeechDecision>>((resolve) => {
        brainControl.resolveDay = resolve;
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    clearDiscussionSkipVotes("ABCDE");
  });

  it("bỏ kết quả AI đang chạy nếu người thật skip sang bỏ phiếu", async () => {
    const room = discussionRoom();
    scheduleDayBots(room);

    const botDelay = Math.floor(room.config.discussionSeconds * 1_000 / 2);
    await vi.advanceTimersByTimeAsync(botDelay);
    expect(brainControl.renderDaySpeech).toHaveBeenCalledTimes(1);

    submitDiscussionSkip(room, "human1", true);
    submitDiscussionSkip(room, "human2", true);
    expect(room.engine!.getState().phase).toBe("VOTING");

    brainControl.resolveDay?.({
      ok: true,
      value: { chat: "Tin thảo luận đã lỗi thời" },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(room.chatLog).toEqual([]);
    // Lời nói bị bỏ thì căn cứ của nó cũng không được đánh dấu là "đã dùng":
    // ghi vào speechMemory ở đây sẽ khoá luôn luận điểm mà bot chưa hề nói ra.
    expect(runtimeControl.recordSpeech).not.toHaveBeenCalled();
  });

  it("không chốt sẵn phiếu ở pha thảo luận", async () => {
    const room = discussionRoom();
    scheduleDayBots(room);

    await vi.advanceTimersByTimeAsync(Math.floor(room.config.discussionSeconds * 1_000 / 2));
    brainControl.resolveDay?.({ ok: true, value: { chat: "Tôi nghi Người 1" } });
    await vi.advanceTimersByTimeAsync(0);

    // Bỏ phiếu là việc của pha VOTING. Một phiếu đóng băng từ lúc thảo luận là
    // phiếu bỏ qua mọi thứ xảy ra sau đó, kể cả người vừa bị nghi lên tiếng.
    expect(room.engine!.getState().votes).toEqual({});
  });
});
