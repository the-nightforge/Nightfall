import { describe, expect, it } from "vitest";
import { BotRuntime } from "../src/bot/BotRuntime";
import { wolfBluffSeat } from "../src/bot/decision/claim-decision";
import {
  wolfBluffCandidateScore,
  wolfBluffPick,
  wolfDistanceStance,
} from "../src/bot/decision/wolf-bluff";
import { planWolfTeam } from "../src/bot/roles/wolf-team-plan";
import { planSpeech } from "../src/bot/conversation/speech-planner";
import { deriveSpeechStyle } from "../src/bot/personality/speech-style";
import { BOT_WEIGHTS_V26, BOT_WEIGHTS_V27 } from "../src/bot/config/weights";
import { createSeededRng } from "../src/bot/rng";
import { socialEdgeKey } from "../src/bot/analysis/social-analysis";
import type {
  BotBrainState,
  BotChatObservation,
  BotDecisionContext,
  BotKnowledgeView,
  BotPlayerKnowledge,
  BotVoteIntention,
} from "../src/bot/types";

const PLAYERS: BotPlayerKnowledge[] = [
  { id: "w1", name: "An", alive: true },
  { id: "w2", name: "Bình", alive: true },
  { id: "v1", name: "Chi", alive: true },
  { id: "v2", name: "Dũng", alive: true },
  { id: "v3", name: "Em", alive: true },
];

const PACK_ROLES = { w1: "WEREWOLF" as const, w2: "WEREWOLF" as const };

function context(
  botId: string,
  over: Partial<BotKnowledgeView> = {},
  chat: BotChatObservation[] = [],
): BotDecisionContext {
  return {
    knowledge: {
      dayOfTruthClaims: {},
      activeEventId: null,
      neutralRolesInPlay: [],
      botId,
      round: 2,
      phase: "DAY_DISCUSSION",
      phaseStartedAt: 0,
      phaseEndsAt: null,
      selfRole: "WEREWOLF",
      players: PLAYERS,
      knownRoles: { ...PACK_ROLES },
      seerResult: null,
      sorcererResult: null,
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
      ...over,
    },
    visibleChat: chat,
  };
}

function wolf(botId: string, weights = BOT_WEIGHTS_V27): BotRuntime {
  return new BotRuntime({
    playerId: botId,
    rng: createSeededRng(botId),
    playerIds: PLAYERS.map((player) => player.id),
    weights,
  });
}

const PACK = ["w1", "w2"];

describe("wolfBluffCandidateScore (§17)", () => {
  it("ghế đang gánh phiếu bị trừ điểm", () => {
    const bot = wolf("w1");
    const clean = context("w1");
    const pressed = context("w1", {
      currentVoteCounts: { players: { w2: 4 }, noElimination: 0 },
    });

    const a = wolfBluffCandidateScore(clean.knowledge, bot.state, "w2", BOT_WEIGHTS_V27);
    const b = wolfBluffCandidateScore(pressed.knowledge, bot.state, "w2", BOT_WEIGHTS_V27);
    expect(b.exposureRisk).toBeGreaterThan(a.exposureRisk);
    expect(b.score).toBeLessThan(a.score);
  });

  it("ghế đang bị cả bàn soi có lowSuspicion thấp hơn", () => {
    const bot = wolf("w1");
    for (const from of ["v1", "v2", "v3"]) {
      bot.state.relationships[socialEdgeKey(from, "w2")] = {
        support: 0,
        hostility: 0.9,
        voteAlignment: 0,
        samples: 3,
        reasons: [],
        lastUpdatedRound: 2,
      };
    }
    const scored = wolfBluffCandidateScore(
      context("w1").knowledge,
      bot.state,
      "w2",
      BOT_WEIGHTS_V27,
    );
    expect(scored.lowSuspicion).toBeLessThan(0.5);
  });

  it("mọi số hạng nằm trong [0,1]", () => {
    const bot = wolf("w1");
    const scored = wolfBluffCandidateScore(
      context("w1").knowledge,
      bot.state,
      "w2",
      BOT_WEIGHTS_V27,
    );
    for (const key of ["credibility", "persuadability", "lowSuspicion", "exposureRisk", "score"] as const) {
      expect(scored[key]).toBeGreaterThanOrEqual(0);
      expect(scored[key]).toBeLessThanOrEqual(1);
    }
  });
});

