# RL Self-Play Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa thước đo hoà điểm, rồi dựng vòng lặp rollout (TypeScript) → PPO (Python) → benchmark → thăng hạng, để bot học được có cơ hội mạnh hơn bot heuristic — và chứng minh được điều đó trên seed cố định.

**Architecture:** Ranh giới §39 giữ nguyên: self-play TypeScript chạy policy ở chế độ lấy mẫu và ghi `logProb`/`value` vào trajectory; `ai:encode` xuất thêm ba file `.bin`; Python đọc số và chạy PPO clipped với advantage Monte Carlo (`R − V`), khởi tạo từ champion. Một script Python điều phối N iteration, gọi `ai:benchmark` (kế hoạch runtime) và thăng hạng theo ngưỡng +2 điểm.

**Tech Stack:** TypeScript (vitest, tsx), Python 3.13 + torch CPU, numpy.

**Spec:** `docs/superpowers/specs/2026-09-09-rl-self-play-design.md` — executor đọc cả hai. **Điều kiện tiên quyết:** kế hoạch `2026-09-09-learned-policy-runtime.md` đã merge (cần `LearnedPolicy`, `learnedPolicyModel`, `selectLearnedNight`, `SelfPlayInput.learnedPolicy/learnedSeats`, `ai:benchmark`, `model.weights.json`).

## Global Constraints

- `packages/game-engine` không I/O; Python không parse trajectory và không có bản sao encoder.
- Không đổi chiều observation (413) hay không gian hành động (187). `datasetVersion` của encode có rollout: `rollout-0001`.
- Mọi RNG lấy mẫu đi qua `rng` có seed của bot (qua `wrapRngForTrace`), để `replayGame` tái lập ván rollout.
- Champion là file JSON bất biến trong `.tmp/champions/<modelId>.weights.json`; không ghi đè. `modelId` tăng theo iteration: `ppo-0001`, `ppo-0002`, …
- `PYTHONUTF8=1` cho mọi lệnh Python.
- Sau khi sửa engine: `npm run build:deps` rồi `npm run lint`, đọc mã thoát.
- TDD, một commit mỗi task, nhánh `feat/rl-self-play` từ `main`.

---

## Bản đồ file

| File | Trách nhiệm |
|---|---|
| `packages/game-engine/src/bot/learning/dataset.ts` (sửa) | `optimalActionMask(line, encoded, maxSeats)` |
| `apps/server/scripts/ai-encode.ts` (sửa) | xuất `optimal.u8.bin`, `logprobs.f32.bin`, `values.f32.bin`; cờ `--rollout` |
| `ai-training/masoi_training/data.py` (sửa) | đọc ba file mới (optional) |
| `ai-training/masoi_training/train_bc.py` (sửa) | `agreementTieAware` |
| `packages/game-engine/src/bot/policy/learned-policy.ts` (sửa) | `sampleMasked`, `temperature`, trả `learned` |
| `packages/game-engine/src/bot/trace/trace.ts` (sửa) | `chosen.learned?: { actionIndex, logProb, value, temperature }` |
| `packages/game-engine/src/bot/BotRuntime.ts` (sửa) | truyền `run.rng` + temperature; ghi `learned` vào trace |
| `packages/game-engine/src/bot/evaluation/trajectory.ts` (sửa) | `line.learned` |
| `packages/game-engine/src/bot/evaluation/selfplay.ts` (sửa) | `SelfPlayInput.learnedTemperature` |
| `apps/server/scripts/selfplay.ts` (sửa) | cờ `--policy`, `--temperature`, `--learned-seats` |
| `ai-training/masoi_training/train_ppo.py` (mới) | PPO clipped, Monte Carlo advantage |
| `ai-training/tests/test_ppo.py` (mới) | một update trên dữ liệu tổng hợp giảm loss, giữ mask |
| `ai-training/rl_loop.py` (mới) | điều phối N iteration + thăng hạng |
| `docs/BOT_SELF_LEARNING_TRAINING.md` (sửa) | Bước 8: RL |

---

### Task 1: `optimal.u8.bin` và `agreementTieAware`

**Files:**
- Modify: `packages/game-engine/src/bot/learning/dataset.ts`
- Modify: `apps/server/scripts/ai-encode.ts`
- Modify: `ai-training/masoi_training/data.py`, `train_bc.py`
- Test: `packages/game-engine/tests/bot-learning.test.ts` (thêm), `ai-training/tests/test_data.py` (sửa)

**Interfaces:**
- Produces:
```ts
/** mask dài actionSize: MỌI hành động hoà đỉnh trong thang điểm teacher (bỏ jitter). Không có ứng viên → chỉ ô đã chọn. */
export function optimalActionMask(line: BotTrajectory, encoded: EncodedObservation, maxSeats?: number): boolean[];
```
- Python `Dataset` += `optimal: np.ndarray | None  # (N, action_size) bool`.

- [ ] **Step 1: Test TS (fail)**

