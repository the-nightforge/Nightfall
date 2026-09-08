import { describe, expect, it } from "vitest";
import { heuristicPolicyModel } from "../src/bot/policy/policy-model";
import type { PolicyModel } from "../src/bot/policy/policy-model";
import { selectVote } from "../src/bot/decision/vote-decision";
import { BotRuntime } from "../src/bot/BotRuntime";
import { createSeededRng } from "../src/bot/rng";
import { createDecisionProbe } from "../src/bot/trace/trace";
import type { BotDecisionContext, BotPersonality } from "../src/bot/types";
import { DEFAULT_BOT_WEIGHTS } from "../src/bot/config/weights";

/**
 * Seam `PolicyModel` (spec §27): heuristic hiện hành chọn argmax đúng quy tắc
 * cũ, và một model thay thế cắm vào `selectVote` được mà call site không đổi.
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

function context(): BotDecisionContext {
  return {
    knowledge: {
      botId: "me",
      round: 2,
      phase: "VOTING",
      phaseStartedAt: 0,
      phaseEndsAt: 30_000,
      selfRole: "VILLAGER",
      players: [
        { id: "me", name: "Me", alive: true },
        { id: "b", name: "B", alive: true },
        { id: "c", name: "C", alive: true },
        { id: "d", name: "D", alive: true },
      ],
      knownRoles: { me: "VILLAGER" },
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
      legalVoteChoices: ["b", "c", "d"].map((targetId) => ({
        type: "PLAYER" as const,
        targetId,
      })),
      lastNightDeaths: [],
      activeEventId: null,
      dayOfTruthClaims: {},
    },
    visibleChat: [],
  };
}

function runtime() {
  const bot = new BotRuntime({
    playerId: "me",
    rng: createSeededRng("policy"),
    playerIds: ["me", "b", "c", "d"],
    personality: BALANCED,
    weights: DEFAULT_BOT_WEIGHTS,
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
  bot.state.seenEventIds.push("1:nomination:b", "1:nomination:c", "1:nomination:d");
  bot.state.suspicion["b"] = { score: 60, reasons: [reason("b", 10)], lastUpdatedRound: 1 };
  bot.state.suspicion["c"] = { score: 24, reasons: [reason("c", 6)], lastUpdatedRound: 1 };
  bot.state.suspicion["d"] = { score: 5, reasons: [reason("d", 3)], lastUpdatedRound: 1 };
  return bot;
}

describe("PolicyModel seam", () => {
  it("heuristic chọn argmax và hoà điểm tách bằng id", () => {
    const model = heuristicPolicyModel();
    const ctx = context();
    const decision = model.selectAction(
      [
        { targetId: "c", score: 30 },
        { targetId: "b", score: 30 },
        { targetId: "d", score: 31 },
      ],
      { context: ctx, state: runtime().state, rng: createSeededRng("x") },
    );
    expect(decision.targetId).toBe("d");
  });

  it("model thay thế cắm vào selectVote được: chọn người điểm thấp nhất cũng ra phiếu", () => {
    const bot = runtime();
    const ctx = context();

    const contrarian: PolicyModel = {
      name: "contrarian-test",
      selectAction(candidates) {
        const sorted = [...candidates].sort((left, right) => left.score - right.score);
        return { targetId: sorted[0]!.targetId };
      },
    };

    const intention = selectVote(ctx, bot.state, createSeededRng("policy"), undefined, undefined, contrarian);
    // Heuristic mặc định sẽ chọn b (điểm cao nhất); model ngược chọn d.
    expect(intention.choice).toEqual({ type: "PLAYER", targetId: "d" });
  });

  it("mặc định (không truyền model) giữ nguyên heuristic: chọn b", () => {
    const bot = runtime();
    const ctx = context();
    const intention = selectVote(ctx, bot.state, createSeededRng("policy"));
    expect(intention.choice).toEqual({ type: "PLAYER", targetId: "b" });
  });

  it("model trả null (chủ động bỏ) → NO_ELIMINATION, không crash", () => {
    const bot = runtime();
    const ctx = context();
    const abstainer: PolicyModel = { name: "abstainer-test", selectAction: () => ({ targetId: null }) };

    const probe = createDecisionProbe();
    const intention = selectVote(ctx, bot.state, createSeededRng("policy"), undefined, probe, abstainer);
    expect(intention.choice).toEqual({ type: "NO_ELIMINATION" });
    expect(intention.evidence).toEqual([]);
  });
});
