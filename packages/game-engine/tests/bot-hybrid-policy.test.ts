import { describe, expect, it } from "vitest";
import {
  buildTrajectoryStats,
  hybridPolicyModel,
  statsLearnedScorer,
} from "../src/bot/policy/hybrid";
import type { BotTrajectory } from "../src/bot/evaluation/trajectory";
import type { StrategyContext } from "../src/bot/planning/planner";
import { heuristicPolicyModel } from "../src/bot/policy/policy-model";
import type { PolicyModel } from "../src/bot/policy/policy-model";
import { BotRuntime } from "../src/bot/BotRuntime";
import { selectVote } from "../src/bot/decision/vote-decision";
import { createSeededRng } from "../src/bot/rng";
import type { BotDecisionContext, BotPersonality } from "../src/bot/types";
import { DEFAULT_BOT_WEIGHTS } from "../src/bot/config/weights";

/**
 * PR 8 của BOT_AI_CONTINUE_UPGRADE (§24): HybridPolicy —
 * `finalScore = alpha × heuristicScore + beta × learnedScore`, BẮT ĐẦU với
 * alpha=1, beta=0 (byte-identical với heuristic). beta chỉ tăng khi benchmark
 * chứng minh (kỷ luật §24/§27). Learned scorer ban đầu là bảng tra thống kê
 * từ trajectory PR 7 — không ML framework (§23/§38).
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

function context(suspicion: Record<string, number>): StrategyContext {
  const state = {
    playerId: "me",
    personality: BALANCED,
    suspicion: Object.fromEntries(
      Object.entries(suspicion).map(([id, score]) => [
        id,
        { score, reasons: [], lastUpdatedRound: 1 },
      ]),
    ),
    trust: {},
  } as unknown as StrategyContext["state"];
  return {
    context: { knowledge: {}, visibleChat: [] } as unknown as BotDecisionContext,
    state,
    rng: createSeededRng("hybrid"),
  };
}

function trajectoryLine(
  playerId: string,
  targetId: string,
  targetSuspicion: number,
  reward: number,
): BotTrajectory {
  return {
    gameId: "g",
    seed: "g",
    playerId,
    finalRole: "VILLAGER",
    turn: 2,
    phase: "VOTING",
    decision: "VOTE",
    observation: {
      aliveIds: [playerId, targetId],
      legalActions: [targetId],
      knownRoles: { [playerId]: "VILLAGER" },
      seerResult: null,
      nightLegalTargets: null,
      belief: [
        {
          playerId: targetId,
          suspicion: targetSuspicion,
          trust: 0,
          wolfProbability: 0,
          threat: 0,
          credibility: 0,
          influence: 0,
          informationValue: 0,
          claimedPowerRole: false,
          guardedBefore: false,
        },
      ],
      personality: BALANCED,
      nightWolfTarget: null,
      healUsed: false,
      poisonUsed: false,
      guardPrevious: null,
      lastNightDeaths: [],
      voteCounts: { players: {}, noElimination: 0 },
      trialAccusedId: null,
    },
    legalActions: [targetId],
    candidates: [{ targetId, score: 0, terms: [], evidenceIds: [] }],
    selectedAction: { decision: "VOTE", targetId, label: "bầu", kind: null },
    reward,
    finalWinner: "village",
  };
}

describe("buildTrajectoryStats + statsLearnedScorer (bảng tra từ trajectory)", () => {
  it("gom reward theo bucket suspicion (10 điểm/bucket, clamp 0..9)", () => {
    const stats = buildTrajectoryStats([
      trajectoryLine("p1", "t1", 5, 1), // bucket 0
      trajectoryLine("p1", "t2", 8, -1), // bucket 0
      trajectoryLine("p1", "t3", 45, 1), // bucket 4
      trajectoryLine("p1", "t4", 500, 1), // clamp bucket 9
    ]);
    expect(stats.counts["VOTE:s0"]).toEqual({ rewardSum: 0, count: 2 });
    expect(stats.counts["VOTE:s4"]).toEqual({ rewardSum: 1, count: 1 });
    expect(stats.counts["VOTE:s9"]).toEqual({ rewardSum: 1, count: 1 });
  });

  it("statsLearnedScorer: bucket biết → avg reward; bucket trống → null", () => {
    const stats = buildTrajectoryStats([
      trajectoryLine("p1", "t1", 5, 1),
      trajectoryLine("p1", "t2", 8, -1),
    ]);
    const scorer = statsLearnedScorer(stats);
    // x: suspicion 6 → bucket 0 (có data); y: suspicion 45 → bucket 4 (trống);
    // z: không có entry → 0 → bucket 0.
    const ctx = context({ x: 6, y: 45 });
    expect(scorer.score("x", ctx)).toBe(0); // (1 + -1) / 2
    expect(scorer.score("y", ctx)).toBeNull();
    expect(scorer.score("z", ctx)).toBe(0);
  });
});

describe("hybridPolicyModel (§24)", () => {
  const candidates = [
    { targetId: "b", score: 60 },
    { targetId: "c", score: 50 },
  ];

  it("beta = 0: chọn Y HỆT heuristic kể cả khi learned dirty", () => {
    const heuristic = heuristicPolicyModel();
    const learned = statsLearnedScorer(
      buildTrajectoryStats([trajectoryLine("p1", "t", 45, 1)]),
    );
    const hybrid = hybridPolicyModel({ alpha: 1, beta: 0, learned });
    const ctx = context({ b: 55, c: 45 });
    expect(hybrid.selectAction(candidates, ctx).targetId).toBe(
      heuristic.selectAction(candidates, ctx).targetId,
    );
  });

  it("beta > 0: learned đủ mạnh lật lựa chọn", () => {
    // Bucket 4 (suspicion 40..49) trung bình thắng; c có suspicion 45, b 55.
    const learned = statsLearnedScorer(
      buildTrajectoryStats([trajectoryLine("p1", "t", 45, 1)]),
    );
    const hybrid = hybridPolicyModel({ alpha: 1, beta: 50, learned });
    const ctx = context({ b: 55, c: 45 });
    // Heuristic chênh 10 điểm; learned +1 cho c → 50×1 lật được.
    expect(hybrid.selectAction(candidates, ctx).targetId).toBe("c");
  });

  it("bucket lạ được coi là 0 — chỉ ứng viên có dữ liệu mới được beta cộng", () => {
    const learned = statsLearnedScorer(
      buildTrajectoryStats([trajectoryLine("p1", "t", 5, -1)]),
    );
    const hybrid = hybridPolicyModel({ alpha: 1, beta: 30, learned });
    const ctx = context({ b: 5, c: 45 });
    // b: learned −1 → 60 − 30; c: unknown → 50. b vẫn thắng vì 30 > 50? 60−30=30 < 50 → c thắng.
    expect(hybrid.selectAction(candidates, ctx).targetId).toBe("c");
  });

  it("rỗng ứng viên → targetId null (hợp đồng NO_ELIMINATION giữ nguyên)", () => {
    const hybrid = hybridPolicyModel({ alpha: 1, beta: 0 });
    expect(hybrid.selectAction([], context({})).targetId).toBeNull();
  });

  it("tất định: cùng input → cùng kết quả", () => {
    const learned = statsLearnedScorer(
      buildTrajectoryStats([trajectoryLine("p1", "t", 45, 1)]),
    );
    const hybrid = hybridPolicyModel({ alpha: 1, beta: 50, learned });
    const ctx = context({ b: 55, c: 45 });
    expect(hybrid.selectAction(candidates, ctx)).toEqual(hybrid.selectAction(candidates, ctx));
  });
});

describe("BotRuntime.votePolicy (inject qua seam M7)", () => {
  function runtime(policy?: PolicyModel) {
    return new BotRuntime({
      playerId: "me",
      rng: createSeededRng("hybrid-rt"),
      playerIds: ["me", "b", "c"],
      personality: BALANCED,
      weights: DEFAULT_BOT_WEIGHTS,
      votePolicy: policy,
    });
  }

  function ctx(suspicion: Record<string, number>): BotDecisionContext {
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
        legalVoteChoices: ["b", "c"].map((targetId) => ({
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

  const contrarian: PolicyModel = {
    name: "contrarian-test",
    selectAction(candidates) {
      const sorted = [...candidates].sort((left, right) => left.score - right.score);
      return { targetId: sorted[0]!.targetId };
    },
  };

  it("không truyền policy → heuristic mặc định (b, điểm cao hơn)", () => {
    const bot = runtime();
    bot.state.seenEventIds.push("s-b", "s-c");
    bot.state.suspicion["b"] = { score: 60, reasons: [], lastUpdatedRound: 1 };
    bot.state.suspicion["c"] = { score: 30, reasons: [], lastUpdatedRound: 1 };
    const vote = bot.decideVote(ctx({ b: 60, c: 30 }));
    expect(vote.choice).toEqual({ type: "PLAYER", targetId: "b" });
  });

  it("truyền contrarian policy → chọn điểm thấp nhất (seam sống)", () => {
    const bot = runtime(contrarian);
    bot.state.seenEventIds.push("s-b", "s-c");
    bot.state.suspicion["b"] = { score: 60, reasons: [], lastUpdatedRound: 1 };
    bot.state.suspicion["c"] = { score: 30, reasons: [], lastUpdatedRound: 1 };
    const vote = bot.decideVote(ctx({ b: 60, c: 30 }));
    expect(vote.choice).toEqual({ type: "PLAYER", targetId: "c" });
  });
});