Thêm vào `bot-learning.test.ts`, trong describe "dataset stats + split":
```ts
  it("optimalActionMask: mọi ứng viên hoà đỉnh (bỏ jitter) đều là tối ưu; không ứng viên → chỉ ô đã chọn", () => {
    const tied = line({
      candidates: [
        { targetId: "p1", score: 50, terms: [{ name: "belief", value: 40 }, { name: "jitter", value: 10 }], evidenceIds: [] },
        { targetId: "p3", score: 40, terms: [{ name: "belief", value: 40 }, { name: "jitter", value: 0 }], evidenceIds: [] },
      ],
    });
    const enc = encodeObservation(tied);
    const opt = optimalActionMask(tied, enc);
    // seats = [p2, p3, p1] → p3 ghế 1, p1 ghế 2; cả hai hoà 40 sau khi bỏ jitter.
    expect(opt[actionIndexOf("CHOOSE", 1)]).toBe(true);
    expect(opt[actionIndexOf("CHOOSE", 2)]).toBe(true);
    expect(opt.filter(Boolean)).toHaveLength(2);
    expect(opt[enc.actionIndex!]).toBe(true);

    const none = line({ selectedAction: { decision: "VOTE", targetId: null, label: "không treo", kind: null } });
    const encNone = encodeObservation(none);
    const optNone = optimalActionMask(none, encNone);
    expect(optNone.filter(Boolean)).toHaveLength(1);
    expect(optNone[encNone.actionIndex!]).toBe(true);
  });
```
Import `optimalActionMask` từ `../src/bot/learning/dataset`.

Run: `cd packages/game-engine && npx vitest run tests/bot-learning.test.ts` → FAIL (không có export).

- [ ] **Step 2: Viết `optimalActionMask` trong `dataset.ts`**

```ts
import { actionSize, DEFAULT_MAX_SEATS, actionIndexOf, DAY_ACTION_KIND } from "./observation";
import type { EncodedObservation } from "./observation";

/**
 * Tập hành động TỐI ƯU theo teacher: mọi ứng viên có điểm (bỏ jitter) bằng
 * điểm cao nhất, ánh xạ vào ô của loại hành động đã chọn. Khi bot không chọn
 * ai (SKIP/NO_ELIMINATION) hoặc không có bảng ứng viên, tập = { ô đã chọn }.
 *
 * Lý do tồn tại: `argmax == chosen` chấm oan 28% nước hoà điểm (48% ở đêm)
 * — teacher phá hoà bằng id thô mà §9 cố tình giấu khỏi observation.
 */
export function optimalActionMask(
  line: BotTrajectory,
  encoded: EncodedObservation,
  maxSeats: number = DEFAULT_MAX_SEATS,
): boolean[] {
  const mask = new Array<boolean>(actionSize(maxSeats)).fill(false);
  if (encoded.actionIndex === null) return mask;
  mask[encoded.actionIndex] = true;
  const target = line.selectedAction.targetId;
  if (target === null || line.candidates.length === 0) return mask;
  const kind = line.decision === "NIGHT" ? (line.selectedAction.kind ?? "SKIP") : DAY_ACTION_KIND;
  let best = Number.NEGATIVE_INFINITY;
  const scores = new Map<string, number>();
  for (const c of line.candidates) {
    let s = c.score;
    for (const t of c.terms) if (t.name === "jitter") s -= t.value;
    scores.set(c.targetId, s);
    if (s > best) best = s;
  }
  for (const [id, s] of scores) {
    if (s !== best) continue;
    const seat = encoded.seats.indexOf(id);
    if (seat < 0 || seat >= maxSeats) continue;
    const index = actionIndexOf(kind, seat, maxSeats);
    if (encoded.mask[index]) mask[index] = true;
  }
  return mask;
}
```

- [ ] **Step 3: Test → pass; encoder xuất file**

Run test → pass. Trong `ai-encode.ts`: thêm stream `optimal: createWriteStream(join(outDir, "optimal.u8.bin"))`, và sau khi ghi `masks`:
```ts
    const optimal = optimalActionMask(line, encoded, options.maxSeats);
    streams.optimal.write(Buffer.from(Uint8Array.from(optimal, (ok) => (ok ? 1 : 0))));
```
Import `optimalActionMask` từ `@masoi/game-engine` (export sẵn qua `export *`).

- [ ] **Step 4: Python đọc + báo**

`data.py`: trong `Dataset` thêm `optimal: np.ndarray | None`; trong `load`, sau `roles`/`decisions`:
```python
    optimal_path = root / "optimal.u8.bin"
    optimal = np.fromfile(optimal_path, dtype=np.uint8) if optimal_path.exists() else None
```
Thêm vào `expected` nếu không None: `"optimal": (optimal.size, rows * action_size)`. Trong `return Dataset(...)`: `optimal=optimal.reshape(rows, action_size).astype(bool) if optimal is not None else None`. Trong `split()`: `optimal=self.optimal[keep] if self.optimal is not None else None`.

`train_bc.py`, trong `evaluate` sau `correct = ...`:
```python
    tie_aware = None
    if data.optimal is not None:
        pred = predicted.cpu().numpy()
        tie_aware = round(float(data.optimal[np.arange(len(pred)), pred].mean()), 4)
```
và thêm `"agreementTieAware": tie_aware` vào dict trả về; dòng print cuối thêm `(tie-aware: {test_metrics.get('agreementTieAware')})`.

`tests/test_data.py`: trong `write_dataset` thêm `np.tile(np.array([1, 1, 0], dtype=np.uint8), ROWS).tofile(root / "optimal.u8.bin")` và assert `data.optimal.shape == (ROWS, ACT)`.

Run: `cd ai-training && PYTHONUTF8=1 ./.venv/Scripts/python.exe tests/test_data.py && PYTHONUTF8=1 ./.venv/Scripts/python.exe tests/test_train_smoke.py` → `ok` ×2 (smoke không có optimal → `None`, không ném).

- [ ] **Step 5: Đo lại policy-0004 với thước đo mới**

