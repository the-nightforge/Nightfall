# Dự án M — model cho bàn 8–12 người: kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một model (`village-ppo-0002`) mạnh hơn heuristic ở mọi cỡ bàn 8–12 mà không phá cân bằng, và chỉ chạy ở những cỡ bàn nó đã đạt.

**Architecture:** File model mang `tableSizes`; runtime chỉ hỏi model khi cỡ bàn nằm trong đó (vắng → `[8]`, nên model cũ giữ nguyên hành vi). Dataset/BC trộn 5 cỡ bàn; `ai-encode` ghi cỡ bàn mỗi dòng để BC báo độ khớp theo cỡ. `rl_loop --players` rải rollout và benchmark theo cỡ, với cổng "trung bình + không cỡ nào tụt + cân bằng theo cỡ". `rl_stages --project m` gói các stage; notebook Kaggle gọi thẳng `rl_stages`.

**Tech Stack:** TypeScript (`packages/game-engine`, `apps/server/scripts`, vitest), Python 3 (`ai-training`, test là script `python tests/x.py` in `ok`), Jupyter/Kaggle.

**Spec:** `docs/superpowers/specs/2026-09-22-multi-size-tables-design.md`

## Global Constraints

- Cỡ bàn của dự án: `8, 9, 10, 11, 12`. Encoder giữ nguyên (797 chiều, `DEFAULT_MAX_SEATS` 16).
- `tableSizes` vắng trong file model → `[8]`. Hợp lệ: mảng không rỗng, số nguyên trong `1..DEFAULT_MAX_SEATS`.
- `village-ppo-0001` / `village-bc-0002` phải chơi Y HỆT trước thay đổi ở bàn 8 (benchmark cùng seed).
- Mọi cờ mới mặc định = hành vi cũ, byte một: `rl_loop --players` mặc định `8` sinh đúng lệnh/tên file cũ.
- Cổng thăng hạng (D5): điểm tổng = trung bình các cỡ, > champion + 2 trên MỌI bộ seed; không cỡ nào < champion ở cỡ đó − 2 (bộ seed chính); cân bằng theo cỡ (chỉ khi bật): `imbalance(all) ≤ imbalance(baseline) + 2` đọc từ CÙNG file bench.
- Confirm (D7): seed `confirm-0922`, T=0,5, 5 × 200 ván mỗi cỡ; một cỡ ĐẠT khi: không phe nào < heuristic − 1; một phe ≥ heuristic + 2; cân bằng ≤ heuristic + 2; 0 vi phạm; riêng bàn 8: đối đầu ppo-0001 mỗi phe ≥ −1.
- Tên: dataset `dataset-0006` (rollout `rollout-0003`), BC `village-bc-0004`, RL `village-ppo-0002`, run `m-village` / `m-wolves`.
- Người dùng tự chạy dataset/BC/RL/confirm. Agent KHÔNG chạy các giai đoạn train.
- KHÔNG xoá gì ngoài file chính task đó tạo ra — tuyệt đối không xoá `.tmp/`, `.superpowers/` hay thư mục gitignored nào. Smoke test ghi vào scratchpad hoặc một đường dẫn riêng.
- Commit kết thúc bằng `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File Structure

| File | Trách nhiệm | Task |
|---|---|---|
| `packages/game-engine/src/bot/learning/mlp.ts` | Đọc/kiểm `tableSizes`, mang trên `LearnedPolicy` | 1 |
| `packages/game-engine/src/bot/BotRuntime.ts` | `learnedFor` hỏi `tableSizes` của model | 1 |
| `apps/server/scripts/ai-encode.ts` | `tableSize.u8.bin`, `meta.tableSizes`, version | 2 |
| `ai-training/masoi_training/data.py` | Đọc `table_sizes` | 3 |
| `ai-training/masoi_training/train_bc.py` | Độ khớp theo cỡ bàn | 3 |
| `ai-training/masoi_training/export.py` | Ghi `tableSizes` | 3 |
| `ai-training/make_dataset.py` | `--players` | 4 |
| `ai-training/rl_loop.py` | `--players`, bench theo cỡ, cổng D5, state | 5 |
| `ai-training/rl_stages.py` | `--project m`, `confirm_m` | 6 |
| `ai-training/colab/train_rl_kaggle.ipynb` | Gọi `rl_stages` với `PROJECT`/`STAGE` | 7 |
| Test: `packages/game-engine/tests/bot-mlp.test.ts`, `bot-learned-policy.test.ts`, `ai-training/tests/test_table_sizes.py` (mới), `test_rl_gates.py`, `test_rl_stages.py` | | 1–6 |

---

### Task 1: `tableSizes` trong file model

**Files:**
- Modify: `packages/game-engine/src/bot/learning/mlp.ts` (`MlpWeightsJson`, `LearnedPolicy`, `loadMlpPolicy`)
- Modify: `packages/game-engine/src/bot/BotRuntime.ts` (`LEARNED_TABLE_SIZE`, `learnedFor`)
- Modify: `apps/server/src/bots/learned-policy.ts`, `.env.example` (chú thích)
- Test: `packages/game-engine/tests/bot-mlp.test.ts`, `packages/game-engine/tests/bot-learned-policy.test.ts`

**Interfaces:**
- Produces:
  - `export const DEFAULT_TABLE_SIZES: readonly number[] = [8];` (mlp.ts)
  - `MlpWeightsJson.tableSizes?: number[]`
  - `LearnedPolicy.tableSizes?: readonly number[]` (optional: policy dựng tay trong test không cần khai; runtime coi vắng = `DEFAULT_TABLE_SIZES`)
  - `loadMlpPolicy` trả `tableSizes` đã sort tăng dần, luôn có mặt.
  - `LEARNED_TABLE_SIZE` bị XOÁ.

- [ ] **Step 1: Ghi mốc hành vi ppo-0001 bàn 8 TRƯỚC khi sửa**

```bash
cd /d/Source/ma-soi-online && npm run build:deps --silent
npx tsx apps/server/scripts/ai-benchmark.ts --model apps/server/assets/models/village-ppo-0001.weights.json --players 8 --games 40 --repeat 1 --seed ts-lock --setups village,wolves,all --learned-decisions vote,night,final,hunter --temperature 0.5 --out "$SCRATCH/ts-lock-before.json"
```

`$SCRATCH` = thư mục scratchpad của phiên (KHÔNG phải `.tmp/`). Giữ file tới Step 7.

- [ ] **Step 2: Viết test hỏng — loader**

Thêm vào `bot-mlp.test.ts` (dùng `zeroWeights()` có sẵn đầu file):

```ts
describe("loadMlpPolicy — tableSizes (spec 2026-09-22 D1)", () => {
  it("vắng → [8]; có → giữ, sort tăng dần", () => {
    expect(loadMlpPolicy(zeroWeights()).tableSizes).toEqual([8]);
    const w = { ...zeroWeights(), tableSizes: [12, 8, 10, 9, 11] };
    expect(loadMlpPolicy(w).tableSizes).toEqual([8, 9, 10, 11, 12]);
  });

  it("rỗng, không nguyên, ngoài 1..16 → ném", () => {
    for (const bad of [[], [8.5], [0], [17], "8"]) {
      expect(() => loadMlpPolicy({ ...zeroWeights(), tableSizes: bad as never })).toThrow(/tableSizes/);
    }
  });
});
```

- [ ] **Step 3: Viết test hỏng — runtime**

Trong `bot-learned-policy.test.ts`, trong `describe("model chỉ chơi bàn 8 người — …")`, thêm (dùng `preferring` có sẵn):

```ts
  it("model khai tableSizes [8..12]: chơi bàn 10, KHÔNG chơi bàn 13", () => {
    const wide: LearnedPolicy = { ...preferring(actionIndexOf("CHOOSE", DEFAULT_MAX_SEATS)), tableSizes: [8, 9, 10, 11, 12] };
    const at = (size: number) =>
      runSelfPlay({
        seed: `wide-${size}`,
        playerCount: size,
        config: PRESET_DECKS[size],
        maxRounds: 3,
        trace: true,
        learnedPolicy: wide,
        learnedTemperature: 1,
      });
    expect(at(10).traces.some((t) => t.chosen.learned)).toBe(true);
    expect(at(13).traces.some((t) => t.chosen.learned)).toBe(false);
  });
