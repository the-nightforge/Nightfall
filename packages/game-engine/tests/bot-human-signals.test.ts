import { describe, expect, it } from "vitest";
import type { DayVoteRecap, PublicVoteChoice } from "@masoi/shared";
import { BotRuntime } from "../src/bot/BotRuntime";
import { BOT_WEIGHTS_V10, BOT_WEIGHTS_V11 } from "../src/bot/config/weights";
import type {
  BotChatObservation,
  BotDecisionContext,
  BotKnowledgeView,
  BotPersonality,
} from "../src/bot/types";

/**
 * Hai tín hiệu P0.2 đi qua `BotRuntime.observe` - đúng đường `applyEvidence`
 * mà mọi bằng chứng công khai khác đi, không có đường riêng.
 */

const SHARP: BotPersonality = {
  aggressiveness: 0.5,
  talkativeness: 0.5,
  riskTolerance: 0.5,
  deceptionSkill: 0.5,
  analyticalSkill: 1,
  loyalty: 0.5,
  stubbornness: 0.5,
};

const PLAYERS = ["me", "a", "b", "c", "d"];

function player(targetId: string): PublicVoteChoice {
  return { type: "PLAYER", targetId };
}

function recap(
  round: number,
  ballots: Record<string, string | null>,
  accusedId: string | null = null,
): DayVoteRecap {
  const list = Object.entries(ballots).map(([voterId, to], index) => ({
    id: `${round}:nomination:${index + 1}`,
    round,
    voterId,
    previousChoice: null,
    choice: (to === null ? { type: "NO_ELIMINATION" } : player(to)) as PublicVoteChoice,
    castAt: 1_000 * (index + 1),
    phaseStartedAt: 0,
    phaseEndsAt: 30_000,
    sequence: index + 1,
  }));
  return {
    round,
    mutations: list,
    finalBallots: list.map((m) => ({ voterId: m.voterId, choice: m.choice })),
    nomination: accusedId ? { kind: "TRIAL", accusedId } : { kind: "NONE", reason: "tie" },
    finalJudgment: null,
  };
}

function context(over: Partial<BotKnowledgeView> = {}, chat: BotChatObservation[] = []): BotDecisionContext {
  return {
    knowledge: {
      botId: "me",
      round: 3,
      phase: "VOTING",
      phaseStartedAt: 0,
      phaseEndsAt: 30_000,
      selfRole: "VILLAGER",
      players: PLAYERS.map((id) => ({ id, name: id.toUpperCase(), alive: true })),
      knownRoles: { me: "VILLAGER" },
      seerResult: null,
      neutralRolesInPlay: [],
      night: null,
      trialAccusedId: null,
      canFinalVote: false,
      hunterShot: null,
      publicVoteHistory: [],
      currentVoteCounts: { players: {}, noElimination: 0 },
      hasVoted: false,
      myVote: null,
      legalVoteChoices: [],
      lastNightDeaths: [],
      activeEventId: null,
      dayOfTruthClaims: {},
      ...over,
    },
    visibleChat: chat,
  };
}

function runtime(weights = BOT_WEIGHTS_V11): BotRuntime {
  return new BotRuntime({
    playerId: "me",
    rng: () => 0,
    playerIds: PLAYERS,
    personality: SHARP,
    weights,
  });
}

/** d bỏ phiếu trắng ba vòng liền và không ai đụng tới d. */
function avoidantHistory(): DayVoteRecap[] {
  return [
    recap(1, { me: "c", a: "c", b: "a", c: "a", d: null }, "c"),
    recap(2, { me: "c", a: "c", b: "a", c: "a", d: null }),
    recap(3, { me: "c", a: "c", b: "a", c: "b", d: null }, "c"),
  ];
}

describe("AVOIDANCE qua BotRuntime", () => {
  it("nghi người né tránh sau ba vòng, và chỉ cộng một lần dù observe nhiều lần", () => {
    const bot = runtime();
    const ctx = context({ publicVoteHistory: avoidantHistory() });

    bot.observe(ctx);
    const once = bot.state.suspicion.d!.score;
    expect(once).toBeGreaterThan(0);
    expect(bot.state.suspicion.d!.reasons.map((r) => r.kind)).toContain("AVOIDANCE");

    bot.observe(ctx);
    bot.observe(ctx);
    expect(bot.state.suspicion.d!.score).toBe(once);
  });

  it("ghi một memory AVOIDANCE có nguồn là recap thật", () => {
    const bot = runtime();
    bot.observe(context({ publicVoteHistory: avoidantHistory() }));

    const memories = bot.state.memories.filter((m) => m.type === "AVOIDANCE");
    expect(memories.length).toBeGreaterThan(0);
    for (const memory of memories) {
      expect(memory.actorId).toBe("d");
      expect(bot.state.seenEventIds).toContain(memory.sourceId);
    }
  });

  it("không nghi ai khi mới có hai vòng", () => {
    const bot = runtime();
    bot.observe(context({ round: 2, publicVoteHistory: avoidantHistory().slice(0, 2) }));
    expect(bot.state.suspicion.d!.score).toBe(0);
  });

  it("v10 không có tín hiệu này", () => {
    const bot = runtime(BOT_WEIGHTS_V10);
    bot.observe(context({ publicVoteHistory: avoidantHistory() }));
    expect(bot.state.suspicion.d!.reasons.map((r) => r.kind)).not.toContain("AVOIDANCE");
  });
});