Run: `npm run ai:encode -- --in .tmp/ds-ob/trajectories.jsonl --out .tmp/enc-ob` (ghi thêm `optimal.u8.bin`), rồi:
```bash
cd ai-training && PYTHONUTF8=1 ./.venv/Scripts/python.exe -c "
import json, torch, numpy as np
from pathlib import Path
from masoi_training.data import load
from masoi_training.model import PolicyValueNet, masked_logits
d = load('../.tmp/enc-ob').split('test')
m = PolicyValueNet(d.obs_size, d.action_size, 128); m.load_state_dict(torch.load('../.tmp/model-ob/model.pt')); m.eval()
with torch.no_grad():
    lg, _ = m(torch.from_numpy(d.features)); pred = masked_logits(lg, torch.from_numpy(d.masks)).argmax(1).numpy()
print('agreement', (pred == d.actions).mean().round(4), 'tie-aware', d.optimal[np.arange(len(pred)), pred].mean().round(4))"
```
Expected: `tie-aware` ≥ `agreement`; ghi hai số vào `reports/train-policy-0002.md`.

- [ ] **Step 6: Build, lint, commit**

```bash
npm run build:deps && npm run lint
git add packages/game-engine apps/server/scripts/ai-encode.ts ai-training
git commit -m "feat(ai): tie-aware agreement — score a pick as correct when it ties the teacher's best"
```

---

### Task 2: Lấy mẫu có nhiệt độ + ghi `learned` vào trace/trajectory

**Files:**
- Modify: `packages/game-engine/src/bot/policy/learned-policy.ts`
- Modify: `packages/game-engine/src/bot/trace/trace.ts`, `BotRuntime.ts`, `evaluation/trajectory.ts`, `evaluation/selfplay.ts`, `evaluation/report.ts`
- Test: `packages/game-engine/tests/bot-learned-policy.test.ts` (thêm)

**Interfaces:**
- Produces:
```ts
export interface LearnedPick { actionIndex: number; logProb: number; value: number | null; temperature: number }
export interface LearnedPolicyOptions { maxSeats?: number; temperature?: number }  // 0 = argmax (mặc định)
export function sampleMasked(logits: readonly number[], mask: readonly boolean[], temperature: number, rng: BotRng): { index: number; logProb: number } | null;
// learnedPolicyModel / selectLearnedNight nhận thêm `onPick?: (pick: LearnedPick) => void`
// BotDecisionTrace.chosen.learned?: LearnedPick ; BotTrajectory.learned?: LearnedPick
// SelfPlayInput.learnedTemperature?: number ; SelfPlayBatchInput.learnedTemperature?: number
```

- [ ] **Step 1: Test (fail)**

```ts
  it("sampleMasked: T=0 là argmax; T=1 lấy mẫu đúng phân phối; logProb khớp softmax", () => {
    const logits = [2, 0, 1, 5];
    const mask = [true, true, true, false]; // ô 3 bị che dù logit cao nhất
    const rng = createSeededRng("sample-1");
    const greedy = sampleMasked(logits, mask, 0, rng)!;
    expect(greedy.index).toBe(0);
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 2000; i += 1) counts[sampleMasked(logits, mask, 1, rng)!.index] += 1;
    expect(counts[3]).toBe(0);
    expect(counts[0]).toBeGreaterThan(counts[2]);
    expect(counts[2]).toBeGreaterThan(counts[1]);
    const z = Math.exp(2) + Math.exp(0) + Math.exp(1);
    expect(sampleMasked(logits, mask, 0, rng)!.logProb).toBeCloseTo(Math.log(Math.exp(2) / z), 8);
  });

  it("rollout: T=1 ghi learned{actionIndex,logProb,value} vào trace và trajectory, replay tái lập", () => {
    const policy = preferring(actionIndexOf("CHOOSE", 1));
    const game = runSelfPlay({ seed: "rl-1", playerCount: 8, maxRounds: 5, trace: true, learnedPolicy: policy, learnedTemperature: 1 });
    const picks = game.traces.filter((t) => t.chosen.learned);
    expect(picks.length).toBeGreaterThan(0);
    for (const t of picks) {
      expect(t.chosen.learned!.logProb).toBeLessThanOrEqual(0);
      expect(t.chosen.learned!.temperature).toBe(1);
    }
    const lines = gameToTrajectories(game);
    const withLearned = lines.filter((l) => l.learned);
    expect(withLearned.length).toBe(picks.length);
    // Nhãn encoder phải trùng chỉ số policy đã lấy mẫu.
    for (const l of withLearned) expect(encodeObservation(l).actionIndex).toBe(l.learned!.actionIndex);
    const again = replayGame(game.record, undefined, policy);
    expect(again.actions).toBe(game.actions);
    expect(again.winner).toBe(game.winner);
  });
```
Import `createSeededRng` từ `../src/bot/rng`, `sampleMasked` từ learned-policy, `gameToTrajectories` từ trajectory.

- [ ] **Step 2: `sampleMasked` + nhiệt độ trong `learned-policy.ts`**

