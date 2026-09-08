import { describe, expect, it } from "vitest";
import {
  expectedOutcomeFor,
  counterfactualVotePlanner,
} from "../src/bot/planning/counterfactual";
import { projectRoleBeliefs } from "../src/bot/belief/role-belief";
import { immediateUtilityPlanner } from "../src/bot/planning/planner";
import { deriveVoteScoringFrame, scoreVoteCandidate, selectVote } from "../src/bot/decision/vote-decision";
import { sumTerms, createDecisionProbe } from "../src/bot/trace/trace";
import { BotRuntime } from "../src/bot/BotRuntime";
import { createSeededRng } from "../src/bot/rng";
import type { BotKnowledgeView, BotPersonality } from "../src/bot/types";
import { BOT_WEIGHTS_V18, BOT_WEIGHTS_V21, BOT_WEIGHTS_V22 } from "../src/bot/config/weights";
import { weightsPreset } from "../src/bot/config/presets";

/**
 * PR 3 của BOT_AI_CONTINUE_UPGRADE (§10/§11/§35): counterfactual MỘT BƯỚC có
 * cấu trúc — vươn từ `futureRisk` đơn thành phần (v20) thành ExpectedOutcome
 * phân biệt survival / information / team value, chạy trên seam planner M5.
 *
 * Kỷ luật:
 * - Tất định, không RNG (giống v20).
 * - Nhánh Sói byte-identical với v18 ở v21 (wolfSideGain để cho PR 5).
 * - Σterms === score giữ nguyên trên mọi bảng điểm.
 */

const BALANCED: BotPersonality = {
  aggressiveness: 0.5,
  talkativeness: 0.9,
  riskTolerance: 0.5,
  deceptionSkill: 0.0,
  analyticalSkill: 1,
  loyalty: 0.5,
  stubbornness: 0.5,
};

const DECK_8: Record<string, number> = {
  WEREWOLF: 2,
  SEER: 1,
  WITCH: 1,
  GUARD: 1,
  HUNTER: 1,
  DETECTIVE: 1,
  VILLAGER: 1,
};

function knowledge(
  overrides: Partial<BotKnowledgeView> = {},
  selfRole: BotKnowledgeView["selfRole"] = "VILLAGER",
): BotKnowledgeView {
  return {
    botId: "me",
    round: 4,
    phase: "VOTING",
    phaseStartedAt: 0,
    phaseEndsAt: 30_000,
    selfRole,
    players: [
      { id: "me", name: "Me", alive: true },
      { id: "b", name: "B", alive: true },
      { id: "c", name: "C", alive: true },
      { id: "d", name: "D", alive: true },
      { id: "e", name: "E", alive: true },
      { id: "x", name: "X", alive: false },
      { id: "y", name: "Y", alive: false },
      { id: "w", name: "W", alive: false },
    ],
    knownRoles: { me: selfRole },
    seerResult: null,
    sorcererResult: null,
    trackerResult: null,
    neutralRolesInPlay: [],
    night: null,
    trialAccusedId: null,
    canFinalVote: false,
    hunterShot: null,
    publicVoteHistory: [],
    currentVoteCounts: { players: {}, noElimination: 0 },
    hasVoted: false,
    myVote: null,
    legalVoteChoices: ["b", "c"].map((targetId) => ({ type: "PLAYER" as const, targetId })),
    lastNightDeaths: [],
    activeEventId: null,
    dayOfTruthClaims: {},
    roleComposition: DECK_8,
    ...overrides,
  };
}

function runtime(selfRole: BotKnowledgeView["selfRole"] = "VILLAGER") {
  return new BotRuntime({
    playerId: "me",
    rng: createSeededRng("counterfactual"),
    playerIds: ["me", "b", "c", "d", "e", "x", "y", "w"],
    personality: BALANCED,
    weights: BOT_WEIGHTS_V21,
  });
}

