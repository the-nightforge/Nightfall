import { describe, expect, it } from "vitest";
import { actionIndexOf } from "../src/bot/learning/observation";
import { pickResidual, residualRows, type ResidualRow } from "../src/bot/policy/residual-policy";
import { createSeededRng } from "../src/bot/rng";

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
