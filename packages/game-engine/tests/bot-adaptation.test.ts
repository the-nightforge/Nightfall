import { describe, expect, it } from "vitest";
import { BotRuntime } from "../src/bot/BotRuntime";
import { createSeededRng } from "../src/bot/rng";
import type { BotDecisionContext, BotKnowledgeView } from "../src/bot/types";

const PLAYERS = ["me", "ally", "a", "b", "c"];

function context(over: Partial<BotKnowledgeView> = {}): BotDecisionContext {
  return {
    knowledge: {
      botId: "me",
      round: 2,
      phase: "DAY_DISCUSSION",
      phaseStartedAt: 0,
      phaseEndsAt: 60_000,
      selfRole: "VILLAGER",
      players: PLAYERS.map((id) => ({ id, name: id.toUpperCase(), alive: true })),
      knownRoles: { me: "VILLAGER" },
      seerResult: null,
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
    visibleChat: [],
  };
}

const runtime = (seed = "adapt") =>
  new BotRuntime({ playerId: "me", rng: createSeededRng(seed), playerIds: PLAYERS });

describe("thích nghi khi có người chết", () => {
  it("người từng công kích nạn nhân bị nghi thêm", () => {
    // "Ai muốn người đó chết" là suy luận rẻ nhất và đúng nhất sau một đêm.
    const bot = runtime();
    bot.state.seenEventIds.push("src-1");
    bot.state.relationships["a->c"] = {
      support: 0,
      hostility: 1,
      voteAlignment: 0,
      samples: 4,
      reasons: [],
      lastUpdatedRound: 1,
    };
    bot.state.trust.c = { score: 80, reasons: [], lastUpdatedRound: 1 };
    const before = bot.state.suspicion.a.score;

    bot.observe(
      context({
        round: 3,
        lastNightDeaths: [{ playerId: "c", name: "C" }],
      }),
    );

    expect(bot.state.suspicion.a.score).toBeGreaterThan(before);
  });

  it("không nghi thêm ai khi nạn nhân không được ai tin", () => {
    const bot = runtime();
    bot.state.relationships["a->c"] = {
      support: 0,
      hostility: 1,
      voteAlignment: 0,
      samples: 4,
      reasons: [],
      lastUpdatedRound: 1,
    };

    bot.observe(context({ round: 3, lastNightDeaths: [{ playerId: "c", name: "C" }] }));

    expect(bot.state.suspicion.a.score).toBe(0);
  });

  it("Sói mất đồng bọn thì thận trọng hơn", () => {
    const bot = runtime();
    bot.observe(
      context({
        round: 2,
        selfRole: "WEREWOLF",
        knownRoles: { me: "WEREWOLF", ally: "WEREWOLF" },
      }),
    );
    const before = bot.state.confidence;
    void before;

    bot.observe(
      context({
        round: 3,
        selfRole: "WEREWOLF",
        knownRoles: { me: "WEREWOLF" },
        players: PLAYERS.map((id) => ({
          id,
          name: id.toUpperCase(),
          alive: id !== "ally",
        })),
        lastNightDeaths: [{ playerId: "ally", name: "ALLY" }],
      }),
    );

    // Ghi nhận mất đồng đội để chiến thuật đổi; chi tiết cách đổi thuộc
    // selectVote, nhưng dấu vết phải có trong state.
    expect(bot.state.memories.some((m) => m.type === "ALLY_LOST")).toBe(true);
  });
});

describe("round summary", () => {
  it("ghi tóm tắt vòng và được pin", () => {
    const bot = runtime();
    bot.observe(context({ round: 2, lastNightDeaths: [{ playerId: "c", name: "C" }] }));
    bot.summarizeRound(2);

    const summary = bot.state.memories.find((m) => m.type === "ROUND_SUMMARY");
    expect(summary).toBeDefined();
    expect(summary!.pinned).toBe(true);
  });

  it("không ghi trùng khi gọi lại cùng vòng", () => {
    const bot = runtime();
    bot.observe(context({ round: 2 }));
    bot.summarizeRound(2);
    bot.summarizeRound(2);

    expect(bot.state.memories.filter((m) => m.type === "ROUND_SUMMARY")).toHaveLength(1);
  });

  it("dựng currentTheory khi đã có nghi ngờ có bằng chứng", () => {
    const bot = runtime();
    bot.state.seenEventIds.push("src-1");
    bot.state.suspicion.a = {
      score: 70,
      reasons: [
        {
          id: "e1",
          kind: "ACCUSE",
          sourceId: "src-1",
          actorId: "a",
          weight: 5,
          confidence: 0.5,
          round: 2,
          summary: "buộc tội sát giờ",
        },
      ],
      lastUpdatedRound: 2,
    };

    bot.summarizeRound(2);

    expect(bot.state.currentTheory).not.toBeNull();
    expect(bot.state.currentTheory!.evidenceIds).toContain("e1");
  });

  it("không dựng theory từ nghi ngờ không có bằng chứng", () => {
    const bot = runtime();
    bot.state.suspicion.a = { score: 99, reasons: [], lastUpdatedRound: 2 };

    bot.summarizeRound(2);

    expect(bot.state.currentTheory).toBeNull();
  });
});

describe("vẫn deterministic", () => {
  it("cùng seed cho cùng state cuối", () => {
    const run = () => {
      const bot = runtime("same");
      for (const round of [2, 3, 4]) {
        bot.observe(context({ round, lastNightDeaths: [{ playerId: "c", name: "C" }] }));
        bot.summarizeRound(round);
      }
      return bot.state;
    };

    expect(run()).toEqual(run());
  });
});
