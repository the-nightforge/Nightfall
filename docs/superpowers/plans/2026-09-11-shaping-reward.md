# Shaping Reward Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm nhãn shaping "hành động trúng phe địch" (±1, tính từ luật game ở TypeScript) vào trajectory, vận chuyển qua encoder tới `train_ppo` dưới dạng bonus advantage `A = R − b + α·L`.

**Architecture:** Nhãn tính trong `gameToTrajectories` (module mới `shaping.ts`, nguồn duy nhất), nằm ở CẤP MỘT của line cạnh `reward` — không đụng observation. Encoder ghi cột optional `shaping.i8.bin` (0 = không nhãn). Python chỉ đọc số: `data.py` thêm cột, `train_ppo` cộng `α·L` vào advantage trước chuẩn hoá, `rl_loop` passthrough cờ. α = 0 trả lại hành vi cũ byte một.

**Tech Stack:** TypeScript (vitest, game-engine thuần), Python 3.13 + numpy + torch ≥ 2.6, JSONL → .bin nhị phân.

**Spec:** `docs/superpowers/specs/2026-09-11-shaping-reward-design.md`

## Global Constraints

- Ranh giới §39: Python không parse trajectory, không biết luật game — nhãn chỉ đến qua cột số.
- `shaping` KHÔNG bao giờ xuất hiện trong `observation` (§6/§22): nhãn cấp-ván như `reward`/`finalRole`.
- Nhãn ∈ {−1, +1}, sentinel 0 = không nhãn (int8). Nhãn không bao giờ có giá trị 0.
- Vai trung lập (`ROLE_META[role].team === "neutral"`) và quyết định NIGHT/SPEECH không có nhãn (spec D3).
- Phe so bằng `sameFaction` của `@masoi/shared` — không dựng lại luật phe.
- `datasetVersion` KHÔNG đổi (`dataset-0003`/`rollout-0001`): chiều vector và không gian hành động không đổi, cột mới là optional.
- Kéo dài dòng JSONL phải tất định: khoá mới `shaping` ghi thẳng theo vị trí (không spread), đặt ngay sau `reward`.
- Python entrypoint gọi `force_utf8_console()` (đã có từ commit console UTF-8); test Python chạy được không cần `PYTHONUTF8`.
- Test TS chạy bằng `npx vitest run <file>` trong `packages/game-engine`; test Python chạy bằng `.venv/Scripts/python.exe tests/test_<tên>.py` trong `ai-training` (không framework, assert là đủ).

---

### Task 1: Nhãn shaping ở TypeScript — `shapingLabelFor` + field `shaping`

**Files:**
- Create: `packages/game-engine/src/bot/evaluation/shaping.ts`
- Modify: `packages/game-engine/src/bot/evaluation/trajectory.ts` (interface `BotTrajectory` + `gameToTrajectories`)
- Modify: `packages/game-engine/tests/bot-learning.test.ts:37` (fixture `line()` — thêm `shaping: null` vào `base` vì interface có trường bắt buộc mới)
- Test: `packages/game-engine/tests/bot-shaping.test.ts` (mới)

**Interfaces:**
- Consumes: `sameFaction`, `ROLE_META`, `type Role` từ `@masoi/shared`; `SelfPlayGame` (`roles`, `winner`) và `BotDecisionTrace` (`botId`, `decision`, `chosen.targetId`, `chosen.label`) từ các module hiện có.
- Produces: `shapingLabelFor(game: SelfPlayGame, trace: BotDecisionTrace): number | null` — nhãn ±1 hoặc null; field `shaping: number | null` trên `BotTrajectory`, ghi ngay sau `reward`.

- [ ] **Step 1: Write the failing test**

