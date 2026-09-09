# Learned Policy Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho một model behavior-cloning (`policy-0004`) chơi trọn ván trong self-play qua `BotRuntime`, và đo nó đấu với bot heuristic trên seed cố định — mà production không đổi một byte.

**Architecture:** Trọng số MLP xuất ra JSON, forward pass viết thuần TypeScript trong `game-engine` (đồng bộ, tất định, không dependency). Observation lúc chơi dựng bằng ĐÚNG hàm mà trace dùng, nên vector lúc chơi và vector lúc train giống nhau theo cấu trúc. Policy học được cắm vào seam `votePolicy` có sẵn cho ban ngày và một seam mới trong `decideNight` cho ban đêm; cả hai chỉ hoạt động khi `BotRuntime` được cấp `learnedPolicy`, còn không thì hành vi y hệt hiện tại. Cuối cùng là script benchmark ba cấu hình.

**Tech Stack:** TypeScript (vitest trong `packages/game-engine`, `tsx` script trong `apps/server`), Python 3.13 + torch trong `ai-training/.venv`.

**Spec:** `docs/superpowers/specs/2026-09-09-learned-policy-runtime-design.md` — executor đọc cả hai. Bối cảnh số liệu: `reports/train-policy-0002.md` (local, gitignore).

## Global Constraints

- `packages/game-engine` KHÔNG import `node:fs`, `node:process`, `child_process`, `net`. Mọi đọc file nằm ở `apps/server/scripts/**` hoặc trong test.
- Mọi `decide*` của `BotRuntime` giữ ĐỒNG BỘ. Không async ở đường quyết định.
- `BotRuntime` không có `learnedPolicy` phải cho ra kết quả byte-identical với hiện tại. Test `bot-*.test.ts` hiện có là bằng chứng: không sửa expectation nào của chúng.
- Không đổi định dạng `.bin`/`meta.json` của `ai:encode`; không đổi chiều vector (413) hay không gian hành động (187).
- `apps/server/src/bots/session-registry.ts` KHÔNG đổi (production giữ heuristic).
- Model bị TỪ CHỐI khi `featureNames`/`actionNames` trong JSON không khớp encoder hiện tại — không tự chỉnh, không cắt bớt.
- Chạy Python với `PYTHONUTF8=1` (console Windows cp1252 crash khi in tiếng Việt).
- Sau khi sửa `packages/game-engine` hoặc `packages/shared`: `npm run build:deps` trước khi chạy script trong `apps/server`, rồi `npm run lint` ở gốc và đọc mã thoát (memory `build-deps-exit-code`).
- TDD mọi task: failing test → implement tối thiểu → pass → commit. Mỗi task một commit trên nhánh `feat/learned-policy-runtime` (tạo từ `main`, không làm trên `main`).
- Mọi test/script chạy từ thư mục gốc `C:\Users\Admin\ma-soi-online` trừ khi ghi khác.

---

## Bản đồ file

| File | Trách nhiệm |
|---|---|
| `ai-training/masoi_training/export.py` (mới) | `export_weights_json(model, meta, path)`: state_dict → JSON `masoi-mlp-1` |
| `ai-training/masoi_training/train_bc.py` (sửa) | gọi export sau khi lưu `model.pt` |
| `ai-training/tests/test_export.py` (mới) | numpy forward == torch forward |
| `ai-training/tests/make_mlp_fixture.py` (mới) | sinh fixture parity nhỏ cho TS |
| `packages/game-engine/tests/fixtures/mlp-parity.json` (mới, commit) | mạng 4→3→3→5 + input + output kỳ vọng |
| `packages/game-engine/src/bot/learning/mlp.ts` (mới) | `LearnedPolicy`, `mlpForward`, `loadMlpPolicy` |
| `packages/game-engine/src/bot/trace/snapshot.ts` (mới) | `snapshotKnowledge`, `snapshotBelief` — hàm thuần, tách từ `BotRuntime` |
| `packages/game-engine/src/bot/BotRuntime.ts` (sửa) | dùng `snapshot.ts`; nhận `learnedPolicy`; seam đêm |
| `packages/game-engine/src/bot/evaluation/trajectory.ts` (sửa) | tách `observationFromTrace` |
| `packages/game-engine/src/bot/learning/observation.ts` (sửa) | `ObservationInput`; `selectedAction` optional |
| `packages/game-engine/src/bot/learning/live-observation.ts` (mới) | `buildLiveObservation(knowledge, state, weights, decision)` |
| `packages/game-engine/src/bot/policy/learned-policy.ts` (mới) | `learnedPolicyModel` (ngày), `selectLearnedNight` (đêm) |
| `packages/game-engine/src/bot/evaluation/selfplay.ts` (sửa) | `learnedPolicy`/`learnedSeats` vào input + record; replay guard |
| `packages/game-engine/src/bot/evaluation/report.ts` (sửa) | truyền hai trường trên qua `runBatch` |
| `packages/game-engine/src/index.ts` (sửa) | export module mới |
| `apps/server/scripts/ai-benchmark.ts` (mới) | CLI: đọc JSON, chạy 3 cấu hình × repeat, in bảng |
| `package.json` (sửa) | script `ai:benchmark` |
| `docs/BOT_SELF_LEARNING_TRAINING.md` (sửa) | Bước 7: benchmark |

---

### Task 1: Xuất trọng số MLP ra JSON từ Python

**Files:**
- Create: `ai-training/masoi_training/export.py`
- Modify: `ai-training/masoi_training/train_bc.py:150-175` (sau `torch.save`)
- Test: `ai-training/tests/test_export.py`

**Interfaces:**
- Consumes: `PolicyValueNet` (`model.py`): `trunk[0]`, `trunk[2]` là `nn.Linear`, `policy_head` là `nn.Linear`, `value_head[0]` là `nn.Linear`.
- Produces: file JSON dạng

```json
{
  "format": "masoi-mlp-1",
  "modelId": "policy-0004",
  "gitCommit": "…", "datasetVersion": "dataset-0003", "trainingSeed": 12345,
  "obsSize": 413, "actionSize": 187, "hidden": 128,
  "featureNames": ["round", …],      // đúng meta.json của dataset
  "actionNames": ["CHOOSE:seat0", …],
  "layers": [ {"w": [[…]], "b": [...]}, {"w": [[…]], "b": [...]} ],
  "policyHead": {"w": [[…]], "b": [...]},
  "valueHead":  {"w": [[…]], "b": [...]}
}
```
`w` là mảng `[out][in]` — đúng thứ tự `nn.Linear.weight`.

- [ ] **Step 1: Viết test parity numpy/torch**

```python
# ai-training/tests/test_export.py
"""export_weights_json phải cho forward pass numpy == torch. Chạy: python tests/test_export.py"""
from __future__ import annotations
import json, sys, tempfile
from pathlib import Path
import numpy as np
import torch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from masoi_training.model import PolicyValueNet   # noqa: E402
from masoi_training.export import export_weights_json  # noqa: E402

def np_forward(w: dict, x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    h = x
    for layer in w["layers"]:
        h = np.maximum(0.0, h @ np.array(layer["w"]).T + np.array(layer["b"]))
    logits = h @ np.array(w["policyHead"]["w"]).T + np.array(w["policyHead"]["b"])
    value = np.tanh(h @ np.array(w["valueHead"]["w"]).T + np.array(w["valueHead"]["b"]))
    return logits, value[..., 0]

def main() -> None:
    torch.manual_seed(1)
    obs, act, hidden = 7, 5, 6
    model = PolicyValueNet(obs, act, hidden).eval()
    meta = {"obsSize": obs, "actionSize": act, "featureNames": [f"f{i}" for i in range(obs)],
            "actionNames": [f"a{i}" for i in range(act)], "datasetVersion": "test", "gitCommit": None}
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "model.weights.json"
        export_weights_json(model, meta, path, model_id="t", training_seed=1, hidden=hidden)
        w = json.loads(path.read_text(encoding="utf8"))
    assert w["format"] == "masoi-mlp-1" and w["obsSize"] == obs and w["actionSize"] == act
    assert len(w["layers"]) == 2 and len(w["layers"][0]["w"]) == hidden and len(w["layers"][0]["w"][0]) == obs
    x = np.random.default_rng(3).random((4, obs), dtype=np.float32)
    with torch.no_grad():
        t_logits, t_value = model(torch.from_numpy(x))
    n_logits, n_value = np_forward(w, x.astype(np.float64))
    assert np.allclose(n_logits, t_logits.numpy(), atol=1e-5), "logits lệch"
    assert np.allclose(n_value, t_value.numpy(), atol=1e-5), "value lệch"
    print("ok")

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Chạy để thấy fail**

Run: `cd ai-training && PYTHONUTF8=1 ./.venv/Scripts/python.exe tests/test_export.py`
Expected: `ModuleNotFoundError: No module named 'masoi_training.export'`

- [ ] **Step 3: Viết `export.py`**

```python
# ai-training/masoi_training/export.py
"""Xuất trọng số MLP ra JSON để runtime TypeScript chạy forward pass thuần.

Vì sao không nạp ONNX ở runtime: `packages/game-engine` phải thuần (không I/O),
`onnxruntime-node` chỉ có API bất đồng bộ trong khi mọi quyết định của bot là
đồng bộ, và model chỉ là ba phép nhân ma trận. `featureNames`/`actionNames`
đi kèm để runtime TỪ CHỐI một model lệch schema encoder thay vì chạy sai.
"""
from __future__ import annotations
import json
from pathlib import Path
from torch import nn
from .model import PolicyValueNet

