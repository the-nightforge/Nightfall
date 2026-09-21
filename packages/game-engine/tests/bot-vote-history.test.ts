import { describe, expect, it } from "vitest";
import type { DayVoteRecap } from "@masoi/shared";
import { runSelfPlay } from "../src/bot/evaluation/selfplay";
import {
  gameToTrajectories,
  observationFromTrace,
  type ObservationInput,
} from "../src/bot/evaluation/trajectory";
import {
  encodeObservation,
  observationFeatureNames,
  observationSize,
} from "../src/bot/learning/observation";
import { summarizeVoteDay } from "../src/bot/trace/snapshot";
import type { VoteDaySummary } from "../src/bot/trace/trace";

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

const OLD = 413;
const HIST = OLD; // chỉ số chiều lịch sử đầu tiên
const MATRIX = OLD + 16 * 8;
const at = (seat: number, feature: number): number => HIST + seat * 8 + feature;
const cell = (i: number, j: number): number => MATRIX + i * 16 + j;

function line(voteHistory: VoteDaySummary[], knownRoles: Record<string, string>): ObservationInput {
  return {
    playerId: "a",
    turn: 3,
    phase: "VOTING",
    decision: "VOTE",
    legalActions: ["c", "d", "NO_ELIMINATION"],
    observation: {
      aliveIds: ["a", "c", "d"],
      legalActions: ["c", "d", "NO_ELIMINATION"],
      nightLegalTargets: null,
      knownRoles: knownRoles as ObservationInput["observation"]["knownRoles"],
      seerResult: null,
      belief: [],
      personality: { aggressiveness: 0, talkativeness: 0, riskTolerance: 0, deceptionSkill: 0, analyticalSkill: 0, loyalty: 0, stubbornness: 0 },
      nightWolfTarget: null,
      healUsed: false,
      poisonUsed: false,
      guardPrevious: null,
      lastNightDeaths: ["b"],
      voteCounts: { players: {}, noElimination: 0 },
      trialAccusedId: null,
      voteHistory,
    },
  };
}

const DAYS: VoteDaySummary[] = [
  { round: 1, ballots: { a: "b", b: "c", c: "b", d: "b" }, changed: ["c"], accusedId: "b", guilty: ["a", "c"], innocent: ["d"] },
  { round: 2, ballots: { a: "c", c: "d", d: "c" }, changed: [], accusedId: null, guilty: [], innocent: [] },
];

describe("encodeObservation — lịch sử phiếu (spec 2026-09-19 D2)", () => {
  it("797 chiều; 413 tên đầu không phải hist, tên thứ 414 là hist:seat0:votesCast", () => {
    expect(observationSize()).toBe(797);
    const names = observationFeatureNames();
    expect(names).toHaveLength(797);
    expect(names.slice(0, OLD).some((n) => n.startsWith("hist:"))).toBe(false);
    expect(names[HIST]).toBe("hist:seat0:votesCast");
    expect(names[MATRIX]).toBe("hist:vote:0>0");
    expect(names[796]).toBe("hist:vote:15>15");
  });

  it("lịch sử rỗng → 384 chiều 0", () => {
    const f = encodeObservation(line([], { a: "SEER" })).features;
    expect(f).toHaveLength(797);
    expect(f.slice(OLD).every((v) => v === 0)).toBe(true);
  });

  it("từng chiều theo tay — ghế a,b,c,d = 0,1,2,3; b lộ Sói", () => {
    const f = encodeObservation(line(DAYS, { a: "SEER", b: "WEREWOLF" })).features;
    // ghế a: 2 phiếu / 2 ngày; trúng sói 1/2; trúng dân 0; theo toà 1/2; đổi 0; treo 1/1; tha 0; né d cả 2 ngày.
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((k) => f[at(0, k)])).toEqual([1, 0.5, 0, 0.5, 0, 1, 0, 1]);
    // ghế b (đã chết): 1 phiếu (c) / 2 ngày; không né ai còn sống (a và d đều từng vote b).
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((k) => f[at(1, k)])).toEqual([0.5, 0, 0, 0, 0, 0, 0, 0]);
    // ghế c: đổi phiếu 1/2 ngày; treo 1/1.
    expect(f[at(2, 4)]).toBe(0.5);
    expect(f[at(2, 5)]).toBe(1);
    // ghế d: tha 1/1.
    expect(f[at(3, 6)]).toBe(1);
    // ma trận: a→b = phiếu ngày 1 + treo b = 2 / (2 × 2 ngày).
    expect(f[cell(0, 1)]).toBe(0.5);
    expect(f[cell(0, 2)]).toBe(0.25);
    expect(f[cell(2, 1)]).toBe(0.5);
    expect(f[cell(3, 1)]).toBe(0.25); // phiếu Tha không tính
    expect(f[cell(1, 2)]).toBe(0.25);
    expect(f[cell(2, 3)]).toBe(0.25);
  });

  it("vai CHƯA lộ không vào votedRevealed*", () => {
    const f = encodeObservation(line(DAYS, { a: "SEER" })).features;
    expect(f[at(0, 1)]).toBe(0);
    expect(f[at(0, 2)]).toBe(0);
  });

  it("413 chiều đầu không đổi khi thêm lịch sử", () => {
    const none = encodeObservation(line([], { a: "SEER", b: "WEREWOLF" })).features;
    const some = encodeObservation(line(DAYS, { a: "SEER", b: "WEREWOLF" })).features;
    expect(some.slice(0, OLD)).toEqual(none.slice(0, OLD));
  });
});
