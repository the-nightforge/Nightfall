import { describe, expect, it } from "vitest";
import type { Role } from "@masoi/shared";
import {
  BOT_WEIGHTS_V18,
  BOT_WEIGHTS_V20,
  type BotWeights,
} from "../src/bot/config/weights";
import {
  deriveVoteScoringFrame,
  lookAheadVotePlanner,
  selectVote,
  voteFutureRisk,
} from "../src/bot/decision/vote-decision";
import { immediateUtilityPlanner } from "../src/bot/planning/planner";
import { BotRuntime } from "../src/bot/BotRuntime";
import { createSeededRng } from "../src/bot/rng";
import { sumTerms, createDecisionProbe } from "../src/bot/trace/trace";
import type { BotDecisionContext, BotPersonality } from "../src/bot/types";

/**
 * Look-ahead v1 (spec §12): số hạng `futureRisk` trong bảng điểm phiếu.
 *
 * Ước lượng một bước: "treo người này → nếu họ vô tội, làng mất bao nhiêu cho
 * pha sau". Phạt tỉ lệ với P(vô tội) x (áp lực sĩ số + khan hiếm bằng chứng),
 * CHỈ áp cho nhánh làng (v20 để `wolfMislynchGain = 0` nên Sói byte-identical
 * với v18), và chỉ tồn tại khi preset khai nhóm `lookAhead`.
 */

const BALANCED: BotPersonality = {
  aggressiveness: 0.5,
  talkativeness: 0.9,
  riskTolerance: 0.5,
  deceptionSkill: 0.5,
  analyticalSkill: 1,
  loyalty: 0.5,
  stubbornness: 0.5,
};

function context(selfRole: Role = "VILLAGER"): BotDecisionContext {
  const alive = ["me", "b", "c", "d", "e"];
  const dead = ["f", "g", "h"];
  return {
    knowledge: {
      botId: "me",
      round: 4,
      phase: "VOTING",
      phaseStartedAt: 0,
      phaseEndsAt: 30_000,
      selfRole,
      players: [
        ...alive.map((id) => ({ id, name: id.toUpperCase(), alive: true })),
        ...dead.map((id) => ({ id, name: id.toUpperCase(), alive: false })),
      ],
      knownRoles: { me: selfRole },
      seerResult: null,
      sorcererResult: null,
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
    },
    visibleChat: [],
  };
}

function runtime(selfRole: Role = "VILLAGER", weights: BotWeights = BOT_WEIGHTS_V20) {
  const bot = new BotRuntime({
    playerId: "me",
    rng: createSeededRng("lookahead"),
    playerIds: ["me", "b", "c", "d", "e", "f", "g", "h"],
    personality: BALANCED,
    weights,
  });
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
  // b: đáng ngờ vừa phải; c: gần chắc trong sạch (belief thấp) và được làng tin.
  bot.state.suspicion["b"] = { score: 60, reasons: [reason("b", 10)], lastUpdatedRound: 1 };
  bot.state.suspicion["c"] = { score: 8, reasons: [reason("c", 2)], lastUpdatedRound: 1 };
  bot.state.trust["c"] = { score: 55, reasons: [], lastUpdatedRound: 1 };
  return bot;
}

describe("look-ahead v1 (weights v20)", () => {
  it("v18 không có nhóm lookAhead: futureRisk = 0 và bảng điểm không đổi", () => {
    expect(BOT_WEIGHTS_V18.lookAhead).toBeUndefined();
    const bot = runtime("VILLAGER", BOT_WEIGHTS_V18);
    const ctx = context();
    const frame = deriveVoteScoringFrame(ctx, bot.state, BOT_WEIGHTS_V18);
    expect(voteFutureRisk("c", { context: ctx, state: bot.state, rng: createSeededRng("x"), frame })).toBe(0);
  });

  it("nhánh làng: người belief thấp bị phạt nặng hơn người đáng ngờ", () => {
    const bot = runtime();
    const ctx = context();
    const frame = deriveVoteScoringFrame(ctx, bot.state, BOT_WEIGHTS_V20);

    const riskClean = voteFutureRisk("c", { context: ctx, state: bot.state, rng: createSeededRng("x"), frame });
    const riskSuspect = voteFutureRisk("b", { context: ctx, state: bot.state, rng: createSeededRng("x"), frame });

    expect(riskClean).toBeLessThan(riskSuspect);
    expect(riskSuspect).toBeLessThanOrEqual(0);
    // Cả hai đều âm: treo ai cũng có rủi ro, chỉ là ít hay nhiều.
    expect(riskClean).toBeLessThan(0);
  });

  it("nhánh Sói (v20: wolfMislynchGain = 0) không nhận số hạng futureRisk", () => {
    const bot = runtime("WEREWOLF");
    const ctx = context("WEREWOLF");
    const frame = deriveVoteScoringFrame(ctx, bot.state, BOT_WEIGHTS_V20);
    const risk = voteFutureRisk("c", { context: ctx, state: bot.state, rng: createSeededRng("x"), frame });
    expect(risk).toBe(0);
  });

  it("selectVote v20: term futureRisk xuất hiện, Σterms === score, cùng seed cùng kết quả", () => {
    const bot = runtime();
    const ctx = context();

    const probe = createDecisionProbe();
    const intention = selectVote(ctx, bot.state, createSeededRng("la-vote"), BOT_WEIGHTS_V20, probe);
    expect(probe.candidates.length).toBeGreaterThan(0);
    for (const candidate of probe.candidates) {
      const riskTerm = candidate.terms.find((term) => term.name === "futureRisk");
      expect(riskTerm).toBeDefined();
      expect(sumTerms(candidate.terms)).toBeCloseTo(candidate.score, 10);
    }
    // Chọn người đáng ngờ hơn: số hạng mới khuếch đại chênh belief, không lật.
    expect(intention.choice).toEqual({ type: "PLAYER", targetId: "b" });

    const replay = selectVote(ctx, bot.state, createSeededRng("la-vote"), BOT_WEIGHTS_V20);
    expect(replay.choice).toEqual(intention.choice);
  });

  it("selectVote mặc định (v18) vẫn không mang futureRisk", () => {
    const bot = runtime("VILLAGER", BOT_WEIGHTS_V18);
    const ctx = context();
    const probe = createDecisionProbe();
    selectVote(ctx, bot.state, createSeededRng("la-vote"), BOT_WEIGHTS_V18, probe);
    for (const candidate of probe.candidates) {
      expect(candidate.terms.some((term) => term.name === "futureRisk")).toBe(false);
    }
  });
});