describe("wolfBluffPick — hash là fallback, không bị thay (§17)", () => {
  const hashSeat = wolfBluffSeat(PACK, PACK, 2);

  it("share = 0 trả về ĐÚNG ghế hash", () => {
    const bot = wolf("w1", BOT_WEIGHTS_V26);
    expect(BOT_WEIGHTS_V26.claim.wolfBluffScoreShare).toBe(0);
    expect(
      wolfBluffPick(context("w1").knowledge, bot.state, PACK, hashSeat, BOT_WEIGHTS_V26),
    ).toBe(hashSeat);
  });

  it("hoà điểm thì ghế hash vẫn thắng", () => {
    // Hồ sơ trống: hai ghế chấm bằng nhau, nên chỉ còn prior vòng xoay.
    const bot = wolf("w1", BOT_WEIGHTS_V27);
    expect(
      wolfBluffPick(context("w1").knowledge, bot.state, PACK, hashSeat, BOT_WEIGHTS_V27),
    ).toBe(hashSeat);
  });

  it("một ghế rõ ràng tệ hơn thì vòng xoay bị vượt", () => {
    const bot = wolf("w1", BOT_WEIGHTS_V27);
    const other = PACK.find((id) => id !== hashSeat)!;
    // Ghế hash đang gánh phiếu (khai lúc đó là ném lời khai đi) VÀ ghế kia có
    // hồ sơ đoán đúng dày. Cần cả hai: prior vòng xoay nặng 0.4, nên chỉ một
    // trong hai mình nó vừa đúng hoà - xem `wolfBluffPick`.
    bot.state.profiles[other] = {
      bluffRate: 0,
      aggroRate: 0,
      accuracy: 1,
      samples: 20,
      lastUpdatedRound: 2,
    };
    const pressed = context("w1", {
      currentVoteCounts: { players: { [hashSeat!]: 5 }, noElimination: 0 },
    });
    const picked = wolfBluffPick(
      pressed.knowledge,
      bot.state,
      PACK,
      hashSeat,
      BOT_WEIGHTS_V27,
    );
    expect(picked).not.toBe(hashSeat);
    expect(PACK).toContain(picked!);
  });

  it("bầy rỗng thì không có ghế nào", () => {
    const bot = wolf("w1");
    expect(wolfBluffPick(context("w1").knowledge, bot.state, [], null, BOT_WEIGHTS_V27)).toBeNull();
  });
});

describe("đồng bộ giữa các con Sói", () => {
  /**
   * Không có kênh liên lạc nào giữa hai `BotRuntime`. Hai con Sói cùng nghe một
   * dòng chat và cùng thấy một bảng phiếu PHẢI chốt cùng một ghế — nếu không,
   * cả hai cùng khai và bầy tự lộ.
   */
  it("hai con Sói nghe cùng một ván chốt cùng một ghế khai láo", () => {
    const chat: BotChatObservation[] = [
      { id: "m1", actorId: "v1", text: "Tôi nghi An", at: 0 },
      { id: "m2", actorId: "v2", text: "Tôi nghi An", at: 0 },
      { id: "m3", actorId: "v3", text: "Bình dựa vào đâu vậy", at: 0 },
    ];
    const votes = { players: { w1: 2 }, noElimination: 0 };

    const picks = ["w1", "w2"].map((id) => {
      const bot = wolf(id);
      const ctx = context(id, { currentVoteCounts: votes }, chat);
      bot.observe(ctx);
      return wolfBluffPick(
        ctx.knowledge,
        bot.state,
        PACK,
        wolfBluffSeat(PACK, PACK, 2),
        BOT_WEIGHTS_V27,
      );
    });

    expect(picks[0]).toBe(picks[1]);
  });

  it("kế hoạch của bầy và quyết định của từng con đọc CÙNG một hàm", () => {
    const bot = wolf("w1");
    const ctx = context("w1", {
      currentVoteCounts: { players: { w2: 4 }, noElimination: 0 },
      night: {
        canAct: true,
        legalActions: ["KILL"],
        legalTargets: { KILL: ["v1", "v2", "v3"] } as never,
        wolfTarget: null,
        guardPrevious: null,
        healUsed: false,
        poisonUsed: false,
        wolvesLocked: false,
        bonusSecondTargetFor: null,
      },
    });
    bot.observe(ctx);

    const plan = planWolfTeam({
      knowledge: ctx.knowledge,
      state: bot.state,
      weights: BOT_WEIGHTS_V27,
    });
    const direct = wolfBluffPick(
      ctx.knowledge,
      bot.state,
      PACK,
      wolfBluffSeat(PACK, PACK, 2),
      BOT_WEIGHTS_V27,
    );
    expect(plan.claimant).toBe(direct);
  });
});

describe("wolfDistanceStance (§18)", () => {
  const alive = (votes: Record<string, number>) =>
    context("w1", { currentVoteCounts: { players: votes, noElimination: 0 } }).knowledge;

  it("v26 tắt hẳn: Sói cứ bênh đồng bọn", () => {
    expect(wolfDistanceStance(alive({ w1: 5, w2: 5 }), "w2", "w1", BOT_WEIGHTS_V26)).toBe(
      "DEFEND",
    );
  });

  it("cả hai còn sạch thì bênh ra mặt", () => {
    expect(wolfDistanceStance(alive({}), "w2", "w1", BOT_WEIGHTS_V27)).toBe("DEFEND");
  });

  it("chính mình đang gánh phiếu thì không đụng vào chuyện đó", () => {
    expect(wolfDistanceStance(alive({ w1: 3, w2: 1 }), "w2", "w1", BOT_WEIGHTS_V27)).toBe(
      "IGNORE",
    );
  });

  it("đồng bọn bị dồn mà mình còn sạch thì chỉ gợn lại", () => {
    expect(wolfDistanceStance(alive({ w2: 3 }), "w2", "w1", BOT_WEIGHTS_V27)).toBe(
      "SOFT_DISAGREE",
    );
  });

  it("không bao giờ tự chọn BUS hay HARD_DISAGREE — đó là việc của lá phiếu", () => {
    const cases: Array<Record<string, number>> = [
      {},
      { w1: 1 },
      { w2: 4 },
      { w1: 4, w2: 4 },
      { w1: 2, w2: 2 },
    ];
    for (const votes of cases) {
      const stance = wolfDistanceStance(alive(votes), "w2", "w1", BOT_WEIGHTS_V27);
      expect(["DEFEND", "SOFT_DISAGREE", "IGNORE"]).toContain(stance);
    }
  });
});