```ts
import type { BotRng } from "../types";

export interface LearnedPick { actionIndex: number; logProb: number; value: number | null; temperature: number }

/**
 * Lấy mẫu từ softmax(logits/T) trên các ô đang bật. T=0 → argmax (logProb vẫn
 * là log p của ô đó tại T=1, để BC/RL cùng một quy ước). RNG là của bot, đi
 * qua `wrapRngForTrace`, nên rollout tái lập được bằng seed.
 */
export function sampleMasked(
  logits: readonly number[], mask: readonly boolean[], temperature: number, rng: BotRng,
): { index: number; logProb: number } | null {
  const idx: number[] = [];
  for (let i = 0; i < logits.length; i += 1) if (mask[i]) idx.push(i);
  if (idx.length === 0) return null;
  const logP = (t: number): Map<number, number> => {
    const max = Math.max(...idx.map((i) => logits[i]! / t));
    const exps = idx.map((i) => Math.exp(logits[i]! / t - max));
    const z = exps.reduce((a, b) => a + b, 0);
    return new Map(idx.map((i, k) => [i, Math.log(exps[k]! / z)]));
  };
  if (temperature <= 0) {
    let best = idx[0]!;
    for (const i of idx) if (logits[i]! > logits[best]!) best = i;
    return { index: best, logProb: logP(1).get(best)! };
  }
  const table = logP(temperature);
  const u = rng();
  let acc = 0;
  for (const i of idx) {
    acc += Math.exp(table.get(i)!);
    if (u < acc) return { index: i, logProb: table.get(i)! };
  }
  const last = idx[idx.length - 1]!;
  return { index: last, logProb: table.get(last)! };
}
```
`LearnedPolicyOptions` += `temperature?: number`. Trong `learnedPolicyModel`: thay `argmaxMasked(policy.logits(...), mask)` bằng
```ts
      const features = encoded.features;
      const picked = sampleMasked(policy.logits(features), mask, options.temperature ?? 0, context.rng);
      if (!picked) return fallback...;
      onPick?.({ actionIndex: picked.index, logProb: picked.logProb, value: policy.value(features), temperature: options.temperature ?? 0 });
      const decoded = decodeAction(picked.index, encoded.seats, maxSeats);
```
Chữ ký: `learnedPolicyModel(policy, weights, options = {}, onPick?: (pick: LearnedPick) => void)`. Tương tự `selectLearnedNight(policy, weights, context, state, heuristic, rng: BotRng, options = {}, onPick?)` — thêm tham số `rng` sau `heuristic`, dùng `sampleMasked` với `encoded.mask` nguyên. Khi rơi về heuristic (kind không hợp lệ…) thì KHÔNG gọi `onPick` (không có nhãn cho nước heuristic).

- [ ] **Step 3: Trace + BotRuntime**

`trace.ts`, trong `chosen`: `learned?: LearnedPick;` (import type từ `../policy/learned-policy`).

`BotRuntime`: thêm option `learnedTemperature?: number` (mặc định 0). Trong `beginTracedDecision`, giữ một biến `let learnedPick: LearnedPick | undefined;` trong closure và trả thêm `onPick: (p) => { learnedPick = p; }`; trong `finish`, nếu `learnedPick` thì `chosen.learned = learnedPick`. `votePolicy` dựng trong constructor không có `run` — nên dựng `learnedPolicyModel` theo từng lượt: trong `decideVote`, nếu `this.learnedPolicy && !options.votePolicy` thì
```ts
    const policy = this.learnedPolicy
      ? learnedPolicyModel(this.learnedPolicy, this.weights, { temperature: this.learnedTemperature }, run.onPick)
      : this.votePolicy;
```
(giữ `this.votePolicy` khi người dùng cấp tường minh). Trong `decideNight`: `selectLearnedNight(..., heuristicNight, run.rng, { temperature: this.learnedTemperature }, run.onPick)`.

`trajectory.ts`: `BotTrajectory` += `learned?: LearnedPick`; trong `gameToTrajectories` thêm `...(trace.chosen.learned ? { learned: { ...trace.chosen.learned } } : {})`. `dataset.ts` whitelist cấp line không cần đổi (validator chỉ whitelist khoá trong `observation`).

`selfplay.ts`: `SelfPlayInput.learnedTemperature?: number`; truyền vào `new BotRuntime({... learnedTemperature: input.learnedTemperature })`; `SelfPlayRecord.learnedTemperature?: number`; `replayGame` truyền lại. `report.ts` truyền qua `runBatch`.

- [ ] **Step 4: Test → pass; toàn engine; commit**

Run: `cd packages/game-engine && npx vitest run tests/bot-learned-policy.test.ts && npx vitest run` → pass.
```bash
npm run build:deps && npm run lint
git add packages/game-engine
git commit -m "feat(ai): sampled rollouts — learned picks carry logProb/value into the trace"
```

---

### Task 3: CLI self-play nhận `--policy`, `--temperature`, `--learned-seats`; encoder xuất rollout

**Files:**
- Modify: `apps/server/scripts/selfplay.ts`
- Modify: `apps/server/scripts/ai-encode.ts`
- Modify: `ai-training/masoi_training/data.py`
- Test: chạy thật 20 ván

- [ ] **Step 1: `selfplay.ts`**

`Options` += `policy: string | null; temperature: number; learnedSeats: "all" | "village" | "wolves"`. Usage:
```
    "  --policy <file>     model.weights.json (masoi-mlp-1) cắm vào bot; xem --learned-seats, --temperature",
    "  --temperature <t>   0 = argmax (mặc định); 1 = lấy mẫu cho rollout RL",
    "  --learned-seats <s> all | village | wolves (mặc định all)",
```
Parse ba cờ; sau `parseArgs`, nếu `options.policy`: `const learnedPolicy = loadMlpPolicy(JSON.parse(readFileSync(resolve(options.policy), "utf8")));` và truyền `learnedPolicy, learnedSeats, learnedTemperature: options.temperature` vào `runBatch`. `readFileSync` đã import.

- [ ] **Step 2: `ai-encode.ts` cờ `--rollout`**

