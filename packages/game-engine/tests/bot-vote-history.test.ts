import { describe, expect, it } from "vitest";
import type { DayVoteRecap } from "@masoi/shared";
import { runSelfPlay } from "../src/bot/evaluation/selfplay";
import { gameToTrajectories, observationFromTrace } from "../src/bot/evaluation/trajectory";
import { summarizeVoteDay } from "../src/bot/trace/snapshot";

const recap: DayVoteRecap = {
  round: 1,
  mutations: [
    { id: "m1", round: 1, voterId: "c", previousChoice: null, choice: { type: "PLAYER", targetId: "d" }, castAt: 1, phaseStartedAt: 0, phaseEndsAt: 9, sequence: 1 },
    { id: "m2", round: 1, voterId: "c", previousChoice: { type: "PLAYER", targetId: "d" }, choice: { type: "PLAYER", targetId: "b" }, castAt: 2, phaseStartedAt: 0, phaseEndsAt: 9, sequence: 2 },
  ],
  finalBallots: [
    { voterId: "a", choice: { type: "PLAYER", targetId: "b" } },
    { voterId: "c", choice: { type: "PLAYER", targetId: "b" } },
    { voterId: "d", choice: { type: "NO_ELIMINATION" } },
  ],
  nomination: { kind: "TRIAL", accusedId: "b" },
  finalJudgment: {
    ballots: [{ voterId: "c", guilty: true }, { voterId: "a", guilty: true }, { voterId: "d", guilty: false }],
    guilty: 2, innocent: 1, abstain: 0, lynched: true,
  },
};

describe("summarizeVoteDay", () => {
  it("giữ phiếu chốt, người đổi phiếu, bị cáo, phiếu treo/tha — đã sort", () => {
    expect(summarizeVoteDay(recap)).toEqual({
      round: 1,
      ballots: { a: "b", c: "b", d: null },
      changed: ["c"],
      accusedId: "b",
      guilty: ["a", "c"],
      innocent: ["d"],
    });
  });

  it("ngày không ra toà: accusedId null, không có phiếu treo/tha", () => {
    const s = summarizeVoteDay({ ...recap, nomination: { kind: "NONE", reason: "tie" }, finalJudgment: null });
    expect(s.accusedId).toBeNull();
    expect(s.guilty).toEqual([]);
    expect(s.innocent).toEqual([]);
  });
});

describe("voteHistory trong trace/trajectory", () => {
  it("ván thật: từ vòng 2 trở đi observation có lịch sử, và lịch sử không vượt vòng hiện tại", () => {
    const game = runSelfPlay({ seed: "vh-1", playerCount: 8, maxRounds: 6, trace: true });
    const lines = gameToTrajectories(game);
    const later = lines.filter((l) => l.turn >= 2 && l.decision === "VOTE");
    expect(later.length).toBeGreaterThan(0);
    for (const line of later) {
      expect(line.observation.voteHistory!.length).toBeGreaterThan(0);
      for (const day of line.observation.voteHistory!) expect(day.round).toBeLessThanOrEqual(line.turn);
    }
  });

  it("trace cũ không có voteHistory → observation mang mảng rỗng", () => {
    const game = runSelfPlay({ seed: "vh-2", playerCount: 8, maxRounds: 3, trace: true });
    const trace = game.traces[0]!;
    const { voteHistory: _drop, ...oldSnapshot } = trace.knowledgeSnapshot;
    expect(observationFromTrace({ ...trace, knowledgeSnapshot: oldSnapshot }).observation.voteHistory).toEqual([]);
  });
});
