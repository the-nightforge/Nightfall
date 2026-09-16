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

/** P1-1: fixture silu + layernorm do `tests/make_mlp_fixture.py` sinh. */
const fixtureV2 = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/mlp-parity-v2.json"), "utf8"),
) as MlpWeightsJson & { parity: { input: number[]; logits: number[]; value: number } };

/** Tách trunk value: value đi đường riêng. */
const fixtureV3 = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/mlp-parity-v3.json"), "utf8"),
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

  it("v2 khớp torch trên fixture silu+layernorm (sai số 1e-6)", () => {
    const { logits, value } = mlpForward(fixtureV2, fixtureV2.parity.input);
    expect(logits).toHaveLength(5);
    for (let i = 0; i < 5; i += 1) expect(logits[i]).toBeCloseTo(fixtureV2.parity.logits[i]!, 6);
    expect(value).toBeCloseTo(fixtureV2.parity.value, 6);
  });

  it("v2-separate khớp torch khi value đi trunk riêng (sai số 1e-6)", () => {
    const { logits, value } = mlpForward(fixtureV3, fixtureV3.parity.input);
    expect(logits).toHaveLength(5);
    for (let i = 0; i < 5; i += 1) expect(logits[i]).toBeCloseTo(fixtureV3.parity.logits[i]!, 6);
    expect(value).toBeCloseTo(fixtureV3.parity.value, 6);
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

  it("residual: nạp `residual.beta` hữu hạn > 0; vắng thì không có trường; sai thì TỪ CHỐI", () => {
    const plain = loadMlpPolicy(zeroWeights());
    expect(plain.residual).toBeUndefined();
    const res = loadMlpPolicy({ ...zeroWeights(), residual: { beta: 10 } });
    expect(res.residual).toEqual({ beta: 10 });
    expect(() => loadMlpPolicy({ ...zeroWeights(), residual: { beta: 0 } })).toThrow(/residual/);
    expect(() => loadMlpPolicy({ ...zeroWeights(), residual: { beta: Number.NaN } })).toThrow(
      /residual/,
    );
    expect(() => loadMlpPolicy({ ...zeroWeights(), residual: {} })).toThrow(/residual/);
  });

  it("TỪ CHỐI input sai chiều lúc gọi", () => {
    const policy = loadMlpPolicy(zeroWeights());
    expect(() => policy.logits([1, 2, 3])).toThrow(/chiều/);
  });

  it("v2: nạp silu+layernorm, activation/norm lạ hoặc thiếu normLayers thì TỪ CHỐI", () => {
    // Fixture parity (obs 4) không qua được schema-check của encoder thật theo
    // thiết kế — dựng weights v2 đúng chiều encoder để kiểm loadMlpPolicy.
    const v2weights = (): MlpWeightsJson => ({
      ...zeroWeights(),
      format: "masoi-mlp-2",
      activation: "silu",
      norm: "layernorm",
      normLayers: [
        { w: [1, 1], b: [0, 0] },
        { w: [1, 1], b: [0, 0] },
      ],
    });
    const v2 = loadMlpPolicy(v2weights());
    expect(v2.logits(new Array<number>(observationSize()).fill(0))).toHaveLength(actionSize());
    expect(() => loadMlpPolicy({ ...v2weights(), activation: "gelu" })).toThrow(/activation/);
    expect(() => loadMlpPolicy({ ...v2weights(), norm: "batchnorm" })).toThrow(/norm/);
    const noNorm = { ...v2weights() } as Record<string, unknown>;
    delete noNorm["normLayers"];
    expect(() => loadMlpPolicy(noNorm)).toThrow(/normLayers/);
  });

  it("v2-separate: thiếu/sai valueLayers (hoặc valueNormLayers khi layernorm) thì TỪ CHỐI", () => {
    const sep = (): MlpWeightsJson => {
      const base = zeroWeights();
      const zeros = (rows: number, cols: number): number[][] =>
        Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
      return {
        ...base,
        format: "masoi-mlp-2",
        valueTrunk: "separate",
        valueLayers: [
          { w: zeros(2, base.obsSize), b: [0, 0] },
          { w: zeros(2, 2), b: [0, 0] },
        ],
      };
    };
    const loaded = loadMlpPolicy(sep());
    expect(loaded.logits(new Array<number>(observationSize()).fill(0))).toHaveLength(
      actionSize(),
    );
    const missing = { ...sep() } as Record<string, unknown>;
    delete missing["valueLayers"];
    expect(() => loadMlpPolicy(missing)).toThrow(/valueLayers/);
    const bad = sep();
    bad.valueLayers = [{ w: [[1]], b: [0] }, bad.valueLayers![1]!];
    expect(() => loadMlpPolicy(bad)).toThrow(/valueLayers/);
    expect(() => loadMlpPolicy({ ...sep(), valueTrunk: "split" })).toThrow(/valueTrunk/);
  });
});
