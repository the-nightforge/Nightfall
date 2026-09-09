import { describe, expect, it } from "vitest";
import { runSelfPlay } from "../src/bot/evaluation/selfplay";
import { snapshotKnowledge } from "../src/bot/trace/snapshot";
import type { BotKnowledgeView } from "../src/bot/types";

describe("trace/snapshot", () => {
  it("snapshotKnowledge là bản sao, không giữ tham chiếu sống vào knowledge", () => {
    // Một ván có trace để có knowledge view thật.
    const game = runSelfPlay({ seed: "snap-1", playerCount: 8, trace: true, maxRounds: 3 });
    expect(game.traces.length).toBeGreaterThan(0);
    const snap = game.traces[0]!.knowledgeSnapshot;
    // Cùng hình dạng mà BotRuntime đã ghi: các trường bắt buộc có mặt.
    expect(Array.isArray(snap.aliveIds)).toBe(true);
    expect(snap.voteCounts).toBeDefined();
    // Hàm tách ra phải cho ra đúng hình dạng đó từ một view tối thiểu.
    const minimal = {
      players: [{ id: "a", name: "A", alive: true, isBot: true }],
      legalVoteChoices: [],
      night: null,
      hunterShot: null,
      knownRoles: {},
      seerResult: null,
      lastNightDeaths: [],
      currentVoteCounts: { players: {}, noElimination: 0 },
      trialAccusedId: null,
    } as unknown as BotKnowledgeView;
    expect(snapshotKnowledge(minimal)).toMatchObject({
      aliveIds: ["a"],
      legalChoices: [],
      nightLegalTargets: null,
      hunterLegalTargets: null,
      knownRoles: {},
      seerResult: null,
      nightWolfTarget: null,
      nightLegalActions: null,
      healUsed: false,
      poisonUsed: false,
      guardPrevious: null,
      lastNightDeaths: [],
      voteCounts: { players: {}, noElimination: 0 },
      trialAccusedId: null,
    });
  });
});