Thêm option `rollout: boolean` (`--rollout`). Khi bật: chỉ giữ line có `line.learned` (không có → `unlabelled += 1`), kiểm `encoded.actionIndex === line.learned.actionIndex` (lệch → `rejected += 1`, in cảnh báo một lần), và ghi:
```ts
    streams.logprobs.write(Buffer.from(Float32Array.of(line.learned.logProb).buffer));
    streams.values.write(Buffer.from(Float32Array.of(line.learned.value ?? 0).buffer));
```
(`logprobs.f32.bin`, `values.f32.bin`). `meta.datasetVersion = options.rollout ? "rollout-0001" : "dataset-0003"`, `meta.rollout = options.rollout`, `meta.temperature` đọc từ line đầu có `learned`.

- [ ] **Step 3: `data.py`**: `logprobs`/`values` optional như `optimal` (float32, shape `(rows,)`); `Dataset` += `logprobs: np.ndarray | None`, `values: np.ndarray | None`; `split()` cắt theo.

- [ ] **Step 4: Chạy thật**

```bash
npx tsx apps/server/scripts/selfplay.ts --games 20 --players 8 --preset --defense --seed roll-smoke --policy .tmp/model-ob/model.weights.json --temperature 1 --learned-seats all --trajectories .tmp/roll-smoke --trace-games 20 --quiet > /dev/null
npm run ai:validate-dataset -- .tmp/roll-smoke/trajectories.jsonl
npm run ai:encode -- --in .tmp/roll-smoke/trajectories.jsonl --out .tmp/roll-smoke-enc --rollout
```
Expected: validate SẠCH (ván rollout vẫn qua leak validator); encode `TỪ CHỐI 0`, có `logprobs.f32.bin`. Kiểm bằng Python: `d = load('.tmp/roll-smoke-enc'); assert d.logprobs.max() <= 0`.

- [ ] **Step 5: Commit**
```bash
git add apps/server/scripts ai-training/masoi_training/data.py
git commit -m "feat(ai): rollout collection — selfplay --policy/--temperature, encode --rollout"
```

---

### Task 4: `train_ppo.py`

**Files:**
- Create: `ai-training/masoi_training/train_ppo.py`
- Test: `ai-training/tests/test_ppo.py`

**Interfaces:**
- CLI: `python -m masoi_training.train_ppo --data <enc-rollout> --init <champion.weights.json> --out <dir> [--epochs 4] [--batch-size 4096] [--lr 3e-4] [--clip 0.2] [--entropy 0.01] [--value-coef 0.5] [--model-id ppo-0001] [--seed 12345]`
- Ghi `model.pt`, `model.weights.json`, `metrics.json` (`policyLoss`, `valueLoss`, `entropy`, `approxKl`, `clipFraction`, `agreementWithInit`).

- [ ] **Step 1: Test (fail)**

```python
# ai-training/tests/test_ppo.py
"""Một update PPO trên dữ liệu tổng hợp: loss giảm, mask được tôn trọng, ratio ban đầu = 1."""
from __future__ import annotations
import json, sys, tempfile
from pathlib import Path
import numpy as np, torch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from masoi_training.model import PolicyValueNet, masked_logits   # noqa
from masoi_training.export import export_weights_json           # noqa
from masoi_training import train_ppo                             # noqa

ROWS, OBS, ACT = 256, 6, 9

def main() -> None:
    torch.manual_seed(0); rng = np.random.default_rng(0)
    init = PolicyValueNet(OBS, ACT, 8).eval()
    feats = rng.random((ROWS, OBS), dtype=np.float32)
    masks = np.zeros((ROWS, ACT), dtype=np.uint8); masks[:, :4] = 1
    with torch.no_grad():
        lg, val = init(torch.from_numpy(feats))
        lp = torch.log_softmax(masked_logits(lg, torch.from_numpy(masks.astype(bool))), 1)
    actions = torch.distributions.Categorical(logits=lp).sample().numpy().astype("<i4")
    logprobs = lp[np.arange(ROWS), actions].numpy().astype("<f4")
    rewards = np.where(actions == 0, 1, -1).astype(np.int8)  # hành động 0 luôn thắng
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp) / "enc"; d.mkdir()
        feats.astype("<f4").tofile(d / "features.f32.bin"); masks.tofile(d / "masks.u8.bin")
        actions.tofile(d / "actions.i32.bin"); rewards.tofile(d / "rewards.i8.bin")
        np.zeros(ROWS, np.uint8).tofile(d / "splits.u8.bin"); np.zeros(ROWS, np.uint8).tofile(d / "roles.u8.bin")
        np.zeros(ROWS, np.uint8).tofile(d / "decisions.u8.bin")
        logprobs.tofile(d / "logprobs.f32.bin"); val.numpy().astype("<f4").tofile(d / "values.f32.bin")
        meta = {"rows": ROWS, "obsSize": OBS, "actionSize": ACT, "datasetVersion": "rollout-test",
                "roles": ["A"], "decisions": ["VOTE"], "featureNames": [f"f{i}" for i in range(OBS)],
                "actionNames": [f"a{i}" for i in range(ACT)]}
        (d / "meta.json").write_text(json.dumps(meta), encoding="utf8")
        initp = Path(tmp) / "init.weights.json"
        export_weights_json(init, meta, initp, model_id="init", training_seed=0, hidden=8)
        out = Path(tmp) / "out"
        sys.argv = ["train_ppo", "--data", str(d), "--init", str(initp), "--out", str(out), "--epochs", "8", "--batch-size", "64", "--model-id", "t"]
        train_ppo.main()
        m = json.loads((out / "metrics.json").read_text(encoding="utf8"))
        assert m["history"][0]["approxKl"] < 1e-4, "ratio ban đầu phải ≈ 1"
        assert m["history"][-1]["policyLoss"] < m["history"][0]["policyLoss"]
        # Sau update, xác suất hành động 0 (luôn thắng) phải tăng.
        new = PolicyValueNet(OBS, ACT, 8); new.load_state_dict(torch.load(out / "model.pt")); new.eval()
        with torch.no_grad():
            p0 = torch.softmax(masked_logits(new(torch.from_numpy(feats))[0], torch.from_numpy(masks.astype(bool))), 1)[:, 0].mean()
            q0 = torch.softmax(lp, 1)[:, 0].mean()
        assert p0 > q0, (p0, q0)
        assert (out / "model.weights.json").exists()
    print("ok")

if __name__ == "__main__":
    main()
```

