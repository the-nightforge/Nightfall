import { describe, expect, it } from "vitest";
import { PRESET_DECKS } from "@masoi/shared";
import { replayGame, runSelfPlay, type SelfPlayGame } from "../src/bot/evaluation/selfplay";
import { gameToTrajectories } from "../src/bot/evaluation/trajectory";
import { candidateBases } from "../src/bot/learning/dataset";
import type { LearnedPolicy } from "../src/bot/learning/mlp";
import { actionIndexOf, actionSize, encodeObservation } from "../src/bot/learning/observation";
import { pickResidual, residualRows, type ResidualRow } from "../src/bot/policy/residual-policy";
import { createSeededRng } from "../src/bot/rng";

/** Residual = 0 với mọi obs: policy phải là heuristic đúng byte. */
function zeroResidual(beta = 10): LearnedPolicy {
  return {
    id: `res0-b${beta}`,
    logits: () => new Array<number>(actionSize()).fill(0),
    value: () => 0,
    residual: { beta },
  };
}

/** Residual thích một vài ô: β·10 = +100 điểm, át mọi chênh lệch heuristic. */
function residualPreferring(indices: number[], beta = 10): LearnedPolicy {
  return {
    id: `res-prefer-${indices.join("-")}`,
    logits: () => {
      const l = new Array<number>(actionSize()).fill(0);
      for (const i of indices) l[i] = 10;
      return l;
    },
    value: () => 0.25,
    residual: { beta },
  };
}

const decisions = (g: SelfPlayGame) =>
  g.traces.map((t) => [t.botId, t.round, t.decision, t.chosen.actionKind ?? null, t.chosen.targetId]);

describe("pickResidual", () => {
  const rows: ResidualRow[] = [
    { targetId: "p2", actionIndex: 1, adjusted: 40 },
    { targetId: "p10", actionIndex: 9, adjusted: 40 },
    { targetId: "p3", actionIndex: 2, adjusted: 35 },
  ];

  it("T=0: argmax theo adjusted, hoà thì localeCompare (p10 < p2) — đúng tie-break heuristic", () => {
    const picked = pickResidual(rows, 0, createSeededRng("never-drawn"))!;
    expect(picked.row.targetId).toBe("p10");
    // logProb ở τ=1 của chính phân phối trên bảng.
    const z = Math.exp(0) + Math.exp(0) + Math.exp(-5);
    expect(picked.logProb).toBeCloseTo(Math.log(1 / z), 9);
  });

  it("T=0 không rút RNG; T>0 rút đúng MỘT lần", () => {
    const rng0 = createSeededRng("draws");
    pickResidual(rows, 0, rng0);
    expect(rng0.cursor).toBe(0);
    const rng1 = createSeededRng("draws");
    pickResidual(rows, 5, rng1);
    expect(rng1.cursor).toBe(1);
  });

  it("T=5: tần suất khớp softmax(adjusted/5); logProb khớp", () => {
    const rng = createSeededRng("sample");
    const counts: Record<string, number> = { p2: 0, p10: 0, p3: 0 };
    for (let i = 0; i < 4000; i += 1) counts[pickResidual(rows, 5, rng)!.row.targetId]! += 1;
    const z = 2 + Math.exp(-1);
    expect(counts.p3! / 4000).toBeCloseTo(Math.exp(-1) / z, 1);
    expect(Math.abs(counts.p2! - counts.p10!)).toBeLessThan(250);
    const one = pickResidual(rows, 5, rng)!;
    const expected = one.row.targetId === "p3" ? Math.log(Math.exp(-1) / z) : Math.log(1 / z);
    expect(one.logProb).toBeCloseTo(expected, 9);
  });

  it("bảng rỗng → null", () => {
    expect(pickResidual([], 0, createSeededRng("x"))).toBeNull();
  });
});

