import { describe, expect, it } from "vitest";
import { immediateUtilityPlanner } from "../src/bot/planning/planner";
import { selectVote, scoreVoteCandidate } from "../src/bot/decision/vote-decision";
import { BotRuntime } from "../src/bot/BotRuntime";
import { createSeededRng } from "../src/bot/rng";
import { createDecisionProbe } from "../src/bot/trace/trace";
import type { BotDecisionContext, BotPersonality } from "../src/bot/types";
import { DEFAULT_BOT_WEIGHTS } from "../src/bot/config/weights";

/**
 * Characterization cho seam `StrategicPlanner` (spec §12): planner hiện hành là
 * một lớp dẫn qua scorer của `selectVote`. Vì jitter rút từ RNG của bot, cùng
 * seed + cùng thứ tự ứng viên buộc hai đường cho cùng vân tay điểm số.
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
      currentVoteCounts: { players: { b: 1 }, noElimination: 0 },
      hasVoted: false,
      myVote: null,
      legalVoteChoices: [
        { type: "PLAYER", targetId: "b" },
        { type: "PLAYER", targetId: "c" },
        { type: "PLAYER", targetId: "d" },
      ],
      lastNightDeaths: [],
      activeEventId: null,
      dayOfTruthClaims: {},
    },
    visibleChat: [],
  };
}

/** State có belief lệch nhau giữa các ứng viên, để bảng điểm không phẳng. */
function makeRuntime() {
  const bot = new BotRuntime({
    playerId: "me",
    rng: createSeededRng("planner"),
    playerIds: ["me", "b", "c", "d"],
    personality: BALANCED,
    weights: DEFAULT_BOT_WEIGHTS,
  });
  const reasons = (id: string, weight: number) => [
    {
      id: `ev-${id}`,
      kind: "TIE_BREAK" as const,
      sourceId: `1:nomination:${id}`,
      actorId: id,
      targetId: "z",
      weight,
      confidence: 0.7,
      round: 1,
      summary: `Phiếu phá hoà của ${id}.`,
    },
  ];
  bot.state.seenEventIds.push("1:nomination:b", "1:nomination:c", "1:nomination:d");
  bot.state.suspicion["b"] = { score: 62, reasons: reasons("b", 10), lastUpdatedRound: 1 };
  bot.state.suspicion["c"] = { score: 24, reasons: reasons("c", 6), lastUpdatedRound: 1 };
  bot.state.suspicion["d"] = { score: 5, reasons: [], lastUpdatedRound: 1 };
  bot.state.trust["d"] = { score: 40, reasons: [], lastUpdatedRound: 1 };
  return bot;
}

describe("ImmediateUtilityPlanner (seam StrategicPlanner)", () => {
  it("chấm từng ứng viên Y HỆT selectVote khi cùng seed và cùng thứ tự", () => {
    const bot = makeRuntime();
    const ctx = context();

    // Đường production: chọn phiếu qua selectVote, ghi lại bảng điểm qua probe.
    const probe = createDecisionProbe();
    const voteRng = createSeededRng("planner-vote");
    const intention = selectVote(ctx, bot.state, voteRng, DEFAULT_BOT_WEIGHTS, probe);
    const recorded = new Map(
      probe.candidates.map((item) => [item.targetId, { score: item.score, terms: item.terms }]),
    );
    expect(recorded.size).toBe(3);
    expect(intention.choice).toEqual({ type: "PLAYER", targetId: "b" });

    // Đường planner: cùng seed nên dãy jitter rút theo cùng thứ tự ứng viên.
    const planner = immediateUtilityPlanner(scoreVoteCandidate);
    const plannerRng = createSeededRng("planner-vote");
    for (const targetId of ["b", "c", "d"]) {
      const evaluation = planner.evaluate(targetId, {
        context: ctx,
        state: bot.state,
        rng: plannerRng,
      });
      // Probe chỉ ghi { score, terms } — so sánh đúng phần đó.
      expect({ score: evaluation.score, terms: evaluation.terms }).toEqual(
        recorded.get(targetId),
      );
    }
  });

  it("planner chọn cùng winner khi điểm hai người gần nhau (tie-break theo id)", () => {
    const bot = makeRuntime();
    bot.state.suspicion["b"]!.score = 50;
    bot.state.suspicion["c"]!.score = 50;
    const ctx = context();

    const planner = immediateUtilityPlanner(scoreVoteCandidate);
    const rng = createSeededRng("planner-tie");
    const scores = ["b", "c", "d"].map((targetId) =>
      planner.evaluate(targetId, { context: ctx, state: bot.state, rng }).score,
    );
    // Jitter giống nhau cho cùng thứ tự rút; hai người hoà belief phải được
    // tách bằng chính jitter, và selectVote với cùng seed phải chọn cùng người.
    const intention = selectVote(ctx, bot.state, createSeededRng("planner-tie"), DEFAULT_BOT_WEIGHTS);
    const best = Math.max(...scores);
    const expected = ["b", "c", "d"].filter((_, index) => scores[index] === best);
    expect(expected).toContain(
      intention.choice.type === "PLAYER" ? intention.choice.targetId : "",
    );
  });
});
