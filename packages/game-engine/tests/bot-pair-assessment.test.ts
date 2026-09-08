import { describe, expect, it } from "vitest";
import { assessPairs } from "../src/bot/belief/pair-assessment";
import type { PairAssessmentInput } from "../src/bot/belief/pair-assessment";
import { projectRoleBeliefs } from "../src/bot/belief/role-belief";
import { applySocialEvidence } from "../src/bot/analysis/social-analysis";
import { BotRuntime } from "../src/bot/BotRuntime";
import { createSeededRng } from "../src/bot/rng";
import type { BotEvidence, BotKnowledgeView, BotPersonality } from "../src/bot/types";
import { DEFAULT_BOT_WEIGHTS } from "../src/bot/config/weights";

/**
 * PR 2 của BOT_AI_CONTINUE_UPGRADE (§8/§34): đánh giá QUAN HỆ CẶP người trên
 * lớp belief xác suất của PR 1 và social graph có sẵn.
 *
 * Ràng buộc bắt buộc (§34):
 * - Pairwise KHÔNG được đè bằng chứng cá nhân: joint ≤ min(pA, pB) (chặn trên
 *   Fréchet), và khi không có quan sát nào thì joint = pA × pB (độc lập).
 * - Tất định: không RNG, thứ tự cặp chuẩn hoá (a < b), evidence sort theo id.
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

function knowledge(overrides: Partial<BotKnowledgeView> = {}): BotKnowledgeView {
  return {
    botId: "me",
    round: 3,
    phase: "DAY_DISCUSSION",
    phaseStartedAt: 0,
    phaseEndsAt: 30_000,
    selfRole: "VILLAGER",
    players: [
      { id: "a", name: "A", alive: true },
      { id: "b", name: "B", alive: true },
      { id: "c", name: "C", alive: true },
      { id: "z", name: "Z", alive: false },
    ],
    knownRoles: { me: "VILLAGER" },
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
    legalVoteChoices: [],
    lastNightDeaths: [],
    activeEventId: null,
    dayOfTruthClaims: {},
    ...overrides,
  };
}

function evidence(
  id: string,
  kind: BotEvidence["kind"],
  actorId: string,
  targetId: string,
): BotEvidence {
  return {
    id,
    kind,
    sourceId: `src-${id}`,
    actorId,
    targetId,
    weight: 6,
    confidence: 0.8,
    round: 2,
    summary: `${kind} của ${actorId} tới ${targetId}.`,
  };
}

function input(
  overrides: Partial<BotKnowledgeView> = {},
  mutate?: (bot: BotRuntime) => void,
): PairAssessmentInput {
  const ctx = { knowledge: knowledge(overrides), visibleChat: [] };
  const bot = new BotRuntime({
    playerId: "me",
    rng: createSeededRng("pair-assessment"),
    playerIds: ctx.knowledge.players.map((player) => player.id),
    personality: BALANCED,
    weights: DEFAULT_BOT_WEIGHTS,
  });
  // Belief gốc: a và b vừa đủ nghi, c sạch sẽ hơn.
  bot.state.seenEventIds.push("src-x1", "src-x2");
  bot.state.suspicion["a"] = {
    score: 55,
    reasons: [
      {
        id: "x1",
        kind: "TIE_BREAK",
        sourceId: "src-x1",
        actorId: "a",
        weight: 8,
        confidence: 0.7,
        round: 1,
        summary: "Phá hoà.",
      },
    ],
    lastUpdatedRound: 1,
  };
  bot.state.suspicion["b"] = {
    score: 40,
    reasons: [
      {
        id: "x2",
        kind: "ACCUSE",
        sourceId: "src-x2",
        actorId: "b",
        targetId: "me",
        weight: 5,
        confidence: 0.6,
        round: 1,
        summary: "Buộc tội.",
      },
    ],
    lastUpdatedRound: 1,
  };
  if (mutate) mutate(bot);
  return {
    knowledge: ctx.knowledge,
    state: bot.state,
    roleComposition: DECK_8,
  };
}

function wolfMarginals(input_: PairAssessmentInput): Record<string, number> {
  const beliefs = projectRoleBeliefs(input_);
  return Object.fromEntries(
    Object.entries(beliefs).map(([id, belief]) => [id, belief.probabilities["WEREWOLF"] ?? 0]),
  );
}

describe("assessPairs (PR2 — pairwise reasoning)", () => {
  it("không có cạnh nào → joint đúng bằng tích độc lập pA × pB", () => {
    const input_ = input();
    const marginals = wolfMarginals(input_);
    const pairs = assessPairs(input_);
    const pair = pairs.find((item) => item.playerA === "a" && item.playerB === "b")!;
    expect(pair.wolfPairScore).toBeCloseTo(marginals["a"]! * marginals["b"]!, 10);
    expect(pair.allyScore).toBe(0);
    expect(pair.conflictScore).toBe(0);
    expect(pair.evidence).toEqual([]);
  });

  it("hai chiều bênh nhau + trùng phiếu → joint vượt tích độc lập", () => {
    const input_ = input({}, (bot) => {
      const align = evidence("e1", "VOTE_ALIGNMENT", "a", "b");
      const defend = evidence("e2", "DEFEND", "b", "a");
      bot.state.seenEventIds.push("src-e1", "src-e2");
      applySocialEvidence(bot.state, align, DEFAULT_BOT_WEIGHTS);
      applySocialEvidence(bot.state, defend, DEFAULT_BOT_WEIGHTS);
    });
    const marginals = wolfMarginals(input_);
    const pairs = assessPairs(input_);
    const pair = pairs.find((item) => item.playerA === "a" && item.playerB === "b")!;
    expect(pair.allyScore).toBeGreaterThan(0);
    expect(pair.wolfPairScore).toBeGreaterThan(marginals["a"]! * marginals["b"]!);
  });

  it("quan hệ thù địch không làm joint vượt tích độc lập", () => {
    const input_ = input({}, (bot) => {
      bot.state.seenEventIds.push("src-e1");
      applySocialEvidence(
        bot.state,
        evidence("e1", "ACCUSE", "a", "b"),
        DEFAULT_BOT_WEIGHTS,
      );
    });
    const marginals = wolfMarginals(input_);
    const pairs = assessPairs(input_);
    const pair = pairs.find((item) => item.playerA === "a" && item.playerB === "b")!;
    expect(pair.conflictScore).toBeGreaterThan(0);
    expect(pair.wolfPairScore).toBeCloseTo(marginals["a"]! * marginals["b"]!, 10);
  });

  it("chặn trên Fréchet: joint không bao giờ vượt min(pA, pB)", () => {
    // Ba mảnh hợp lực cùng chiều, đủ mạnh để hệ số tương quan bão hoà.
    const input_ = input({}, (bot) => {
      bot.state.seenEventIds.push("src-e1", "src-e2", "src-e3", "src-e4");
      applySocialEvidence(bot.state, evidence("e1", "VOTE_ALIGNMENT", "a", "b"), DEFAULT_BOT_WEIGHTS);
      applySocialEvidence(bot.state, evidence("e2", "DEFEND", "a", "b"), DEFAULT_BOT_WEIGHTS);
      applySocialEvidence(bot.state, evidence("e3", "DEFEND", "b", "a"), DEFAULT_BOT_WEIGHTS);
      applySocialEvidence(bot.state, evidence("e4", "SAVE_VOTE", "b", "a"), DEFAULT_BOT_WEIGHTS);
    });
    const marginals = wolfMarginals(input_);
    const pair = assessPairs(input_).find(
      (item) => item.playerA === "a" && item.playerB === "b",
    )!;
    expect(pair.wolfPairScore).toBeLessThanOrEqual(
      Math.min(marginals["a"]!, marginals["b"]!) + 1e-9,
    );
  });

  it("vai certain đè quan hệ: hai Sói đã lộ → joint 1; một người chắc chắn sạch → joint 0", () => {
    const wolfPair = input({ knownRoles: { me: "VILLAGER", a: "WEREWOLF", b: "WEREWOLF" } });
    expect(
      assessPairs(wolfPair).find((item) => item.playerA === "a" && item.playerB === "b")!
        .wolfPairScore,
    ).toBe(1);

    const clearPair = input({
      seerResult: { targetId: "a", targetName: "A", isWolf: false, team: "village" },
    });
    expect(
      assessPairs(clearPair).find((item) => item.playerA === "a" && item.playerB === "b")!
        .wolfPairScore,
    ).toBe(0);
  });

  it("cặp chuẩn hoá a < b, chỉ gồm người sống, đối xứng tuyệt đối", () => {
    const pairs = assessPairs(input({ knownRoles: { me: "VILLAGER" } }));
    for (const pair of pairs) {
      expect(pair.playerA < pair.playerB).toBe(true);
      expect(["a", "b", "c"]).toContain(pair.playerA);
      expect(["a", "b", "c"]).toContain(pair.playerB);
      expect(pair.allyScore).toBeGreaterThanOrEqual(0);
      expect(pair.allyScore).toBeLessThanOrEqual(1);
      expect(pair.conflictScore).toBeGreaterThanOrEqual(0);
      expect(pair.conflictScore).toBeLessThanOrEqual(1);
    }
    // Người chết z không xuất hiện.
    for (const pair of pairs) {
      expect(pair.playerA).not.toBe("z");
      expect(pair.playerB).not.toBe("z");
    }
    // Đủ cặp tổ hợp của 3 người sống.
    expect(pairs).toHaveLength(3);
  });

  it("evidence gom cả hai chiều, sort theo id, không trùng", () => {
    const input_ = input({}, (bot) => {
      bot.state.seenEventIds.push("src-e2", "src-e1", "src-e3");
      applySocialEvidence(bot.state, evidence("e2", "DEFEND", "b", "a"), DEFAULT_BOT_WEIGHTS);
      applySocialEvidence(bot.state, evidence("e1", "VOTE_ALIGNMENT", "a", "b"), DEFAULT_BOT_WEIGHTS);
      applySocialEvidence(bot.state, evidence("e3", "ACCUSE", "a", "b"), DEFAULT_BOT_WEIGHTS);
    });
    const pair = assessPairs(input_).find((item) => item.playerA === "a")!;
    expect(pair.evidence.map((item) => item.id)).toEqual(["e1", "e2", "e3"]);
  });

  it("tất định: cùng input hai lần → cùng bảng", () => {
    const input_ = input({}, (bot) => {
      bot.state.seenEventIds.push("src-e1");
      applySocialEvidence(bot.state, evidence("e1", "VOTE_ALIGNMENT", "a", "b"), DEFAULT_BOT_WEIGHTS);
    });
    expect(JSON.stringify(assessPairs(input_))).toBe(JSON.stringify(assessPairs(input_)));
  });
});