describe("residualRows", () => {
  it("adjusted = score + β·logits[ô]; ứng viên không có ghế → []", () => {
    const seats = ["me", "p2", "p3"];
    const logits = new Array<number>(187).fill(0);
    logits[actionIndexOf("KILL", 2)] = 0.5;
    const rows = residualRows(
      [
        { targetId: "p2", score: 10 },
        { targetId: "p3", score: 8 },
      ],
      "KILL",
      logits,
      seats,
      10,
    );
    expect(rows).toEqual([
      { targetId: "p2", actionIndex: actionIndexOf("KILL", 1), adjusted: 10 },
      { targetId: "p3", actionIndex: actionIndexOf("KILL", 2), adjusted: 13 },
    ]);
    expect(residualRows([{ targetId: "zz", score: 1 }], "KILL", logits, seats, 10)).toEqual([]);
  });
});

describe("residual 0, T=0 → heuristic đúng byte (VOTE + NIGHT)", () => {
  for (let i = 0; i < 20; i += 1) {
    const seed = `res-byte-${i}`;
    it(seed, () => {
      const plain = runSelfPlay({ seed, playerCount: 8, maxRounds: 8, trace: true });
      const res = runSelfPlay({
        seed,
        playerCount: 8,
        maxRounds: 8,
        trace: true,
        learnedPolicy: zeroResidual(),
      });
      expect(res.winner).toBe(plain.winner);
      expect(res.actions).toBe(plain.actions);
      expect(res.rounds).toBe(plain.rounds);
      expect(JSON.stringify(res.events)).toBe(JSON.stringify(plain.events));
      expect(decisions(res)).toEqual(decisions(plain));
      expect(res.violations).toEqual([]);
    });
  }

  it("learnedDecisions vote/night cũng byte một", () => {
    const plain = runSelfPlay({ seed: "res-ld", playerCount: 8, maxRounds: 6, trace: true });
    for (const ld of ["vote", "night"] as const) {
      const g = runSelfPlay({
        seed: "res-ld",
        playerCount: 8,
        maxRounds: 6,
        trace: true,
        learnedPolicy: zeroResidual(),
        learnedDecisions: ld,
      });
      expect(decisions(g)).toEqual(decisions(plain));
    }
  });
});

describe("residual có thiên hướng lái được cả ngày lẫn đêm", () => {
  it("thích KILL ghế 2 → Sói cắn đúng người đó khi hợp lệ; thích CHOOSE ghế 1 → phiếu đi ghế 1 khi là ứng viên", () => {
    const policy = residualPreferring([actionIndexOf("KILL", 2), actionIndexOf("CHOOSE", 1)]);
    const game = runSelfPlay({
      seed: "res-steer",
      playerCount: 8,
      maxRounds: 6,
      trace: true,
      traceLiveInput: true,
      learnedPolicy: policy,
    });
    expect(game.violations).toEqual([]);
    let kills = 0;
    let votes = 0;
    for (const t of game.traces) {
      if (!t.liveInput) continue;
      const enc = encodeObservation(t.liveInput);
      if (t.decision === "NIGHT" && t.chosen.actionKind === "KILL") {
        const legal = t.liveInput.observation.nightLegalTargets?.KILL ?? [];
        const seat2 = enc.seats[2];
        if (seat2 !== undefined && legal.includes(seat2)) {
          expect(t.chosen.targetId).toBe(seat2);
          kills += 1;
        }
      }
      // Chỉ khi seat1 là ứng viên và nước đề xuất thật sự được đi (`learned`
      // có mặt): cổng hysteresis/không-treo của `selectVote` vẫn đứng sau.
      if (t.decision === "VOTE" && t.chosen.learned) {
        const seat1 = enc.seats[1];
        if (seat1 !== undefined && t.candidates.some((c) => c.targetId === seat1)) {
          expect(t.chosen.targetId).toBe(seat1);
          votes += 1;
        }
      }
    }
    expect(kills).toBeGreaterThan(0);
    expect(votes).toBeGreaterThan(0);
  });
});

