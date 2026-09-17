# RL PPO từ bản sao BC — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chạy PPO trên logits thuần xuất phát từ `village-bc-0002` để mỗi phe mạnh hơn heuristic ≥ +2 điểm mà không làm lệch cân bằng phe, rồi đóng gói `village-ppo-0001`.

**Architecture:** Vá bốn chỗ trước khi chạy: guard ghi `learned` cho FINAL_VOTE (engine), cờ `--learned-decisions` cho `selfplay.ts` (parser dùng chung với `ai-benchmark.ts`), hai cổng thăng hạng mới trong `rl_loop.py` (cân bằng, không tụt phe kia), và truyền cờ bốn lượt xuống mọi rollout/benchmark. Sau đó chạy `rl_loop.py` theo năm giai đoạn trên CPU local.

**Tech Stack:** TypeScript (vitest, tsx) cho engine/scripts; Python 3 + PyTorch CPU (`ai-training/.venv`) cho PPO và vòng lặp; test Python là script `assert` chạy bằng `python tests/<file>.py`.

**Spec:** `docs/superpowers/specs/2026-09-17-rl-ppo-from-bc-design.md`

## Global Constraints

- Model xuất phát: `apps/server/assets/models/village-bc-0002.weights.json` (masoi-mlp-2). Không residual.
- Lượt policy trong rollout và benchmark: `vote,night,final,hunter` (mặc định của `rl_loop.py --learned-decisions`).
- Ngưỡng thăng hạng: `--promote-margin 2`, trên HAI bộ seed (`rl-bench` + `--confirm-seed rl-conf`).
- Cổng cân bằng: `imbalance = |villageWinMean(all) − 0,5| × 100`; challenger ≤ champion + `--balance-slack` (mặc định 1,0; âm = tắt).
- Cổng phe kia (chỉ `--side village|wolves`): `score_of(challenger, phe_kia) ≥ score_of(champion, phe_kia) − --other-side-slack` (mặc định 1,0; âm = tắt).
- Siêu tham số chung giai đoạn 1–3: `--temperature 1 --lr 1e-4 --target-kl 0.01 --shaping-alpha 1 --baseline role`.
- Máy: i5-10300H 4 lõi/8 luồng, CPU-only. KHÔNG đưa rollout lên GitHub Actions.
- KHÔNG ghi đè `apps/server/assets/models/village-bc-0002.weights.json`; model mới là file mới.
- Train do NGƯỜI DÙNG chạy qua `ai-training/colab/train_bc_local.ipynb` mục 6; agent không tự chạy `rl_loop.py` giai đoạn 0–4.
- Mọi chạy Python trong `ai-training/`: `PYTHONUTF8=1 ./.venv/Scripts/python.exe ...` (Git Bash).
- Commit message kết thúc bằng dòng `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File Structure

| File | Trách nhiệm | Task |
|---|---|---|
| `packages/game-engine/src/bot/BotRuntime.ts` | Guard ghi `learned` cho FINAL_VOTE | 1 |
| `packages/game-engine/tests/bot-learned-policy.test.ts` | Test rollout FINAL_VOTE/HUNTER_SHOT mang `learned` | 1 |
| `apps/server/scripts/learned-decisions.ts` (mới) | Parse `--learned-decisions` — một nguồn cho mọi script | 2 |
| `apps/server/tests/learned-decisions.test.ts` (mới) | Test parser | 2 |
| `apps/server/scripts/ai-benchmark.ts` | Dùng parser chung | 2 |
| `apps/server/scripts/selfplay.ts` | Cờ `--learned-decisions` | 2 |
| `ai-training/rl_loop.py` | `imbalance_of`, `BenchRead`, `read_bench`, `champion_of`, `passes_gates`, `champion_from_state`, `bench_cmd`, `rollout_cmd`; nối vào `main` | 3, 4 |
| `ai-training/tests/test_rl_gates.py` (mới) | Test cổng + state + lệnh | 3, 4 |
| `docs/BOT_SELF_LEARNING_TRAINING.md` | Mục cổng mới + lệnh chạy | 4 |
| `ai-training/colab/train_bc_local.ipynb` | Mục 6: các cell chạy giai đoạn 0–4 | 5 |
| `apps/server/assets/models/village-ppo-0001.weights.json` (mới, có điều kiện) | Model đóng gói | 7 |

---

### Task 0: Nhánh mới từ `origin/main` mang thay đổi runtime hôm nay

Thay đổi cờ `"hunter"` + `seats: "all"` hiện là working tree CHƯA commit trên `feat/gameplay` (nhánh này sau `origin/main` 13 commit). Spec và plan là commit trên `feat/gameplay`.

**Files:**
- Modify: `deploy/env.production.example:52`
- Commit (đang ở working tree): `.env.example`, `apps/server/scripts/ai-benchmark.ts`, `apps/server/src/bots/learned-policy.ts`, `apps/server/tests/learned-policy.test.ts`, `packages/game-engine/src/bot/BotRuntime.ts`, `packages/game-engine/src/bot/decision/trial-decision.ts`, `packages/game-engine/src/bot/policy/learned-policy.ts`, `packages/game-engine/tests/bot-final-vote-action-space.test.ts`

**Interfaces:**
- Produces: nhánh `feat/rl-ppo-from-bc` có `LearnedDecision = "vote" | "night" | "final" | "hunter"`, `selectLearnedHunterShot`, production `seats: "all"` + `learnedDecisions: ["vote","night","final","hunter"]`, cùng spec + plan.

- [ ] **Step 1: Cất thay đổi runtime, tạo nhánh, mang spec + plan sang**

```bash
cd /d/Source/ma-soi-online
git stash push -m runtime-hunter -- .env.example apps/server/scripts/ai-benchmark.ts apps/server/src/bots/learned-policy.ts apps/server/tests/learned-policy.test.ts packages/game-engine/src/bot/BotRuntime.ts packages/game-engine/src/bot/decision/trial-decision.ts packages/game-engine/src/bot/policy/learned-policy.ts packages/game-engine/tests/bot-final-vote-action-space.test.ts
git fetch origin
git switch -c feat/rl-ppo-from-bc origin/main
# b4fedd6 = commit cuối của feat/gameplay đã merge vào main (PR #113); mọi
# commit sau nó trên feat/gameplay là spec + plan của dự án này.
git log --oneline b4fedd6..feat/gameplay
git cherry-pick b4fedd6..feat/gameplay
git stash pop
```

Expected: `stash pop` không conflict. Nếu conflict: giữ phía stash cho tám file trên (đó là thay đổi mới), `git add` từng file, `git stash drop`.

- [ ] **Step 2: Sửa model trong env mẫu production**

Trong `deploy/env.production.example` thay dòng:

```
BOT_POLICY_FILE=apps/server/assets/models/village-bc-0001.weights.json
```

bằng:

```
BOT_POLICY_FILE=apps/server/assets/models/village-bc-0002.weights.json
```

- [ ] **Step 3: Build + test toàn bộ**

```bash
cd /d/Source/ma-soi-online && npm run build:deps
cd packages/game-engine && npx tsc --noEmit -p . && npx vitest run
cd ../../apps/server && npx vitest run
```

Expected: engine 5265+ passed, server 1174+ passed, tsc không lỗi.

- [ ] **Step 4: Commit**

```bash
cd /d/Source/ma-soi-online
git add .env.example deploy/env.production.example apps/server/scripts/ai-benchmark.ts apps/server/src/bots/learned-policy.ts apps/server/tests/learned-policy.test.ts packages/game-engine/src/bot/BotRuntime.ts packages/game-engine/src/bot/decision/trial-decision.ts packages/game-engine/src/bot/policy/learned-policy.ts packages/game-engine/tests/bot-final-vote-action-space.test.ts
git commit -m "feat(bot): learned policy for whole table incl. final vote and hunter shot

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 1: Guard ghi `learned` cho FINAL_VOTE (spec D6)

