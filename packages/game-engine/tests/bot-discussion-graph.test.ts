import { describe, expect, it } from "vitest";
import { buildDiscussionGraph } from "../src/bot/analysis/discussion-graph";
import type { PressureEpisode } from "../src/bot/analysis/discussion-graph";
import { assessPairs } from "../src/bot/belief/pair-assessment";
import type { PairAssessmentInput } from "../src/bot/belief/pair-assessment";
import { BotRuntime } from "../src/bot/BotRuntime";
import { createSeededRng } from "../src/bot/rng";
import type { BotKnowledgeView, BotMemory, BotPersonality } from "../src/bot/types";
import { BOT_WEIGHTS_V18 } from "../src/bot/config/weights";

/**
 * PR 4 của BOT_AI_CONTINUE_UPGRADE (§13): discussion graph — ai KHỞI XƯỚng áp
 * lực, ai tham gia, ai bênh, ai im; và tín hiệu CÙNG-HƯỚNG (co-accusation /
 * co-defense) nối vào pair assessment.
 *
 * Kỷ luật §13: evidence tăng dần — co-accusation chỉ là TÍN HIỆU phối hợp,
 * chiết khấu theo độ đông của đám đông (chỉ hai đứa cùng tố một người thì mạnh
 * hơn khi cả bàn cùng tố). Không bao giờ "cùng tố X → là Sói".
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
      { id: "me", name: "Me", alive: true },
      { id: "a", name: "A", alive: true },
      { id: "b", name: "B", alive: true },
      { id: "c", name: "C", alive: true },
      { id: "e", name: "E", alive: true },
      { id: "x", name: "X", alive: false },
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

function chatMemory(
  id: string,
  type: BotMemory["type"],
  actorId: string,
  targetId: string | undefined,
  round: number,
): BotMemory {
  return {
    id: `m-${id}`,
    sourceId: id,
    round,
    phase: "DAY_DISCUSSION",
    type,
    actorId,
    targetId,
    importance: 10,
    pinned: false,
    data: {},
  };
}

function input(
  memories: BotMemory[],
  overrides: Partial<BotKnowledgeView> = {},
): PairAssessmentInput {
  const ctx = knowledge(overrides);
  const bot = new BotRuntime({
    playerId: "me",
    rng: createSeededRng("discussion-graph"),
    playerIds: ctx.players.map((player) => player.id),
    personality: BALANCED,
    weights: BOT_WEIGHTS_V18,
  });
  bot.state.seenEventIds.push(...memories.map((memory) => memory.sourceId));
  bot.state.memories = memories.map((memory) => ({ ...memory }));
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
  return { knowledge: ctx, state: bot.state, roleComposition: DECK_8 };
}

describe("buildDiscussionGraph (PR4 — pressure episodes)", () => {
  it("gom episode theo (round, target): initiator là message đầu, im lặng là người sống không hành động", () => {
    const input_ = input([
      chatMemory("bot-chat:2:2", "ACCUSE", "b", "c", 2),
      chatMemory("bot-chat:2:1", "ACCUSE", "a", "c", 2),
      chatMemory("bot-chat:2:3", "DEFEND", "e", "c", 2),
      chatMemory("bot-chat:1:1", "ACCUSE", "a", "b", 1),
    ]);
    const graph = buildDiscussionGraph(input_);

    expect(graph.episodes).toHaveLength(2);

    const round2 = graph.episodes.find((episode) => episode.round === 2)!;
    expect(round2.targetId).toBe("c");
    // `bot-chat:2:1` (a) tới trước `bot-chat:2:2` (b) → a khởi xướng.
    expect(round2.initiatorId).toBe("a");
    expect(round2.accuserIds).toEqual(["a", "b"]);
    expect(round2.defenderIds).toEqual(["e"]);
    // Người sống (me, a, b, e) trừ người tố/bênh/target → chỉ "me" im lặng.
    expect(round2.silentIds).toEqual(["me"]);

    const round1 = graph.episodes.find((episode) => episode.round === 1)!;
    expect(round1.targetId).toBe("b");
    expect(round1.accuserIds).toEqual(["a"]);
    expect(round1.defenderIds).toEqual([]);
  });

  it("người chết vẫn tính vào accuser (đám đông là đám đông) nhưng không nằm trong silent", () => {
    const input_ = input([
      chatMemory("bot-chat:2:1", "ACCUSE", "x", "c", 2),
      chatMemory("bot-chat:2:2", "ACCUSE", "a", "c", 2),
    ]);
    const graph = buildDiscussionGraph(input_);
    const episode = graph.episodes[0]!;
    expect(episode.accuserIds).toEqual(["a", "x"]);
    expect(episode.silentIds).not.toContain("x");
    expect(episode.silentIds).toEqual(["b", "e", "me"]);
  });

  it("chỉ DEFEND một người vẫn tạo episode (bênh = tham gia đợt áp lực quanh target)", () => {
    const graph = buildDiscussionGraph(
      input([chatMemory("bot-chat:2:1", "DEFEND", "a", "b", 2)]),
    );
    expect(graph.episodes).toHaveLength(1);
    const episode = graph.episodes[0]!;
    expect(episode.targetId).toBe("b");
    expect(episode.accuserIds).toEqual([]);
    expect(episode.defenderIds).toEqual(["a"]);
    // Không có ai tố → initiator là người bênh đầu tiên (danh sách accusers
    // rỗng thì fall về defender sort đầu).
    expect(episode.initiatorId).toBe("a");
  });

  it("tất định: cùng memories → cùng graph", () => {
    const memories = [
      chatMemory("bot-chat:2:2", "ACCUSE", "b", "c", 2),
      chatMemory("bot-chat:2:1", "ACCUSE", "a", "c", 2),
    ];
    expect(JSON.stringify(buildDiscussionGraph(input(memories)))).toBe(
      JSON.stringify(buildDiscussionGraph(input(memories))),
    );
  });
});

describe("co-accusation / co-defense trong assessPairs (PR4)", () => {
  it("hai người cùng tố một người (đám đông 2) → coAccusationScore > 0 và joint vượt tích độc lập", () => {
    const input_ = input([
      chatMemory("bot-chat:2:1", "ACCUSE", "a", "c", 2),
      chatMemory("bot-chat:2:2", "ACCUSE", "b", "c", 2),
    ]);
    const pair = assessPairs(input_).find((item) => item.playerA === "a" && item.playerB === "b")!;
    expect(pair.coAccusationScore).toBeGreaterThan(0);

    const empty = input([]);
    const baseline = assessPairs(empty).find(
      (item) => item.playerA === "a" && item.playerB === "b",
    )!;
    expect(pair.wolfPairScore).toBeGreaterThan(baseline.wolfPairScore);
  });

  it("đám đông càng đông, tín hiệu cặp càng loãng (3 người cùng tố < 2 người)", () => {
    const two = input([
      chatMemory("bot-chat:2:1", "ACCUSE", "a", "c", 2),
      chatMemory("bot-chat:2:2", "ACCUSE", "b", "c", 2),
    ]);
    const three = input([
      chatMemory("bot-chat:2:1", "ACCUSE", "a", "c", 2),
      chatMemory("bot-chat:2:2", "ACCUSE", "b", "c", 2),
      chatMemory("bot-chat:2:3", "ACCUSE", "e", "c", 2),
    ]);
    const twoScore = assessPairs(two).find((item) => item.playerA === "a")!.coAccusationScore;
    const threeScore = assessPairs(three).find((item) => item.playerA === "a")!.coAccusationScore;
    expect(threeScore).toBeLessThan(twoScore);
    expect(threeScore).toBeGreaterThan(0);
  });

  it("hai người cùng BÊNH một người cũng là tín hiệu liên minh (co-defense)", () => {
    const input_ = input([
      chatMemory("bot-chat:2:1", "DEFEND", "a", "c", 2),
      chatMemory("bot-chat:2:2", "DEFEND", "b", "c", 2),
    ]);
    const pair = assessPairs(input_).find((item) => item.playerA === "a" && item.playerB === "b")!;
    expect(pair.coAccusationScore).toBeGreaterThan(0);
  });

  it("a tố b (không phải cùng tố ai) → coAccusationScore = 0, joint giữ độc lập", () => {
    const input_ = input([chatMemory("bot-chat:2:1", "ACCUSE", "a", "b", 2)]);
    const pair = assessPairs(input_).find((item) => item.playerA === "a" && item.playerB === "b")!;
    expect(pair.coAccusationScore).toBe(0);
    const baseline = assessPairs(input([])).find(
      (item) => item.playerA === "a" && item.playerB === "b",
    )!;
    expect(pair.wolfPairScore).toBeCloseTo(baseline.wolfPairScore, 10);
  });

  it("ràng buộc Fréchet vẫn giữ sau khi cộng tín hiệu cặp", () => {
    const memories: BotMemory[] = [];
    for (let round = 1; round <= 4; round += 1) {
      memories.push(chatMemory(`bot-chat:${round}:1`, "ACCUSE", "a", "c", round));
      memories.push(chatMemory(`bot-chat:${round}:2`, "ACCUSE", "b", "c", round));
    }
    const pair = assessPairs(input(memories)).find(
      (item) => item.playerA === "a" && item.playerB === "b",
    )!;
    // Marginals của a/b trong fixture: P(wolf) tương đương 0.25 + 0.55×0.75 và
    // 0.25 + 0.40×0.75 → joint không vượt min.
    const beliefs = pair;
    void beliefs;
    const assessed = assessPairs(input(memories));
    const pa = 0.25 + 0.55 * 0.75;
    const pb = 0.25 + 0.4 * 0.75;
    expect(pair.wolfPairScore).toBeLessThanOrEqual(Math.min(pa, pb) + 1e-9);
    expect(assessed).toHaveLength(assessed.length);
  });

  it("không memories → assessPairs giống PR2 nguyên bản (coAccusationScore = 0)", () => {
    const pairs = assessPairs(input([]));
    for (const pair of pairs) {
      expect(pair.coAccusationScore).toBe(0);
    }
  });
});

describe("PressureEpisode shape", () => {
  it("các danh sách sort ổn định, không trùng, target không nằm trong accusers/defenders", () => {
    const episodes: PressureEpisode[] = buildDiscussionGraph(
      input([
        chatMemory("bot-chat:2:1", "ACCUSE", "b", "c", 2),
        chatMemory("bot-chat:2:2", "ACCUSE", "a", "c", 2),
        chatMemory("bot-chat:2:3", "DEFEND", "a", "c", 2),
      ]),
    ).episodes;
    const episode = episodes[0]!;
    expect(episode.accuserIds).toEqual([...episode.accuserIds].sort());
    expect(episode.defenderIds).toEqual([...episode.defenderIds].sort());
    expect(new Set(episode.accuserIds).size).toBe(episode.accuserIds.length);
    expect(episode.accuserIds).not.toContain("c");
    expect(episode.defenderIds).not.toContain("c");
    // Người vừa tố vừa bênh cùng target: cả hai vai đều ghi nhận.
    expect(episode.accuserIds).toContain("a");
    expect(episode.defenderIds).toContain("a");
  });
});