describe("planSpeech — Sói giữ khoảng cách với đồng bọn (§18)", () => {
  const vote: BotVoteIntention = {
    kind: "VOTE",
    choice: { type: "PLAYER", targetId: "v1" },
    confidence: 0.5,
    evidence: [],
  };

  /** Chi tố Bình; An (Sói) tin Bình. Ứng viên đầu cho trigger là DEFEND. */
  function reactToAllyAccused(votes: Record<string, number>, weights = BOT_WEIGHTS_V27) {
    const bot = wolf("w1", weights);
    const chat: BotChatObservation[] = [{ id: "m1", actorId: "v1", text: "Tôi nghi Bình", at: 0 }];
    const ctx = context("w1", { currentVoteCounts: { players: votes, noElimination: 0 } }, chat);
    bot.observe(ctx);
    bot.state.trust["w2"] = { score: 40, reasons: [], lastUpdatedRound: 2 };
    // Ấm áp để `DEFEND` là ứng viên ĐẦU của `ACCUSED_MY_TRUSTED`, và hoạt ngôn
    // để lượt rút "có đáp không" không nuốt mất câu trả lời.
    bot.state.personality.loyalty = 0.95;
    bot.state.personality.aggressiveness = 0.05;
    bot.state.personality.talkativeness = 1;
    // Đã khai vai rồi: `decideChatClaim` thoát ngay, nên đường 0 (khai láo của
    // Sói) không cướp mất lượt này. Bài kiểm chỉ nói về đường trigger.
    bot.state.myClaim = { role: "VILLAGER", round: 1 };

    return planSpeech({
      context: ctx,
      state: bot.state,
      vote,
      style: deriveSpeechStyle(bot.state.personality),
      rng: createSeededRng("distance"),
      weights,
    });
  }

  /** Câu ĐÁP cho `m1`, hoặc `null` nếu lượt này nói chuyện khác. */
  function replyOf(votes: Record<string, number>, weights = BOT_WEIGHTS_V27) {
    const speech = reactToAllyAccused(votes, weights);
    return speech?.replyToMessageId === "m1" ? speech : null;
  }

  it("cả hai còn sạch: vẫn bênh", () => {
    expect(replyOf({})?.kind).toBe("DEFEND");
  });

  it("chính mình đang gánh phiếu: không bênh nữa", () => {
    expect(replyOf({ w1: 3 })?.kind).not.toBe("DEFEND");
  });

  it("v26 vẫn bênh dù chính mình đang gánh phiếu — chỗ hai bản khác nhau", () => {
    expect(replyOf({ w1: 3 }, BOT_WEIGHTS_V26)?.kind).toBe("DEFEND");
  });

  it("Dân Làng không có đồng bọn nên nhánh này không tồn tại với họ", () => {
    const bot = new BotRuntime({
      playerId: "v2",
      rng: createSeededRng("villager"),
      playerIds: PLAYERS.map((player) => player.id),
      weights: BOT_WEIGHTS_V27,
    });
    const chat: BotChatObservation[] = [{ id: "m1", actorId: "v1", text: "Tôi nghi Bình", at: 0 }];
    const ctx: BotDecisionContext = {
      knowledge: {
        ...context("v2", { currentVoteCounts: { players: { v2: 3 }, noElimination: 0 } }, chat)
          .knowledge,
        selfRole: "VILLAGER",
        // Dân Làng KHÔNG thấy bầy: engine lọc `knownRoles` theo vai.
        knownRoles: {},
      },
      visibleChat: chat,
    };
    bot.observe(ctx);
    bot.state.trust["w2"] = { score: 40, reasons: [], lastUpdatedRound: 2 };
    bot.state.personality.loyalty = 0.95;
    bot.state.personality.aggressiveness = 0.05;
    bot.state.personality.talkativeness = 1;
    bot.state.myClaim = { role: "VILLAGER", round: 1 };

    const speech = planSpeech({
      context: ctx,
      state: bot.state,
      vote,
      style: deriveSpeechStyle(bot.state.personality),
      rng: createSeededRng("distance"),
      weights: BOT_WEIGHTS_V27,
    });
    expect(speech?.kind).toBe("DEFEND");
  });
});

/** Giữ kiểu cho rõ ý đồ fixture. */
export type _State = BotBrainState;