**Files:**
- Modify: `packages/game-engine/src/bot/BotRuntime.ts` (khối `finish` trong `beginTracedDecision`, đoạn comment "Giới hạn đã biết (spec 2026-09-14 v2…)" ≈ dòng 770–780)
- Test: `packages/game-engine/tests/bot-learned-policy.test.ts`

**Interfaces:**
- Consumes: `FINAL_ACTION_KIND` (đã import từ `./learning/observation`), `FINAL_VOTE_GUILTY_LABEL` (đã import từ `./decision/trial-decision`).
- Produces: trace FINAL_VOTE do policy quyết mang `chosen.learned`; trajectory tương ứng có `learned` và `encodeObservation(line).actionIndex === line.learned.actionIndex`.

- [ ] **Step 1: Viết test lỗi**

Thêm import ở đầu `packages/game-engine/tests/bot-learned-policy.test.ts` (sửa dòng `import { isWolfPack } from "@masoi/shared";`):

```ts
import { isWolfPack, PRESET_DECKS } from "@masoi/shared";
```

Thêm test vào cuối `describe("lấy mẫu có nhiệt độ (rollout RL)", …)`, ngay sau test `"rollout: T=1 ghi learned{actionIndex,logProb,value} …"`:

```ts
  it("rollout cờ final+hunter: FINAL_VOTE và HUNTER_SHOT mang learned, nhãn encoder khớp", () => {
    // Policy đều: mọi ô bằng nhau, T=1 lấy mẫu → cả treo lẫn tha, bắn lẫn không.
    const uniform: LearnedPolicy = {
      id: "uniform",
      logits: () => new Array<number>(actionSize()).fill(0),
      value: () => null,
    };
    const seen = new Set<string>();
    // Preset 8 người có Thợ Săn; defense bật phiên toà. Đo 2026-09-17: 10 ván
    // cho 378 lượt FINAL_VOTE và 5 lượt HUNTER_SHOT, nên 40 ván là dư.
    for (let i = 0; i < 40 && seen.size < 2; i += 1) {
      const game = runSelfPlay({
        seed: `rl-fh-${i}`,
        playerCount: 8,
        maxRounds: 20,
        trace: true,
        defense: true,
        config: PRESET_DECKS[8],
        learnedPolicy: uniform,
        learnedTemperature: 1,
        learnedDecisions: ["final", "hunter"],
      });
      for (const line of gameToTrajectories(game).filter((l) => l.learned)) {
        expect(["FINAL_VOTE", "HUNTER_SHOT"]).toContain(line.decision);
        expect(encodeObservation(line).actionIndex).toBe(line.learned!.actionIndex);
        seen.add(line.decision);
      }
    }
    expect([...seen].sort()).toEqual(["FINAL_VOTE", "HUNTER_SHOT"]);
  });
```

- [ ] **Step 2: Chạy test, xác nhận lỗi**

```bash
cd /d/Source/ma-soi-online/packages/game-engine
npx vitest run tests/bot-learned-policy.test.ts -t "final+hunter"
```

Expected: FAIL — `expected [ 'HUNTER_SHOT' ] to deeply equal [ 'FINAL_VOTE', 'HUNTER_SHOT' ]`.

- [ ] **Step 3: Sửa guard**

Trong `packages/game-engine/src/bot/BotRuntime.ts` thay khối:

```ts
        // Giới hạn đã biết (spec 2026-09-14 v2 phải sửa trước rollout): hai
        // nước FINAL cùng `targetId` (bị cáo) và `kind` ở đây tính ra "CHOOSE",
        // nên một pick FINAL không bao giờ khớp guard này và rollout PPO bỏ
        // qua hàng FINAL (fail-closed — v1 không hỏng gì, nhưng v2 muốn học
        // phiên toà thì phải sửa guard này trước).
        if (learnedPick && learnedDecided) {
          const kind = decision === "NIGHT" ? (actionKind ?? "SKIP") : DAY_ACTION_KIND;
          if (kind === learnedDecided.kind && targetId === learnedDecided.targetId) {
            chosen.learned = learnedPick;
          }
        }
```

bằng:

```ts
        //
        // Phiên toà: hai nước FINAL cùng `targetId` (bị cáo), phân biệt bằng
        // `label`. Policy nói "treo" khi `learnedDecided.targetId` khác null
        // (spec 2026-09-17 D6) — so theo đó, không theo `targetId`.
        if (learnedPick && learnedDecided) {
          if (decision === "FINAL_VOTE") {
            const pickedGuilty = learnedDecided.targetId !== null;
            if (
              learnedDecided.kind === FINAL_ACTION_KIND &&
              pickedGuilty === (label === FINAL_VOTE_GUILTY_LABEL)
            ) {
              chosen.learned = learnedPick;
            }
          } else {
            const kind = decision === "NIGHT" ? (actionKind ?? "SKIP") : DAY_ACTION_KIND;
            if (kind === learnedDecided.kind && targetId === learnedDecided.targetId) {
              chosen.learned = learnedPick;
            }
          }
        }
```

(Giữ nguyên các dòng comment phía trên khối, bắt đầu bằng "Chỉ ghi khi nước policy đề xuất CHÍNH LÀ nước đã đi".)

- [ ] **Step 4: Chạy test, xác nhận qua; chạy cả suite engine**

```bash
npx vitest run tests/bot-learned-policy.test.ts -t "final+hunter"
npx tsc --noEmit -p . && npx vitest run
```

Expected: test mới PASS; toàn suite PASS.

- [ ] **Step 5: Commit**

```bash
cd /d/Source/ma-soi-online
git add packages/game-engine/src/bot/BotRuntime.ts packages/game-engine/tests/bot-learned-policy.test.ts
git commit -m "fix(bot): record learned pick on FINAL_VOTE so PPO rollouts include trial rows

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Parser `--learned-decisions` dùng chung + cờ cho `selfplay.ts` (spec D2)

**Files:**
- Create: `apps/server/scripts/learned-decisions.ts`
- Create: `apps/server/tests/learned-decisions.test.ts`
- Modify: `apps/server/scripts/ai-benchmark.ts` (nhánh `else if (a === "--learned-decisions")` trong `parseArgs`)
- Modify: `apps/server/scripts/selfplay.ts` (import, `interface Options`, `usage`, `parseArgs`, object `batch` trong `main`)

**Interfaces:**
- Consumes: type `LearnedDecision`, `LearnedDecisions` từ `@masoi/game-engine`.
- Produces: `export function parseLearnedDecisions(value: string): LearnedDecisions` — `"both"` → `"both"`; CSV hợp lệ một phần tử → chuỗi; nhiều phần tử → mảng không trùng, giữ thứ tự xuất hiện; rỗng → ném `"--learned-decisions rỗng"`; tên lạ → ném thông báo chứa `vote | night | final | hunter | both`. `selfplay.ts --learned-decisions <v>` truyền kết quả vào `SelfPlayBatchInput.learnedDecisions`.

- [ ] **Step 1: Viết test lỗi**

Tạo `apps/server/tests/learned-decisions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseLearnedDecisions } from "../scripts/learned-decisions";

