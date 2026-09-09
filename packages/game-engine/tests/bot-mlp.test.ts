import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  actionNames,
  actionSize,
  observationFeatureNames,
  observationSize,
} from "../src/bot/learning/observation";
import { loadMlpPolicy, mlpForward, type MlpWeightsJson } from "../src/bot/learning/mlp";

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/mlp-parity.json"), "utf8"),
) as MlpWeightsJson & { parity: { input: number[]; logits: number[]; value: number } };

/** Trọng số 0 với đúng chiều của encoder hiện tại — chỉ để kiểm validate. */
function zeroWeights(): MlpWeightsJson {
  const obs = observationSize();
  const act = actionSize();
  const hidden = 2;
  const zeros = (rows: number, cols: number): number[][] =>
    Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  return {
    format: "masoi-mlp-1",
    modelId: "zero",
    obsSize: obs,
    actionSize: act,
    hidden,
    featureNames: observationFeatureNames(),
    actionNames: actionNames(),
    layers: [
      { w: zeros(hidden, obs), b: [0, 0] },
      { w: zeros(hidden, hidden), b: [0, 0] },
    ],
    policyHead: { w: zeros(act, hidden), b: new Array<number>(act).fill(0) },
  };
}

describe("mlpForward", () => {
  it("khớp torch trên fixture parity (sai số 1e-6)", () => {
    const { logits, value } = mlpForward(fixture, fixture.parity.input);
    expect(logits).toHaveLength(5);
    for (let i = 0; i < 5; i += 1) expect(logits[i]).toBeCloseTo(fixture.parity.logits[i]!, 6);
    expect(value).toBeCloseTo(fixture.parity.value, 6);
  });

  it("tất định: cùng input → cùng output", () => {
    expect(mlpForward(fixture, fixture.parity.input)).toEqual(
      mlpForward(fixture, fixture.parity.input),
    );
  });
});

describe("loadMlpPolicy", () => {
  it("nạp model đúng schema và trả logits đúng chiều", () => {
    const policy = loadMlpPolicy(zeroWeights());
    expect(policy.id).toBe("zero");
    expect(policy.logits(new Array<number>(observationSize()).fill(0))).toHaveLength(actionSize());
  });

  it("TỪ CHỐI khi featureNames lệch encoder", () => {
    const bad = zeroWeights();
    bad.featureNames = [...bad.featureNames.slice(1), "stray"];
    expect(() => loadMlpPolicy(bad)).toThrow(/featureNames/);
  });

  it("TỪ CHỐI khi obsSize lệch, format lạ, hoặc ma trận sai chiều", () => {
    expect(() => loadMlpPolicy({ ...zeroWeights(), obsSize: 5 })).toThrow(/obsSize/);
    expect(() => loadMlpPolicy({ ...zeroWeights(), format: "x" })).toThrow(/format/);
    const bad = zeroWeights();
    bad.layers[0]!.b = [0];
    expect(() => loadMlpPolicy(bad)).toThrow(/layers\[0\]/);
  });

  it("TỪ CHỐI input sai chiều lúc gọi", () => {
    const policy = loadMlpPolicy(zeroWeights());
    expect(() => policy.logits([1, 2, 3])).toThrow(/chiều/);
  });
});