Run: `cd ai-training && PYTHONUTF8=1 ./.venv/Scripts/python.exe tests/test_ppo.py` → `ModuleNotFoundError`.

- [ ] **Step 2: Viết `train_ppo.py`**

```python
"""PPO clipped trên rollout do self-play TypeScript ghi (spec R3/R4).

Advantage Monte Carlo: A = R − V(s), reward ±1 cuối ván, γ = λ = 1. Value
target = R. Mask áp lên logits trước log-softmax, cùng MASK_FILL với BC.
Khởi tạo từ model.weights.json của champion.
"""
from __future__ import annotations
import argparse, copy, json, subprocess
from pathlib import Path
import numpy as np, torch
from torch import nn
from .data import load
from .export import export_weights_json
from .model import PolicyValueNet, masked_logits


def load_init(path: Path, obs: int, act: int) -> tuple[PolicyValueNet, int]:
    w = json.loads(Path(path).read_text(encoding="utf8"))
    assert w["format"] == "masoi-mlp-1" and w["obsSize"] == obs and w["actionSize"] == act, "init lệch schema"
    hidden = int(w["hidden"])
    m = PolicyValueNet(obs, act, hidden)
    with torch.no_grad():
        for layer, src in ((m.trunk[0], w["layers"][0]), (m.trunk[2], w["layers"][1]), (m.policy_head, w["policyHead"])):
            layer.weight.copy_(torch.tensor(src["w"])); layer.bias.copy_(torch.tensor(src["b"]))
        if w.get("valueHead"):
            m.value_head[0].weight.copy_(torch.tensor(w["valueHead"]["w"])); m.value_head[0].bias.copy_(torch.tensor(w["valueHead"]["b"]))
    return m, hidden


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--data", required=True); p.add_argument("--init", required=True); p.add_argument("--out", required=True)
    p.add_argument("--epochs", type=int, default=4); p.add_argument("--batch-size", type=int, default=4096)
    p.add_argument("--lr", type=float, default=3e-4); p.add_argument("--clip", type=float, default=0.2)
    p.add_argument("--entropy", type=float, default=0.01); p.add_argument("--value-coef", type=float, default=0.5)
    p.add_argument("--model-id", default="ppo-0001"); p.add_argument("--seed", type=int, default=12345)
    a = p.parse_args()
    torch.manual_seed(a.seed)

    d = load(a.data)
    assert d.logprobs is not None and d.values is not None, "dataset không phải rollout (thiếu logprobs/values) — encode với --rollout"
    model, hidden = load_init(Path(a.init), d.obs_size, d.action_size)
    init_state = copy.deepcopy(model.state_dict())
    opt = torch.optim.Adam(model.parameters(), lr=a.lr)

    X = torch.from_numpy(d.features); M = torch.from_numpy(d.masks); A = torch.from_numpy(d.actions)
    R = torch.from_numpy(d.rewards); OLD = torch.from_numpy(d.logprobs.astype(np.float32))
    adv = R - torch.from_numpy(d.values.astype(np.float32))
    adv = (adv - adv.mean()) / (adv.std() + 1e-8)

    gen = torch.Generator().manual_seed(a.seed)
    history = []
    for epoch in range(1, a.epochs + 1):
        model.train(); order = torch.randperm(len(d), generator=gen)
        tot = {"policyLoss": 0.0, "valueLoss": 0.0, "entropy": 0.0, "approxKl": 0.0, "clipFraction": 0.0}; n = 0
        for s in range(0, len(d), a.batch_size):
            idx = order[s:s + a.batch_size]
            logits, value = model(X[idx])
            logp_all = torch.log_softmax(masked_logits(logits, M[idx]), dim=1)
            logp = logp_all.gather(1, A[idx].unsqueeze(1)).squeeze(1)
            ratio = torch.exp(logp - OLD[idx])
            unclipped = ratio * adv[idx]; clipped = torch.clamp(ratio, 1 - a.clip, 1 + a.clip) * adv[idx]
            policy_loss = -torch.min(unclipped, clipped).mean()
            value_loss = nn.functional.mse_loss(value, R[idx])
            probs = logp_all.exp()
            entropy = -(probs * logp_all.masked_fill(~M[idx], 0.0)).sum(1).mean()
            loss = policy_loss + a.value_coef * value_loss - a.entropy * entropy
            opt.zero_grad(); loss.backward(); nn.utils.clip_grad_norm_(model.parameters(), 0.5); opt.step()
            with torch.no_grad():
                kl = (OLD[idx] - logp).mean().item(); cf = ((ratio - 1).abs() > a.clip).float().mean().item()
            b = len(idx); n += b
            for k, v in (("policyLoss", policy_loss.item()), ("valueLoss", value_loss.item()), ("entropy", entropy.item()), ("approxKl", kl), ("clipFraction", cf)):
                tot[k] += v * b
        row = {"epoch": epoch, **{k: round(v / max(n, 1), 5) for k, v in tot.items()}}
        history.append(row); print(f"epoch {epoch}  policy {row['policyLoss']:.4f}  value {row['valueLoss']:.4f}  ent {row['entropy']:.3f}  kl {row['approxKl']:.5f}  clip {row['clipFraction']:.3f}")

    # Độ trôi so với init: bao nhiêu % argmax còn giống champion (mỏ neo, xem R1).
    model.eval()
    with torch.no_grad():
        new = masked_logits(model(X)[0], M).argmax(1)
        ref = PolicyValueNet(d.obs_size, d.action_size, hidden); ref.load_state_dict(init_state); ref.eval()
        old = masked_logits(ref(X)[0], M).argmax(1)
        agree_init = float((new == old).float().mean())

    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), out / "model.pt")
    export_weights_json(model, d.meta, out / "model.weights.json", model_id=a.model_id, training_seed=a.seed, hidden=hidden)
    try: commit = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    except Exception: commit = None
    (out / "metrics.json").write_text(json.dumps({
        "modelId": a.model_id, "gitCommit": commit, "init": str(a.init), "datasetVersion": d.meta.get("datasetVersion"),
        "rows": len(d), "config": vars(a), "history": history, "agreementWithInit": round(agree_init, 4),
    }, indent=2), encoding="utf8")
    print(f"Đã ghi {out}  agreementWithInit {agree_init:.3f}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Test → pass; commit**

Run: `cd ai-training && PYTHONUTF8=1 ./.venv/Scripts/python.exe tests/test_ppo.py` → `ok`.
```bash
git add ai-training/masoi_training/train_ppo.py ai-training/tests/test_ppo.py
git commit -m "feat(ai): PPO update from TypeScript rollouts, Monte Carlo advantage"
```
Thêm `python tests/test_ppo.py` vào job CI `ai-training` (`.github/workflows/ci.yml`, sau bước smoke) và vào `ai-training/README.md`.

---

### Task 5: `rl_loop.py` — điều phối + thăng hạng

**Files:**
- Create: `ai-training/rl_loop.py`
- Test: chạy thật 1 iteration nhỏ

**Interfaces:**
- CLI: `python rl_loop.py --champion <weights.json> --iterations 3 --games 600 --bench-games 300 --bench-repeat 3 --out .tmp/rl`
- Mỗi iteration `k`: rollout 3 phần (all/village/wolves, mỗi phần `games/3`, seed `rl-k-<seats>`) → encode `--rollout` → `train_ppo --init champion --model-id ppo-000k` → `ai:benchmark --model challenger --out bench.json` → điểm = mean(Δlàng, Δsói) → thăng hạng nếu > champion + 2 điểm.

- [ ] **Step 1: Viết script**

```python
# ai-training/rl_loop.py
"""Vòng lặp RL: rollout (TS) → PPO (Py) → benchmark (TS) → thăng hạng (spec R5).

Chạy từ thư mục ai-training. Champion là file JSON bất biến; challenger chỉ
thay champion khi điểm benchmark cao hơn ít nhất 2 điểm (trên nhiễu ±3% đã đo).
"""
from __future__ import annotations
import argparse, json, shutil, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PY = sys.executable