Tạo `packages/game-engine/tests/bot-shaping.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { Role } from "@masoi/shared";
import { gameToTrajectories } from "../src/bot/evaluation/trajectory";
import { shapingLabelFor } from "../src/bot/evaluation/shaping";
import type { BotDecisionTrace } from "../src/bot/trace/trace";
import type { SelfPlayGame } from "../src/bot/evaluation/selfplay";
import { DEFAULT_ROOM_CONFIG, type RoomConfig } from "@masoi/shared";

/**
 * Nhãn shaping (spec 2026-09-11-shaping-reward-design D2/D3): "nước đi có trúng
 * phe địch không" — VOTE/HUNTER_SHOT theo mục tiêu, FINAL_VOTE theo sự nhất
 * quán treo/tha với phe của bị cáo. Trung lập và NIGHT/SPEECH không có nhãn.
 */

function trace(overrides: Partial<BotDecisionTrace> = {}): BotDecisionTrace {
  return {
    botId: "p1",
    round: 2,
    phase: "VOTING",
    decision: "VOTE",
    chosen: { targetId: "p2", label: "bầu" },
    candidates: [],
    beliefBefore: {},
    beliefAfter: {},
    personality: {
      aggressiveness: 0.5, talkativeness: 0.5, riskTolerance: 0.5,
      deceptionSkill: 0.5, analyticalSkill: 0.5, loyalty: 0.5, stubbornness: 0.5,
    },
    rngDraws: [],
    fallbackReason: null,
    knowledgeSnapshot: { aliveIds: ["p1", "p2", "p3"], legalChoices: [], knownRoles: {}, seerResult: null },
    ...overrides,
  } as unknown as BotDecisionTrace;
}

function game(roles: Record<string, Role>, overrides: Partial<SelfPlayGame> = {}): SelfPlayGame {
  const config: RoomConfig = { ...DEFAULT_ROOM_CONFIG, werewolves: 1 };
  return {
    record: { seed: "s", playerCount: 3, config, weightsVersion: "t", maxRounds: 20, events: false, speech: true, defense: false },
    winner: "village",
    rounds: 2, actions: 1, rejected: 0, skipped: 0,
    events: [], violations: [], traces: [], roles,
    ...overrides,
  };
}

const ROLES: Record<string, Role> = { p1: "VILLAGER", p2: "WEREWOLF", p3: "SEER" };

describe("shapingLabelFor (spec 2026-09-11 D2/D3)", () => {
  it("VOTE: mục tiêu khác phe → +1, cùng phe → −1", () => {
    const g = game(ROLES);
    expect(shapingLabelFor(g, trace({ botId: "p1", chosen: { targetId: "p2", label: "bầu" } }))).toBe(1);
    expect(shapingLabelFor(g, trace({ botId: "p2", chosen: { targetId: "p1", label: "bầu" } }))).toBe(1);
    expect(shapingLabelFor(g, trace({ botId: "p1", chosen: { targetId: "p3", label: "bầu" } }))).toBe(-1);
  });

  it("HUNTER_SHOT cùng quy tắc mục tiêu", () => {
    const g = game(ROLES);
    expect(shapingLabelFor(g, trace({ botId: "p1", decision: "HUNTER_SHOT", chosen: { targetId: "p2", label: "bắn" } }))).toBe(1);
    expect(shapingLabelFor(g, trace({ botId: "p1", decision: "HUNTER_SHOT", chosen: { targetId: "p3", label: "bắn" } }))).toBe(-1);
  });

  it("FINAL_VOTE: phán quyết nhất quán với phe bị cáo → +1", () => {
    const g = game(ROLES);
    // làng treo Sói: nhất quán → +1; làng tha Sói: mâu thuẫn → −1.
    expect(shapingLabelFor(g, trace({ botId: "p1", decision: "FINAL_VOTE", chosen: { targetId: "p2", label: "treo" } }))).toBe(1);
    expect(shapingLabelFor(g, trace({ botId: "p1", decision: "FINAL_VOTE", chosen: { targetId: "p2", label: "tha" } }))).toBe(-1);
    // Sói treo dân: nhất quán với phe mình → +1.
    expect(shapingLabelFor(g, trace({ botId: "p2", decision: "FINAL_VOTE", chosen: { targetId: "p1", label: "treo" } }))).toBe(1);
  });

  it("trung lập (actor hoặc mục tiêu) → null; targetId null → null", () => {
    const jester: Record<string, Role> = { p1: "VILLAGER", p2: "WEREWOLF", p3: "JESTER" };
    expect(shapingLabelFor(game(jester), trace({ chosen: { targetId: "p3", label: "bầu" } }))).toBeNull();
    expect(shapingLabelFor(game(jester), trace({ botId: "p3", chosen: { targetId: "p1", label: "bầu" } }))).toBeNull();
    expect(shapingLabelFor(game(ROLES), trace({ chosen: { targetId: null, label: "không treo ai" } }))).toBeNull();
  });

  it("NIGHT/SPEECH không có nhãn; thiếu vai → null", () => {
    const g = game(ROLES);
    expect(shapingLabelFor(g, trace({ decision: "NIGHT", chosen: { targetId: "p2", label: "cắn" } }))).toBeNull();
    expect(shapingLabelFor(g, trace({ decision: "SPEECH", chosen: { targetId: "p2", label: "nói" } }))).toBeNull();
    expect(shapingLabelFor(g, trace({ botId: "ghost" }))).toBeNull();
  });

  it("gameToTrajectories ghi `shaping` ngay sau `reward`, không lẫn vào observation", () => {
    const g = game(ROLES, { traces: [trace({ botId: "p1" })] });
    const lines = gameToTrajectories(g);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.shaping).toBe(1); // dân bầu Sói
    expect(lines[0]!.reward).toBe(1); // làng thắng
    const raw = JSON.stringify(lines[0]);
    const keys = Object.keys(JSON.parse(raw));
    expect(keys.indexOf("shaping")).toBe(keys.indexOf("reward") + 1);
    expect(Object.keys(lines[0]!.observation)).not.toContain("shaping");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (workdir `packages/game-engine`): `npx vitest run tests/bot-shaping.test.ts`
Expected: FAIL — `Cannot find module '../src/bot/evaluation/shaping'`

- [ ] **Step 3: Write minimal implementation**

Tạo `packages/game-engine/src/bot/evaluation/shaping.ts`:

```typescript
import { ROLE_META, sameFaction, type Role } from "@masoi/shared";
import type { BotDecisionTrace } from "../trace/trace";
import type { SelfPlayGame } from "./selfplay";