describe("DEFENSE_QUALITY qua BotRuntime", () => {
  const trialRound: DayVoteRecap[] = [recap(2, { me: "c", a: "c", b: "c", c: "a", d: "c" }, "c")];
  const defenseWindow = { startedAt: 40_000, endedAt: 70_000 };

  function duringDefense(chat: BotChatObservation[] = []): BotDecisionContext {
    return context(
      {
        round: 2,
        phase: "DEFENSE",
        trialAccusedId: "c",
        trialDefense: { startedAt: defenseWindow.startedAt, endedAt: null },
        publicVoteHistory: trialRound,
      },
      chat,
    );
  }

  function atFinalVote(chat: BotChatObservation[] = []): BotDecisionContext {
    return context(
      {
        round: 2,
        phase: "FINAL_VOTE",
        trialAccusedId: "c",
        trialDefense: defenseWindow,
        publicVoteHistory: trialRound,
        canFinalVote: true,
      },
      chat,
    );
  }

  it("bị cáo im lặng suốt lượt bào chữa thì bị nghi thêm, đúng một lần", () => {
    const bot = runtime();
    bot.observe(duringDefense());
    const beforeVerdict = bot.state.suspicion.c!.score;
    // Lượt bào chữa chưa khép: chưa được phán xét gì.
    expect(bot.state.suspicion.c!.reasons.map((r) => r.kind)).not.toContain("DEFENSE_QUALITY");

    bot.observe(atFinalVote());
    const after = bot.state.suspicion.c!.score;
    expect(after).toBeGreaterThan(beforeVerdict);
    const reason = bot.state.suspicion.c!.reasons.find((r) => r.kind === "DEFENSE_QUALITY");
    expect(reason?.id).toBe("2:nomination:result:DEFENSE_QUALITY:silent");

    bot.observe(atFinalVote());
    expect(bot.state.suspicion.c!.score).toBe(after);
  });

  it("chỉ tính lời nói trong CỬA SỔ bào chữa, không tính câu nói trước đó", () => {
    const early: BotChatObservation = { id: "m0", actorId: "c", text: "Tôi nghi A", at: 10_000 };
    const bot = runtime();
    bot.observe(atFinalVote([early]));
    const reason = bot.state.suspicion.c!.reasons.find((r) => r.kind === "DEFENSE_QUALITY");
    expect(reason?.id).toBe("2:nomination:result:DEFENSE_QUALITY:silent");
  });

  it("bị cáo chỉ lái sang người khác thì bị nghi, và nhắm đúng người bị lái sang", () => {
    const deflect: BotChatObservation = { id: "m1", actorId: "c", text: "Tôi nghi A", at: 50_000 };
    const bot = runtime();
    bot.observe(atFinalVote([deflect]));
    const reason = bot.state.suspicion.c!.reasons.find((r) => r.kind === "DEFENSE_QUALITY");
    expect(reason?.id).toBe("2:nomination:result:DEFENSE_QUALITY:deflect:a");
    expect(reason?.targetId).toBe("a");
  });

  it("bị cáo nhận vơ vai chức năng lần đầu lúc bị xử", () => {
    const grab: BotChatObservation = { id: "m1", actorId: "c", text: "Tôi là tiên tri", at: 50_000 };
    const bot = runtime();
    bot.observe(atFinalVote([grab]));
    const reason = bot.state.suspicion.c!.reasons.find((r) => r.kind === "DEFENSE_QUALITY");
    expect(reason?.id).toBe("2:nomination:result:DEFENSE_QUALITY:grab");
  });

  it("đã khai vai từ trước phiên toà thì nhắc lại không phải nhận vơ", () => {
    const earlier: BotChatObservation = { id: "m0", actorId: "c", text: "Tôi là tiên tri", at: 5_000 };
    const again: BotChatObservation = { id: "m1", actorId: "c", text: "Tôi là tiên tri mà", at: 50_000 };
    const bot = runtime();
    bot.observe(context({ round: 1, phase: "DAY_DISCUSSION" }, [earlier]));
    bot.observe(atFinalVote([earlier, again]));
    expect(bot.state.suspicion.c!.reasons.map((r) => r.kind)).not.toContain("DEFENSE_QUALITY");
  });

  it("bị cáo nói nhưng parser không hiểu thì không phán xét gì", () => {
    const vague: BotChatObservation = { id: "m1", actorId: "c", text: "mọi người tin tôi đi mà", at: 50_000 };
    const bot = runtime();
    bot.observe(atFinalVote([vague]));
    expect(bot.state.suspicion.c!.reasons.map((r) => r.kind)).not.toContain("DEFENSE_QUALITY");
  });

  it("không có cửa sổ bào chữa (harness tự chơi) thì không phán xét", () => {
    const bot = runtime();
    bot.observe(
      context({
        round: 2,
        phase: "FINAL_VOTE",
        trialAccusedId: "c",
        publicVoteHistory: trialRound,
        canFinalVote: true,
      }),
    );
    expect(bot.state.suspicion.c!.reasons.map((r) => r.kind)).not.toContain("DEFENSE_QUALITY");
  });

  it("bot là bị cáo thì không tự nghi mình", () => {
    const bot = new BotRuntime({
      playerId: "c",
      rng: () => 0,
      playerIds: PLAYERS,
      personality: SHARP,
      weights: BOT_WEIGHTS_V11,
    });
    const ctx = atFinalVote();
    ctx.knowledge.botId = "c";
    bot.observe(ctx);
    expect(bot.state.suspicion.c).toBeUndefined();
  });
});