/**
 * Một parser cho `--learned-decisions` của mọi script (spec 2026-09-17 D2):
 * rollout và benchmark đọc lệch nhau là đo một cấu hình, train một cấu hình
 * khác — và không có dòng log nào than.
 */
describe("parseLearnedDecisions", () => {
  it("both giữ nguyên alias", () => {
    expect(parseLearnedDecisions("both")).toBe("both");
  });

  it("một cờ → chuỗi; nhiều cờ → mảng không trùng, đúng thứ tự", () => {
    expect(parseLearnedDecisions("final")).toBe("final");
    expect(parseLearnedDecisions("vote, night,final,hunter")).toEqual([
      "vote",
      "night",
      "final",
      "hunter",
    ]);
    expect(parseLearnedDecisions("hunter,vote,hunter")).toEqual(["hunter", "vote"]);
  });

  it("rỗng hoặc chỉ dấu phẩy → ném", () => {
    expect(() => parseLearnedDecisions("")).toThrow("--learned-decisions rỗng");
    expect(() => parseLearnedDecisions(" , ")).toThrow("--learned-decisions rỗng");
  });

  it("tên lạ → ném, liệt kê giá trị hợp lệ", () => {
    expect(() => parseLearnedDecisions("vote,speech")).toThrow(
      "vote | night | final | hunter | both",
    );
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận lỗi**

```bash
cd /d/Source/ma-soi-online/apps/server
npx vitest run tests/learned-decisions.test.ts
```

Expected: FAIL — không resolve được `../scripts/learned-decisions`.

- [ ] **Step 3: Viết parser**

Tạo `apps/server/scripts/learned-decisions.ts`:

```ts
import type { LearnedDecision, LearnedDecisions } from "@masoi/game-engine";

const FLAGS: readonly LearnedDecision[] = ["vote", "night", "final", "hunter"];

/**
 * `--learned-decisions` của mọi script: `both` (= vote+night, alias cũ) hoặc
 * CSV trong `vote,night,final,hunter`.
 *
 * Một nguồn duy nhất vì `rl_loop.py` truyền CÙNG một chuỗi cho rollout
 * (`selfplay.ts`) lẫn benchmark (`ai-benchmark.ts`); hai parser lệch nhau là
 * train một cấu hình rồi đo một cấu hình khác (spec 2026-09-17 D2).
 */
export function parseLearnedDecisions(value: string): LearnedDecisions {
  if (value === "both") return "both";
  const flags = value
    .split(",")
    .map((flag) => flag.trim())
    .filter((flag) => flag !== "");
  if (flags.length === 0) throw new Error("--learned-decisions rỗng");
  for (const flag of flags) {
    if (!(FLAGS as readonly string[]).includes(flag)) {
      throw new Error(
        `--learned-decisions cần ${FLAGS.join(" | ")} | both (cách nhau bằng dấu phẩy), nhận "${value}"`,
      );
    }
  }
  const unique = [...new Set(flags as LearnedDecision[])];
  return unique.length === 1 ? unique[0]! : unique;
}
```

- [ ] **Step 4: Chạy test, xác nhận qua**

```bash
npx vitest run tests/learned-decisions.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: `ai-benchmark.ts` dùng parser chung**

Thêm import sau dòng `import { PRESET_DECKS } from "@masoi/shared";`:

```ts
import { parseLearnedDecisions } from "./learned-decisions";
```

Thay nguyên khối này trong `parseArgs`:

```ts
    } else if (a === "--learned-decisions") {
      const value = next();
      // Tập cờ (spec 2026-09-14 D6): ablation một-lượt-một ("final" riêng)
      // không được bật lẫn vote/night — điều mà union cũ làm im lặng.
      if (value === "both") {
        o.learnedDecisions = "both";
      } else {
        const flags = value
          .split(",")
          .map((flag) => flag.trim())
          .filter((flag) => flag !== "");
        for (const flag of flags) {
          if (flag !== "vote" && flag !== "night" && flag !== "final" && flag !== "hunter") {
            throw new Error(
              `--learned-decisions cần vote | night | final | hunter | both (cách nhau bằng dấu phẩy), nhận "${value}"`,
            );
          }
        }
        if (flags.length === 0) throw new Error("--learned-decisions rỗng");
        const valid = flags as Array<"vote" | "night" | "final" | "hunter">;
        o.learnedDecisions = valid.length === 1 ? valid[0]! : [...new Set(valid)];
      }
```

bằng:

```ts
    } else if (a === "--learned-decisions") {
      // Tập cờ (spec 2026-09-14 D6); parser chung với selfplay (spec 2026-09-17 D2).
      o.learnedDecisions = parseLearnedDecisions(next());
```

- [ ] **Step 6: Cờ `--learned-decisions` cho `selfplay.ts`**

(a) Trong khối import `@masoi/game-engine`, thêm sau `type BotWeights,`:

```ts
  type LearnedDecisions,
```

và thêm dòng import sau `import { PRESET_DECKS, type RoomConfig } from "@masoi/shared";`:

```ts
import { parseLearnedDecisions } from "./learned-decisions";
```

(b) Trong `interface Options`, sau `learnedSeats: LearnedSeats;`:

```ts
  /** Lượt giao cho policy. Xem `SelfPlayInput.learnedDecisions`. Mặc định `"both"`. */
  learnedDecisions: LearnedDecisions;
```

(c) Trong `usage()`, sau dòng `"  --learned-seats <s> all | village | wolves (mặc định all)",`:

```ts
    "  --learned-decisions <d> both | CSV trong vote,night,final,hunter (mặc định both)",
```

(d) Trong object mặc định của `parseArgs`, sau `learnedSeats: "all",`:

```ts
    learnedDecisions: "both",
```

(e) Trong `switch` của `parseArgs`, ngay trước `case "--quiet":`:

```ts
      case "--learned-decisions":
        options.learnedDecisions = parseLearnedDecisions(argv[++i] ?? "");
        break;
```

(f) Trong `main`, object `batch`, thay:

```ts
          learnedSeats: options.learnedSeats,
          learnedTemperature: options.temperature,
```

bằng:

```ts
          learnedSeats: options.learnedSeats,
          learnedTemperature: options.temperature,
          learnedDecisions: options.learnedDecisions,
```

- [ ] **Step 7: Kiểm tra chạy thật cả hai script**

```bash
cd /d/Source/ma-soi-online
npx tsx apps/server/scripts/selfplay.ts --games 2 --players 8 --preset --defense --policy apps/server/assets/models/village-bc-0002.weights.json --temperature 1 --learned-decisions vote,night,final,hunter --trajectories .tmp/probe-ld --trace-games 2 --quiet > /dev/null
grep -c '"decision":"FINAL_VOTE".*"learned"' .tmp/probe-ld/trajectories.jsonl
npx tsx apps/server/scripts/selfplay.ts --learned-decisions speech 2>&1 | head -2
npm run ai:benchmark -- --model apps/server/assets/models/village-bc-0002.weights.json --games 20 --repeat 1 --setups baseline,all --learned-decisions vote,night,final,hunter 2>&1 | tail -3
cd apps/server && npx vitest run
```

Expected: `grep -c` in ra số > 0; lệnh `speech` in lỗi chứa `vote | night | final | hunter | both`; benchmark in dòng `Δ cả bàn học được`; suite server PASS.

Nếu `grep -c` in 0 do thứ tự khoá JSON, dùng:

```bash
node -e "const l=require('fs').readFileSync('.tmp/probe-ld/trajectories.jsonl','utf8').trim().split('\n').map(JSON.parse);console.log(l.filter(x=>x.decision==='FINAL_VOTE'&&x.learned).length)"
```

- [ ] **Step 8: Commit**

```bash
cd /d/Source/ma-soi-online
git add apps/server/scripts/learned-decisions.ts apps/server/tests/learned-decisions.test.ts apps/server/scripts/ai-benchmark.ts apps/server/scripts/selfplay.ts
git commit -m "feat(scripts): shared --learned-decisions parser, selfplay flag

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Cổng cân bằng và cổng phe kia trong `rl_loop.py` (spec D3, D4)

**Files:**
- Modify: `ai-training/rl_loop.py` (thêm hàm thuần sau `should_promote`)
- Create: `ai-training/tests/test_rl_gates.py`

**Interfaces:**
- Consumes: `score_of(bench_json: Path, side: str) -> float`, `should_promote(scores: list[float], champion: float, margin: float) -> bool` (đã có).
- Produces:
  - `OTHER_SIDE: dict[str, str]` = `{"village": "wolves", "wolves": "village"}`
  - `imbalance_of(bench_json: Path) -> float`
  - `@dataclass(frozen=True) class BenchRead: score: float; other: float | None; imbalance: float`
  - `read_bench(bench_json: Path, side: str) -> BenchRead`
  - `champion_of(reads: list[BenchRead]) -> BenchRead` — score = min, other = min (None nếu mọi other None), imbalance = max
  - `passes_gates(reads: list[BenchRead], champion: BenchRead, margin: float, balance_slack: float, other_slack: float) -> bool`

- [ ] **Step 1: Viết test lỗi**

Tạo `ai-training/tests/test_rl_gates.py`:

```python
"""Cổng thăng hạng mới (spec 2026-09-17 D3/D4). Chạy: python tests/test_rl_gates.py

Model logits thuần là MỘT bộ trọng số cho cả hai phe: train cho làng có thể
kéo sói xuống, và một model mạnh lên có thể đẩy cả bàn lệch khỏi 50 %. Hai cổng
này chặn đúng hai kiểu thăng hạng đó.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rl_loop import (  # noqa: E402
    BenchRead,
    champion_of,
    imbalance_of,
    passes_gates,
    read_bench,
)


def write_bench(path: Path, baseline: float, village: float, wolves: float, all_: float | None) -> Path:
    summary = [
        {"setup": "baseline", "villageWinMean": baseline},
        {"setup": "village", "villageWinMean": village},
        {"setup": "wolves", "villageWinMean": wolves},
    ]
    if all_ is not None:
        summary.append({"setup": "all", "villageWinMean": all_})
    path.write_text(json.dumps({"summary": summary}), encoding="utf8")
    return path


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)

        # imbalance đọc cấu hình `all`, theo điểm phần trăm, đối xứng quanh 50 %.
        b = write_bench(root / "a.json", 0.54, 0.56, 0.54, 0.558)
        assert abs(imbalance_of(b) - 5.8) < 1e-9, imbalance_of(b)
        b2 = write_bench(root / "b.json", 0.54, 0.56, 0.54, 0.44)
        assert abs(imbalance_of(b2) - 6.0) < 1e-9, imbalance_of(b2)

        # Thiếu `all` → ném, không trả 0 im lặng.
        missing = write_bench(root / "c.json", 0.54, 0.56, 0.54, None)
        try:
            imbalance_of(missing)
        except ValueError as error:
            assert "all" in str(error)
        else:
            raise AssertionError("imbalance_of phải ném khi thiếu cấu hình all")

        # read_bench: village → other là điểm phe sói; all → other None.
        r = read_bench(b, "village")
        assert abs(r.score - 2.0) < 1e-9 and r.other is not None and abs(r.other - 0.0) < 1e-9, r
        assert read_bench(b, "all").other is None

    champ = BenchRead(score=0.0, other=0.0, imbalance=5.8)

    # Qua cả ba cổng.
    good = [BenchRead(3.0, -0.5, 6.5), BenchRead(2.5, 0.2, 6.0)]
    assert passes_gates(good, champ, margin=2.0, balance_slack=1.0, other_slack=1.0)

    # Điểm không đủ trên bộ xác nhận → chặn (cổng cũ vẫn đứng đầu).
    assert not passes_gates([BenchRead(3.0, 0.0, 5.0), BenchRead(1.9, 0.0, 5.0)], champ, 2.0, 1.0, 1.0)

    # Lệch cân bằng vượt champion + slack trên MỘT bộ seed → chặn.
    assert not passes_gates([BenchRead(3.0, 0.0, 6.9), BenchRead(3.0, 0.0, 5.0)], champ, 2.0, 1.0, 1.0)
    # Slack âm = tắt cổng cân bằng.
    assert passes_gates([BenchRead(3.0, 0.0, 30.0)], champ, 2.0, -1.0, 1.0)

    # Phe kia tụt quá slack → chặn; đúng bằng slack → qua.
    assert not passes_gates([BenchRead(3.0, -1.1, 5.0)], champ, 2.0, 1.0, 1.0)
    assert passes_gates([BenchRead(3.0, -1.0, 5.0)], champ, 2.0, 1.0, 1.0)
    # Slack âm = tắt cổng phe kia.
    assert passes_gates([BenchRead(3.0, -9.0, 5.0)], champ, 2.0, 1.0, -1.0)
    # --side all: champion.other None → bỏ qua cổng phe kia.
    assert passes_gates([BenchRead(3.0, None, 5.0)], BenchRead(0.0, None, 5.8), 2.0, 1.0, 1.0)

    # Champion mới lấy chiều bi quan trên mọi bộ seed.
    new = champion_of([BenchRead(3.0, -0.5, 6.5), BenchRead(2.5, 0.2, 6.0)])
    assert new == BenchRead(2.5, -0.5, 6.5), new
    assert champion_of([BenchRead(3.0, None, 6.5)]).other is None

    print("ok")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Chạy test, xác nhận lỗi**

```bash
cd /d/Source/ma-soi-online/ai-training
PYTHONUTF8=1 ./.venv/Scripts/python.exe tests/test_rl_gates.py
```

Expected: FAIL — `ImportError: cannot import name 'BenchRead' from 'rl_loop'`.

- [ ] **Step 3: Viết các hàm**

Trong `ai-training/rl_loop.py`, thêm vào khối import (sau `from concurrent.futures import ThreadPoolExecutor`):

```python
from dataclasses import dataclass
```

Thêm ngay SAU hàm `should_promote`:

```python
OTHER_SIDE = {"village": "wolves", "wolves": "village"}


def imbalance_of(bench_json: Path) -> float:
    """Độ lệch cân bằng cả bàn: |tỉ lệ làng thắng khi CẢ BÀN dùng model − 50 %|,
    bằng điểm phần trăm (spec 2026-09-17 D3). Thiếu cấu hình `all` thì ném: trả
    0 im lặng là một cổng luôn mở."""
    b = json.loads(bench_json.read_text(encoding="utf8"))
    by = {s.get("setup"): s["villageWinMean"] for s in b["summary"]}
    if "all" not in by:
        raise ValueError(f"{bench_json}: thiếu cấu hình all — benchmark phải chạy baseline,village,wolves,all")
    return abs(by["all"] - 0.5) * 100


@dataclass(frozen=True)
class BenchRead:
    """Ba con số một lần benchmark quyết định thăng hạng."""

    score: float
    """`score_of(bench, side)` — sức mạnh phe đang train."""
    other: float | None
    """`score_of(bench, phe kia)`; None khi `--side all` (score đã gồm hai phe)."""
    imbalance: float
    """`imbalance_of(bench)`."""


def read_bench(bench_json: Path, side: str) -> BenchRead:
    other = OTHER_SIDE.get(side)
    return BenchRead(
        score=score_of(bench_json, side),
        other=score_of(bench_json, other) if other else None,
        imbalance=imbalance_of(bench_json),
    )


def champion_of(reads: list[BenchRead]) -> BenchRead:
    """Điểm của champion mới = chiều BI QUAN trên mọi bộ seed đã đo: điểm và phe
    kia lấy min, lệch cân bằng lấy max — cùng tinh thần `min(scores)` cũ."""
    others = [r.other for r in reads if r.other is not None]
    return BenchRead(
        score=min(r.score for r in reads),
        other=min(others) if others else None,
        imbalance=max(r.imbalance for r in reads),
    )


def passes_gates(
    reads: list[BenchRead],
    champion: BenchRead,
    margin: float,
    balance_slack: float,
    other_slack: float,
) -> bool:
    """Thăng hạng khi MỌI bộ seed qua CẢ BA cổng: điểm (`should_promote`), cân
    bằng (D3) và phe kia (D4). Slack âm tắt cổng tương ứng."""
    if not should_promote([r.score for r in reads], champion.score, margin):
        return False
    if balance_slack >= 0 and any(r.imbalance > champion.imbalance + balance_slack for r in reads):
        return False
    if other_slack >= 0 and champion.other is not None:
        if any(r.other is None or r.other < champion.other - other_slack for r in reads):
            return False
    return True
```

- [ ] **Step 4: Chạy test mới và test cũ**

```bash
PYTHONUTF8=1 ./.venv/Scripts/python.exe tests/test_rl_gates.py
PYTHONUTF8=1 ./.venv/Scripts/python.exe tests/test_rl_loop.py
```

Expected: cả hai in `ok`.

- [ ] **Step 5: Commit**

```bash
cd /d/Source/ma-soi-online
git add ai-training/rl_loop.py ai-training/tests/test_rl_gates.py
git commit -m "feat(rl): balance and other-side promotion gates

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Nối cổng + cờ bốn lượt vào vòng lặp `rl_loop.py` (spec D2–D4)

**Files:**
- Modify: `ai-training/rl_loop.py` (thêm `champion_from_state`, `bench_cmd`, `rollout_cmd`; sửa `main`)
- Modify: `ai-training/tests/test_rl_gates.py`
- Modify: `docs/BOT_SELF_LEARNING_TRAINING.md` (cuối mục "### Mask loss theo luật…", trước "### Ngắt lúc nào cũng được")

**Interfaces:**
- Consumes: `BenchRead`, `read_bench`, `champion_of`, `passes_gates` (Task 3); `tool(name)`, `step(marker, cmd, cwd)`, `done_marker(dir, name)` (đã có).
- Produces:
  - `champion_from_state(state: dict, initial: BenchRead) -> BenchRead`
  - `bench_cmd(model: Path, seed: str, dest: Path, games: int, repeat: int, decisions: str) -> list[str]`
  - `rollout_cmd(source: Path, seats: str, iteration: int, part: Path, games: int, temperature: float, decisions: str) -> list[str]`
  - CLI `rl_loop.py`: `--learned-decisions` (mặc định `vote,night,final,hunter`), `--balance-slack` (1.0), `--other-side-slack` (1.0)
  - `state.json` thêm khoá `championOther`, `championImbalance`; mỗi hàng `scores` thêm `imbalance` và (khi có) `otherSide`.

- [ ] **Step 1: Viết test lỗi**

Trong `ai-training/tests/test_rl_gates.py`, sửa khối import thành:

```python
from rl_loop import (  # noqa: E402
    BenchRead,
    bench_cmd,
    champion_from_state,
    champion_of,
    imbalance_of,
    passes_gates,
    read_bench,
    rollout_cmd,
)
```

Thêm vào cuối `main()`, ngay trước `print("ok")`:

```python
    # State cũ (trước spec 2026-09-17) thiếu hai khoá mới → lấy từ bench champion-0000.
    initial = BenchRead(score=0.0, other=-0.3, imbalance=5.8)
    assert champion_from_state({"champion": None}, initial) == initial
    legacy = {"champion": "x.json", "championScore": 2.4}
    assert champion_from_state(legacy, initial) == BenchRead(2.4, -0.3, 5.8)
    full = {"champion": "x.json", "championScore": 2.4, "championOther": 0.1, "championImbalance": 6.2}
    assert champion_from_state(full, initial) == BenchRead(2.4, 0.1, 6.2)

    # Mọi lệnh rollout/benchmark mang cùng một cờ bốn lượt (D2).
    decisions = "vote,night,final,hunter"
    bench = bench_cmd(Path("m.json"), "rl-bench", Path("b.json"), 300, 3, decisions)
    assert bench[bench.index("--learned-decisions") + 1] == decisions, bench
    assert bench[bench.index("--setups") + 1] == "baseline,village,wolves,all", bench
    assert bench[bench.index("--seed") + 1] == "rl-bench", bench
    roll = rollout_cmd(Path("m.json"), "village", 3, Path("part"), 1000, 1.0, decisions)
    assert roll[roll.index("--learned-decisions") + 1] == decisions, roll
    assert roll[roll.index("--learned-seats") + 1] == "village", roll
    assert roll[roll.index("--seed") + 1] == "rl-3-village", roll
    assert roll[roll.index("--trace-games") + 1] == "1000", roll
```

- [ ] **Step 2: Chạy test, xác nhận lỗi**

```bash
cd /d/Source/ma-soi-online/ai-training
PYTHONUTF8=1 ./.venv/Scripts/python.exe tests/test_rl_gates.py
```

Expected: FAIL — `ImportError: cannot import name 'bench_cmd'`.

- [ ] **Step 3: Viết ba hàm**

Trong `ai-training/rl_loop.py`, thêm ngay SAU `passes_gates`:

```python
def champion_from_state(state: dict, initial: BenchRead) -> BenchRead:
    """Champion khôi phục từ `state.json`. State ghi trước spec 2026-09-17 thiếu
    `championOther`/`championImbalance`: lấy từ bench của champion-0000 thay vì
    vứt cả một đêm chạy."""
    if not state.get("champion"):
        return initial
    return BenchRead(
        score=state["championScore"],
        other=state.get("championOther", initial.other),
        imbalance=state.get("championImbalance", initial.imbalance),
    )


def bench_cmd(model: Path, seed: str, dest: Path, games: int, repeat: int, decisions: str) -> list[str]:
    """Lệnh benchmark DUY NHẤT của vòng lặp: champion-0000, mỗi challenger và bộ
    xác nhận đo đúng cùng cấu hình — kể cả lượt policy (D2)."""
    return [
        tool("npm"), "run", "ai:benchmark", "--", "--model", str(model),
        "--games", str(games), "--repeat", str(repeat),
        "--setups", "baseline,village,wolves,all",
        "--learned-decisions", decisions,
        "--seed", seed, "--out", str(dest),
    ]


def rollout_cmd(
    source: Path, seats: str, iteration: int, part: Path, games: int, temperature: float, decisions: str
) -> list[str]:
    return [
        tool("npx"), "tsx", "apps/server/scripts/selfplay.ts",
        "--games", str(games), "--players", "8", "--preset", "--defense",
        "--seed", f"rl-{iteration}-{seats}", "--policy", str(source),
        "--temperature", str(temperature), "--learned-seats", seats,
        "--learned-decisions", decisions,
        "--trajectories", str(part), "--trace-games", str(games), "--quiet",
    ]
```

- [ ] **Step 4: Chạy test, xác nhận qua**

```bash
PYTHONUTF8=1 ./.venv/Scripts/python.exe tests/test_rl_gates.py
```

Expected: `ok`.

- [ ] **Step 5: Thêm ba cờ CLI**

Trong `main()`, ngay sau dòng `p.add_argument("--lr", type=float, default=3e-4, help="Xem train_ppo --lr")`:

```python
    p.add_argument("--learned-decisions", default="vote,night,final,hunter", dest="learned_decisions",
                   help="Lượt giao cho policy trong rollout VÀ benchmark (spec 2026-09-17 D2)")
    p.add_argument("--balance-slack", type=float, default=1.0, dest="balance_slack",
                   help="Điểm lệch cân bằng |all − 50%%| challenger được hơn champion; âm = tắt (D3)")
    p.add_argument("--other-side-slack", type=float, default=1.0, dest="other_side_slack",
                   help="Điểm phe KHÔNG train được tụt so với champion (--side village|wolves); âm = tắt (D4)")
```

- [ ] **Step 6: Thay phần thân `main` từ benchmark champion-0000 tới hết**

Trong `main()`, thay TOÀN BỘ đoạn từ dòng `bench0 = out / "bench-champion-0000.json"` tới hết hàm (dòng `print(f"xong. champion: {champion} điểm {champion_score:+.1f}")`) bằng:

```python
    bench0 = out / "bench-champion-0000.json"
    step(
        done_marker(out, "bench-0000"),
        bench_cmd(champion, "rl-bench", bench0, a.bench_games, a.bench_repeat, a.learned_decisions),
    )
    champ = read_bench(bench0, a.side)
    print(f"champion điểm {champ.score:+.1f}  lệch cân bằng {champ.imbalance:.1f}", flush=True)

    # Khôi phục champion đã thăng hạng ở lần chạy trước. Đặt SAU bench0 để lần
    # chạy đầu vẫn có điểm xuất phát, và trước vòng lặp để rollout đi từ đúng nó.
    if state["champion"]:
        champion = Path(state["champion"])
        champ = champion_from_state(state, champ)
        print(f"tiếp tục từ {champion.name} điểm {champ.score:+.1f}", flush=True)

    gates = {
        "margin": a.promote_margin,
        "balance_slack": a.balance_slack,
        "other_slack": a.other_side_slack,
    }

    for k in range(1, a.iterations + 1):
        if k in state["done"]:
            print(f"vòng {k}: đã xong, bỏ qua", flush=True)
            continue
        it = out / f"iter-{k:04d}"
        it.mkdir(exist_ok=True)

        # Ba phần seats độc lập nhau → chạy cùng lúc. ĐỪNG đưa lên GitHub
        # Actions (runner 2 lõi, đã gỡ role-power.yml vì đúng lý do đó).
        def rollout_one(seats: str, iteration: int = k, source: Path = champion) -> None:
            part = it / f"roll-{seats}"
            step(
                done_marker(it, f"roll-{seats}"),
                rollout_cmd(source, seats, iteration, part, a.games // 3, a.temperature, a.learned_decisions),
            )

        with ThreadPoolExecutor(max_workers=3) as pool:
            list(pool.map(rollout_one, SEATS))

        # Gộp CHỈ sau khi cả ba xong, theo thứ tự cố định.
        merged = it / "trajectories.jsonl"
        merge_marker = done_marker(it, "merge")
        if not merge_marker.exists():
            with merged.open("w", encoding="utf8") as f:
                for seats in SEATS:
                    f.write((it / f"roll-{seats}" / "trajectories.jsonl").read_text(encoding="utf8"))
            merge_marker.write_text("ok", encoding="utf8")

        enc = it / "enc"
        step(
            done_marker(it, "validate"),
            [tool("npm"), "run", "ai:validate-dataset", "--", str(merged)],
        )
        step(
            done_marker(it, "encode"),
            [tool("npm"), "run", "ai:encode", "--", "--in", str(merged), "--out", str(enc), "--rollout"],
        )

        model_id = f"ppo-{k:04d}"
        model_dir = it / "model"
        step(
            done_marker(it, "ppo"),
            [PY, "-m", "masoi_training.train_ppo", "--data", str(enc),
             "--init", str(champion), "--out", str(model_dir), "--model-id", model_id,
             "--baseline", a.baseline, "--side", a.side, "--lr", str(a.lr),
             "--shaping-weight", str(a.shaping_alpha),
             *(["--shaping-decisions", a.shaping_decisions] if a.shaping_decisions else []),
             *(["--train-decisions", a.train_decisions] if a.train_decisions else []),
             *(["--target-kl", str(a.target_kl)] if a.target_kl is not None else [])],
            cwd=ROOT / "ai-training",
        )
        challenger = model_dir / "model.weights.json"

        # Benchmark tốn thời gian nhất mỗi vòng. Vòng không đo: challenger vẫn
        # thành điểm xuất phát của vòng sau (nó là kết quả của một update thật),
        # nhưng KHÔNG vào `champions/` — champion chính thức chỉ đổi khi có điểm.
        should_bench = (k % a.bench_every == 0) or (k == a.iterations)
        if not should_bench:
            print(f"vòng {k}: bỏ benchmark (--bench-every)", flush=True)
            champion = challenger
        else:
            bench = it / "bench.json"
            step(
                done_marker(it, "bench"),
                bench_cmd(challenger, "rl-bench", bench, a.bench_games, a.bench_repeat, a.learned_decisions),
            )
            reads = [read_bench(bench, a.side)]
            print(
                f"iteration {k}: challenger {reads[0].score:+.1f} vs champion {champ.score:+.1f}"
                f"  | lệch cân bằng {reads[0].imbalance:.1f} vs {champ.imbalance:.1f}",
                flush=True,
            )
            row = {
                "iteration": k,
                "modelId": model_id,
                "score": round(reads[0].score, 2),
                "imbalance": round(reads[0].imbalance, 2),
            }
            if reads[0].other is not None:
                row["otherSide"] = round(reads[0].other, 2)
            # Bộ seed thứ hai chỉ chạy khi bộ thứ nhất đã qua MỌI cổng: nó tốn
            # thêm một lần benchmark, nhưng chỉ ở những vòng hiếm có ứng viên.
            if a.confirm_seed and passes_gates(reads, champ, **gates):
                conf = it / "bench-confirm.json"
                step(
                    done_marker(it, "bench-confirm"),
                    bench_cmd(challenger, a.confirm_seed, conf, a.bench_games, a.bench_repeat, a.learned_decisions),
                )
                reads.append(read_bench(conf, a.side))
                row["confirmScore"] = round(reads[-1].score, 2)
                print(f"  xác nhận trên seed {a.confirm_seed}: {reads[-1].score:+.1f}", flush=True)
            state["scores"].append(row)
            if passes_gates(reads, champ, **gates):
                champion = champions / f"champion-{k:04d}.weights.json"
                shutil.copy(challenger, champion)
                champ = champion_of(reads)
                print(f"THĂNG HẠNG → {champion.name}", flush=True)
            else:
                print("GIỮ champion", flush=True)

        state["done"].append(k)
        state["champion"] = str(champion)
        state["championScore"] = champ.score
        state["championOther"] = champ.other
        state["championImbalance"] = champ.imbalance
        save_state()

    print(f"xong. champion: {champion} điểm {champ.score:+.1f}")
```

- [ ] **Step 7: Kiểm tra không còn tên cũ, test lại, `--help` chạy được**

```bash
grep -n "champion_score" rl_loop.py
PYTHONUTF8=1 ./.venv/Scripts/python.exe tests/test_rl_gates.py
PYTHONUTF8=1 ./.venv/Scripts/python.exe tests/test_rl_loop.py
PYTHONUTF8=1 ./.venv/Scripts/python.exe rl_loop.py --help | grep -E "learned-decisions|balance-slack|other-side-slack"
```

Expected: `grep` không in gì; hai test in `ok`; `--help` in ba dòng cờ mới.

- [ ] **Step 8: Cập nhật tài liệu**

Trong `docs/BOT_SELF_LEARNING_TRAINING.md`, chèn ngay TRƯỚC dòng `### Ngắt lúc nào cũng được`:

~~~markdown
### PPO logits thuần từ bản sao BC: cờ bốn lượt và hai cổng mới (2026-09-17)

Spec: `docs/superpowers/specs/2026-09-17-rl-ppo-from-bc-design.md`.

- `--learned-decisions` (mặc định `vote,night,final,hunter`) đi xuống MỌI
  rollout (`selfplay.ts`) và MỌI benchmark — đúng cấu hình production. Trước
  đây cả hai chạy mặc định vote+night và PPO không bao giờ thấy phiên toà.
- **Cổng cân bằng** `--balance-slack` (mặc định 1,0): `|all − 50 %|` của
  challenger không được hơn champion quá slack, trên mọi bộ seed. Âm = tắt.
- **Cổng phe kia** `--other-side-slack` (mặc định 1,0, chỉ `--side
  village|wolves`): model logits là một bộ trọng số cho cả hai phe, nên train
  làng không được kéo sói tụt quá slack. Âm = tắt.
- `state.json` lưu thêm `championOther`, `championImbalance`; state cũ thiếu
  khoá thì lấy từ `bench-champion-0000.json`.

```bash
cd ai-training && PYTHONUTF8=1 ./.venv/Scripts/python.exe rl_loop.py \
  --champion ../apps/server/assets/models/village-bc-0002.weights.json \
  --side village --iterations 10 --games 3000 --bench-every 5 \
  --temperature 1 --lr 1e-4 --target-kl 0.01 \
  --train-decisions vote,final_vote,hunter_shot --out .tmp/rl-bc-village
```
~~~

- [ ] **Step 9: Commit**

```bash
cd /d/Source/ma-soi-online
git add ai-training/rl_loop.py ai-training/tests/test_rl_gates.py docs/BOT_SELF_LEARNING_TRAINING.md
git commit -m "feat(rl): wire four-decision flag and new gates into rl_loop

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Mục 6 (RL) trong `train_bc_local.ipynb` — người dùng tự chạy train

Người dùng tự chạy mọi lượt train qua notebook local. Mục 6 đã được thêm vào
`ai-training/colab/train_bc_local.ipynb` (18 cell, sau mục 5); task này kiểm và
commit nó.

**Files:**
- Modify: `ai-training/colab/train_bc_local.ipynb` (đã có mục 6; commit gồm cả chỉnh sửa trước đó của người dùng ở mục 3)

**Interfaces:**
- Consumes: `rl_loop.py` cờ `--learned-decisions/--balance-slack/--other-side-slack` (Task 4), `selfplay.ts --learned-decisions` (Task 2), guard FINAL_VOTE (Task 1); từ `rl_loop`: `score_of`, `imbalance_of`.
- Produces: các cell người dùng chạy theo thứ tự

| Cell | Việc | Giai đoạn spec |
|---|---|---|
| setup | `run_logged` (stream output vào notebook + `.tmp/rl/<run>.log`), `rl_loop(name, champion, side, iterations, games, extra)`, `latest_champion(out)`, `show_state(out)` | — |
| 6.0 | `build:deps` + từ chối nếu thiếu cờ của Task 0–4 | — |
| 6.1 | pilot 2 vòng × 600 ván + kiểm hàng FINAL_VOTE/HUNTER_SHOT, `approxKl` < 0,05, `agreementWithInit` ≥ 0,95 → in `PILOT OK` | 0 |
| 6.2 | làng 10 × 3000, tự chạy lại `--lr 3e-4` một lần, dừng nếu không thăng hạng | 1 |
| 6.3 | sói 10 × 3000 từ champion làng, `--shaping-decisions vote`, retry như trên | 2 |
| 6.4 | đêm 5 vòng/phe nếu 6.2 và 6.3 cùng thăng hạng | 3 |
| 6.5 | benchmark `confirm-0917` 5×300 cho `village-bc-0002` và `CANDIDATE`, in khối `VERDICT: PASS/FAIL` + `candidate:` | 4 |

- [ ] **Step 1: Kiểm notebook parse được và cell 6.0 từ chối đúng khi thiếu code**

Chạy TRƯỚC khi merge Task 1–4 (trên nhánh chưa có chúng) thì cell 6.0 phải in `missing [...]`; SAU Task 4 phải in `OK - pipeline has the four-decision flag and both new gates`.

```bash
cd /d/Source/ma-soi-online/ai-training/colab
python -c "
import json, ast
nb = json.load(open('train_bc_local.ipynb', encoding='utf-8'))
[ast.parse(''.join(c['source'])) for c in nb['cells'] if c['cell_type'] == 'code']
assert any('## 6. RL: PPO from the BC clone' in ''.join(c['source']) for c in nb['cells'])
print('ok', len(nb['cells']))
"
```

Expected: `ok 33`.

- [ ] **Step 2: Commit**

```bash
cd /d/Source/ma-soi-online
git add ai-training/colab/train_bc_local.ipynb
git commit -m "feat(training): RL PPO-from-BC section in local notebook

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Người dùng chạy mục 6.0 → 6.5 (checkpoint, agent không làm gì)

Agent DỪNG ở đây và chờ. Người dùng chạy notebook theo thứ tự (mỗi cell dài có thể ngắt và chạy lại, `rl_loop` resume). Agent tiếp tục khi nhận được MỘT trong các thông báo:

- Log/lỗi của 6.0 hoặc `PILOT FAILED: ...` (6.1) → chẩn đoán bằng `.tmp/rl/pilot.log`, sửa code, người dùng chạy lại.
- `Village never promoted ...` (6.2) → viết báo cáo FAIL theo Task 7 Step 1a, đề xuất dự án con B.
- Người dùng hỏi vì cổng cân bằng chặn liên tục → trình bày bảng `show_state`, để người dùng quyết `--balance-slack`.
- Khối `VERDICT` của 6.5 → Task 7.

---

### Task 7: Đóng gói hoặc báo cáo từ verdict của notebook (có điều kiện)

**Files:**
- Create (PASS): `apps/server/assets/models/village-ppo-0001.weights.json`
- Modify (PASS): `apps/server/tests/learned-policy.test.ts`, `.env.example`, `deploy/env.production.example`
- Create: `ai-training/reports/rl-ppo-from-bc-2026-09.md`

**Interfaces:**
- Consumes: khối verdict 6.5 (`VERDICT`, `candidate:` là đường dẫn tuyệt đối), `.tmp/rl/confirm-bc0002.json`, `.tmp/rl/confirm-candidate.json`, các `.tmp/rl/*/state.json`.
- Produces: model đóng gói hoặc quyết định giữ `village-bc-0002`, kèm báo cáo.

Trước khi làm, chấm lại verdict độc lập (không tin bản in):

```bash
cd /d/Source/ma-soi-online/ai-training
PYTHONUTF8=1 ./.venv/Scripts/python.exe -c "
import json
from pathlib import Path
from rl_loop import imbalance_of, score_of
base = Path('../.tmp/rl/confirm-bc0002.json'); cand = Path('../.tmp/rl/confirm-candidate.json')
for side in ('village', 'wolves'):
    print(side, '%+.2f' % (score_of(cand, side) - score_of(base, side)))
print('imbalance %.2f' % imbalance_of(cand))
print('violations', sum(r['violations'] for r in json.load(open(cand, encoding='utf8'))['rows']))
"
```

Expected: trùng số trong khối verdict. Lệch → dừng, báo người dùng.

- [ ] **Step 1a (FAIL): viết báo cáo, giữ production**

Tạo `ai-training/reports/rl-ppo-from-bc-2026-09.md` gồm: các bảng `show_state` và khối verdict người dùng gửi, đường dẫn log `.tmp/rl/*.log`, thời gian thật mỗi giai đoạn, kết luận "giữ village-bc-0002" và gợi ý bước kế (dự án con B). Commit:

```bash
cd /d/Source/ma-soi-online
git add ai-training/reports/rl-ppo-from-bc-2026-09.md
git commit -m "docs(rl): PPO-from-BC run report (not promoted)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Dừng ở đây.

- [ ] **Step 1b (PASS): đóng gói model**

`CAND` = dòng `candidate:` trong khối verdict mà người dùng gửi.

```bash
cd /d/Source/ma-soi-online/ai-training
CAND=<đường dẫn champion ứng viên cuối, tuyệt đối>
PYTHONUTF8=1 ./.venv/Scripts/python.exe -c "
import json, sys
src = sys.argv[1]
w = json.load(open(src, encoding='utf8'))
w['modelId'] = 'village-ppo-0001'
json.dump(w, open('../apps/server/assets/models/village-ppo-0001.weights.json', 'w', encoding='utf8'))
print('ok', w['format'])
" "$CAND"
```

Expected: `ok masoi-mlp-2`.

- [ ] **Step 2 (PASS): cập nhật test server**

Trong `apps/server/tests/learned-policy.test.ts`: đổi hai lần `"village-bc-0002.weights.json"` (trong `vi.mock` và hằng `CHAMPION`) thành `"village-ppo-0001.weights.json"`, và hai lần `toBe("village-bc-0002")` thành `toBe("village-ppo-0001")`. Sửa comment đầu file đoạn "Model đóng gói hiện là…" thành:

```ts
 * Model đóng gói hiện là village-ppo-0001: PPO logits thuần từ village-bc-0002
 * (spec 2026-09-17), cả bàn, bốn lượt. village-bc-0002 vẫn trong image để
 * rollback bằng env.
```

Chạy:

```bash
cd /d/Source/ma-soi-online/apps/server && npx vitest run tests/learned-policy.test.ts
```

Expected: PASS (file tồn tại, `modelId` đúng, `residual` undefined).

- [ ] **Step 3 (PASS): cập nhật env mẫu**

`deploy/env.production.example`: `BOT_POLICY_FILE=apps/server/assets/models/village-ppo-0001.weights.json`.

`.env.example`: dòng `# Mo hinh dong goi san trong apps/server/assets/models/: village-bc-0002` thành `# Mo hinh dong goi san trong apps/server/assets/models/: village-ppo-0001 (PPO tu village-bc-0002; bc-0002 giu de rollback)`.

- [ ] **Step 4 (PASS): suite + báo cáo + commit**

```bash
cd /d/Source/ma-soi-online/apps/server && npx vitest run
```

Expected: PASS. Viết `ai-training/reports/rl-ppo-from-bc-2026-09.md` như Step 1a nhưng kết luận "đóng gói village-ppo-0001" kèm bảng delta từng phe và imbalance.

```bash
cd /d/Source/ma-soi-online
git add apps/server/assets/models/village-ppo-0001.weights.json apps/server/tests/learned-policy.test.ts .env.example deploy/env.production.example ai-training/reports/rl-ppo-from-bc-2026-09.md
git commit -m "feat(bot): ship village-ppo-0001 (PPO from BC clone)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Dừng trước deploy**

Không push, không mở PR, không đổi env production. Báo người dùng: số chấm lại verdict, đường dẫn báo cáo, và rằng deploy cần họ duyệt (kèm việc đổi `BOT_POLICY_FILE` trong `/opt/masoi/.env` trên VPS).