describe("rollout residual T=5: learned cho VOTE lẫn NIGHT, replay tái lập", () => {
  it("ghi learned{beta:10,temperature:5} ở cả hai lượt; nhãn encoder trùng; Thám Tử có, Phù Thuỷ không", () => {
    const policy = zeroResidual();
    // Bộ bài chuẩn 8 người có Thám Tử (bộ mặc định của self-play thì không).
    const game = runSelfPlay({
      seed: "res-roll",
      playerCount: 8,
      config: PRESET_DECKS[8],
      maxRounds: 6,
      trace: true,
      learnedPolicy: policy,
      learnedTemperature: 5,
    });
    expect(game.violations).toEqual([]);
    const picks = game.traces.filter((t) => t.chosen.learned);
    expect(picks.some((t) => t.decision === "VOTE")).toBe(true);
    expect(picks.some((t) => t.decision === "NIGHT")).toBe(true);
    for (const t of picks) {
      expect(t.chosen.learned!.beta).toBe(10);
      expect(t.chosen.learned!.temperature).toBe(5);
      expect(t.chosen.learned!.logProb).toBeLessThanOrEqual(0);
    }
    const byRole = (role: string) =>
      game.traces.filter((t) => t.decision === "NIGHT" && game.roles[t.botId] === role);
    for (const t of byRole("WITCH")) expect(t.chosen.learned).toBeUndefined();
    const detective = byRole("DETECTIVE").filter((t) => t.chosen.actionKind === "DETECTIVE_CHECK");
    expect(detective.length).toBeGreaterThan(0);
    for (const t of detective) expect(t.chosen.learned).toBeDefined();
    const lines = gameToTrajectories(game).filter((l) => l.learned);
    expect(lines).toHaveLength(picks.length);
    for (const l of lines) expect(encodeObservation(l).actionIndex).toBe(l.learned!.actionIndex);
    // `replayGame` không thu trace; so kết cục ở đó và so từng quyết định ở
    // một lần chạy lại cùng đầu vào có trace.
    const again = replayGame(game.record, undefined, policy);
    expect(again.actions).toBe(game.actions);
    expect(again.winner).toBe(game.winner);
    const traced = runSelfPlay({
      seed: "res-roll",
      playerCount: 8,
      config: PRESET_DECKS[8],
      maxRounds: 6,
      trace: true,
      learnedPolicy: policy,
      learnedTemperature: 5,
    });
    expect(decisions(traced)).toEqual(decisions(game));
  });
});

describe("bases + β + τ dựng lại đúng logProb đã ghi (điều kiện approxKl ≈ 0)", () => {
  it("log softmax((bases + β·logits)/τ)[a] == learned.logProb ở mọi line rollout", () => {
    const policy = residualPreferring([actionIndexOf("KILL", 2), actionIndexOf("CHOOSE", 3)]);
    const game = runSelfPlay({
      seed: "res-recon",
      playerCount: 8,
      config: PRESET_DECKS[8],
      maxRounds: 6,
      trace: true,
      learnedPolicy: policy,
      learnedTemperature: 5,
    });
    const lines = gameToTrajectories(game).filter((l) => l.learned);
    expect(lines.length).toBeGreaterThan(10);
    expect(lines.some((l) => l.decision === "NIGHT")).toBe(true);
    for (const l of lines) {
      const enc = encodeObservation(l);
      const bases = candidateBases(l, enc);
      const logits = policy.logits(enc.features);
      const adj = bases.map((b, i) => (Number.isNaN(b) ? Number.NaN : (b + 10 * logits[i]!) / 5));
      const idx = adj.map((v, i) => (Number.isNaN(v) ? -1 : i)).filter((i) => i >= 0);
      const max = Math.max(...idx.map((i) => adj[i]!));
      const z = idx.reduce((sum, i) => sum + Math.exp(adj[i]! - max), 0);
      const a = l.learned!.actionIndex;
      expect(idx).toContain(a);
      expect(adj[a]! - max - Math.log(z)).toBeCloseTo(l.learned!.logProb, 9);
    }
  });
});