/**
 * Nhãn shaping (spec 2026-09-11-shaping-reward-design D2): "nước đi có trúng
 * phe địch không" — tín hiệu từng-quyết-định có nguồn từ luật game, cho tầng
 * train PPO (A = R − b + α·L). Đo trên 500 ván: E[L|win] − E[L|loss] = +0.34 ±
 * 0.02 ở VOTE làng, +0.43 ± 0.02 ở FINAL_VOTE làng, và IM LẶNG ở FINAL_VOTE
 * Sói (+0.014 ± 0.027) — vì vậy việc có nhãn hay không phải chính xác đến từng
 * loại quyết định.
 *
 * Đây là NHÃN cho tầng train, cùng bản chất với `reward`/`finalRole` — KHÔNG
 * phải observation. Không đường nào đưa nó vào `BotDecisionContext`.
 *
 * Vai trung lập không cùng phe với ai (`sameFaction`) và có điều kiện thắng
 * riêng, nên nhãn phe-hoá là sai bản chất của chúng → null. NIGHT cũng null:
 * với Sói "cắn trúng phe địch" tầm thường (mục tiêu đêm không bao giờ là Sói),
 * nhãn đêm có giá trị là một định nghĩa theo threat — việc riêng sau v1 (D3).
 */

const SHAPED_DECISIONS: ReadonlySet<string> = new Set(["VOTE", "FINAL_VOTE", "HUNTER_SHOT"]);

export function shapingLabelFor(game: SelfPlayGame, trace: BotDecisionTrace): number | null {
  if (!SHAPED_DECISIONS.has(trace.decision)) return null;

  const actorRole: Role | undefined = game.roles[trace.botId];
  const targetId = trace.chosen.targetId;
  if (!actorRole || !targetId) return null;
  const targetRole: Role | undefined = game.roles[targetId];
  if (!targetRole) return null;
  if (ROLE_META[actorRole].team === "neutral" || ROLE_META[targetRole].team === "neutral") {
    return null;
  }

  const enemy = !sameFaction(actorRole, targetRole);
  if (trace.decision === "FINAL_VOTE") {
    // Bị cáo cố định; quyết định là treo/tha. Thưởng sự NHẤT QUÁN giữa phán
    // quyết và phe của bị cáo (BotRuntime.decideFinalVote ghi label "treo"/"tha").
    return (trace.chosen.label === "treo") === enemy ? 1 : -1;
  }
  return enemy ? 1 : -1;
}
```

Sửa `packages/game-engine/src/bot/evaluation/trajectory.ts`:

(a) Thêm vào interface `BotTrajectory`, ngay sau field `reward`:

```typescript
  /** +1 thắng / −1 thua theo đúng luật (kể cả thắng cá nhân vai trung lập). */
  reward: number;
  /**
   * Nhãn shaping ±1 (spec 2026-09-11 D2): nước có trúng phe địch không.
   * `null` = không có nhãn (NIGHT/SPEECH, mục tiêu null, vai trung lập).
   * Nhãn cho tầng train như `reward` — không bao giờ là observation.
   */
  shaping: number | null;
```

(b) Trong `gameToTrajectories`, thêm import và khoá `shaping` ngay sau `reward`:

```typescript
import { shapingLabelFor } from "./shaping";
```

```typescript
      reward: rewardFor(game, trace.botId, finalRole),
      shaping: shapingLabelFor(game, trace),
      finalWinner: game.winner ?? "draw",
```

(c) Sửa fixture `line()` trong `packages/game-engine/tests/bot-learning.test.ts` — thêm `shaping: null,` ngay sau `reward: ...` trong object `base` (interface có trường bắt buộc mới).

- [ ] **Step 4: Run tests to verify they pass**

Run (workdir `packages/game-engine`): `npx vitest run tests/bot-shaping.test.ts tests/bot-trajectory.test.ts tests/bot-learning.test.ts`
Expected: PASS toàn bộ

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/bot/evaluation/shaping.ts packages/game-engine/src/bot/evaluation/trajectory.ts packages/game-engine/tests/bot-shaping.test.ts packages/game-engine/tests/bot-learning.test.ts
git commit -m "feat(ai): nhãn shaping ±1 trúng-phe-địch trên trajectory (spec 2026-09-11 D2/D3)"
```

---

### Task 2: Validator kiểm hình thức `shaping`

**Files:**
- Modify: `packages/game-engine/src/bot/learning/dataset.ts` (hàm `validateTrajectoryLine`, sau kiểm `reward` ở dòng ~100)
- Test: `packages/game-engine/tests/bot-learning.test.ts` (describe `leak validator`)

**Interfaces:**
- Consumes: `line.shaping` từ Task 1.
- Produces: luật validator — `shaping` vắng/null/±1 hợp lệ; giá trị khác → violation kind `"schema"`.

- [ ] **Step 1: Write the failing test**