FORMAT = "masoi-mlp-1"

def _linear(layer: nn.Linear) -> dict:
    return {"w": layer.weight.detach().cpu().tolist(), "b": layer.bias.detach().cpu().tolist()}

def export_weights_json(model: PolicyValueNet, meta: dict, path: Path, *,
                        model_id: str, training_seed: int, hidden: int) -> None:
    payload = {
        "format": FORMAT,
        "modelId": model_id,
        "gitCommit": meta.get("gitCommit"),
        "datasetVersion": meta.get("datasetVersion"),
        "trainingSeed": training_seed,
        "obsSize": int(meta["obsSize"]),
        "actionSize": int(meta["actionSize"]),
        "hidden": hidden,
        "featureNames": list(meta.get("featureNames", [])),
        "actionNames": list(meta.get("actionNames", [])),
        "layers": [_linear(model.trunk[0]), _linear(model.trunk[2])],
        "policyHead": _linear(model.policy_head),
        "valueHead": _linear(model.value_head[0]),
    }
    Path(path).write_text(json.dumps(payload), encoding="utf8")
```

- [ ] **Step 4: Chạy test → pass**

Run: `cd ai-training && PYTHONUTF8=1 ./.venv/Scripts/python.exe tests/test_export.py`
Expected: `ok`

- [ ] **Step 5: Gọi export trong `train_bc.py`**

Tìm dòng `torch.save(model.state_dict(), out / "model.pt")` và thêm ngay sau:

```python
    from .export import export_weights_json
    export_weights_json(
        model, full.meta, out / "model.weights.json",
        model_id=args.model_id, training_seed=args.seed, hidden=args.hidden,
    )
```

Đưa `from .export import export_weights_json` lên khối import đầu file (cạnh `from .model import …`) và bỏ dòng import cục bộ.

- [ ] **Step 6: Chạy smoke để chắc train vẫn chạy và có file mới**

Run: `cd ai-training && PYTHONUTF8=1 ./.venv/Scripts/python.exe tests/test_train_smoke.py`
Expected: `ok`. Mở `tests/test_train_smoke.py`, thêm sau `assert (out / "model.pt").exists()`:
```python
        assert (out / "model.weights.json").exists(), "thiếu model.weights.json"
```
Chạy lại → `ok`.

- [ ] **Step 7: Xuất JSON cho model đã train sẵn (không train lại)**

```bash
cd ai-training && PYTHONUTF8=1 ./.venv/Scripts/python.exe -c "
import json, torch
from pathlib import Path
from masoi_training.model import PolicyValueNet
from masoi_training.export import export_weights_json
meta = json.loads(Path('../.tmp/enc-ob/meta.json').read_text(encoding='utf8'))
m = PolicyValueNet(meta['obsSize'], meta['actionSize'], 128)
m.load_state_dict(torch.load('../.tmp/model-ob/model.pt'))
export_weights_json(m, meta, Path('../.tmp/model-ob/model.weights.json'), model_id='policy-0004', training_seed=12345, hidden=128)
print('ok')"
```
Expected: `ok`, file `.tmp/model-ob/model.weights.json` khoảng 2 MB. Nếu `.tmp/enc-ob/meta.json` không còn, sinh lại theo `docs/BOT_SELF_LEARNING_TRAINING.md` Bước 2–4.

- [ ] **Step 8: Commit**

```bash
git add ai-training/masoi_training/export.py ai-training/masoi_training/train_bc.py ai-training/tests/test_export.py ai-training/tests/test_train_smoke.py
git commit -m "feat(ai): export MLP weights as JSON for the TypeScript runtime"
```

---

### Task 2: Forward pass MLP thuần TypeScript + fixture parity

**Files:**
- Create: `ai-training/tests/make_mlp_fixture.py`
- Create: `packages/game-engine/tests/fixtures/mlp-parity.json`
- Create: `packages/game-engine/src/bot/learning/mlp.ts`
- Test: `packages/game-engine/tests/bot-mlp.test.ts`

**Interfaces:**
- Produces:
```ts
export interface MlpLinear { w: number[][]; b: number[] }
export interface MlpWeightsJson {
  format: "masoi-mlp-1"; modelId: string;
  gitCommit?: string | null; datasetVersion?: string | null; trainingSeed?: number;
  obsSize: number; actionSize: number; hidden: number;
  featureNames: string[]; actionNames: string[];
  layers: MlpLinear[]; policyHead: MlpLinear; valueHead?: MlpLinear;
}
export interface LearnedPolicy {
  readonly id: string;
  /** logits dài `actionSize`, CHƯA mask. Thuần, đồng bộ, tất định. */
  logits(features: readonly number[]): number[];
  /** value head (tanh), nếu model có. */
  value(features: readonly number[]): number | null;
}
export function mlpForward(weights: MlpWeightsJson, x: readonly number[]): { logits: number[]; value: number | null };
export function loadMlpPolicy(json: unknown, options?: { maxSeats?: number }): LearnedPolicy;
```

- [ ] **Step 1: Sinh fixture parity bằng Python (mạng nhỏ, số cố định)**

```python
# ai-training/tests/make_mlp_fixture.py
"""Sinh packages/game-engine/tests/fixtures/mlp-parity.json: mạng 4→3→3→5 có
trọng số cố định, một input, và output torch tính ra. Test TS so với nó."""
from __future__ import annotations
import json, sys
from pathlib import Path
import torch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from masoi_training.model import PolicyValueNet
from masoi_training.export import export_weights_json

torch.manual_seed(2026)
model = PolicyValueNet(4, 5, 3).eval()
out = Path(__file__).resolve().parents[2] / "packages/game-engine/tests/fixtures/mlp-parity.json"
tmp = out.with_suffix(".tmp.json")
meta = {"obsSize": 4, "actionSize": 5, "featureNames": ["f0","f1","f2","f3"],
        "actionNames": ["a0","a1","a2","a3","a4"], "datasetVersion": "fixture", "gitCommit": None}
export_weights_json(model, meta, tmp, model_id="fixture", training_seed=2026, hidden=3)
w = json.loads(tmp.read_text(encoding="utf8")); tmp.unlink()
x = [0.1, -0.2, 0.3, 0.9]
with torch.no_grad():
    logits, value = model(torch.tensor([x]))