def run(cmd: list[str], cwd: Path = ROOT) -> None:
    print("$", " ".join(cmd)); subprocess.run(cmd, cwd=cwd, check=True)

def score_of(bench_json: Path) -> float:
    b = json.loads(bench_json.read_text(encoding="utf8"))
    base, village, wolves = (s["villageWinMean"] for s in b["summary"])
    return ((village - base) + (base - wolves)) / 2 * 100  # điểm phần trăm

def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--champion", required=True); p.add_argument("--iterations", type=int, default=3)
    p.add_argument("--games", type=int, default=600); p.add_argument("--bench-games", type=int, default=300)
    p.add_argument("--bench-repeat", type=int, default=3); p.add_argument("--out", default=".tmp/rl")
    p.add_argument("--promote-margin", type=float, default=2.0); p.add_argument("--temperature", type=float, default=1.0)
    a = p.parse_args()
    out = (ROOT / a.out).resolve(); champions = out / "champions"; champions.mkdir(parents=True, exist_ok=True)
    champion = champions / "champion-0000.weights.json"; shutil.copy(a.champion, champion)

    bench0 = out / "bench-champion-0000.json"
    if not bench0.exists():
        run(["npm", "run", "ai:benchmark", "--", "--model", str(champion), "--games", str(a.bench_games), "--repeat", str(a.bench_repeat), "--seed", "rl-bench", "--out", str(bench0)])
    champion_score = score_of(bench0); print(f"champion điểm {champion_score:+.1f}")

    for k in range(1, a.iterations + 1):
        it = out / f"iter-{k:04d}"; it.mkdir(exist_ok=True)
        merged = it / "trajectories.jsonl"; merged.write_text("", encoding="utf8")
        for seats in ("all", "village", "wolves"):
            part = it / f"roll-{seats}"
            run(["npx", "tsx", "apps/server/scripts/selfplay.ts", "--games", str(a.games // 3), "--players", "8", "--preset", "--defense",
                 "--seed", f"rl-{k}-{seats}", "--policy", str(champion), "--temperature", str(a.temperature), "--learned-seats", seats,
                 "--trajectories", str(part), "--trace-games", str(a.games // 3), "--quiet"])
            with merged.open("a", encoding="utf8") as f: f.write((part / "trajectories.jsonl").read_text(encoding="utf8"))
        run(["npm", "run", "ai:validate-dataset", "--", str(merged)])
        run(["npm", "run", "ai:encode", "--", "--in", str(merged), "--out", str(it / "enc"), "--rollout"])
        model_id = f"ppo-{k:04d}"
        run([PY, "-m", "masoi_training.train_ppo", "--data", str(it / "enc"), "--init", str(champion), "--out", str(it / "model"), "--model-id", model_id], cwd=ROOT / "ai-training")
        challenger = it / "model" / "model.weights.json"; bench = it / "bench.json"
        run(["npm", "run", "ai:benchmark", "--", "--model", str(challenger), "--games", str(a.bench_games), "--repeat", str(a.bench_repeat), "--seed", "rl-bench", "--out", str(bench)])
        s = score_of(bench); print(f"iteration {k}: challenger {s:+.1f} vs champion {champion_score:+.1f}")
        if s > champion_score + a.promote_margin:
            champion = champions / f"champion-{k:04d}.weights.json"; shutil.copy(challenger, champion); champion_score = s
            print(f"THĂNG HẠNG → {champion.name}")
        else:
            print("GIỮ champion")
    print(f"xong. champion: {champion} điểm {champion_score:+.1f}")

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Chạy 1 iteration nhỏ để kiểm đường ống**

Run: `cd ai-training && PYTHONUTF8=1 ./.venv/Scripts/python.exe rl_loop.py --champion ../.tmp/model-ob/model.weights.json --iterations 1 --games 60 --bench-games 30 --bench-repeat 1 --out .tmp/rl-smoke`
Expected: in điểm champion, rollout ba phần, validate SẠCH, encode `TỪ CHỐI 0`, PPO 4 epoch, benchmark, rồi `GIỮ champion` hoặc `THĂNG HẠNG`. Số ván nhỏ chỉ để kiểm đường ống, không kết luận.

- [ ] **Step 3: Chạy thật**

Run: `cd ai-training && PYTHONUTF8=1 ./.venv/Scripts/python.exe rl_loop.py --champion ../.tmp/model-ob/model.weights.json --iterations 3 --games 3000 --bench-games 300 --bench-repeat 3 --out .tmp/rl`
Thời gian ước: mỗi iteration ~8 phút rollout + ~2 phút PPO + ~6 phút benchmark. Ghi bảng điểm từng iteration và `agreementWithInit` vào `reports/train-policy-0002.md` mục "RL". Kỳ vọng trung thực: 3 iteration có thể chưa thăng hạng; đó vẫn là kết quả — đường ống chạy, và số đo nói RL có tín hiệu hay không.

- [ ] **Step 4: Commit**
```bash
git add ai-training/rl_loop.py ai-training/README.md .github/workflows/ci.yml
git commit -m "feat(ai): RL loop — rollout, PPO, benchmark, promote by margin"
```

---

### Task 6: Tài liệu + PR

- [ ] **Step 1:** `docs/BOT_SELF_LEARNING_TRAINING.md`: thêm "Bước 8 — RL" (lệnh `rl_loop.py`, cách đọc điểm, luật thăng hạng, `agreementWithInit` là mỏ neo), và trong "Điều quan trọng nhất" nêu `agreementTieAware` là thước đo chính từ nay. `docs/BOT_SELF_LEARNING_AUDIT.md` §3: đánh dấu Step 8 (BC) xong, Step 9 (self-play + PPO) đã có đường ống.
- [ ] **Step 2:** Kiểm toàn bộ: `npm run build && npm run lint && (cd packages/game-engine && npx vitest run) && (cd apps/server && npx vitest run) && (cd ai-training && PYTHONUTF8=1 ./.venv/Scripts/python.exe tests/test_data.py && PYTHONUTF8=1 ./.venv/Scripts/python.exe tests/test_export.py && PYTHONUTF8=1 ./.venv/Scripts/python.exe tests/test_ppo.py && PYTHONUTF8=1 ./.venv/Scripts/python.exe tests/test_train_smoke.py)` → exit 0.
- [ ] **Step 3:** Commit docs, push `feat/rl-self-play`, mở PR qua REST API với bảng: tie-aware vs agreement của policy-0004, kết quả 1 iteration nhỏ, kết quả chạy thật (nếu có).

---

## Self-review

- **Spec coverage:** R1 → Task 1. R2 → Task 2–3 (rollout ở TS, RNG qua trace, replay test). R3/R4 → Task 4 (`adv = R − V`, clipped, mask trước log-softmax, init từ JSON). R5 → Task 5 (ba phần seats, điểm = mean Δ, +2 điểm, champion bất biến). R6 → không task nào chạm `session-registry.ts`. Tiêu chí xong: tie-aware (Task 1 Step 5), `rl_loop` 3 iteration (Task 5 Step 3), replay rollout (Task 2 test).
- **Placeholder scan:** không có TODO/TBD; mọi bước code có code.
- **Type consistency:** `LearnedPick` (Task 2) dùng ở trace/trajectory/encode; `sampleMasked(logits, mask, temperature, rng)` dùng ở cả VOTE lẫn NIGHT; `Dataset.logprobs/values/optimal` (Task 1, 3) dùng ở `train_ppo`/`train_bc`; `score_of` đọc đúng `summary[0..2]` theo thứ tự `setups` của `ai-benchmark.ts` (baseline, làng, sói); `--rollout` của encode và `--policy/--temperature/--learned-seats` của selfplay khớp lời gọi trong `rl_loop.py`.