function seeded(
  selfRole: BotKnowledgeView["selfRole"] = "VILLAGER",
  mutate?: (bot: BotRuntime, ctx: BotKnowledgeView) => void,
) {
  const ctx = knowledge({}, selfRole);
  const bot = runtime(selfRole);
  const reason = (id: string, weight: number) => ({
    id: `ev-${id}`,
    kind: "TIE_BREAK" as const,
    sourceId: `1:nomination:${id}`,
    actorId: id,
    targetId: "z",
    weight,
    confidence: 0.7,
    round: 1,
    summary: `Phiếu phá hoà của ${id}.`,
  });
  bot.state.seenEventIds.push("1:nomination:b", "1:nomination:c");
  bot.state.suspicion["b"] = { score: 70, reasons: [reason("b", 10)], lastUpdatedRound: 1 };
  bot.state.suspicion["c"] = { score: 10, reasons: [reason("c", 2)], lastUpdatedRound: 1 };
  bot.state.trust["c"] = { score: 60, reasons: [], lastUpdatedRound: 1 };
  if (mutate) mutate(bot, ctx);
  return { bot, ctx };
}

describe("expectedOutcomeFor (PR3 — counterfactual một bước)", () => {
  it("teamValue tăng theo P(Sói) của mục tiêu", () => {
    const { bot, ctx } = seeded();
    const beliefs = projectRoleBeliefs({
      knowledge: ctx,
      state: bot.state,
      roleComposition: DECK_8,
    });
    const frame = deriveVoteScoringFrame({ knowledge: ctx, visibleChat: [] }, bot.state, BOT_WEIGHTS_V21);
    const high = expectedOutcomeFor("b", { context: { knowledge: ctx, visibleChat: [] }, state: bot.state, rng: createSeededRng("x"), frame }, beliefs);
    const low = expectedOutcomeFor("c", { context: { knowledge: ctx, visibleChat: [] }, state: bot.state, rng: createSeededRng("x"), frame }, beliefs);
    expect(high.wolfProbability).toBeGreaterThan(low.wolfProbability);
    expect(high.teamValue).toBeGreaterThan(low.teamValue);
  });

  it("survivalValue tăng theo áp lực sĩ số, chỉ phạt phần có thể nhầm", () => {
    // 5/8 sống → pressure = 3/8. So sánh với bàn 7/8 sống (pressure = 1/8).
    const thin = seeded();
    const thinFrame = deriveVoteScoringFrame({ knowledge: thin.ctx, visibleChat: [] }, thin.bot.state, BOT_WEIGHTS_V21);
    const thinBeliefs = projectRoleBeliefs({ knowledge: thin.ctx, state: thin.bot.state, roleComposition: DECK_8 });
    const thinOutcome = expectedOutcomeFor("c", { context: { knowledge: thin.ctx, visibleChat: [] }, state: thin.bot.state, rng: createSeededRng("x"), frame: thinFrame }, thinBeliefs);

    const fatCtx = knowledge({
      players: [
        { id: "me", name: "Me", alive: true },
        { id: "b", name: "B", alive: true },
        { id: "c", name: "C", alive: true },
        { id: "d", name: "D", alive: true },
        { id: "e", name: "E", alive: true },
        { id: "x", name: "X", alive: true },
        { id: "y", name: "Y", alive: true },
        { id: "w", name: "W", alive: false },
      ],
    });
    const fatBot = runtime();
    fatBot.state.seenEventIds.push("1:nomination:b", "1:nomination:c");
    fatBot.state.suspicion["c"] = { score: 10, reasons: [], lastUpdatedRound: 1 };
    fatBot.state.trust["c"] = { score: 60, reasons: [], lastUpdatedRound: 1 };
    const fatFrame = deriveVoteScoringFrame({ knowledge: fatCtx, visibleChat: [] }, fatBot.state, BOT_WEIGHTS_V21);
    const fatBeliefs = projectRoleBeliefs({ knowledge: fatCtx, state: fatBot.state, roleComposition: DECK_8 });
    const fatOutcome = expectedOutcomeFor("c", { context: { knowledge: fatCtx, visibleChat: [] }, state: fatBot.state, rng: createSeededRng("x"), frame: fatFrame }, fatBeliefs);

    expect(thinOutcome.survivalValue).toBeLessThan(fatOutcome.survivalValue);
    expect(thinOutcome.survivalValue).toBeLessThanOrEqual(0);
  });

  it("informationValue phạt việc mất người đang mang bằng chứng khi làng khan dữ liệu", () => {
    const { bot, ctx } = seeded();
    const frame = deriveVoteScoringFrame({ knowledge: ctx, visibleChat: [] }, bot.state, BOT_WEIGHTS_V21);
    const beliefs = projectRoleBeliefs({ knowledge: ctx, state: bot.state, roleComposition: DECK_8 });
    const withReasons = expectedOutcomeFor("c", { context: { knowledge: ctx, visibleChat: [] }, state: bot.state, rng: createSeededRng("x"), frame }, beliefs);

    // Bỏ reasons của c: cùng trust, cùng p — nhưng c không còn là nguồn dữ liệu.
    bot.state.suspicion["c"] = { score: 10, reasons: [], lastUpdatedRound: 1 };
    const withoutReasons = expectedOutcomeFor("c", { context: { knowledge: ctx, visibleChat: [] }, state: bot.state, rng: createSeededRng("x"), frame }, beliefs);
    expect(withReasons.informationValue).toBeLessThan(0);
    expect(withoutReasons.informationValue).toBeGreaterThan(withReasons.informationValue);
  });

  it("nhánh Sói ở v21: mọi thành phần counterfactual = 0, wrapper là passthrough", () => {
    const { bot, ctx } = seeded("WEREWOLF");
    const frame = deriveVoteScoringFrame({ knowledge: ctx, visibleChat: [] }, bot.state, BOT_WEIGHTS_V21);
    const beliefs = projectRoleBeliefs({ knowledge: ctx, state: bot.state, roleComposition: DECK_8 });
    const outcome = expectedOutcomeFor("b", { context: { knowledge: ctx, visibleChat: [] }, state: bot.state, rng: createSeededRng("x"), frame }, beliefs);
    expect(outcome.teamValue).toBe(0);
    expect(outcome.survivalValue).toBe(0);
    expect(outcome.informationValue).toBe(0);

    const base = immediateUtilityPlanner(scoreVoteCandidate);
    const wrapper = counterfactualVotePlanner(base, beliefs);
    const baseEval = base.evaluate("b", { context: { knowledge: ctx, visibleChat: [] }, state: bot.state, rng: createSeededRng("x"), frame });
    const wrappedEval = wrapper.evaluate("b", { context: { knowledge: ctx, visibleChat: [] }, state: bot.state, rng: createSeededRng("x"), frame });
    expect(wrappedEval).toEqual(baseEval);
  });

  it("nhánh Sói ở v22 (wolfSideGain > 0): teamValue thưởng bỏ phiếu người không-Sói, survival phạt bỏ phiếu đồng bọn", () => {
    const { bot, ctx } = seeded("WEREWOLF");
    bot.state.seenEventIds.push("1:nomination:d");
    // d = đồng bọn Sói đã lộ trong knownRoles → P(wolf)=1; b = người thường.
    const ctxWithPack = {
      ...ctx,
      knownRoles: { me: "WEREWOLF" as const, d: "WEREWOLF" as const },
      players: [...ctx.players, { id: "d", name: "D", alive: true }],
    };
    const frame = deriveVoteScoringFrame({ knowledge: ctxWithPack, visibleChat: [] }, bot.state, BOT_WEIGHTS_V22);
    const beliefs = projectRoleBeliefs({
      knowledge: ctxWithPack,
      state: bot.state,
      roleComposition: DECK_8,
    });

    const villagerOutcome = expectedOutcomeFor("b", { context: { knowledge: ctxWithPack, visibleChat: [] }, state: bot.state, rng: createSeededRng("x"), frame }, beliefs);
    // Bỏ phiếu người không-Sói khi làng còn mỏng: lợi cho Sói (teamValue > 0).
    expect(villagerOutcome.teamValue).toBeGreaterThan(0);
    expect(villagerOutcome.survivalValue).toBeLessThan(0);

    const mateOutcome = expectedOutcomeFor("d", { context: { knowledge: ctxWithPack, visibleChat: [] }, state: bot.state, rng: createSeededRng("x"), frame }, beliefs);
    // Bỏ phiếu đồng bọn (P(wolf)=1): teamValue = 0, survival phạt tối đa.
    expect(mateOutcome.teamValue).toBe(0);
    expect(mateOutcome.survivalValue).toBeLessThan(villagerOutcome.survivalValue);
  });

  it("preset 22.0.0 đăng ký đúng, wolfSideGain = 5; v21 vẫn 0", () => {
    expect(weightsPreset("22.0.0").version).toBe("22.0.0");
    expect(BOT_WEIGHTS_V22.counterfactual?.wolfSideGain).toBe(5);
    expect(BOT_WEIGHTS_V21.counterfactual?.wolfSideGain).toBe(0);
  });

  it("planner bọc: term named survivalValue/informationValue/teamValue, Σterms === score", () => {
    const { bot, ctx } = seeded();
    const frame = deriveVoteScoringFrame({ knowledge: ctx, visibleChat: [] }, bot.state, BOT_WEIGHTS_V21);
    const beliefs = projectRoleBeliefs({ knowledge: ctx, state: bot.state, roleComposition: DECK_8 });
    const base = immediateUtilityPlanner(scoreVoteCandidate);
    const wrapper = counterfactualVotePlanner(base, beliefs);
    const evaluation = wrapper.evaluate("b", { context: { knowledge: ctx, visibleChat: [] }, state: bot.state, rng: createSeededRng("x"), frame });
    const names = evaluation.terms.map((term) => term.name);
    expect(names).toContain("survivalValue");
    expect(names).toContain("informationValue");
    expect(names).toContain("teamValue");
    expect(sumTerms(evaluation.terms)).toBeCloseTo(evaluation.score, 10);
  });
});