Trong `packages/game-engine/tests/bot-learning.test.ts`, trong `describe("leak validator (§7, §42, §44)")`, thêm:

```typescript
  it("shaping: ±1/vắng hợp lệ, giá trị khác bị từ chối (spec 2026-09-11 D5)", () => {
    expect(validateTrajectoryLine(line()).valid).toBe(true);
    expect(validateTrajectoryLine(line({ shaping: 1 })).valid).toBe(true);
    expect(validateTrajectoryLine(line({ shaping: -1 })).valid).toBe(true);
    expect(validateTrajectoryLine(line({ shaping: null })).valid).toBe(true);
    const bad = validateTrajectoryLine(line({ shaping: 0.5 }));
    expect(bad.valid).toBe(false);
    expect(bad.violations.some((v) => v.field === "shaping")).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run (workdir `packages/game-engine`): `npx vitest run tests/bot-learning.test.ts`
Expected: FAIL — `shaping: 0.5` vẫn `valid === true` (chưa có luật)

- [ ] **Step 3: Write minimal implementation**

Trong `dataset.ts`, ngay sau khối kiểm `reward` (dòng ~100):

```typescript
  if (line.reward !== 1 && line.reward !== -1) {
    add("reward", "reward phải là +1 hoặc −1 (§20)", "schema");
  }
  // Shaping là nhãn ±1 (spec 2026-09-11 D5). Validator chỉ thấy line nên không
  // xác thực được semantics (không có vai thật của người khác) — semantics do
  // test bảng của shaping.ts bảo vệ; ở đây chỉ chặn giá trị sai hình thức.
  if (line.shaping !== undefined && line.shaping !== null && line.shaping !== 1 && line.shaping !== -1) {
    add("shaping", "shaping phải là +1, −1, null hoặc vắng mặt", "schema");
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run (workdir `packages/game-engine`): `npx vitest run tests/bot-learning.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/bot/learning/dataset.ts packages/game-engine/tests/bot-learning.test.ts
git commit -m "feat(ai): validator chặn shaping sai hình thức (spec 2026-09-11 D5)"
```

---

### Task 3: Encoder ghi cột `shaping.i8.bin`

**Files:**
- Modify: `apps/server/scripts/ai-encode.ts` (object `streams` ~dòng 127, phần ghi mỗi hàng ~dòng 249)

**Interfaces:**
- Consumes: `line.shaping: number | null` từ Task 1.
- Produces: file `shaping.i8.bin` — int8, một byte mỗi hàng, giá trị −1/0/+1, 0 = không nhãn; luôn ghi cho mọi dataset mới (loader cũ bỏ qua vì không đọc).

- [ ] **Step 1: Thêm stream**

Trong `apps/server/scripts/ai-encode.ts`, object `streams` — thêm một dòng sau `rewards`:

```typescript
    rewards: createWriteStream(join(outDir, "rewards.i8.bin")),
    // Nhãn shaping ±1 (spec 2026-09-11 D4); 0 = không nhãn. Luôn ghi: loader
    // nhận diện bằng SỰ CÓ MẶT của file, dataset cũ không có là đúng.
    shaping: createWriteStream(join(outDir, "shaping.i8.bin")),
```

- [ ] **Step 2: Ghi mỗi hàng**

Trong phần ghi mỗi hàng, ngay sau dòng `streams.rewards.write(...)`:

```typescript
    streams.rewards.write(Buffer.from(Int8Array.of(line.reward)));
    streams.shaping.write(Buffer.from(Int8Array.of(line.shaping ?? 0)));
```

(Object `streams` được `Object.values(streams)` gom vào `end()` ở cuối — không phải sửa chỗ close.)

- [ ] **Step 3: Smoke E2E — dataset nhỏ qua trọn đường ống**

```powershell
npm run ai:dataset -- --games 3 --players 8 --preset --defense --seed enc-smoke --trajectories .tmp/enc-smoke --trace-games 3 --no-jitter --quiet
npm run ai:encode -- --in .tmp/enc-smoke/trajectories.jsonl --out .tmp/enc-smoke-enc
```

Expected: encode in `TỪ CHỐI 0`; dòng `mẫu train N` — kiểm `(Get-Item .tmp/enc-smoke-enc/shaping.i8.bin).Length` bằng đúng N (int8 = 1 byte/hàng):

```powershell
Get-Item .tmp/enc-smoke-enc/shaping.i8.bin | Select-Object Length
```

Kiểm nhanh có nhãn thật (không toàn 0):

```powershell
[IO.File]::ReadAllBytes("$PWD\.tmp\enc-smoke-enc\shaping.i8.bin") | Group-Object | Select-Object Name, Count
```

Expected: có cả nhóm `1`, `-1` và `0` — `0` đến từ các hàng NIGHT (spec D3: không nhãn) và các hàng VOTE/HUNTER_SHOT mục tiêu null/trung lập.

- [ ] **Step 4: Commit**

```bash
git add apps/server/scripts/ai-encode.ts
git commit -m "feat(ai): encode ghi shaping.i8.bin — nhãn ±1, 0 = không nhãn (spec 2026-09-11 D4)"
```

---

### Task 4: Loader Python đọc cột `shaping`

**Files:**
- Modify: `ai-training/masoi_training/data.py` (dataclass `Dataset`, `where`, `load`)
- Test: `ai-training/tests/test_data.py`

**Interfaces:**
- Consumes: `shaping.i8.bin` từ Task 3.
- Produces: `Dataset.shaping: np.ndarray | None` — `(N,)` int8 ∈ {−1, 0, +1}, 0 = không nhãn; `where()` mang theo; vắng file → `None`.

- [ ] **Step 1: Write the failing test**

Trong `ai-training/tests/test_data.py`:

(a) Trong `write_dataset`, thêm trước dòng `meta.json`:

```python
    np.array([1, 0, -1, 1, 0, -1], dtype=np.int8).tofile(root / "shaping.i8.bin")
```

(b) Trong `main()`, khối kiểm đầu tiên — thêm sau dòng `assert data.features[1, 0] == 4.0`:

```python
        assert data.shaping is not None and data.shaping.dtype == np.int8
        assert data.shaping.tolist() == [1, 0, -1, 1, 0, -1]
```

(c) Sau khối kiểm split (dòng ~78), thêm:

```python
        # where() phải mang theo cột optional — train lọc phe/loại mà mất nhãn
        # là mất tín hiệu trong im lặng.
        assert data.split("train").shaping.tolist() == [1, 0, -1]
```

- [ ] **Step 2: Run test to verify it fails**

Run (workdir `ai-training`): `.\.venv\Scripts\python.exe tests\test_data.py`
Expected: FAIL — `AttributeError: 'Dataset' object has no attribute 'shaping'`

- [ ] **Step 3: Write minimal implementation**

`ai-training/masoi_training/data.py`:

(a) Dataclass — thêm field cuối (sau `bases`):

```python
    # Nhãn shaping ±1 (spec 2026-09-11 D4): nước có trúng phe địch không.
    # 0 là sentinel "không nhãn" — nhãn không bao giờ có giá trị 0. Chỉ dataset
    # encode bằng bản mới có file; `None` là câu trả lời đúng khi vắng.
    shaping: np.ndarray | None = None  # (N,) int8, −1/0/+1
```

(b) `where()` — thêm một dòng vào constructor:

```python
            bases=self.bases[keep] if self.bases is not None else None,
            shaping=self.shaping[keep] if self.shaping is not None else None,
```

(c) `load()` — thêm sau khối `bases` (~dòng 125):

```python
    shaping_path = root / "shaping.i8.bin"
    shaping = np.fromfile(shaping_path, dtype=np.int8) if shaping_path.exists() else None
```

(d) `expected` — thêm sau khối `bases`:

```python
    if shaping is not None:
        expected["shaping"] = (shaping.size, rows)
```

(e) `Dataset(...)` trả về — thêm:

```python
        bases=bases.reshape(rows, action_size) if bases is not None else None,
        shaping=shaping,
```

- [ ] **Step 4: Run test to verify it passes**

Run (workdir `ai-training`): `.\.venv\Scripts\python.exe tests\test_data.py`
Expected: `ok`

- [ ] **Step 5: Commit**

```bash
git add ai-training/masoi_training/data.py ai-training/tests/test_data.py
git commit -m "feat(ai): loader đọc shaping.i8.bin — optional, 0 = không nhãn (spec 2026-09-11 D4)"
```

---

### Task 5: train_ppo — `--shaping-weight`, `--shaping-decisions`, coverage

**Files:**
- Modify: `ai-training/masoi_training/train_ppo.py`
- Test: `ai-training/tests/test_ppo.py`

**Interfaces:**
- Consumes: `Dataset.shaping` từ Task 4; `meta["decisions"]` (tên HOA: `VOTE`, `NIGHT`, `HUNTER_SHOT`, `FINAL_VOTE`, `SPEECH`).
- Produces: cờ CLI `--shaping-weight` (α, mặc định 1.0) và `--shaping-decisions` (CSV tên viết thường, rỗng = tất cả); metrics.json thêm `shapingCoverage`/`shapingDecisions` (α có sẵn trong `config` qua `vars(a)`); advantage `A = R − b + α·L` trước chuẩn hoá.

- [ ] **Step 1: Write the failing test**

Trong `ai-training/tests/test_ppo.py`:

(a) Trong `logits_case`, thêm `"--shaping-weight", "0"` vào `sys.argv` của LẦN CHẠY ĐẦU (8 epoch) và cả ba lần chạy baseline:

```python
        sys.argv = [
            "train_ppo",
            "--data", str(d),
            "--init", str(initp),
            "--out", str(out),
            "--epochs", "8",
            "--batch-size", "64",
            "--model-id", "t",
            "--shaping-weight", "0",
        ]
```

(và tương tự cho ba vòng lặp `--baseline kind`).

(b) Trong `residual_case`, thêm `"--shaping-weight", "0"` vào lần chạy chính và các lần chạy `--side`/`--target-kl`/từ chối (mọi `sys.argv` hiện có).

(c) Thêm hàm `shaping_case()` và gọi nó trong `main()`:

```python
def shaping_case() -> None:
    """Shaping bonus (spec 2026-09-11 D1/D6): A += α·L trên hàng có nhãn.

    Bốn bài kiểm: (a) α > 0 thiếu cột phải dừng; (b) α = 0 cho trọng số GIỐNG
    HẰNG BYTE trên dataset có/không có cột; (c) nhãn +1 gắn hành động 0 phải
    kéo xác suất của nó lên hơn chạy α = 0; (d) --shaping-decisions lọc đúng
    và coverage trong metrics phản ánh đúng phần được giữ.
    """
    torch.manual_seed(2)
    rng = np.random.default_rng(2)
    init = PolicyValueNet(OBS, ACT, 8).eval()
    feats = rng.random((ROWS, OBS), dtype=np.float32)
    masks = np.zeros((ROWS, ACT), dtype=np.uint8)
    masks[:, :4] = 1
    with torch.no_grad():
        lg, val = init(torch.from_numpy(feats))
        lp = torch.log_softmax(masked_logits(lg, torch.from_numpy(masks.astype(bool))), 1)
    actions = torch.distributions.Categorical(logits=lp).sample().numpy().astype("<i4")
    logprobs = lp[np.arange(ROWS), actions].numpy().astype("<f4")
    rewards = rng.choice(np.array([-1, 1], dtype=np.int8), ROWS)
    roles = (np.arange(ROWS) % 2).astype(np.uint8)
    decisions = (np.arange(ROWS) % 2).astype(np.uint8)  # meta: ["VOTE", "NIGHT"]
    # Nhãn +1 cho hành động 0, −1 cho mọi hành động khác.
    shaping = np.where(actions == 0, 1, -1).astype(np.int8)

    def write(root: Path, with_shaping: bool) -> None:
        root.mkdir(parents=True, exist_ok=True)
        feats.astype("<f4").tofile(root / "features.f32.bin")
        masks.tofile(root / "masks.u8.bin")
        actions.tofile(root / "actions.i32.bin")
        rewards.tofile(root / "rewards.i8.bin")
        np.zeros(ROWS, np.uint8).tofile(root / "splits.u8.bin")
        roles.tofile(root / "roles.u8.bin")
        decisions.tofile(root / "decisions.u8.bin")
        logprobs.tofile(root / "logprobs.f32.bin")
        val.numpy().astype("<f4").tofile(root / "values.f32.bin")
        if with_shaping:
            shaping.tofile(root / "shaping.i8.bin")
        meta = {
            "rows": ROWS,
            "obsSize": OBS,
            "actionSize": ACT,
            "datasetVersion": "rollout-test",
            "roles": ["A", "B"],
            "decisions": ["VOTE", "NIGHT"],
            "featureNames": [f"f{i}" for i in range(OBS)],
            "actionNames": [f"a{i}" for i in range(ACT)],
        }
        (root / "meta.json").write_text(json.dumps(meta), encoding="utf8")

    with tempfile.TemporaryDirectory() as tmp:
        d_with = Path(tmp) / "enc-with"
        d_without = Path(tmp) / "enc-without"
        write(d_with, True)
        write(d_without, False)

        initp = Path(tmp) / "init.weights.json"
        export_weights_json(init, json.loads((d_with / "meta.json").read_text(encoding="utf8")),
                            initp, model_id="init", training_seed=0, hidden=8)
        common = ["--init", str(initp), "--epochs", "6", "--batch-size", "64", "--model-id", "sh"]

        # (a) α mặc định > 0 mà thiếu cột → dừng.
        sys.argv = ["train_ppo", "--data", str(d_without), "--out", str(Path(tmp) / "reject"), *common]
        try:
            train_ppo.main()
        except SystemExit:
            pass
        else:
            raise AssertionError("thiếu shaping.i8.bin phải bị từ chối khi --shaping-weight > 0")

        # (b) α = 0: dataset có/không có cột cho cùng trọng số — hành vi cũ byte một.
        sys.argv = ["train_ppo", "--data", str(d_without), "--out", str(Path(tmp) / "base0"), *common,
                    "--shaping-weight", "0"]
        train_ppo.main()
        sys.argv = ["train_ppo", "--data", str(d_with), "--out", str(Path(tmp) / "base1"), *common,
                    "--shaping-weight", "0"]
        train_ppo.main()
        a_state = torch.load(Path(tmp) / "base0" / "model.pt")
        b_state = torch.load(Path(tmp) / "base1" / "model.pt")
        for key in a_state:
            assert torch.equal(a_state[key], b_state[key]), f"α=0 phải byte một: lệch ở {key}"

        # (c) shaping kéo P(action 0) lên hơn chạy không shaping.
        sys.argv = ["train_ppo", "--data", str(d_with), "--out", str(Path(tmp) / "shaped"), *common]
        train_ppo.main()
        m = json.loads((Path(tmp) / "shaped" / "metrics.json").read_text(encoding="utf8"))
        assert m["shapingCoverage"] == 1.0, m["shapingCoverage"]
        assert m["config"]["shaping_weight"] == 1.0, m["config"]

        def p0(model_dir: Path) -> float:
            net = PolicyValueNet(OBS, ACT, 8)
            net.load_state_dict(torch.load(model_dir / "model.pt"))
            net.eval()
            with torch.no_grad():
                lg, _ = net(torch.from_numpy(feats))
                probs = torch.softmax(masked_logits(lg, torch.from_numpy(masks.astype(bool))), 1)
                return float(probs[:, 0].mean())

        assert p0(Path(tmp) / "shaped") > p0(Path(tmp) / "base1"), (p0(Path(tmp) / "shaped"), p0(Path(tmp) / "base1"))

        # (d) lọc theo loại quyết định: chỉ VOTE (chỉ số 0) giữ nhãn.
        sys.argv = ["train_ppo", "--data", str(d_with), "--out", str(Path(tmp) / "filtered"), *common,
                    "--shaping-decisions", "vote"]
        train_ppo.main()
        mf = json.loads((Path(tmp) / "filtered" / "metrics.json").read_text(encoding="utf8"))
        assert abs(mf["shapingCoverage"] - float((decisions == 0).mean())) < 1e-3, mf["shapingCoverage"]
```

Trong `main()` của file test, thêm `shaping_case()` sau `residual_case()`.

- [ ] **Step 2: Run test to verify it fails**

Run (workdir `ai-training`): `.\.venv\Scripts\python.exe tests\test_ppo.py`
Expected: FAIL — `shaping_case` chết ở (a): `train_ppo.main()` chạy ốp ốp rồi không raise `SystemExit` (cờ chưa tồn tại → argparse cũng thoát lỗi cờ, hoặc missing attribute). Đọc lỗi để xác nhận là "cờ chưa có", không phải lỗi khác.

- [ ] **Step 3: Write minimal implementation**

Trong `ai-training/masoi_training/train_ppo.py`:

(a) Hai cờ mới, sau `--baseline`:

```python
    p.add_argument(
        "--shaping-weight",
        type=float,
        default=1.0,
        help="α trong A = R − b + α·L (spec 2026-09-11 D1). 0 = tắt, hành vi cũ byte một",
    )
    p.add_argument(
        "--shaping-decisions",
        default="",
        help="Chỉ shaping các loại quyết định này (CSV, viết thường: vote,final_vote). Rỗng = tất cả hàng có nhãn",
    )
```

(b) Sau khối `residual`/`else` (sau dòng `assert init_residual is None` đã đổi thành `raise`), thêm:

```python
    # Shaping (spec 2026-09-11 D1/D6): nhãn ±1 từ luật game, cộng vào advantage
    # TRƯỚC chuẩn hoá. α = 0 → không đụng cột, dataset cũ vẫn train được.
    shaping: torch.Tensor | None = None
    if a.shaping_weight > 0:
        if d.shaping is None:
            raise SystemExit("--shaping-weight cần shaping.i8.bin — encode lại dataset bằng bản mới")
        raw = d.shaping.astype(np.float32).copy()
        if a.shaping_decisions:
            wanted = {name.strip().lower() for name in a.shaping_decisions.split(",") if name.strip()}
            names = np.array([str(d.meta["decisions"][int(i)]).lower() for i in d.decisions])
            raw[~np.isin(names, sorted(wanted))] = 0.0
        shaping = torch.from_numpy(raw)
    shaping_coverage = round(float((shaping.numpy() != 0).mean()), 4) if shaping is not None else None
```

(c) Đổi phép tính advantage:

```python
    adv = R - base
    if shaping is not None:
        adv = adv + a.shaping_weight * shaping
    adv = (adv - adv.mean()) / (adv.std() + 1e-8)
```

(d) metrics.json — thêm ba khoá cạnh `"baselineMse"`:

```python
                "shapingWeight": a.shaping_weight,
                "shapingDecisions": a.shaping_decisions or None,
                "shapingCoverage": shaping_coverage,
```

- [ ] **Step 4: Run tests to verify they pass**

Run (workdir `ai-training`): `.\.venv\Scripts\python.exe tests\test_ppo.py`
Expected: `ok` (logits_case + residual_case với α=0 + shaping_case đủ 4 kiểm)

- [ ] **Step 5: Commit**

```bash
git add ai-training/masoi_training/train_ppo.py ai-training/tests/test_ppo.py
git commit -m "feat(ai): PPO shaping bonus A += α·L, lọc theo loại quyết định, coverage (spec 2026-09-11 D1/D6)"
```

---

### Task 6: rl_loop passthrough

**Files:**
- Modify: `ai-training/rl_loop.py` (argparse trong `main()` + lệnh `train_ppo` trong vòng lặp)

**Interfaces:**
- Consumes: `--shaping-weight`/`--shaping-decisions` của `train_ppo` từ Task 5.
- Produces: cờ `--shaping-alpha` (float, mặc định 1.0) và `--shaping-decisions` (CSV, mặc định rỗng) ở tầng vòng lặp.

- [ ] **Step 1: Thêm hai cờ**

Trong `main()` của `rl_loop.py`, sau `--target-kl`:

```python
    p.add_argument("--shaping-alpha", type=float, default=1.0, dest="shaping_alpha",
                   help="Xem train_ppo --shaping-weight; 0 = tắt shaping (dataset cũ)")
    p.add_argument("--shaping-decisions", default="", dest="shaping_decisions",
                   help="Xem train_ppo --shaping-decisions; ví dụ wolves-side: vote")
```

- [ ] **Step 2: Truyền vào lệnh train_ppo**

Trong lệnh `step(...)` gọi `train_ppo`, sau `"--lr", str(a.lr)`:

```python
             [PY, "-m", "masoi_training.train_ppo", "--data", str(enc),
              "--init", str(champion), "--out", str(model_dir), "--model-id", model_id,
              "--baseline", a.baseline, "--side", a.side, "--lr", str(a.lr),
              "--shaping-weight", str(a.shaping_alpha),
              *(["--shaping-decisions", a.shaping_decisions] if a.shaping_decisions else []),
              *(["--target-kl", str(a.target_kl)] if a.target_kl is not None else [])],
```

- [ ] **Step 3: Verify**

Run (workdir `ai-training`):

```powershell
.\.venv\Scripts\python.exe rl_loop.py --help; if ($?) { .\.venv\Scripts\python.exe tests\test_rl_loop.py }
```

Expected: `--help` thoát 0, liệt kê `--shaping-alpha`/`--shaping-decisions`; test in `ok` (import `rl_loop` phải không cần torch — `console` import là torch-free).

- [ ] **Step 4: Commit**

```bash
git add ai-training/rl_loop.py
git commit -m "feat(ai): rl_loop passthrough --shaping-alpha/--shaping-decisions (spec 2026-09-11 D7)"
```

---

### Task 7: Docs + xác minh tổng

**Files:**
- Modify: `docs/BOT_SELF_LEARNING_TRAINING.md` (Bước 8, sau mục "Tách phe")

**Interfaces:**
- Consumes: toàn bộ các task trước.

- [ ] **Step 1: Cập nhật tài liệu train**

Trong `docs/BOT_SELF_LEARNING_TRAINING.md`, sau mục "### Tách phe: hai phe có tín hiệu ngược dấu" (Bước 8), thêm mục:

```markdown
### Shaping reward: nhãn trúng-phe-địch (2026-09-11)

Spike 500 ván đo thấy nhãn "nước đi có trúng phe địch không" mang tín hiệu
từng-quyết-định mà reward ±1 cấp-ván không có (VOTE làng: E[L|win] − E[L|loss]
= +0.34 ± 0.02; FINAL_VOTE Sói: im lặng). PPO nhận nó dưới dạng bonus
advantage: `A = R − b + α·L` — objective thật vẫn nằm trong gradient. Chi
tiết: `docs/superpowers/specs/2026-09-11-shaping-reward-design.md`.

- Mặc định α = 1. Rollout encode bằng bản mới tự có cột `shaping.i8.bin`.
- Dataset cũ không có cột: `train_ppo` từ chối khi α > 0 — encode lại.
- `--shaping-decisions vote` cho chạy `--side wolves`: FINAL_VOTE của Sói đã
  đo là im lặng, đừng shaping nó.
- `--shaping-weight 0` = hành vi cũ byte một (rollback).
```

Và thêm một dòng vào bảng "Bảng lệnh nhanh":

```markdown
| RL shaping | `python rl_loop.py --champion R.json --side village --shaping-alpha 1.0 --lr 1e-4 --target-kl 0.01 --bench-every 5 --iterations 5` |
```

- [ ] **Step 2: Chạy trọn bộ test Python (không PYTHONUTF8)**

Run (workdir `ai-training`):

```powershell
.\.venv\Scripts\python.exe tests\test_data.py; if ($?) { .\.venv\Scripts\python.exe tests\test_train_smoke.py }; if ($?) { .\.venv\Scripts\python.exe tests\test_ppo.py }; if ($?) { .\.venv\Scripts\python.exe tests\test_rl_loop.py }
```

Expected: bốn dòng `ok`

- [ ] **Step 3: Chạy test TS liên quan**

Run (workdir `packages/game-engine`): `npx vitest run tests/bot-shaping.test.ts tests/bot-trajectory.test.ts tests/bot-learning.test.ts tests/bot-residual-policy.test.ts tests/bot-learned-policy.test.ts`
Expected: PASS toàn bộ

- [ ] **Step 4: Lint**

Run (workdir repo root): `npm run lint`
Expected: PASS. (Nếu `@masoi/web` fail vì `node_modules` chưa cài — môi trường, không phải thay đổi này; xác nhận ba workspace còn lại xanh.)

- [ ] **Step 5: Commit**

```bash
git add docs/BOT_SELF_LEARNING_TRAINING.md
git commit -m "docs(ai): shaping reward — cách chạy và ý nghĩa từng cờ"
```