w["parity"] = {"input": x, "logits": logits[0].tolist(), "value": float(value[0])}
out.write_text(json.dumps(w, indent=1), encoding="utf8")
print("wrote", out)
```

Run: `cd ai-training && PYTHONUTF8=1 ./.venv/Scripts/python.exe tests/make_mlp_fixture.py`
Expected: `wrote …/mlp-parity.json`. Mở file: có `layers` (2), `policyHead`, `valueHead`, `parity`.

- [ ] **Step 2: Viết test TS (fail)**

```ts
// packages/game-engine/tests/bot-mlp.test.ts
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
  const zeros = (rows: number, cols: number) => Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  return {
    format: "masoi-mlp-1", modelId: "zero", obsSize: obs, actionSize: act, hidden,
    featureNames: observationFeatureNames(), actionNames: actionNames(),
    layers: [{ w: zeros(hidden, obs), b: [0, 0] }, { w: zeros(hidden, hidden), b: [0, 0] }],
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
    expect(mlpForward(fixture, fixture.parity.input)).toEqual(mlpForward(fixture, fixture.parity.input));
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
```

Run: `cd packages/game-engine && npx vitest run tests/bot-mlp.test.ts`
Expected: FAIL — `Cannot find module '../src/bot/learning/mlp'`

- [ ] **Step 3: Viết `mlp.ts`**

```ts
// packages/game-engine/src/bot/learning/mlp.ts
import {
  actionNames,
  actionSize,
  observationFeatureNames,
  observationSize,
} from "./observation";

/**
 * Forward pass MLP thuần TypeScript, đồng bộ, tất định.
 *
 * Vì sao không nạp ONNX ở runtime: package này phải thuần (không I/O),
 * `onnxruntime-node` chỉ có API bất đồng bộ trong khi `BotRuntime.decide*` là
 * đồng bộ, và model chỉ là ba phép nhân ma trận (~94k tham số). Định dạng
 * `masoi-mlp-1` do `ai-training/masoi_training/export.py` xuất.
 */

export interface MlpLinear {
  /** `[out][in]`, đúng thứ tự `nn.Linear.weight`. */
  w: number[][];
  b: number[];
}

export interface MlpWeightsJson {
  format: "masoi-mlp-1";
  modelId: string;
  gitCommit?: string | null;
  datasetVersion?: string | null;
  trainingSeed?: number;
  obsSize: number;
  actionSize: number;
  hidden: number;
  featureNames: string[];
  actionNames: string[];
  layers: MlpLinear[];
  policyHead: MlpLinear;
  valueHead?: MlpLinear;
}

export interface LearnedPolicy {
  readonly id: string;
  /** logits dài `actionSize`, CHƯA mask. Thuần, đồng bộ, tất định. */
  logits(features: readonly number[]): number[];
  /** value head (tanh) nếu model có, ngược lại `null`. */
  value(features: readonly number[]): number | null;
}

function linear(layer: MlpLinear, x: readonly number[]): number[] {
  const out = new Array<number>(layer.w.length);
  for (let i = 0; i < layer.w.length; i += 1) {
    const row = layer.w[i]!;
    let sum = layer.b[i]!;
    for (let j = 0; j < row.length; j += 1) sum += row[j]! * x[j]!;
    out[i] = sum;
  }
  return out;
}

function relu(x: number[]): number[] {
  for (let i = 0; i < x.length; i += 1) if (x[i]! < 0) x[i] = 0;
  return x;
}

export function mlpForward(
  weights: MlpWeightsJson,
  x: readonly number[],
): { logits: number[]; value: number | null } {
  let h: number[] = [...x];
  for (const layer of weights.layers) h = relu(linear(layer, h));
  const logits = linear(weights.policyHead, h);
  const value = weights.valueHead ? Math.tanh(linear(weights.valueHead, h)[0]!) : null;
  return { logits, value };
}

function checkLinear(name: string, layer: unknown, rows: number, cols: number): MlpLinear {
  const l = layer as Partial<MlpLinear> | null;
  if (!l || !Array.isArray(l.w) || !Array.isArray(l.b)) throw new Error(`${name}: thiếu w/b`);
  if (l.w.length !== rows || l.b.length !== rows) {
    throw new Error(`${name}: chờ ${rows} hàng, nhận w=${l.w.length} b=${l.b.length}`);
  }
  for (const row of l.w) {
    if (!Array.isArray(row) || row.length !== cols) throw new Error(`${name}: hàng phải dài ${cols}`);
  }
  return l as MlpLinear;
}

function sameList(name: string, got: unknown, want: readonly string[]): void {
  if (!Array.isArray(got) || got.length !== want.length || got.some((v, i) => v !== want[i])) {
    throw new Error(`${name} không khớp encoder hiện tại — model này train trên schema khác, từ chối nạp`);
  }
}

/**
 * Nạp và KIỂM một model. Từ chối mọi lệch schema thay vì chạy sai: một model
 * 365 chiều nạp lên encoder 413 chiều sẽ ra số, và số đó không có nghĩa.
 */
export function loadMlpPolicy(json: unknown, options: { maxSeats?: number } = {}): LearnedPolicy {
  const w = json as Partial<MlpWeightsJson> | null;
  if (!w || w.format !== "masoi-mlp-1") throw new Error("format không phải masoi-mlp-1");
  const obs = observationSize(options.maxSeats);
  const act = actionSize(options.maxSeats);
  if (w.obsSize !== obs) throw new Error(`obsSize ${w.obsSize} ≠ encoder ${obs}`);
  if (w.actionSize !== act) throw new Error(`actionSize ${w.actionSize} ≠ encoder ${act}`);
  sameList("featureNames", w.featureNames, observationFeatureNames(options.maxSeats));
  sameList("actionNames", w.actionNames, actionNames(options.maxSeats));
  if (!Array.isArray(w.layers) || w.layers.length === 0) throw new Error("layers rỗng");
  let width = obs;
  const layers = w.layers.map((layer, i) => {
    const rows = (layer as MlpLinear).w?.length ?? 0;
    const checked = checkLinear(`layers[${i}]`, layer, rows, width);
    width = rows;
    return checked;
  });
  const policyHead = checkLinear("policyHead", w.policyHead, act, width);
  const valueHead = w.valueHead ? checkLinear("valueHead", w.valueHead, 1, width) : undefined;
  const weights: MlpWeightsJson = { ...(w as MlpWeightsJson), layers, policyHead, valueHead };
  const id = typeof w.modelId === "string" ? w.modelId : "unnamed";

  const guard = (x: readonly number[]): void => {
    if (x.length !== obs) throw new Error(`features phải có ${obs} chiều, nhận ${x.length}`);
  };
  return {
    id,
    logits(features) {
      guard(features);
      return mlpForward(weights, features).logits;
    },
    value(features) {
      guard(features);
      return mlpForward(weights, features).value;
    },
  };
}
```

- [ ] **Step 4: Chạy test → pass**

Run: `cd packages/game-engine && npx vitest run tests/bot-mlp.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Export từ `index.ts`**

Thêm vào `packages/game-engine/src/index.ts` cạnh hai dòng `export * from "./bot/learning/..."`:
```ts
export * from "./bot/learning/mlp";
```

- [ ] **Step 6: Build + lint**

Run: `npm run build:deps && npm run lint`
Expected: cả hai exit 0.

- [ ] **Step 7: Commit**

```bash
git add ai-training/tests/make_mlp_fixture.py packages/game-engine/tests/fixtures/mlp-parity.json packages/game-engine/src/bot/learning/mlp.ts packages/game-engine/tests/bot-mlp.test.ts packages/game-engine/src/index.ts
git commit -m "feat(ai): pure TypeScript MLP forward pass with schema-checked loader"
```

---

### Task 3: Tách `snapshotKnowledge` / `snapshotBelief` thành hàm thuần

**Files:**
- Create: `packages/game-engine/src/bot/trace/snapshot.ts`
- Modify: `packages/game-engine/src/bot/BotRuntime.ts:170-200` (`snapshotKnowledge`) và `~610-650` (`snapshotBelief`)
- Test: `packages/game-engine/tests/bot-snapshot.test.ts`

**Interfaces:**
- Produces:
```ts
export function snapshotKnowledge(knowledge: BotKnowledgeView): TraceKnowledgeSnapshot;
export function snapshotBelief(state: BotBrainState, knowledge: BotKnowledgeView, weights: BotWeights): BeliefSnapshot;
```
Nội dung hai hàm là NGUYÊN VĂN code hiện có trong `BotRuntime.ts` (cắt-dán, đổi `this.state`→`state`, `this.weights`→`weights`). Không đổi một phép tính nào.

- [ ] **Step 1: Viết test (fail)**

```ts
// packages/game-engine/tests/bot-snapshot.test.ts
import { describe, expect, it } from "vitest";
import { runSelfPlay } from "../src/bot/evaluation/selfplay";
import { snapshotKnowledge } from "../src/bot/trace/snapshot";

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
    } as never;
    expect(snapshotKnowledge(minimal)).toMatchObject({
      aliveIds: ["a"], legalChoices: [], nightLegalTargets: null, hunterLegalTargets: null,
      knownRoles: {}, seerResult: null, nightWolfTarget: null, nightLegalActions: null,
      healUsed: false, poisonUsed: false, guardPrevious: null, lastNightDeaths: [],
      voteCounts: { players: {}, noElimination: 0 }, trialAccusedId: null,
    });
  });
});
```

Run: `cd packages/game-engine && npx vitest run tests/bot-snapshot.test.ts`
Expected: FAIL — module `../src/bot/trace/snapshot` không tồn tại.

- [ ] **Step 2: Tạo `snapshot.ts` bằng cách DI CHUYỂN code**

Mở `BotRuntime.ts`, cắt hàm `function snapshotKnowledge(...)` (kèm block chú thích trên nó) và thân của phương thức `private snapshotBelief(knowledge)`, dán vào file mới:

```ts
// packages/game-engine/src/bot/trace/snapshot.ts
import { assessPlayers } from "../belief/player-assessment";
import type { BotWeights } from "../config/weights";
import { informationValue } from "../roles/uncertainty";
import { powerRoleClaimOf } from "../roles/wolf-team-plan";
import type { BotBrainState, BotKnowledgeView } from "../types";
import type { BeliefSnapshot, TraceKnowledgeSnapshot } from "./trace";

/**
 * Hai ảnh chụp mà trace ghi và observation lúc chơi dùng CHUNG.
 *
 * Tách khỏi `BotRuntime` để `buildLiveObservation` gọi được cùng code: cách
 * duy nhất chắc chắn vector lúc chơi == vector lúc train là không có hai bản.
 */
export function snapshotKnowledge(knowledge: BotKnowledgeView): TraceKnowledgeSnapshot {
  // … NGUYÊN VĂN thân hàm cũ trong BotRuntime.ts …
}

export function snapshotBelief(
  state: BotBrainState,
  knowledge: BotKnowledgeView,
  weights: BotWeights,
): BeliefSnapshot {
  // … NGUYÊN VĂN thân phương thức cũ, thay `this.state`→`state`, `this.weights`→`weights` …
}
```

Trong `BotRuntime.ts`:
- Import: `import { snapshotBelief, snapshotKnowledge } from "./trace/snapshot";`
- Xoá import `assessPlayers`, `informationValue`, `powerRoleClaimOf` nếu không còn chỗ dùng khác (kiểm bằng `npx tsc --noEmit -p .`).
- Phương thức `private snapshotBelief(knowledge)` giữ lại nhưng thân chỉ còn: `return snapshotBelief(this.state, knowledge, this.weights);`

- [ ] **Step 3: Chạy test mới + toàn bộ test trace/trajectory**

Run: `cd packages/game-engine && npx vitest run tests/bot-snapshot.test.ts tests/bot-trace.test.ts tests/bot-trace-jsonl.test.ts tests/bot-trajectory.test.ts tests/selfplay-invariants.test.ts tests/bot-learning.test.ts`
Expected: tất cả pass. Nếu `selfplay-invariants` đỏ nghĩa là bạn đã đổi một phép tính khi di chuyển — so lại với `git diff`.

- [ ] **Step 4: Commit**

```bash
git add packages/game-engine/src/bot/trace/snapshot.ts packages/game-engine/src/bot/BotRuntime.ts packages/game-engine/tests/bot-snapshot.test.ts
git commit -m "refactor(bot): move trace snapshots into pure functions"
```

---

### Task 4: `observationFromTrace` + `ObservationInput` + `buildLiveObservation`

**Files:**
- Modify: `packages/game-engine/src/bot/evaluation/trajectory.ts` (tách hàm từ `gameToTrajectories`)
- Modify: `packages/game-engine/src/bot/learning/observation.ts:349-352` (`encodeObservation` nhận `ObservationInput`)
- Create: `packages/game-engine/src/bot/learning/live-observation.ts`
- Test: `packages/game-engine/tests/bot-live-observation.test.ts`

**Interfaces:**
- Produces:
```ts
// trajectory.ts
export type ObservationInput = Pick<BotTrajectory, "playerId" | "turn" | "phase" | "decision" | "observation" | "legalActions"> & { selectedAction?: BotTrajectory["selectedAction"] };
export function observationFromTrace(trace: Pick<BotDecisionTrace, "botId" | "round" | "phase" | "decision" | "beliefAfter" | "personality" | "knowledgeSnapshot">): ObservationInput;
// observation.ts
export function encodeObservation(input: ObservationInput, options?: EncodeOptions): EncodedObservation; // actionIndex = null khi không có selectedAction
// live-observation.ts
export function buildLiveObservation(knowledge: BotKnowledgeView, state: BotBrainState, weights: BotWeights, decision: TraceDecisionKind): ObservationInput;
```

- [ ] **Step 1: Viết test quyết định — hai đường, một vector (fail)**

```ts
// packages/game-engine/tests/bot-live-observation.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_BOT_WEIGHTS } from "../src/bot/config/weights";
import { runSelfPlay } from "../src/bot/evaluation/selfplay";
import { gameToTrajectories, observationFromTrace } from "../src/bot/evaluation/trajectory";
import { encodeObservation } from "../src/bot/learning/observation";
import { buildLiveObservation } from "../src/bot/learning/live-observation";

describe("observation lúc chơi == observation của trace", () => {
  it("observationFromTrace là đúng hàm gameToTrajectories dùng", () => {
    const game = runSelfPlay({ seed: "live-1", playerCount: 8, trace: true, maxRounds: 4 });
    const lines = gameToTrajectories(game);
    expect(lines.length).toBe(game.traces.length);
    for (let i = 0; i < lines.length; i += 1) {
      const fromTrace = observationFromTrace(game.traces[i]!);
      expect(fromTrace.observation).toEqual(lines[i]!.observation);
      expect(fromTrace.legalActions).toEqual(lines[i]!.legalActions);
    }
  });

  it("encodeObservation không cần selectedAction; có thì actionIndex như cũ", () => {
    const game = runSelfPlay({ seed: "live-2", playerCount: 8, trace: true, maxRounds: 3 });
    const line = gameToTrajectories(game).find((l) => l.decision === "VOTE" && l.selectedAction.targetId !== null)!;
    const { selectedAction, ...withoutLabel } = line;
    const a = encodeObservation(withoutLabel);
    const b = encodeObservation(line);
    expect(a.features).toEqual(b.features);
    expect(a.mask).toEqual(b.mask);
    expect(a.actionIndex).toBeNull();
    expect(b.actionIndex).not.toBeNull();
  });

  it("buildLiveObservation cho ra CÙNG features như trajectory, trên 20 ván", () => {
    // Trace ghi beliefAfter + knowledgeSnapshot tại thời điểm quyết định; lúc
    // chơi ta chỉ có knowledge + state. Hai đường phải gặp nhau ở đây.
    let compared = 0;
    for (let g = 0; g < 20; g += 1) {
      const game = runSelfPlay({ seed: `live-3-${g}`, playerCount: 8, trace: true, maxRounds: 6 });
      for (const trace of game.traces) {
        if (!["VOTE", "NIGHT", "HUNTER_SHOT"].includes(trace.decision)) continue;
        // `liveInputs` được self-play ghi kèm khi trace bật (xem Step 3).
        const live = trace.liveInput;
        if (!live) continue;
        const expected = encodeObservation(observationFromTrace(trace));
        const got = encodeObservation(live);
        expect(got.features).toEqual(expected.features);
        expect(got.mask).toEqual(expected.mask);
        expect(got.seats).toEqual(expected.seats);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(200);
  });
});
```

Run: `cd packages/game-engine && npx vitest run tests/bot-live-observation.test.ts`
Expected: FAIL — `observationFromTrace`/`buildLiveObservation` không tồn tại.

- [ ] **Step 2: Tách `observationFromTrace` trong `trajectory.ts`**

Trong `gameToTrajectories`, toàn bộ phần dựng `belief`, `nightLegalTargets`, và object `observation` + `legalActions` chuyển vào hàm mới; `gameToTrajectories` gọi nó rồi ghép thêm `gameId/seed/finalRole/candidates/selectedAction/reward/finalWinner`:

```ts
export type ObservationInput = Pick<
  BotTrajectory,
  "playerId" | "turn" | "phase" | "decision" | "observation" | "legalActions"
> & { selectedAction?: BotTrajectory["selectedAction"] };

/**
 * Phần OBSERVATION của một line, từ một trace. Đây là hàm DUY NHẤT biến
 * (knowledgeSnapshot, beliefAfter, personality) thành observation; cả export
 * trajectory lẫn `buildLiveObservation` đều đi qua đây.
 */
export function observationFromTrace(
  trace: Pick<BotDecisionTrace, "botId" | "round" | "phase" | "decision" | "beliefAfter" | "personality" | "knowledgeSnapshot">,
): ObservationInput {
  const legalActions = legalActionsFor(trace as BotDecisionTrace);
  const belief = Object.entries(trace.beliefAfter).map(([playerId, entry]) => ({ /* NGUYÊN VĂN như hiện tại */ }));
  belief.sort((left, right) => left.playerId.localeCompare(right.playerId));
  const snapshot = trace.knowledgeSnapshot;
  let nightLegalTargets: Record<string, string[]> | null = null;
  /* NGUYÊN VĂN khối dựng nightLegalTargets hiện tại */
  return {
    playerId: trace.botId,
    turn: trace.round,
    phase: trace.phase,
    decision: trace.decision,
    observation: { /* NGUYÊN VĂN object observation hiện tại */ },
    legalActions,
  };
}
```
`legalActionsFor` chỉ đọc `decision` và `knowledgeSnapshot` nên ép kiểu là an toàn; nếu muốn sạch hơn, đổi chữ ký nó thành `Pick<BotDecisionTrace, "decision" | "knowledgeSnapshot">`.

Trong `gameToTrajectories`:
```ts
    const base = observationFromTrace(trace);
    lines.push({
      gameId: seed, seed, finalRole,
      ...base,
      candidates: trace.candidates.map((candidate) => ({ ...candidate })),
      selectedAction: { /* NGUYÊN VĂN */ },
      reward: rewardFor(game, trace.botId, finalRole),
      finalWinner: game.winner ?? "draw",
    });
```
Thứ tự khoá của object đổi → `serializeTrajectory` ra JSON khác thứ tự. Kiểm `bot-trajectory.test.ts`; nếu có test so chuỗi JSON nguyên văn thì cập nhật expectation ở đó (chỉ thứ tự khoá, không đổi giá trị).

- [ ] **Step 3: `encodeObservation` nhận `ObservationInput`**

Trong `observation.ts`:
- `import type { BotTrajectory, ObservationInput } from "../evaluation/trajectory";`
- Đổi chữ ký: `export function encodeObservation(line: ObservationInput, options: EncodeOptions = {}): EncodedObservation`.
- `canonicalSeats(line: ObservationInput)`, `selfRoleOf(line: ObservationInput)`, `legalMoves(line: ObservationInput)` — chỉ đổi kiểu tham số.
- Trong `encodeAction`: đầu hàm thêm `if (!line.selectedAction) return null;` và đổi kiểu tham số thành `ObservationInput`; dòng `const target = line.selectedAction.targetId;` và `line.selectedAction.kind` giữ nguyên (đã narrow).
- Trong `dataset.ts`, `legalMoves(line as unknown as BotTrajectory)` đổi thành `legalMoves(line as unknown as ObservationInput)`.

- [ ] **Step 4: Viết `live-observation.ts`**

```ts
// packages/game-engine/src/bot/learning/live-observation.ts
import type { BotWeights } from "../config/weights";
import { observationFromTrace, type ObservationInput } from "../evaluation/trajectory";
import { snapshotBelief, snapshotKnowledge } from "../trace/snapshot";
import type { TraceDecisionKind } from "../trace/trace";
import type { BotBrainState, BotKnowledgeView } from "../types";

/**
 * Observation LÚC CHƠI, cho policy học được.
 *
 * Đi qua đúng hai ảnh chụp mà trace ghi và đúng `observationFromTrace` mà
 * export trajectory dùng, nên vector ở đây bằng vector lúc train theo cấu
 * trúc — test `bot-live-observation.test.ts` là bằng chứng trên 20 ván.
 * Không có `selectedAction`: đây là câu hỏi, không phải nhãn.
 */
export function buildLiveObservation(
  knowledge: BotKnowledgeView,
  state: BotBrainState,
  weights: BotWeights,
  decision: TraceDecisionKind,
): ObservationInput {
  return observationFromTrace({
    botId: state.playerId,
    round: knowledge.round,
    phase: knowledge.phase,
    decision,
    beliefAfter: snapshotBelief(state, knowledge, weights),
    personality: { ...state.personality },
    knowledgeSnapshot: snapshotKnowledge(knowledge),
  });
}
```

- [ ] **Step 5: Ghi `liveInput` vào trace khi trace bật (cho test so sánh)**

Trong `trace.ts`, thêm vào `BotDecisionTrace`:
```ts
  /**
   * Observation dựng bằng `buildLiveObservation` NGAY LÚC quyết định, chỉ để
   * test đối chiếu với `observationFromTrace(trace)`. Optional, chỉ có khi
   * trace bật; không bao giờ vào JSONL (xem `trace-jsonl.ts`).
   */
  liveInput?: ObservationInput;
```
(`import type { ObservationInput } from "../evaluation/trajectory";` — kiểm không tạo vòng import lúc runtime: `trajectory.ts` import `type` từ `trace.ts`, và ngược lại cũng chỉ `type` → an toàn.)

Trong `BotRuntime.beginTracedDecision().finish`, ngay trước `sink.record({...})`:
```ts
        const liveInput = buildLiveObservation(context.knowledge, this.state, this.weights, decision);
```
và thêm `liveInput,` vào object record. Import `buildLiveObservation` từ `./learning/live-observation`.

Trong `trace-jsonl.ts` (hàm serialize), loại `liveInput` khỏi output: tìm chỗ dựng object ghi ra và thêm `const { liveInput: _omit, ...persisted } = trace;` rồi ghi `persisted`. Chạy `bot-trace-jsonl.test.ts` để chắc round-trip không đổi.

- [ ] **Step 6: Chạy test → pass**

Run: `cd packages/game-engine && npx vitest run tests/bot-live-observation.test.ts tests/bot-trajectory.test.ts tests/bot-learning.test.ts tests/bot-trace-jsonl.test.ts tests/selfplay-invariants.test.ts`
Expected: pass; test thứ ba báo `compared > 200`.

Nếu test "hai đường" ĐỎ ở `features`: in `names[i]` của chiều lệch (`observationFeatureNames()`) — lệch thường ở `belief` (snapshot lấy TRƯỚC hay SAU `observe`) hoặc `voteCounts`. Sửa để `buildLiveObservation` được gọi ở đúng thời điểm trace lấy `beliefAfter` (cuối `observe`), KHÔNG sửa test.

- [ ] **Step 7: Build, lint, toàn bộ engine test**

Run: `npm run build:deps && npm run lint && cd packages/game-engine && npx vitest run`
Expected: exit 0; ≥ 4772 test pass.

- [ ] **Step 8: Commit**

```bash
git add packages/game-engine/src packages/game-engine/tests
git commit -m "feat(ai): build the live observation through the same path as the trace"
```

---

### Task 5: Policy học được cho lượt VOTE (`learnedPolicyModel`)

**Files:**
- Create: `packages/game-engine/src/bot/policy/learned-policy.ts`
- Modify: `packages/game-engine/src/bot/BotRuntime.ts` (option `learnedPolicy`)
- Test: `packages/game-engine/tests/bot-learned-policy.test.ts`

**Interfaces:**
- Consumes: `LearnedPolicy` (Task 2), `buildLiveObservation` (Task 4), `encodeObservation`, `maskLogits`, `decodeAction`, `DAY_ACTION_KIND`, `NO_TARGET_ACTION` (observation.ts), `PolicyModel` (policy-model.ts), `VoteScoringFrame` (vote-decision.ts).
- Produces:
```ts
export interface LearnedPolicyOptions { maxSeats?: number }
export function learnedPolicyModel(policy: LearnedPolicy, weights: BotWeights, options?: LearnedPolicyOptions): PolicyModel<VoteScoringFrame>;
```
`BotRuntimeOptions.learnedPolicy?: LearnedPolicy` — khi có và không có `votePolicy`, runtime tự dựng `learnedPolicyModel`.

- [ ] **Step 1: Test (fail)**

```ts
// packages/game-engine/tests/bot-learned-policy.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_BOT_WEIGHTS } from "../src/bot/config/weights";
import { runSelfPlay } from "../src/bot/evaluation/selfplay";
import { actionIndexOf, actionSize, DEFAULT_MAX_SEATS } from "../src/bot/learning/observation";
import type { LearnedPolicy } from "../src/bot/learning/mlp";
import { learnedPolicyModel } from "../src/bot/policy/learned-policy";

/** Policy giả: luôn thích một chỉ số hành động cho trước. */
function preferring(index: number): LearnedPolicy {
  return {
    id: `prefer-${index}`,
    logits: () => { const l = new Array<number>(actionSize()).fill(0); l[index] = 10; return l; },
    value: () => null,
  };
}

describe("learnedPolicyModel (VOTE)", () => {
  it("chọn theo logits trong tập ứng viên hợp lệ; ghế 1 = người đứng sau chính mình", () => {
    // Bàn 8 người, seed cố định: lấy một trace VOTE thật để có context/state.
    const game = runSelfPlay({ seed: "lp-1", playerCount: 8, trace: true, maxRounds: 2 });
    const trace = game.traces.find((t) => t.decision === "VOTE")!;
    const live = trace.liveInput!;
    const seat1 = live.observation.aliveIds.includes(live.playerId) ? undefined : undefined; // chỉ để nhắc: seats do encoder tính
    void seat1;
    const model = learnedPolicyModel(preferring(actionIndexOf("CHOOSE", 1)), DEFAULT_BOT_WEIGHTS);
    expect(model.name).toBe("learned:prefer-" + actionIndexOf("CHOOSE", 1));
    // Không thể tái tạo StrategyContext thật ở đây; test hành vi qua self-play ở dưới.
  });

  it("chạy trọn ván với learnedPolicy giả mà không ném, và phiếu luôn hợp lệ", () => {
    const game = runSelfPlay({
      seed: "lp-2", playerCount: 8, maxRounds: 6,
      learnedPolicy: preferring(actionIndexOf("CHOOSE", DEFAULT_MAX_SEATS)), // luôn thích "không treo ai"
    });
    expect(game.violations).toEqual([]);
    expect(game.rejected).toBe(0);
  });

  it("policy thích ô bất hợp lệ thì rơi về heuristic, không ném", () => {
    const game = runSelfPlay({
      seed: "lp-3", playerCount: 8, maxRounds: 6,
      learnedPolicy: preferring(actionIndexOf("POISON", 3)), // POISON không bao giờ hợp lệ ban ngày
    });
    expect(game.violations).toEqual([]);
    expect(game.rejected).toBe(0);
  });

  it("không có learnedPolicy → ván byte-identical với hiện tại", () => {
    const a = runSelfPlay({ seed: "lp-4", playerCount: 8, maxRounds: 6 });
    const b = runSelfPlay({ seed: "lp-4", playerCount: 8, maxRounds: 6, learnedPolicy: undefined });
    expect(b.winner).toBe(a.winner);
    expect(b.rounds).toBe(a.rounds);
    expect(b.actions).toBe(a.actions);
  });
});
```
(Xoá test đầu tiên nếu thấy thừa — nó chỉ kiểm `name`; hai test self-play là bằng chứng thật. `runSelfPlay({ learnedPolicy })` có ở Task 7; tạm thời test này đỏ cho tới Task 7, và đó là chấp nhận được — hoặc gộp Task 5–7 thành một commit nếu executor thấy tiện. Ưu tiên: giữ ba commit, chạy test file này ở cuối Task 7.)

- [ ] **Step 2: Viết `learned-policy.ts`**

```ts
// packages/game-engine/src/bot/policy/learned-policy.ts
import type { BotWeights } from "../config/weights";
import type { VoteScoringFrame } from "../decision/vote-decision";
import { buildLiveObservation } from "../learning/live-observation";
import type { LearnedPolicy } from "../learning/mlp";
import {
  DAY_ACTION_KIND,
  DEFAULT_MAX_SEATS,
  NO_TARGET_ACTION,
  decodeAction,
  encodeObservation,
  maskLogits,
  slotsPerKind,
} from "../learning/observation";
import type { StrategyContext } from "../planning/planner";
import { heuristicPolicyModel, type PolicyModel } from "./policy-model";

export interface LearnedPolicyOptions {
  maxSeats?: number;
}

/** Chỉ số có logit lớn nhất trong các ô đang bật; `null` nếu không ô nào bật. */
export function argmaxMasked(logits: readonly number[], mask: readonly boolean[]): number | null {
  const masked = maskLogits(logits, mask);
  let best: number | null = null;
  for (let i = 0; i < masked.length; i += 1) {
    if (masked[i]! === Number.NEGATIVE_INFINITY) continue;
    if (best === null || masked[i]! > masked[best]!) best = i;
  }
  return best;
}

/**
 * `PolicyModel` cho lượt VOTE, chọn bằng policy học được.
 *
 * Nhận bảng ứng viên đã chấm (hợp đồng seam) nhưng KHÔNG đọc điểm: nó dựng
 * observation lúc chơi, lấy logits, che theo mask của encoder VÀ theo tập ứng
 * viên mà planner đưa (hai tập phải trùng; nếu encoder mở một ô planner không
 * đưa thì ô đó bị che — planner là trọng tài). Không có ô hợp lệ, hoặc decode
 * ra loại khác CHOOSE, thì rơi về heuristic — không bao giờ ném giữa ván.
 */
export function learnedPolicyModel(
  policy: LearnedPolicy,
  weights: BotWeights,
  options: LearnedPolicyOptions = {},
): PolicyModel<VoteScoringFrame> {
  const maxSeats = options.maxSeats ?? DEFAULT_MAX_SEATS;
  const fallback = heuristicPolicyModel<VoteScoringFrame>();
  return {
    name: `learned:${policy.id}`,
    selectAction(candidates, context: StrategyContext<VoteScoringFrame>, probe) {
      if (candidates.length === 0) return fallback.selectAction(candidates, context, probe);
      const live = buildLiveObservation(context.context.knowledge, context.state, weights, "VOTE");
      const encoded = encodeObservation(live, { maxSeats });
      const allowed = new Set(candidates.map((c) => c.targetId));
      const noneLegal = live.legalActions.includes(NO_TARGET_ACTION);
      const base = 0; // CHOOSE là loại 0
      const mask = encoded.mask.map((on, index) => {
        if (!on) return false;
        if (Math.floor(index / slotsPerKind(maxSeats)) !== base) return false;
        const slot = index % slotsPerKind(maxSeats);
        if (slot === maxSeats) return noneLegal;
        return allowed.has(encoded.seats[slot]!);
      });
      const index = argmaxMasked(policy.logits(encoded.features), mask);
      if (index === null) return fallback.selectAction(candidates, context, probe);
      const decoded = decodeAction(index, encoded.seats, maxSeats);
      if (decoded.kind !== DAY_ACTION_KIND) return fallback.selectAction(candidates, context, probe);
      return { targetId: decoded.targetId };
    },
  };
}
```

- [ ] **Step 3: `BotRuntime` nhận `learnedPolicy`**

Trong `BotRuntimeOptions` (sau `votePolicy`):
```ts
  /**
   * Policy học được (MLP) cho cả VOTE lẫn NIGHT. Vắng = heuristic thuần.
   * Nếu cấp cả `votePolicy` thì `votePolicy` thắng ở lượt VOTE (để hybrid
   * alpha/beta còn cắm được); `learnedPolicy` vẫn dùng cho NIGHT.
   */
  learnedPolicy?: LearnedPolicy;
```
Trong class: `private readonly learnedPolicy: LearnedPolicy | undefined;` và trong constructor:
```ts
    this.learnedPolicy = options.learnedPolicy;
    this.votePolicy =
      options.votePolicy ??
      (options.learnedPolicy ? learnedPolicyModel(options.learnedPolicy, this.weights) : undefined);
```
(Đảm bảo `this.weights` đã gán TRƯỚC dòng này.) Import `learnedPolicyModel` từ `./policy/learned-policy` và `type LearnedPolicy` từ `./learning/mlp`.

- [ ] **Step 4: Typecheck**

Run: `cd packages/game-engine && npx tsc --noEmit -p .`
Expected: 0 lỗi.

- [ ] **Step 5: Commit (test file này chạy ở Task 7)**

```bash
git add packages/game-engine/src/bot/policy/learned-policy.ts packages/game-engine/src/bot/BotRuntime.ts packages/game-engine/tests/bot-learned-policy.test.ts
git commit -m "feat(ai): learned PolicyModel for the vote seam"
```

---

### Task 6: Seam ban đêm (`selectLearnedNight`)

**Files:**
- Modify: `packages/game-engine/src/bot/policy/learned-policy.ts` (thêm hàm)
- Modify: `packages/game-engine/src/bot/BotRuntime.ts:485-500` (`decideNight`)
- Test: thêm vào `packages/game-engine/tests/bot-learned-policy.test.ts`

**Interfaces:**
- Produces:
```ts
export function selectLearnedNight(
  policy: LearnedPolicy, weights: BotWeights,
  context: BotDecisionContext, state: BotBrainState,
  heuristic: BotNightIntention | null,
  options?: LearnedPolicyOptions,
): BotNightIntention | null;
```

- [ ] **Step 1: Thêm test (fail)**

```ts
  it("ban đêm: policy thích KILL ghế 2 thì Sói cắn đúng người đó khi hợp lệ", () => {
    // Chạy ván với policy ưu tiên KILL:seat2. Lấy trace NIGHT của Sói và
    // kiểm mục tiêu == seats[2] mỗi khi seats[2] nằm trong legal KILL.
    const policy = preferring(actionIndexOf("KILL", 2));
    const game = runSelfPlay({ seed: "lp-5", playerCount: 8, maxRounds: 6, trace: true, learnedPolicy: policy });
    expect(game.violations).toEqual([]);
    let checked = 0;
    for (const t of game.traces) {
      if (t.decision !== "NIGHT" || t.chosen.actionKind !== "KILL" || !t.liveInput) continue;
      const enc = encodeObservation(t.liveInput);
      const seat2 = enc.seats[2];
      const legal = t.liveInput.observation.nightLegalTargets?.KILL ?? [];
      if (seat2 !== undefined && legal.includes(seat2)) {
        expect(t.chosen.targetId).toBe(seat2);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("ban đêm: policy thích SKIP thì Phù Thuỷ giữ thuốc, và Thám Tử vẫn đi hai người", () => {
    const game = runSelfPlay({
      seed: "lp-6", playerCount: 8, maxRounds: 6, trace: true,
      learnedPolicy: preferring(actionIndexOf("SKIP", DEFAULT_MAX_SEATS)),
    });
    expect(game.violations).toEqual([]);
    const witchNights = game.traces.filter((t) => t.decision === "NIGHT" && game.roles[t.botId] === "WITCH" && t.liveInput?.observation.nightLegalTargets);
    for (const t of witchNights) expect(t.chosen.targetId).toBeNull();
    const detective = game.traces.find((t) => t.decision === "NIGHT" && t.chosen.actionKind === "DETECTIVE_CHECK");
    if (detective) expect(detective.chosen.targetId).not.toBeNull(); // heuristic giữ lượt Thám Tử
  });
```
Thêm `import { encodeObservation } from "../src/bot/learning/observation";` ở đầu file.

- [ ] **Step 2: Viết `selectLearnedNight`**

Thêm vào `learned-policy.ts`:
```ts
import type { BotBrainState, BotDecisionContext, BotNightIntention, NightActionKind } from "../types";

/**
 * Đề xuất nước đi ĐÊM từ policy học được, trên nền nước heuristic đã tính.
 *
 * Runtime là trọng tài: chỉ nhận (loại, mục tiêu) nếu loại được engine chào
 * (`night.legalActions`) và mục tiêu nằm trong `night.legalTargets[loại]`
 * (HEAL/SKIP không mục tiêu). Giữ `confidence`/`evidence` của heuristic vì
 * model không sinh được chúng; giữ `secondaryTargetId` khi cùng loại. Thám Tử
 * cần đúng hai người mà model chỉ nói một → luôn theo heuristic.
 */
export function selectLearnedNight(
  policy: LearnedPolicy,
  weights: BotWeights,
  context: BotDecisionContext,
  state: BotBrainState,
  heuristic: BotNightIntention | null,
  options: LearnedPolicyOptions = {},
): BotNightIntention | null {
  const night = context.knowledge.night;
  if (!night || !night.canAct) return heuristic;
  const maxSeats = options.maxSeats ?? DEFAULT_MAX_SEATS;
  const live = buildLiveObservation(context.knowledge, state, weights, "NIGHT");
  const encoded = encodeObservation(live, { maxSeats });
  const index = argmaxMasked(policy.logits(encoded.features), encoded.mask);
  if (index === null) return heuristic;
  const decoded = decodeAction(index, encoded.seats, maxSeats);
  const kind = decoded.kind as NightActionKind;
  if (kind === "SKIP") return null;
  if (kind === "DETECTIVE_CHECK") return heuristic;
  if (!night.legalActions.includes(kind)) return heuristic;
  const needsTarget = kind !== "HEAL";
  if (needsTarget) {
    if (decoded.targetId === null) return heuristic;
    if (!(night.legalTargets[kind] ?? []).includes(decoded.targetId)) return heuristic;
  }
  const base: BotNightIntention = heuristic ?? {
    kind: "NIGHT_ACTION", action: kind, targetId: null, confidence: 0.5, evidence: [],
  };
  return {
    ...base,
    action: kind,
    targetId: needsTarget ? decoded.targetId : null,
    secondaryTargetId: heuristic && heuristic.action === kind ? heuristic.secondaryTargetId : undefined,
  };
}
```

- [ ] **Step 3: Cắm vào `decideNight`**

Trong `BotRuntime.decideNight`, sau khi có `const night = strategyFor(...).decideNight(...)` và TRƯỚC `run.finish(...)`:
```ts
    const night = this.learnedPolicy
      ? selectLearnedNight(this.learnedPolicy, this.weights, context, this.state, heuristicNight)
      : heuristicNight;
```
(đổi tên biến kết quả heuristic thành `heuristicNight`). Import `selectLearnedNight`.

- [ ] **Step 4: Typecheck + commit (test chạy ở Task 7)**

Run: `cd packages/game-engine && npx tsc --noEmit -p .` → 0 lỗi.
```bash
git add packages/game-engine/src/bot/policy/learned-policy.ts packages/game-engine/src/bot/BotRuntime.ts packages/game-engine/tests/bot-learned-policy.test.ts
git commit -m "feat(ai): learned night seam guarded by the engine's legal set"
```

---

### Task 7: Self-play nhận `learnedPolicy` + `learnedSeats`, record + replay guard

**Files:**
- Modify: `packages/game-engine/src/bot/evaluation/selfplay.ts` (`SelfPlayInput`, `SelfPlayRecord`, chỗ `new BotRuntime`, `replayGame`)
- Modify: `packages/game-engine/src/bot/evaluation/report.ts` (`SelfPlayBatchInput`, `runBatch`)
- Test: `packages/game-engine/tests/bot-learned-policy.test.ts` (đã viết) + thêm 2 test

**Interfaces:**
- Produces:
```ts
export type LearnedSeats = "all" | "village" | "wolves";
// SelfPlayInput += { learnedPolicy?: LearnedPolicy; learnedSeats?: LearnedSeats }
// SelfPlayRecord += { learnedPolicyId?: string; learnedSeats?: LearnedSeats }
// SelfPlayBatchInput += cùng hai trường
export function replayGame(record: SelfPlayRecord, weights?: BotWeights, learnedPolicy?: LearnedPolicy): SelfPlayGame;
```

- [ ] **Step 1: Thêm test (fail)**

```ts
  it("learnedSeats='wolves': chỉ ghế Sói dùng policy (kiểm qua trace name không đủ → kiểm hành vi)", () => {
    // Policy thích NO_ELIMINATION ban ngày: nếu ÁP cho làng, làng sẽ hay "không treo ai".
    const policy = preferring(actionIndexOf("CHOOSE", DEFAULT_MAX_SEATS));
    const wolvesOnly = runSelfPlay({ seed: "lp-7", playerCount: 8, maxRounds: 6, trace: true, learnedPolicy: policy, learnedSeats: "wolves" });
    const all = runSelfPlay({ seed: "lp-7", playerCount: 8, maxRounds: 6, trace: true, learnedPolicy: policy, learnedSeats: "all" });
    const noneVotes = (g: typeof all, wolf: boolean) =>
      g.traces.filter((t) => t.decision === "VOTE" && (isWolfPack(g.roles[t.botId]!) === wolf) && t.chosen.targetId === null).length;
    expect(noneVotes(wolvesOnly, false)).toBeLessThan(noneVotes(all, false)); // làng ở wolvesOnly KHÔNG bị policy
    expect(wolvesOnly.record.learnedPolicyId).toBe(policy.id);
    expect(wolvesOnly.record.learnedSeats).toBe("wolves");
  });

  it("replayGame từ chối khi thiếu policy đúng id", () => {
    const policy = preferring(actionIndexOf("CHOOSE", 1));
    const game = runSelfPlay({ seed: "lp-8", playerCount: 8, maxRounds: 4, learnedPolicy: policy });
    expect(() => replayGame(game.record)).toThrow(/learnedPolicy/);
    expect(() => replayGame(game.record, undefined, preferring(actionIndexOf("CHOOSE", 2)))).toThrow(/prefer-/);
    const again = replayGame(game.record, undefined, policy);
    expect(again.winner).toBe(game.winner);
    expect(again.actions).toBe(game.actions);
  });
```
Import thêm: `import { isWolfPack } from "@masoi/shared"; import { replayGame } from "../src/bot/evaluation/selfplay";`

- [ ] **Step 2: Sửa `selfplay.ts`**

`SelfPlayInput`:
```ts
  /** Policy học được (MLP) cắm vào BotRuntime. Vắng = heuristic thuần. */
  learnedPolicy?: LearnedPolicy;
  /** Ghế nào dùng policy: mặc định "all". Phe đọc theo `isWolfPack(role)`; trung lập tính về phía làng. */
  learnedSeats?: LearnedSeats;
```
`SelfPlayRecord`:
```ts
  learnedPolicyId?: string;
  learnedSeats?: LearnedSeats;
```
Chỗ `new BotRuntime({...})` trong `runSelfPlay`:
```ts
    const usesLearned =
      input.learnedPolicy !== undefined &&
      ((input.learnedSeats ?? "all") === "all" ||
        ((input.learnedSeats ?? "all") === "wolves") === isWolfPack(player.role));
    runtimes.set(player.id, new BotRuntime({
      playerId: player.id,
      rng: createSeededRng(`${input.seed}:${player.id}`),
      playerIds: engine.state.players.map((p) => p.id),
      weights,
      trace: collector as BotTraceSink | undefined,
      learnedPolicy: usesLearned ? input.learnedPolicy : undefined,
    }));
```
Chỗ dựng `record` (tìm `weightsVersion: weights.version`): thêm
```ts
    learnedPolicyId: input.learnedPolicy?.id,
    learnedSeats: input.learnedPolicy ? (input.learnedSeats ?? "all") : undefined,
```
`replayGame`:
```ts
export function replayGame(record: SelfPlayRecord, weights?: BotWeights, learnedPolicy?: LearnedPolicy): SelfPlayGame {
  if (weights && weights.version !== record.weightsVersion) { /* như cũ */ }
  if (record.learnedPolicyId !== undefined) {
    if (!learnedPolicy) throw new Error(`Record cần learnedPolicy "${record.learnedPolicyId}" nhưng không được cấp`);
    if (learnedPolicy.id !== record.learnedPolicyId) {
      throw new Error(`Record cần learnedPolicy "${record.learnedPolicyId}" nhưng nhận "${learnedPolicy.id}"`);
    }
  }
  return runSelfPlay({ /* như cũ */, learnedPolicy, learnedSeats: record.learnedSeats });
}
```
Import: `import type { LearnedPolicy } from "../learning/mlp";` và `isWolfPack` từ `@masoi/shared` (kiểm đã có chưa).

- [ ] **Step 3: Sửa `report.ts`**

`SelfPlayBatchInput` += `learnedPolicy?: LearnedPolicy; learnedSeats?: LearnedSeats;` và truyền cả hai vào CẢ HAI lời gọi `runSelfPlay` trong `runBatch` (lần chính và lần `verifyReplay`).

- [ ] **Step 4: Chạy toàn bộ test learned-policy + engine**

Run: `cd packages/game-engine && npx vitest run tests/bot-learned-policy.test.ts && npx vitest run`
Expected: file learned-policy pass hết (kể cả test từ Task 5–6); toàn bộ ≥ 4772 pass.

- [ ] **Step 5: Build + lint + commit**

Run: `npm run build:deps && npm run lint` → exit 0.
```bash
git add packages/game-engine/src packages/game-engine/tests
git commit -m "feat(ai): self-play can seat a learned policy on all, village, or wolf seats"
```

---

### Task 8: Script `ai:benchmark`

**Files:**
- Create: `apps/server/scripts/ai-benchmark.ts`
- Modify: `package.json` (scripts)
- Test: chạy thật với model giả và model thật

**Interfaces:**
- Consumes: `loadMlpPolicy`, `runBatch`, `collectMetrics` hoặc đếm `game.winner` trực tiếp.
- CLI: `npm run ai:benchmark -- --model <weights.json> [--games 300] [--repeat 3] [--seed bench] [--players 8] [--preset] [--defense] [--out <json>]`

- [ ] **Step 1: Viết script**

```ts
// apps/server/scripts/ai-benchmark.ts
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PRESET_DECKS } from "@masoi/shared";
import {
  DEFAULT_BOT_WEIGHTS,
  loadMlpPolicy,
  runBatch,
  type LearnedSeats,
  type SelfPlayGame,
} from "@masoi/game-engine";

/**
 * Champion/challenger cho policy học được (BOT_SELF_LEARNING §24-§26).
 *
 * Ba cấu hình trên CÙNG seed: baseline (heuristic cả bàn), làng học được đấu
 * sói heuristic, sói học được đấu làng heuristic. Số cần đọc là tỉ lệ thắng
 * của LÀNG ở mỗi cấu hình so với baseline, và độ lệch giữa các seed — theo
 * kinh nghiệm của repo, 60 ván lệch ±10 điểm, 3×300 ván mới kết luận được ±3%.
 */
interface Options {
  model: string; games: number; repeat: number; seed: string; players: number;
  preset: boolean; defense: boolean; out: string | null;
}

function parseArgs(argv: readonly string[]): Options {
  const o: Options = { model: "", games: 300, repeat: 3, seed: "bench", players: 8, preset: true, defense: true, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i] ?? "";
    if (a === "--model") o.model = next();
    else if (a === "--games") o.games = Number(next());
    else if (a === "--repeat") o.repeat = Number(next());
    else if (a === "--seed") o.seed = next();
    else if (a === "--players") o.players = Number(next());
    else if (a === "--no-preset") o.preset = false;
    else if (a === "--no-defense") o.defense = false;
    else if (a === "--out") o.out = next();
    else throw new Error(`Tham số không nhận ra: ${a}`);
  }
  if (!o.model) throw new Error("npm run ai:benchmark -- --model <model.weights.json> [--games 300] [--repeat 3] [--seed bench]");
  return o;
}

function villageWinRate(games: readonly SelfPlayGame[]): number {
  const finished = games.filter((g) => g.winner !== null);
  return finished.length === 0 ? 0 : finished.filter((g) => g.winner === "village").length / finished.length;
}

function main(): void {
  const o = parseArgs(process.argv.slice(2));
  const policy = loadMlpPolicy(JSON.parse(readFileSync(resolve(o.model), "utf8")));
  const config = o.preset ? PRESET_DECKS[o.players] : undefined;
  if (o.preset && !config) throw new Error(`Không có bộ bài chuẩn cho ${o.players} người`);

  const setups: Array<{ name: string; seats: LearnedSeats | null }> = [
    { name: "baseline (heuristic)", seats: null },
    { name: "làng học được", seats: "village" },
    { name: "sói học được", seats: "wolves" },
  ];
  const rows: Array<{ setup: string; seed: string; games: number; villageWin: number; violations: number }> = [];
  for (const setup of setups) {
    for (let r = 0; r < o.repeat; r += 1) {
      const seedBase = `${o.seed}-${r}`;
      const games = runBatch({
        seedBase, games: o.games, playerCount: o.players, config,
        weights: DEFAULT_BOT_WEIGHTS, defense: o.defense, speech: true,
        learnedPolicy: setup.seats ? policy : undefined, learnedSeats: setup.seats ?? undefined,
      });
      rows.push({
        setup: setup.name, seed: seedBase, games: games.length,
        villageWin: villageWinRate(games),
        violations: games.reduce((n, g) => n + g.violations.length, 0),
      });
      process.stdout.write(`${setup.name.padEnd(22)} ${seedBase.padEnd(10)} làng thắng ${(villageWinRate(games) * 100).toFixed(1)}%  vi phạm ${rows.at(-1)!.violations}\n`);
    }
  }
  const summary = setups.map((s) => {
    const mine = rows.filter((r) => r.setup === s.name).map((r) => r.villageWin);
    const mean = mine.reduce((a, b) => a + b, 0) / mine.length;
    const spread = Math.max(...mine) - Math.min(...mine);
    return { setup: s.name, villageWinMean: mean, spread };
  });
  process.stdout.write("\n");
  for (const s of summary) {
    process.stdout.write(`${s.setup.padEnd(22)} TB ${(s.villageWinMean * 100).toFixed(1)}%  lệch giữa seed ${(s.spread * 100).toFixed(1)} điểm\n`);
  }
  const base = summary[0]!.villageWinMean;
  process.stdout.write(`\nΔ làng học được  ${((summary[1]!.villageWinMean - base) * 100).toFixed(1)} điểm (dương = làng học được mạnh hơn)\n`);
  process.stdout.write(`Δ sói học được   ${((base - summary[2]!.villageWinMean) * 100).toFixed(1)} điểm (dương = sói học được mạnh hơn)\n`);
  if (o.out) writeFileSync(resolve(o.out), JSON.stringify({ model: policy.id, options: o, rows, summary }, null, 2));
  if (rows.some((r) => r.violations > 0)) process.exitCode = 1;
}

main();
```

- [ ] **Step 2: Thêm script vào `package.json`** (cạnh `ai:validate-dataset`):
```json
    "preai:benchmark": "npm run build:deps",
    "ai:benchmark": "tsx apps/server/scripts/ai-benchmark.ts",
```

- [ ] **Step 3: Chạy nhanh với model thật, ít ván**

Run: `npm run ai:benchmark -- --model .tmp/model-ob/model.weights.json --games 20 --repeat 1 --seed smoke`
Expected: ba dòng kết quả + tổng kết, `vi phạm 0`, exit 0. Nếu `loadMlpPolicy` ném `featureNames không khớp`: model JSON được xuất từ `meta.json` của dataset cũ hơn encoder — xuất lại theo Task 1 Step 7 hoặc train lại.

- [ ] **Step 4: Chạy đủ và ghi kết quả**

Run: `npm run ai:benchmark -- --model .tmp/model-ob/model.weights.json --games 300 --repeat 3 --seed bench --out reports/benchmark-policy-0004.json`
Expected: chạy ~6 phút, exit 0. Ghi bảng vào `reports/train-policy-0002.md` mục mới "Benchmark policy-0004" (thư mục `reports/` gitignore). Đọc đúng: với behavior cloning, kỳ vọng Δ ≈ 0 ± nhiễu; Δ âm rõ rệt nghĩa là 14% nước chép trượt có giá. Không bật beta ở đâu cả — đây là vạch xuất phát cho kế hoạch RL.

- [ ] **Step 5: Lint + commit**

Run: `npm run lint` → exit 0.
```bash
git add apps/server/scripts/ai-benchmark.ts package.json
git commit -m "feat(ai): champion/challenger benchmark for a learned policy"
```

---

### Task 9: Tài liệu + PR

**Files:**
- Modify: `docs/BOT_SELF_LEARNING_TRAINING.md` (thêm "Bước 7 — Cho model chơi và đo")
- Modify: `docs/BOT_SELF_LEARNING_AUDIT.md` (§1.3: quyết định không dùng ONNX runtime; cập nhật bảng "Giới hạn")

- [ ] **Step 1: Bước 7 trong TRAINING.md** — chèn trước "## Giới hạn đã biết":

```markdown
## Bước 7 — Cho model chơi và đo (champion/challenger)

`train_bc` xuất thêm `model.weights.json` (định dạng `masoi-mlp-1`). Runtime
TypeScript chạy forward pass thuần từ file này — không có ONNX runtime, vì
`game-engine` phải thuần và mọi quyết định của bot là đồng bộ. Loader TỪ CHỐI
model có `featureNames`/`actionNames` lệch encoder hiện tại.

```bash
npm run ai:benchmark -- --model .tmp/model-ob/model.weights.json --games 300 --repeat 3 --seed bench
```

Ba cấu hình trên cùng seed: heuristic cả bàn, làng học được, sói học được. Đọc
Δ tỉ lệ thắng của làng so với baseline; 60 ván lệch ±10 điểm, 3×300 ván mới
kết luận ±3%. Với behavior cloning, Δ ≈ 0 là ĐÚNG kỳ vọng — model là bản sao
của bot heuristic. Δ dương chỉ có thể tới từ RL (kế hoạch
`2026-09-09-rl-self-play`).

Production KHÔNG đổi: `session-registry.ts` không cấp `learnedPolicy`.
```

- [ ] **Step 2: AUDIT.md** — trong §1.3 thêm đoạn:
```markdown
**Quyết định thứ hai, 2026-09-09: không nạp ONNX ở runtime.** `game-engine`
phải thuần (không I/O, có test canh), `onnxruntime-node` chỉ có API bất đồng
bộ trong khi `BotRuntime.decide*` đồng bộ, và model là MLP ~94k tham số. Trọng
số xuất ra JSON `masoi-mlp-1`, forward pass viết thuần TypeScript
(`bot/learning/mlp.ts`), có fixture parity với torch. ONNX vẫn xuất cho consumer
khác.
```
Và trong "Known limitations" mục 4 ("Không gian hành động chỉ mô tả …") thêm câu: "Runtime đã cắm được cho VOTE/NIGHT (kế hoạch `2026-09-09-learned-policy-runtime`); Thám Tử luôn theo heuristic vì cần hai mục tiêu."

- [ ] **Step 3: Toàn bộ kiểm chứng trước PR**

Run: `npm run build && npm run lint && (cd packages/game-engine && npx vitest run) && (cd apps/server && npx vitest run) && (cd ai-training && PYTHONUTF8=1 ./.venv/Scripts/python.exe tests/test_data.py && PYTHONUTF8=1 ./.venv/Scripts/python.exe tests/test_export.py && PYTHONUTF8=1 ./.venv/Scripts/python.exe tests/test_train_smoke.py)`
Expected: mọi lệnh exit 0.

- [ ] **Step 4: Commit + push + PR**

```bash
git add docs
git commit -m "docs(ai): runtime path for a learned policy and how to benchmark it"
git push -u origin feat/learned-policy-runtime
```
Mở PR bằng REST API (repo không có `gh`; xem memory `no-gh-cli-on-this-machine`; repo là `the-nightforge/Nightfall`). Body PR: ba bảng — parity fixture, test "hai đường một vector" (số cặp so sánh), và bảng benchmark 3×300.

---

## Self-review

- **Spec coverage:** D1 → Task 1–2. D2 → Task 3–4 (test 20 ván). D3 → Task 5–6 (mặc định tắt: test "byte-identical" ở Task 5; production không đổi: Global Constraints). D4 → Task 7–8 (record + replay guard ở Task 7). Tiêu chí xong → Task 8 Step 4 và Task 9 Step 3.
- **Placeholder scan:** hai chỗ ghi "NGUYÊN VĂN" ở Task 3–4 là chỉ thị di chuyển code có sẵn, không phải code cần bịa; executor có `git diff` để đối chiếu. Không có TODO/TBD.
- **Type consistency:** `LearnedPolicy.id/logits/value` (Task 2) được Task 5–8 dùng đúng tên; `ObservationInput`/`observationFromTrace`/`buildLiveObservation` (Task 4) dùng ở Task 5–6; `LearnedSeats` (Task 7) dùng ở Task 8; `argmaxMasked` định nghĩa Task 5, dùng Task 6; `trace.liveInput` (Task 4) dùng ở test Task 5–7.