describe("selectVote với weights v21", () => {
  it("preset 21.0.0 đăng ký đúng, default vẫn v18", () => {
    expect(weightsPreset("21.0.0").version).toBe("21.0.0");
    expect(BOT_WEIGHTS_V21.counterfactual).toBeDefined();
    expect(BOT_WEIGHTS_V18.counterfactual).toBeUndefined();
  });

  it("v21 thêm ba term counterfactual vào bảng điểm phiếu, vẫn chọn target hợp lệ", () => {
    const { bot, ctx } = seeded();
    const probe = createDecisionProbe();
    const intention = selectVote({ knowledge: ctx, visibleChat: [] }, bot.state, createSeededRng("cf-vote"), BOT_WEIGHTS_V21, probe);
    expect(intention.choice).toEqual({ type: "PLAYER", targetId: "b" });
    for (const candidate of probe.candidates) {
      const names = candidate.terms.map((term) => term.name);
      expect(names).toContain("teamValue");
      expect(sumTerms(candidate.terms)).toBeCloseTo(candidate.score, 10);
    }
    // Tất định.
    const replay = selectVote({ knowledge: ctx, visibleChat: [] }, bot.state, createSeededRng("cf-vote"), BOT_WEIGHTS_V21);
    expect(replay.choice).toEqual(intention.choice);
  });

  it("v18 không mang term counterfactual", () => {
    const { bot, ctx } = seeded();
    const probe = createDecisionProbe();
    selectVote({ knowledge: ctx, visibleChat: [] }, bot.state, createSeededRng("cf-vote"), BOT_WEIGHTS_V18, probe);
    for (const candidate of probe.candidates) {
      expect(candidate.terms.some((term) => term.name === "teamValue")).toBe(false);
    }
  });
});