```

Đổi tiêu đề describe thành `"model chỉ chơi những cỡ bàn trong tableSizes (vắng = [8])"`. Các test cũ trong describe đó (policy KHÔNG khai `tableSizes` → chỉ bàn 8) giữ nguyên — chúng giờ khẳng định mặc định `[8]`.

- [ ] **Step 4: Chạy, xác nhận hỏng**

Run: `cd packages/game-engine && npx vitest run tests/bot-mlp.test.ts tests/bot-learned-policy.test.ts`
Expected: FAIL — `tableSizes` undefined; bàn 10 không có `learned`.

- [ ] **Step 5: Loader**

Trong `mlp.ts`: thêm `DEFAULT_MAX_SEATS` vào import từ `./observation`; thêm cạnh các interface:

```ts
/** Cỡ bàn model được chơi khi file KHÔNG khai (mọi model trước spec 2026-09-22). */
export const DEFAULT_TABLE_SIZES: readonly number[] = [8];
```

`MlpWeightsJson`, sau `residual?`:

```ts
  /**
   * Cỡ bàn (số người) model được train và đã đạt confirm (spec 2026-09-22 D1).
   * Vắng = `DEFAULT_TABLE_SIZES`. Runtime không hỏi model ở bàn ngoài danh sách.
   */
  tableSizes?: number[];
```

`LearnedPolicy`, thêm:

```ts
  /** Xem `MlpWeightsJson.tableSizes`. Vắng (policy dựng tay) = `DEFAULT_TABLE_SIZES`. */
  readonly tableSizes?: readonly number[];
```

Trong `loadMlpPolicy`, ngay trước `const weights: MlpWeightsJson = {`:

```ts
  const maxSeats = options.maxSeats ?? DEFAULT_MAX_SEATS;
  const rawSizes: unknown = w.tableSizes ?? DEFAULT_TABLE_SIZES;
  if (
    !Array.isArray(rawSizes) ||
    rawSizes.length === 0 ||
    rawSizes.some((n) => !Number.isInteger(n) || n < 1 || n > maxSeats)
  ) {
    throw new Error(`tableSizes phải là mảng số nguyên 1..${maxSeats}, không rỗng`);
  }
  const tableSizes = [...(rawSizes as number[])].sort((a, b) => a - b);
```

và trong object trả về thêm `tableSizes,` cạnh `id`.

- [ ] **Step 6: Runtime**

Trong `BotRuntime.ts`: xoá khối `/** Cỡ bàn duy nhất … */ export const LEARNED_TABLE_SIZE = 8;`; thêm `DEFAULT_TABLE_SIZES` vào import từ `./learning/mlp` (dòng `import type { LearnedPolicy }` đổi thành `import { DEFAULT_TABLE_SIZES, type LearnedPolicy } from "./learning/mlp";`). Trong `learnedFor`, thay dòng return:

```ts
    const sizes = this.learnedPolicy.tableSizes ?? DEFAULT_TABLE_SIZES;
    return sizes.includes(context.knowledge.players.length) ? this.learnedPolicy : undefined;
```

và trong JSDoc của `learnedFor` thay `bàn đúng cỡ model được train` bằng `cỡ bàn nằm trong \`tableSizes\` của model (vắng = [8], spec 2026-09-22 D1)`, xoá dòng `ponytail: một cỡ bàn cố định …`.

Run: `git grep -n "LEARNED_TABLE_SIZE"` — sửa mọi chỗ còn lại: `apps/server/src/bots/learned-policy.ts` (chú thích: "Chỉ các cỡ bàn trong `tableSizes` của file model; vắng = bàn 8"), test comment nếu có. `.env.example`: dòng `# ban Tho San - CHI o ban 8 nguoi …` thành `# ban Tho San - chi o cac co ban trong tableSizes cua file model (vang = 8 nguoi).`

- [ ] **Step 7: Chạy test + khoá hành vi**

```bash
cd /d/Source/ma-soi-online/packages/game-engine && npx tsc -p tsconfig.json --noEmit && npx vitest run
cd ../../apps/server && npx vitest run
cd ../.. && npm run build:deps --silent
npx tsx apps/server/scripts/ai-benchmark.ts --model apps/server/assets/models/village-ppo-0001.weights.json --players 8 --games 40 --repeat 1 --seed ts-lock --setups village,wolves,all --learned-decisions vote,night,final,hunter --temperature 0.5 --out "$SCRATCH/ts-lock-after.json"
node -e "const f=p=>JSON.stringify(require(p).rows.map(r=>[r.setup,r.villageWin,r.violations]));const a=f(process.argv[1]),b=f(process.argv[2]);if(a!==b){console.error('LỆCH',a,b);process.exit(1)}console.log('y hệt',a)" "$SCRATCH/ts-lock-before.json" "$SCRATCH/ts-lock-after.json"
```

Expected: engine + server PASS (test self-play dài có thể timeout khi cả bộ chạy song song — chạy lại riêng file đó); `y hệt …`.

- [ ] **Step 8: Commit**

```bash
git add packages/game-engine/src/bot/learning/mlp.ts packages/game-engine/src/bot/BotRuntime.ts packages/game-engine/tests/bot-mlp.test.ts packages/game-engine/tests/bot-learned-policy.test.ts apps/server/src/bots/learned-policy.ts .env.example
git commit -m "feat(bot): model files declare tableSizes; runtime asks the model only at those table sizes (default [8])

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `ai-encode` ghi cỡ bàn mỗi dòng

**Files:**
- Modify: `apps/server/scripts/ai-encode.ts`

**Interfaces:**
- Produces: file `tableSize.u8.bin` (một `uint8` mỗi dòng đã ghi, = `encoded.seats.length`); `meta.tableSizes: number[]` (các giá trị đã thấy, sort tăng); `meta.datasetVersion` = `"dataset-0006"` (rollout: `"rollout-0003"`).

`encoded.seats.length` là số người của bàn: `canonicalSeats` gồm mọi id có trong `belief`, và belief có một mục cho mỗi người chơi (kể cả đã chết).

- [ ] **Step 1: Thêm stream và ghi**

Trong object `streams` (cạnh `decisions: createWriteStream(join(outDir, "decisions.u8.bin")),`):

```ts
    // Cỡ bàn của từng dòng (spec 2026-09-22 D3): train_bc báo độ khớp theo cỡ.
    tableSizes: createWriteStream(join(outDir, "tableSize.u8.bin")),
```

Khai báo trước vòng đọc line (cạnh các bộ đếm `rows`, `rejected`…): `const tableSizes = new Set<number>();`

Ngay sau dòng `streams.decisions.write(...)`:

```ts
    streams.tableSizes.write(Buffer.from(Uint8Array.of(encoded.seats.length)));
    tableSizes.add(encoded.seats.length);
```

Trong `meta`: đổi `datasetVersion: options.rollout ? "rollout-0002" : "dataset-0005",` thành `datasetVersion: options.rollout ? "rollout-0003" : "dataset-0006",` và cập nhật chú thích phía trên thêm dòng `// dataset-0006: thêm tableSize.u8.bin + meta.tableSizes (spec 2026-09-22 D2).`; thêm cạnh `maxSeats: options.maxSeats,`:

```ts
    tableSizes: [...tableSizes].sort((a, b) => a - b),
```

- [ ] **Step 2: Smoke (không có unit test cho script này)**

```bash
cd /d/Source/ma-soi-online && npm run build:deps --silent
for n in 8 10; do npx tsx apps/server/scripts/selfplay.ts --games 2 --players $n --preset --defense --seed enc-$n --trajectories "$SCRATCH/traj-$n" --trace-games 2 --no-jitter --quiet; done
cat "$SCRATCH/traj-8/trajectories.jsonl" "$SCRATCH/traj-10/trajectories.jsonl" > "$SCRATCH/traj-mix.jsonl"
npx tsx apps/server/scripts/ai-encode.ts --in "$SCRATCH/traj-mix.jsonl" --out "$SCRATCH/enc-mix"
node -e "const m=require(process.argv[1]+'/meta.json');const n=require('fs').statSync(process.argv[1]+'/tableSize.u8.bin').size;console.log(m.datasetVersion,m.tableSizes,'rows',m.rows,'bytes',n);if(n!==m.rows||JSON.stringify(m.tableSizes)!=='[8,10]')process.exit(1)" "$SCRATCH/enc-mix"
```

Expected: `dataset-0006 [ 8, 10 ] rows N bytes N`, thoát 0.

- [ ] **Step 3: Test server + commit**

Run: `cd apps/server && npx vitest run` — Expected: PASS.

```bash
git add apps/server/scripts/ai-encode.ts
git commit -m "feat(dataset): ai-encode writes the table size of each row (tableSize.u8.bin, meta.tableSizes); dataset-0006

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Python đọc cỡ bàn, báo độ khớp theo cỡ, xuất `tableSizes`

**Files:**
- Modify: `ai-training/masoi_training/data.py` (`Dataset`, `where`, `load`)
- Modify: `ai-training/masoi_training/train_bc.py` (`evaluate`)
- Modify: `ai-training/masoi_training/export.py` (`export_weights_json`)
- Create: `ai-training/tests/test_table_sizes.py`

**Interfaces:**
- Consumes: `tableSize.u8.bin`, `meta.tableSizes` (Task 2). Helper test có sẵn: `tests/test_data.py::write_dataset(root)` (ghi 6 dòng, meta).
- Produces: `Dataset.table_sizes: np.ndarray | None` (uint8, (N,)); `train_bc.by_table_size(values, sizes) -> dict[str, float] | None`; `evaluate()` thêm `agreementByTableSize`, `agreementTieAwareByTableSize`; payload export có `tableSizes` khi `meta` có.

- [ ] **Step 1: Viết test hỏng**

Tạo `ai-training/tests/test_table_sizes.py`:

```python
"""Cỡ bàn theo dòng (spec 2026-09-22 D3): đọc, gom nhóm, xuất ra file model.

Chạy: python tests/test_table_sizes.py
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from masoi_training.data import load  # noqa: E402
from masoi_training.train_bc import by_table_size  # noqa: E402
from test_data import write_dataset  # noqa: E402


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        write_dataset(root)
        assert load(root).table_sizes is None  # dataset cũ: không bịa cột

        np.array([8, 8, 10, 10, 12, 12], dtype=np.uint8).tofile(root / "tableSize.u8.bin")
        data = load(root)
        assert data.table_sizes.tolist() == [8, 8, 10, 10, 12, 12]
        kept = data.where(np.array([True, False, True, False, True, False]))
        assert kept.table_sizes.tolist() == [8, 10, 12]

        np.array([8, 8], dtype=np.uint8).tofile(root / "tableSize.u8.bin")
        try:
            load(root)
            raise AssertionError("file cỡ bàn cụt phải ném")
        except ValueError as error:
            assert "table" in str(error).lower(), error

    hits = np.array([1, 0, 1, 1, 0, 0], dtype=float)
    sizes = np.array([8, 8, 10, 10, 12, 12], dtype=np.uint8)
    assert by_table_size(hits, sizes) == {"8": 0.5, "10": 1.0, "12": 0.0}
    assert by_table_size(hits, None) is None

    print("ok")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Chạy, xác nhận hỏng**

Run: `cd ai-training && PYTHONUTF8=1 .venv/Scripts/python.exe tests/test_table_sizes.py`
Expected: FAIL — `ImportError: cannot import name 'by_table_size'` (hoặc `table_sizes` không tồn tại).

- [ ] **Step 3: `data.py`**

Trong `Dataset`, sau `shaping: …`:

```python
    # Cỡ bàn (số người) của từng dòng (spec 2026-09-22 D3). `None` với dataset
    # encode trước dataset-0006 — không có file thì không bịa cột.
    table_sizes: np.ndarray | None = None  # (N,) uint8
```

Trong `where`, thêm: `table_sizes=self.table_sizes[keep] if self.table_sizes is not None else None,`

Trong `load`, cạnh khối shaping:

```python
    table_path = root / "tableSize.u8.bin"
    table_sizes = np.fromfile(table_path, dtype=np.uint8) if table_path.exists() else None
```

trong khối kiểm kích thước: `if table_sizes is not None: expected["tableSizes"] = (table_sizes.size, rows)`, và trong `return Dataset(...)` thêm `table_sizes=table_sizes,`.

(Tên khoá `tableSizes` trong `expected` cho ra thông báo "tableSizes: … phần tử" — test tìm chữ "table".)

- [ ] **Step 4: `train_bc.py`**

Thêm hàm module-level trước `evaluate`:

```python
def by_table_size(values: np.ndarray, sizes: np.ndarray | None) -> dict[str, float] | None:
    """Trung bình `values` theo cỡ bàn (khoá chuỗi để JSON giữ được). `None`
    khi dataset không có cột cỡ bàn (spec 2026-09-22 D3)."""
    if sizes is None:
        return None
    return {str(int(n)): round(float(values[sizes == n].mean()), 4) for n in np.unique(sizes)}
```

Trong `evaluate`, đổi khối tie-aware để giữ vector theo dòng:

```python
    tie_aware = None
    tie_hits = None
    if data.optimal is not None:
        pred = predicted.cpu().numpy()
        tie_hits = data.optimal[np.arange(len(pred)), pred].astype(float)
        tie_aware = round(float(tie_hits.mean()), 4)
```

và trong dict trả về, sau `"agreementByDecision": …`:

```python
        "agreementByTableSize": by_table_size(correct.astype(float), data.table_sizes),
        "agreementTieAwareByTableSize": by_table_size(tie_hits, data.table_sizes)
        if tie_hits is not None
        else None,
```

- [ ] **Step 5: `export.py`**

Ngay trước `if residual is not None:`:

```python
    # Cỡ bàn dataset đã có (spec 2026-09-22 D1). Vắng → engine coi là [8];
    # script đóng gói ghi đè bằng tập cỡ ĐẠT confirm.
    if meta.get("tableSizes"):
        payload["tableSizes"] = [int(n) for n in meta["tableSizes"]]
```

Thêm vào cuối `main()` của `test_table_sizes.py` (trước `print("ok")`) một kiểm export: đọc `tests/test_export_v2.py` để dựng `PolicyValueNet` + `META` như hàm `export()` ở đó, rồi:

```python
    from masoi_training.export import export_weights_json
    from test_export_v2 import HIDDEN, META, build_model  # xem ghi chú dưới
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "w.json"
        export_weights_json(build_model(), {**META, "tableSizes": [8, 10]}, out, model_id="t", training_seed=0, hidden=HIDDEN)
        assert json.loads(out.read_text(encoding="utf8"))["tableSizes"] == [8, 10]
        export_weights_json(build_model(), META, out, model_id="t", training_seed=0, hidden=HIDDEN)
        assert "tableSizes" not in json.loads(out.read_text(encoding="utf8"))
```

Ghi chú: nếu `test_export_v2.py` không có hàm `build_model`, dựng model đúng như các test trong file đó dựng (cùng `PolicyValueNet(...)`) ngay trong test mới — không sửa `test_export_v2.py`.

- [ ] **Step 6: Chạy test**

```bash
cd /d/Source/ma-soi-online/ai-training
for t in tests/test_table_sizes.py tests/test_data.py tests/test_export.py tests/test_export_v2.py tests/test_metrics_p0.py tests/test_train_smoke.py; do PYTHONUTF8=1 .venv/Scripts/python.exe $t | tail -1; done
```

Expected: mỗi file in `ok` (hoặc thông điệp PASS riêng của file).

- [ ] **Step 7: Commit**

```bash
git add ai-training/masoi_training/data.py ai-training/masoi_training/train_bc.py ai-training/masoi_training/export.py ai-training/tests/test_table_sizes.py
git commit -m "feat(training): per-row table sizes - BC agreement by table size, tableSizes in exported weights

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `make_dataset.py --players`

**Files:**
- Modify: `ai-training/make_dataset.py`

**Interfaces:**
- Consumes: `selfplay.ts --players n --preset`; `ai-encode` ghi `meta.tableSizes` (Task 2).
- Produces: CLI `--players 8,9,10,11,12` (mặc định `8`); `--shards` mặc định `max(1, 10 // số cỡ)` (10 cho `8`, 2 cho năm cỡ); thư mục shard `p{n}-shard-{i:02d}`, seed `{seed}-p{n}-{i}`.

- [ ] **Step 1: Sửa script**

Đổi `shard`:

```python
def shard(out: Path, size: int, i: int, games: int, seed: str) -> Path:
    part = out / f"p{size}-shard-{i:02d}"
    done = part / ".done"
    if not done.exists():
        # Recipe của dataset-0004 (ai-training/README.md), chỉ khác cỡ bàn và seed.
        run([npx(), "tsx", "apps/server/scripts/selfplay.ts", "--games", str(games), "--players", str(size),
             "--preset", "--defense", "--seed", f"{seed}-p{size}-{i}", "--trajectories", str(part),
             "--trace-games", str(games), "--no-jitter", "--quiet"])
        done.write_text("ok")
    return part / "trajectories.jsonl"
```

Trong `main()`: thêm tham số và đổi `--shards`:

```python
    p.add_argument("--players", default="8", help="cỡ bàn, cách nhau dấu phẩy (vd 8,9,10,11,12)")
    p.add_argument("--shards", type=int, default=None, help="số shard MỖI cỡ bàn (mặc định 10 ÷ số cỡ)")
```

sau `parse_args`:

```python
    sizes = sorted({int(x) for x in a.players.split(",") if x.strip()})
    if not sizes or any(n < 8 or n > 16 for n in sizes):
        raise SystemExit("--players: cỡ bàn trong 8..16")
    shards = a.shards if a.shards is not None else max(1, 10 // len(sizes))
    jobs = [(n, i) for n in sizes for i in range(shards)]
```

và thay `parts = list(pool.map(lambda i: shard(out, i, a.games, a.seed), range(a.shards)))` bằng:

```python
        parts = list(pool.map(lambda job: shard(out, job[0], job[1], a.games, a.seed), jobs))
```

Cập nhật docstring đầu file: thêm dòng ví dụ

```
    ai-training/.venv/Scripts/python.exe ai-training/make_dataset.py --players 8,9,10,11,12 --out .tmp/traj-m --enc .tmp/enc-m
```

- [ ] **Step 2: Smoke**

```bash
cd /d/Source/ma-soi-online
PYTHONUTF8=1 ai-training/.venv/Scripts/python.exe ai-training/make_dataset.py --players 8,9 --shards 1 --games 2 --jobs 2 --out "$SCRATCH/mk-traj" --enc "$SCRATCH/mk-enc"
node -e "const m=require(process.argv[1]+'/meta.json');console.log(m.tableSizes);if(JSON.stringify(m.tableSizes)!=='[8,9]')process.exit(1)" "$SCRATCH/mk-enc"
PYTHONUTF8=1 ai-training/.venv/Scripts/python.exe ai-training/make_dataset.py --players 8,9 --shards 1 --games 2 --jobs 2 --out "$SCRATCH/mk-traj" --enc "$SCRATCH/mk-enc2" 2>&1 | grep -c "selfplay.ts" || true
```

Expected: `[ 8, 9 ]`; lần chạy lại in `0` (mọi shard có `.done`, không selfplay nào chạy lại).

- [ ] **Step 3: Commit**

```bash
git add ai-training/make_dataset.py
git commit -m "feat(dataset): make_dataset --players - one shard group per table size

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `rl_loop --players` — rollout, benchmark và cổng theo cỡ bàn

**Files:**
- Modify: `ai-training/rl_loop.py`
- Test: `ai-training/tests/test_rl_gates.py`

**Interfaces:**
- Consumes: `ai:benchmark --players n`, `selfplay.ts --players n` (có sẵn).
- Produces:
  - `parse_players(raw: str) -> list[int]` (8..16, sort, không trùng)
  - `rollout_cmd(..., opponent=None, players: int = 8)` — `--players` luôn có; seed `rl-{k}-{seats}` khi players == 8, `rl-{k}-{seats}-p{n}` khi khác.
  - `bench_cmd(model, seed, dest, games, repeat, decisions, players: int = 8)` — thêm `["--players", str(players)]` CHỈ khi players != 8.
  - `bench_paths(directory, stem, sizes) -> dict[int, Path]` — `[8]` → `{8: directory/f"{stem}.json"}`, khác → `{n: directory/f"{stem}-p{n}.json"}`.
  - `BenchRead` thêm `base_imbalance: float = 0.0`, `by_size: dict[int, "BenchRead"] | None = None`.
  - `read_sizes(paths: dict[int, Path], side) -> BenchRead` — một cỡ = `read_bench`; nhiều cỡ = trung bình score/other/imbalance/base_imbalance, `by_size` = từng cỡ.
  - `passes_gates(..., size_drop: float = -1.0, size_balance_slack: float = -1.0)`.
  - `size_state(read) -> dict | None`, `size_from_state(raw) -> dict[int, BenchRead] | None`; state khoá `championBySize`.
  - CLI: `--players` (mặc định `8`), `--size-drop` (mặc định `2.0`), `--size-balance-slack` (mặc định `-1`, tắt).

- [ ] **Step 1: Viết test hỏng**

Thêm vào `main()` của `test_rl_gates.py` (dùng `write_bench` có sẵn; import thêm `bench_paths, parse_players, read_sizes, size_from_state, size_state` từ `rl_loop`):

```python
        # --- Dự án M (spec 2026-09-22 D4/D5): theo cỡ bàn ---
        assert parse_players("12,8,10,8") == [8, 10, 12]
        for bad in ("", "7", "17", "8,x"):
            try:
                parse_players(bad)
                raise AssertionError(f"--players {bad!r} phải bị từ chối")
            except (SystemExit, ValueError):
                pass

        assert bench_paths(root, "bench", [8]) == {8: root / "bench.json"}
        assert bench_paths(root, "bench", [8, 10]) == {8: root / "bench-p8.json", 10: root / "bench-p10.json"}

        # Lệnh mặc định (8) giữ nguyên byte một: không có --players ở bench, seed rollout cũ.
        assert "--players" not in bench_cmd(Path("m.json"), "rl-bench", Path("b.json"), 200, 3, decisions)
        b10 = bench_cmd(Path("m.json"), "rl-bench", Path("b.json"), 200, 3, decisions, 10)
        assert b10[b10.index("--players") + 1] == "10", b10
        r10 = rollout_cmd(Path("m.json"), "wolves", 4, Path("part"), 200, 1.0, decisions, None, 10)
        assert r10[r10.index("--players") + 1] == "10" and r10[r10.index("--seed") + 1] == "rl-4-wolves-p10", r10

        # Trung bình theo cỡ; base_imbalance đọc setup baseline của CÙNG file.
        p8 = write_bench(root / "p8.json", 0.50, 0.56, 0.44, 0.52)    # làng +6, sói +6, lệch 2, base 0
        p10 = write_bench(root / "p10.json", 0.40, 0.44, 0.38, 0.30)  # làng +4, sói +2, lệch 20, base 10
        multi = read_sizes({8: p8, 10: p10}, "village")
        assert abs(multi.score - 5.0) < 1e-9 and multi.by_size[10].base_imbalance == 10.0, multi
        single = read_sizes({8: p8}, "village")
        assert single.by_size is None and abs(single.score - 6.0) < 1e-9

        champ_m = BenchRead(1.0, 0.0, 5.0, 0.0, {8: BenchRead(1.0, 0.0, 2.0, 0.0), 10: BenchRead(4.5, 0.0, 20.0, 10.0)})
        # Tổng 5,0 > 1,0 + 2; bàn 10 là 4,0 so với champion 4,5 → tụt 0,5, qua.
        assert passes_gates([multi], champ_m, 2.0, -1.0, -1.0, size_drop=2.0)
        # Champion bàn 10 là 6,5 → tụt 2,5 > 2 → chặn.
        champ_hi = BenchRead(1.0, 0.0, 5.0, 0.0, {8: BenchRead(1.0, 0.0, 2.0, 0.0), 10: BenchRead(6.5, 0.0, 20.0, 10.0)})
        assert not passes_gates([multi], champ_hi, 2.0, -1.0, -1.0, size_drop=2.0)
        # Cân bằng theo cỡ: bàn 10 lệch 20 so với heuristic 10 → chặn khi bật, qua khi tắt.
        assert not passes_gates([multi], champ_m, 2.0, -1.0, -1.0, size_drop=2.0, size_balance_slack=2.0)
        assert passes_gates([multi], champ_m, 2.0, -1.0, -1.0, size_drop=2.0, size_balance_slack=-1.0)

        # State giữ được điểm theo cỡ qua resume.
        restored = size_from_state(json.loads(json.dumps(size_state(multi))))
        assert restored[10].score == multi.by_size[10].score and restored[10].base_imbalance == 10.0
        assert size_state(single) is None and size_from_state(None) is None
```

- [ ] **Step 2: Chạy, xác nhận hỏng**

Run: `cd ai-training && PYTHONUTF8=1 .venv/Scripts/python.exe tests/test_rl_gates.py`
Expected: FAIL — `ImportError` (`bench_paths`…).

- [ ] **Step 3: Hàm thuần**

Trong `rl_loop.py`, sau `imbalance_of`:

```python
def parse_players(raw: str) -> list[int]:
    """`--players 8,9,10` → [8, 9, 10] (spec 2026-09-22 D4). Bàn < 8 không mở được
    (`MIN_PLAYERS_TO_START`), > 16 vượt encoder."""
    try:
        sizes = sorted({int(x) for x in raw.split(",") if x.strip()})
    except ValueError as error:
        raise SystemExit(f"--players {raw!r}: cần số nguyên cách nhau dấu phẩy") from error
    if not sizes or any(n < 8 or n > 16 for n in sizes):
        raise SystemExit(f"--players {raw!r}: cỡ bàn trong 8..16")
    return sizes


def bench_paths(directory: Path, stem: str, sizes: list[int]) -> dict[int, Path]:
    """File bench theo cỡ. Chỉ bàn 8 → đúng tên cũ, để run cũ resume được."""
    if sizes == [8]:
        return {8: directory / f"{stem}.json"}
    return {n: directory / f"{stem}-p{n}.json" for n in sizes}
```

`BenchRead`: thêm hai trường CUỐI (có mặc định, để mọi chỗ dựng `BenchRead(a, b, c)` cũ vẫn chạy):

```python
    base_imbalance: float = 0.0
    """|làng thắng của heuristic (setup baseline) − 50 %| trên CÙNG file — mốc cân bằng theo cỡ."""
    by_size: "dict[int, BenchRead] | None" = None
    """Điểm từng cỡ bàn khi chấm nhiều cỡ (spec 2026-09-22 D5); None khi một cỡ."""
```

`read_bench`: thêm `base_imbalance=_baseline_imbalance(bench_json),` với

```python
def _baseline_imbalance(bench_json: Path) -> float:
    b = json.loads(bench_json.read_text(encoding="utf8"))
    by = {s.get("setup"): s["villageWinMean"] for s in b["summary"]}
    return abs(by["baseline"] - 0.5) * 100
```

Thêm:

```python
def read_sizes(paths: dict[int, Path], side: str) -> BenchRead:
    """Một cỡ = `read_bench` (hành vi cũ). Nhiều cỡ = trung bình mọi con số, giữ
    từng cỡ trong `by_size` cho cổng "không cỡ nào tụt" và cân bằng theo cỡ."""
    reads = {n: read_bench(p, side) for n, p in sorted(paths.items())}
    if len(reads) == 1:
        return next(iter(reads.values()))

    def mean(xs: list[float]) -> float:
        return sum(xs) / len(xs)

    others = [r.other for r in reads.values() if r.other is not None]
    return BenchRead(
        score=mean([r.score for r in reads.values()]),
        other=mean(others) if others else None,
        imbalance=mean([r.imbalance for r in reads.values()]),
        base_imbalance=mean([r.base_imbalance for r in reads.values()]),
        by_size=reads,
    )


def size_state(read: BenchRead) -> dict | None:
    if read.by_size is None:
        return None
    return {
        str(n): {"score": r.score, "other": r.other, "imbalance": r.imbalance, "baseImbalance": r.base_imbalance}
        for n, r in read.by_size.items()
    }


def size_from_state(raw: dict | None) -> dict[int, BenchRead] | None:
    if not raw:
        return None
    return {
        int(n): BenchRead(v["score"], v.get("other"), v["imbalance"], v.get("baseImbalance", 0.0))
        for n, v in raw.items()
    }
```

`champion_of`: thêm `base_imbalance=reads[0].base_imbalance, by_size=reads[0].by_size,` (cổng theo cỡ chỉ chấm bộ seed chính, giống cổng phe kia).

`passes_gates`: thêm tham số `size_drop: float = -1.0, size_balance_slack: float = -1.0` và trước `return True`:

```python
    # Theo cỡ bàn (spec 2026-09-22 D5), chỉ bộ seed chính — bộ duy nhất champion cũng được đo.
    if size_drop >= 0 and primary.by_size and champion.by_size:
        for n, r in primary.by_size.items():
            if n in champion.by_size and r.score < champion.by_size[n].score - size_drop:
                return False
    # Cân bằng so với heuristic của CÙNG file bench: không so khác bộ seed.
    if size_balance_slack >= 0 and primary.by_size:
        if any(r.imbalance > r.base_imbalance + size_balance_slack for r in primary.by_size.values()):
            return False
```

`champion_from_state`: thêm vào `BenchRead(...)` trả về `base_imbalance=initial.base_imbalance, by_size=size_from_state(state.get("championBySize")) or initial.by_size,`.

`bench_cmd`: thêm tham số `players: int = 8` và `*(["--players", str(players)] if players != 8 else []),` ngay sau `"--model", str(model),`.

`rollout_cmd`: thêm tham số cuối `players: int = 8`; thay `"--players", "8",` bằng `"--players", str(players),` và seed bằng `f"rl-{iteration}-{seats}" if players == 8 else f"rl-{iteration}-{seats}-p{players}"`.

- [ ] **Step 4: Nối vào `main`**

Tham số (cạnh `--opponent`):

```python
    p.add_argument("--players", default="8", help="cỡ bàn rollout/bench, vd 8,9,10,11,12 (spec 2026-09-22)")
    p.add_argument("--size-drop", type=float, default=2.0, dest="size_drop",
                   help="không cỡ nào được kém champion ở cỡ đó quá chừng này (âm = tắt)")
    p.add_argument("--size-balance-slack", type=float, default=-1.0, dest="size_balance_slack",
                   help="mỗi cỡ: lệch cân bằng ≤ heuristic cùng file + slack (âm = tắt; stage sói dùng 2)")
```

Sau `a = p.parse_args()`: `sizes = parse_players(a.players)`.

Thêm helper trong `main` (sau `save_state`):

```python
    def bench_sizes(model: Path, seed: str, directory: Path, stem: str, marker: str) -> BenchRead:
        paths = bench_paths(directory, stem, sizes)
        for n, path in paths.items():
            step(
                done_marker(directory, marker if len(paths) == 1 else f"{marker}-p{n}"),
                bench_cmd(model, seed, path, a.bench_games, a.bench_repeat, a.learned_decisions, n),
            )
        return read_sizes(paths, a.side)
```

Thay ba chỗ bench:
- bench0: khối `bench0 = …; step(done_marker(out, "bench-0000"), bench_cmd(champion, "rl-bench", bench0, …)); champ = read_bench(bench0, a.side)` → `champ = bench_sizes(champion, "rl-bench", out, "bench-champion-0000", "bench-0000")`.
- vòng: `bench = it / "bench.json"; step(done_marker(it, "bench"), bench_cmd(challenger, "rl-bench", bench, …)); reads = [read_bench(bench, a.side)]` → `reads = [bench_sizes(challenger, "rl-bench", it, "bench", "bench")]`.
- xác nhận: `conf = it / "bench-confirm.json"; step(done_marker(it, "bench-confirm"), bench_cmd(challenger, a.confirm_seed, conf, …)); reads.append(read_bench(conf, a.side))` → `reads.append(bench_sizes(challenger, a.confirm_seed, it, "bench-confirm", "bench-confirm"))`.

`gates` thêm `"size_drop": a.size_drop, "size_balance_slack": a.size_balance_slack,`.

Rollout: thay `rollout_one` và phần gộp:

```python
        parts = [(seats, n) for seats in SEATS for n in sizes]

        def part_name(seats: str, n: int) -> str:
            return f"roll-{seats}" if sizes == [8] else f"roll-{seats}-p{n}"

        def rollout_one(job: tuple[str, int], iteration: int = k, source: Path = champion) -> None:
            seats, n = job
            name = part_name(seats, n)
            step(
                done_marker(it, name),
                rollout_cmd(source, seats, iteration, it / name, a.games // len(parts), a.temperature,
                            a.learned_decisions, a.opponent if seats == a.side else None, n),
            )

        with ThreadPoolExecutor(max_workers=3) as pool:
            list(pool.map(rollout_one, parts))
```

và trong khối gộp: `for seats in SEATS:` → `for seats, n in parts:` với đường dẫn `it / part_name(seats, n) / "trajectories.jsonl"`.

Mỗi chỗ ghi state champion (sau `state["championImbalance"] = champ.imbalance`): thêm `state["championBySize"] = size_state(champ)`. Trong `row` của vòng, sau `otherSide`: `if reads[0].by_size: row["bySize"] = {str(n): round(r.score, 2) for n, r in reads[0].by_size.items()}`.

- [ ] **Step 5: Chạy test**

```bash
cd /d/Source/ma-soi-online/ai-training
for t in tests/test_rl_gates.py tests/test_rl_loop.py tests/test_rl_stages.py; do PYTHONUTF8=1 .venv/Scripts/python.exe $t | tail -1; done
PYTHONUTF8=1 .venv/Scripts/python.exe rl_loop.py --help | grep -A1 -E "players|size-drop|size-balance"
```

Expected: ba file in `ok`; help có ba cờ mới.

- [ ] **Step 6: Commit**

```bash
git add ai-training/rl_loop.py ai-training/tests/test_rl_gates.py
git commit -m "feat(rl): rl_loop --players - per-size rollouts and benchmarks, mean score with no-size-drop and per-size balance gates

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `rl_stages --project m` và `confirm_m`

**Files:**
- Modify: `ai-training/rl_stages.py`
- Modify: `ai-training/colab/train_rl_local.ipynb` (chú thích biến `PROJECT`)
- Test: `ai-training/tests/test_rl_stages.py`

**Interfaces:**
- Consumes: `rl_loop --players/--size-balance-slack/--bench-games` (Task 5); `ai:benchmark --opponent`, `paired["h2h-village"|"h2h-wolves"]`; `rl_loop.score_of`.
- Produces:
  - `set_project("m")`; `M_SIZES = [8, 9, 10, 11, 12]`
  - `judge_size(bench: Path, size: int) -> tuple[bool, dict]`
  - `confirm_m(rl, deadline, model=None) -> list[int]` (trả các cỡ ĐẠT, in bảng + `tableSizes:` + `VERDICT`)
  - CLI `--project` nhận `m`.

- [ ] **Step 1: Viết test hỏng**

Thêm vào `main()` của `test_rl_stages.py`, trước `print("ok")`:

```python
    # Dự án M (spec 2026-09-22): năm cỡ bàn, cổng cân bằng theo cỡ ở stage sói.
    rs.set_project("m")
    try:
        assert rs.CHAMPION0.name == "village-bc-0004.weights.json"
        name, side, iterations, extra = rs.STAGES["village"]
        assert name == "m-village" and side == "village" and iterations == 20
        assert extra[extra.index("--players") + 1] == "8,9,10,11,12", extra
        assert "--size-balance-slack" not in extra
        wolves = rs.STAGES["wolves"][3]
        assert wolves[wolves.index("--size-balance-slack") + 1] == "2", wolves
        assert rs.STAGES["wolves"][0] == "m-wolves"
    finally:
        rs.set_project("a")

    # judge_size: tiêu chí D7 trên một file bench dựng tay.
    def bench(path: Path, base: float, village: float, wolves: float, all_: float, violations: int = 0,
              paired: dict | None = None) -> Path:
        summary = [{"setup": s, "villageWinMean": v} for s, v in
                   (("baseline", base), ("village", village), ("wolves", wolves), ("all", all_))]
        path.write_text(json.dumps({"summary": summary, "rows": [{"violations": violations}],
                                    "paired": paired or {}}), encoding="utf8")
        return path

    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        ok, _ = rs.judge_size(bench(t / "a.json", 0.40, 0.45, 0.39, 0.41), 10)   # làng +5, sói +1, lệch 9 ≤ 10+2
        assert ok
        bad, detail = rs.judge_size(bench(t / "b.json", 0.40, 0.45, 0.43, 0.41), 10)  # sói −3
        assert not bad and not detail["checks"]["không phe nào < heuristic − 1"]
        unbal, _ = rs.judge_size(bench(t / "c.json", 0.50, 0.53, 0.47, 0.35), 10)   # lệch 15 > 0 + 2
        assert not unbal
        dirty, _ = rs.judge_size(bench(t / "d.json", 0.40, 0.45, 0.39, 0.41, violations=1), 10)
        assert not dirty
        h2h = {"h2h-village": {"mean": 0.5, "se": 1}, "h2h-wolves": {"mean": -1.5, "se": 1}}
        eight, detail8 = rs.judge_size(bench(t / "e.json", 0.50, 0.55, 0.47, 0.51, paired=h2h), 8)
        assert not eight and not detail8["checks"]["đối đầu ppo-0001 mỗi phe ≥ −1"]
```

- [ ] **Step 2: Chạy, xác nhận hỏng**

Run: `cd ai-training && PYTHONUTF8=1 .venv/Scripts/python.exe tests/test_rl_stages.py`
Expected: FAIL — `dự án lạ: 'm'`.

- [ ] **Step 3: Hằng số dự án M**

Trong `rl_stages.py`, sau `_PROJECT_B = (...)`:

```python
M_SIZES = [8, 9, 10, 11, 12]
# Spec 2026-09-22 D4/D5: rollout và chấm theo năm cỡ; 200 ván × 3 seed MỖI cỡ.
M_FLAGS = ["--players", ",".join(map(str, M_SIZES)), "--bench-games", "200"]
_PROJECT_M = (
    ROOT / "apps" / "server" / "assets" / "models" / "village-bc-0004.weights.json",
    {
        "village": ("m-village", "village", 20, ["--train-decisions", NO_NIGHT, *SIDE_STAGE, *M_FLAGS]),
        "village-lr3": ("m-village-lr3", "village", 20,
                        ["--train-decisions", NO_NIGHT, *SIDE_STAGE, *M_FLAGS, "--lr", "3e-4"]),
        # D6: làng mạnh lên ở bàn 9–12 là cân bằng TỐT lên; sói mạnh lên là thứ
        # đã phá ppo-0001 — cổng cân bằng theo cỡ chỉ ở stage sói.
        "wolves": ("m-wolves", "wolves", 20,
                   ["--train-decisions", NO_NIGHT, "--shaping-decisions", "vote", *SIDE_STAGE, *M_FLAGS,
                    "--size-balance-slack", "2"]),
        "wolves-lr3": ("m-wolves-lr3", "wolves", 20,
                       ["--train-decisions", NO_NIGHT, "--shaping-decisions", "vote", *SIDE_STAGE, *M_FLAGS,
                        "--size-balance-slack", "2", "--lr", "3e-4"]),
    },
    ("m-village-lr3", "m-village"),
    ("m-wolves-lr3", "m-wolves"),
    ("m-night-wolves", "m-night-village"),
)
```

`set_project`: nhận `"m"` — đổi kiểm thành `if name not in ("a", "b", "m"):` và phép gán thành

```python
    CHAMPION0, STAGES, VILLAGE_RUNS, WOLVES_RUNS, NIGHT_RUNS = {"a": _PROJECT_A, "b": _PROJECT_B, "m": _PROJECT_M}[name]
```

(cập nhật thông báo lỗi thành `(có: a, b, m)` và docstring thêm `'m' = spec 2026-09-22`).

- [ ] **Step 4: `judge_size` và `confirm_m`**

Sau `confirm_b`:

```python
CONFIRM_M = ["--games", "200", "--repeat", "5", "--seed", "confirm-0922", "--temperature", "0.5",
             "--learned-decisions", "vote,night,final,hunter"]


def judge_size(bench: Path, size: int) -> tuple[bool, dict]:
    """Tiêu chí spec 2026-09-22 D7 cho MỘT cỡ bàn, đọc một file `ai:benchmark`."""
    sys.path.insert(0, str(TRAIN_DIR))
    from rl_loop import score_of

    b = json.loads(bench.read_text(encoding="utf8"))
    by = {s["setup"]: s["villageWinMean"] for s in b["summary"]}
    village, wolves = score_of(bench, "village"), score_of(bench, "wolves")
    imbalance, base = abs(by["all"] - 0.5) * 100, abs(by["baseline"] - 0.5) * 100
    violations = sum(r["violations"] for r in b["rows"])
    checks = {
        "không phe nào < heuristic − 1": min(village, wolves) >= -1.0,
        "một phe ≥ heuristic + 2": max(village, wolves) >= 2.0,
        f"cân bằng ≤ heuristic ({base:.1f}) + 2": imbalance <= base + 2.0,
        "0 vi phạm": violations == 0,
    }
    if size == 8:
        h2h = b.get("paired", {})
        checks["đối đầu ppo-0001 mỗi phe ≥ −1"] = (
            "h2h-village" in h2h and "h2h-wolves" in h2h
            and h2h["h2h-village"]["mean"] >= -1.0 and h2h["h2h-wolves"]["mean"] >= -1.0
        )
    return all(checks.values()), {"village": village, "wolves": wolves, "imbalance": imbalance,
                                  "baseImbalance": base, "violations": violations, "checks": checks}


def confirm_m(rl: Path, deadline: float | None, model: Path | None = None) -> list[int]:
    """Confirm dự án M: từng cỡ bàn, in bảng đạt/trượt và `tableSizes` để đóng gói."""
    cand = model or candidate(rl)
    if cand is None:
        raise SystemExit("chưa có lượt chạy nào thăng hạng - không có gì để xác nhận")
    tag = "candidate" if model is None else "_".join(Path(cand).resolve().parts[-3:])
    npm = shutil.which("npm") or "npm"
    results: dict[int, tuple[bool, dict]] = {}
    for n in M_SIZES:
        dest = rl / f"confirm-m-{tag}-p{n}.json"
        extra = (["--opponent", PPO1, "--setups", "baseline,village,wolves,all,h2h-village,h2h-wolves,opponent"]
                 if n == 8 else ["--setups", "baseline,village,wolves,all"])
        if not dest.exists():
            run_logged([npm, "run", "ai:benchmark", "--", "--model", cand, "--players", n, *CONFIRM_M, *extra,
                        "--out", dest], rl / "confirm-m.log", cwd=ROOT, deadline=deadline)
        results[n] = judge_size(dest, n)
    print("=" * 72)
    print(f"{'cỡ':>3} {'làng':>7} {'sói':>7} {'lệch':>6} {'heur':>6} {'vp':>3}  kết quả")
    for n, (ok, d) in results.items():
        failed = [k for k, v in d["checks"].items() if not v]
        print(f"{n:>3} {d['village']:>+7.2f} {d['wolves']:>+7.2f} {d['imbalance']:>6.2f} "
              f"{d['baseImbalance']:>6.2f} {d['violations']:>3}  {'ĐẠT' if ok else 'TRƯỢT: ' + '; '.join(failed)}")
    passed = [n for n, (ok, _) in results.items() if ok]
    print("tableSizes:", passed)
    print("VERDICT:", "PASS" if 8 in passed else ("PARTIAL (trượt bàn 8 - xem spec D8)" if passed else "FAIL"))
    print("candidate:", cand)
    print("=" * 72)
    return passed
```

Trong `run_stage`, nhánh `confirm`:

```python
        if stage == "confirm":
            {"a": confirm, "b": confirm_b, "m": confirm_m}[PROJECT](rl, deadline, model)
            return "gửi khối VERDICT cho Claude"
```

`main()`: `choices=("a", "b", "m")`, help thêm `m = spec 2026-09-22 (bàn 8–12)`. Docstring đầu file thêm ví dụ `rl_stages.py --project m village`.

- [ ] **Step 5: Notebook local**

Chỉ sửa chú thích dòng `PROJECT = "a"` trong `ai-training/colab/train_rl_local.ipynb` bằng script JSON giữ output (mẫu: xem cách Task 7 của plan 2026-09-19 sửa notebook):

```python
edit('PROJECT = "a"          # a = spec 2026-09-17 | b = spec 2026-09-19 (vote history)',
     'PROJECT = "a"          # a = spec 2026-09-17 | b = spec 2026-09-19 | m = spec 2026-09-22 (bàn 8–12)')
```

Nếu chuỗi cũ không khớp đúng (người dùng đã sửa), tìm dòng bắt đầu bằng `PROJECT =` và chỉ thay phần chú thích sau `#`.

- [ ] **Step 6: Chạy test + commit**

```bash
cd /d/Source/ma-soi-online/ai-training
PYTHONUTF8=1 .venv/Scripts/python.exe tests/test_rl_stages.py | tail -1
PYTHONUTF8=1 .venv/Scripts/python.exe rl_stages.py --project m status | tail -1
cd .. && git add ai-training/rl_stages.py ai-training/tests/test_rl_stages.py ai-training/colab/train_rl_local.ipynb
git commit -m "feat(rl): rl_stages --project m (8-12 players, per-size balance gate on wolves, per-size confirm with tableSizes)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Expected: `ok`; `>>> NEXT: village`.

---

### Task 7: Notebook Kaggle gọi `rl_stages`

**Files:**
- Modify: `ai-training/colab/train_rl_kaggle.ipynb`

**Interfaces:**
- Consumes: `rl_stages.py --project {a,b,m} <stage> --rl-dir <dir> --budget-hours <h>` (có sẵn + Task 6).
- Produces: notebook có ô cấu hình `PROJECT`, `STAGE`, `BUDGET_HOURS`; ô chạy duy nhất gọi `rl_stages`.

Hiện notebook tự chép lại logic stage (cells "## 2. Helpers" trở đi: `CHAMPION0`, `COMMON`, `run_logged`, các ô stage). Nhân bản đó là lý do nó chỉ chạy được dự án A. Giữ nguyên các ô: 0 (markdown hướng dẫn), 1 (cấu hình), "## 0. Code, Node.js, dependencies" + ô code của nó, "## 1. Restore the previous version's runs" + ô code của nó. Thay MỌI ô từ "## 2. Helpers" tới hết bằng hai ô dưới.

- [ ] **Step 1: Sửa ô cấu hình**

Ô 1: thay khối chú thích + `STAGE = "village"` bằng:

```python
# ======================= EDIT THIS CELL, then "Save Version" → "Save & Run All" =======================
# PROJECT: "m" = bàn 8–12 người (spec 2026-09-22) | "a" = bàn 8 (spec 2026-09-17) | "b" = spec 2026-09-19 (đã đóng)
# One stage per version (the last cell prints which one to run next):
#   "village"      20 iterations, village side
#   "village-lr3"  only if "village" never promoted
#   "wolves"       20 iterations, wolves side, from the village champion
#   "wolves-lr3"   only if "wolves" never promoted
#   "confirm"      fresh-seed benchmark of the final candidate + VERDICT
#   "status"       print what is done, change nothing
PROJECT = "m"
STAGE = "village"
```

`BUDGET_HOURS = 11.0` giữ nguyên.

- [ ] **Step 2: Thay các ô stage**

Markdown: `## 2. Run the stage`, rồi ô code:

```python
# Same runner as local (ai-training/rl_stages.py): same run folders, flags, resume and
# time budget. The remaining budget is passed down so the version ends before 12 h and
# Kaggle saves /kaggle/working (the rl/ folder) as this version's output.
remaining = max(0.2, (DEADLINE - time.time()) / 3600)
cmd = [sys.executable, str(TRAIN_DIR / "rl_stages.py"), "--project", PROJECT, STAGE,
       "--rl-dir", str(RL), "--budget-hours", f"{remaining:.2f}"]
print("$", " ".join(cmd), flush=True)
done = subprocess.run(cmd, cwd=str(ROOT), env={**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"})
print(f"\nexit {done.returncode} | elapsed {(time.time() - T0) / 3600:.1f} h")
```

Markdown cuối: `## 3. Next\n\nThe last lines above print \`>>> NEXT:\`. Set \`STAGE\` to it, attach THIS version's output as input, and run a new version.`

Sửa bằng script JSON (giữ metadata notebook; output các ô cũ bỏ đi là đúng vì ô bị thay).

- [ ] **Step 3: Cập nhật markdown ô 0**

Trong ô 0: đổi dòng mở đầu thành `# Ma Soi — RL on Kaggle, headless (projects a / m)`, và mục "Each run" thành:

```
## Each run (one stage)

1. Set `PROJECT` and `STAGE` in the next cell (project `m` starts with `village`).
2. **Add Input** → *Your Work* → this notebook's PREVIOUS version (skip on the very first run).
3. **Save Version** → **Save & Run All**. Close the browser if you like.
4. When it finishes, open the version's log: the last lines print `>>> NEXT:` — the stage for the next version.
5. After `confirm`, copy the `VERDICT` block (with the `tableSizes:` line) to Claude.
```

Giữ nguyên mục "One-time setup" (tạo account, `git archive`, dataset, import notebook).

- [ ] **Step 4: Kiểm notebook hợp lệ + chạy thử ô chạy ở local**

```bash
cd /d/Source/ma-soi-online
PYTHONUTF8=1 python -c "import json;nb=json.load(open('ai-training/colab/train_rl_kaggle.ipynb',encoding='utf8'));print(len(nb['cells']),'cells');src=''.join(''.join(c['source']) for c in nb['cells']);assert 'rl_stages.py' in src and 'PROJECT = \"m\"' in src and 'COMMON = [' not in src"
PYTHONUTF8=1 ai-training/.venv/Scripts/python.exe ai-training/rl_stages.py --project m status --rl-dir "$SCRATCH/kaggle-rl" | tail -1
```

Expected: không `AssertionError`; `>>> NEXT: village`.

- [ ] **Step 5: Commit**

```bash
git add ai-training/colab/train_rl_kaggle.ipynb
git commit -m "feat(training): Kaggle notebook delegates to rl_stages (PROJECT/STAGE), runs project m

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Hướng dẫn chạy (người dùng) và đóng gói (agent, có điều kiện)

Không dispatch cho subagent: đây là các lần chạy của người dùng và bước đóng gói phụ thuộc số liệu chưa có.

- [ ] **Step 1: Dataset-0006 (người dùng, local ~1,5–2 giờ)**

```powershell
ai-training/.venv/Scripts/python.exe ai-training/make_dataset.py --players 8,9,10,11,12 --out .tmp/traj-m --enc .tmp/enc-m
```

Agent kiểm: `meta.json` có `"datasetVersion": "dataset-0006"`, `"tableSizes": [8, 9, 10, 11, 12]`; validate sạch; và (spec D2) tập có dòng của các vai mới cùng hành động `TRACK`:

```bash
cd ai-training && PYTHONUTF8=1 ./.venv/Scripts/python.exe -c "
import numpy as np
from masoi_training.data import load
d = load('../.tmp/enc-m'); roles = d.meta['roles']; kinds = d.meta['actionKinds']; slots = (d.action_size // len(kinds))
seen = {roles[i] for i in np.unique(d.roles)}
print('thiếu vai:', {'WOLF_CUB','CURSED','TRAITOR','MAYOR','TRACKER'} - seen)
print('dòng TRACK:', int((d.actions // slots == kinds.index('TRACK')).sum()))
print('dòng theo cỡ:', {int(n): int((d.table_sizes == n).sum()) for n in np.unique(d.table_sizes)})
"
```

Expected: `thiếu vai: set()`, `dòng TRACK` > 0, đủ năm cỡ.

- [ ] **Step 2: BC (người dùng)**

`train_bc_local.ipynb` ô "0. Environment": `DATA = ROOT / '.tmp' / 'enc-m'`, `OUT = ROOT / '.tmp' / 'model-m'`; chạy mục 1–4. Gửi `metrics.test.agreementTieAwareByTableSize`.

- [ ] **Step 3: Cổng BC (agent chạy)**

1. `agreementTieAwareByTableSize` ≥ 0,92 mỗi cỡ.
2. So heuristic mỗi cỡ (T=0):

```bash
for n in 8 9 10 11 12; do npx tsx apps/server/scripts/ai-benchmark.ts --model .tmp/model-m/model.weights.json --players $n --games 200 --repeat 3 --seed bc-m-$n --setups baseline,village,wolves --learned-decisions vote,night,final,hunter --out .tmp/bc-m-p$n.json; done
```

Mỗi cỡ: Δ làng và Δ sói trong ±2. LƯU Ý: file model thử này phải có `tableSizes` [8..12] (export ghi từ meta) — nếu thiếu, runtime chỉ hỏi model ở bàn 8 và số đo 9–12 là của heuristic.
3. Bàn 8 đối đầu bc-0003 (đã gỡ khỏi assets — lấy lại vào scratchpad):

```bash
git show 04360fb:apps/server/assets/models/village-bc-0003.weights.json > "$SCRATCH/bc-0003.json"
npx tsx apps/server/scripts/ai-benchmark.ts --model .tmp/model-m/model.weights.json --opponent "$SCRATCH/bc-0003.json" --players 8 --games 300 --repeat 5 --seed bc-m-h2h --setups baseline,h2h-village,h2h-wolves,opponent --out .tmp/bc-m-h2h.json
```

Mỗi phe ≥ −1. Đạt → đóng gói:

```bash
cd ai-training && PYTHONUTF8=1 ./.venv/Scripts/python.exe -c "
import json
w = json.load(open('../.tmp/model-m/model.weights.json', encoding='utf8'))
w['modelId'] = 'village-bc-0004'
w['tableSizes'] = [8, 9, 10, 11, 12]
json.dump(w, open('../apps/server/assets/models/village-bc-0004.weights.json', 'w', encoding='utf8'))
print('ok', w['format'], w['obsSize'], w['tableSizes'])
"
cd .. && git add apps/server/assets/models/village-bc-0004.weights.json
git commit -m "feat(bot): village-bc-0004 - BC clone on dataset-0006 (8-12 players)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Trượt → báo số liệu, dừng.

- [ ] **Step 4: RL (người dùng, local hoặc Kaggle)**

Local: `train_rl_local.ipynb` `PROJECT = "m"`, lần lượt `village` → `wolves` → `confirm` (hoặc `rl_stages.py --project m <stage>`).

Kaggle: đóng gói code SAU khi bc-0004 đã commit:

```powershell
git archive --format=zip HEAD -o .tmp\repo.zip -- . ":(exclude)apps/web/src"
```

Upload thành Dataset (private), import `ai-training/colab/train_rl_kaggle.ipynb`, Settings: CPU, Internet ON; `PROJECT = "m"`, `STAGE = "village"` → Save & Run All; mỗi phiên sau: Add Input = output phiên trước, đặt `STAGE` theo `>>> NEXT:`. Tải về thư mục `rl/` của phiên cuối vào `.tmp/rl/` nếu muốn xem tại local.

- [ ] **Step 5: Đóng gói theo VERDICT (agent)**

Chấm lại từng file `confirm-m-candidate-p{n}.json` bằng `rs.judge_size` (không tin bản in). Rồi:
- `PASS` (có 8): tạo `village-ppo-0002.weights.json` từ `candidate:` với `modelId` = `village-ppo-0002`, `tableSizes` = danh sách in ra; cập nhật `apps/server/tests/learned-policy.test.ts` (tên file, modelId), `.env.example`, `deploy/env.production.example`, chú thích `apps/server/src/bots/learned-policy.ts`; ghi mục Kết quả vào spec; `cd apps/server && npx vitest run`; commit `feat(bot): ship village-ppo-0002 (8-12 players, tableSizes …)`.
- `PARTIAL`: ghi Kết quả vào spec, đề xuất D8 (`BOT_POLICY_FILES`) cho người dùng; KHÔNG ship.
- `FAIL`: ghi Kết quả, giữ ppo-0001.

- [ ] **Step 6: Dừng trước deploy**

Không push, không PR, không đổi env production khi chưa được duyệt. Deploy: code lên VPS TRƯỚC, rồi mới đổi `BOT_POLICY_FILE` trong `/opt/masoi/.env`.
