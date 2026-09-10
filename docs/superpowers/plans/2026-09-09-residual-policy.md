# Residual Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Policy học được = điểm heuristic + β·(phần học được), cho cả VOTE lẫn NIGHT; residual 0 → heuristic đúng byte; PPO chỉ học phần hơn heuristic.

**Architecture:** Đêm được thêm seam `NightPolicyModel` cắm vào `rankNightTargets` (chỗ 7 vai đã chấm bảng). Một file `policy/residual-policy.ts` dựng observation như policy hiện có, cộng `β·logits[ô]` vào điểm THẬT (có jitter) của từng ứng viên, chọn argmax (T=0, tie-break như heuristic) hoặc lấy mẫu softmax(·/τ) qua RNG của bot. Model tự khai `residual: {beta}` trong file JSON; encode rollout xuất thêm `bases.f32.bin` (điểm có jitter) để Python dựng lại đúng phân phối cũ; `train_ppo` tính ratio trên `(bases + β·net)/τ`.

**Tech Stack:** TypeScript (vitest, tsx), Python 3.13 + torch CPU, numpy.

**Spec:** `docs/superpowers/specs/2026-09-09-residual-policy-design.md` — executor đọc cả hai. Nhánh `feat/residual-policy` (từ `feat/rl-self-play`, đã có distill + benchmark `--setups`).

## Global Constraints

- `packages/game-engine` không I/O; Python không parse trajectory, không có bản sao encoder, không biết luật game (gom theo `roles` đã có).
- Không đổi chiều observation (413) hay không gian hành động (187).
- Điểm nền `score_i` GIỮ jitter (spec D1). `scores.f32.bin` (bỏ jitter) giữ nguyên ý nghĩa; thêm `bases.f32.bin` (có jitter).
- β và loại policy nằm trong file model (`residual: { beta }`), không có cờ `--policy-kind` (spec D2). β mặc định 10; τ khuyến nghị 5.
- Chỉ ghi `learned` khi nước policy đề xuất CHÍNH LÀ nước đã đi (luật `BotRuntime` hiện hành).
- `session-registry.ts` KHÔNG đổi. Rollout chạy cục bộ, không lên GitHub Actions.
- Heredoc qua Bash làm hỏng backslash — viết script Python ra scratchpad rồi chạy; `PYTHONUTF8=1 PYTHONIOENCODING=utf-8` cho mọi lệnh Python.
- Sau khi sửa engine: `npm run build:deps` rồi `npm run lint`, ĐỌC mã thoát (`build:deps` vẫn xuất dist khi lỗi TS).
- TDD, một commit mỗi task. Kết thúc: `npm run build`, `npm run lint`, vitest engine + server, 4 test Python `ok`.

---

## Bản đồ file

| File | Trách nhiệm |
|---|---|
| `packages/game-engine/src/bot/policy/policy-model.ts` (sửa) | thêm `NightCandidate`, `NightPolicyModel` |
| `packages/game-engine/src/bot/roles/night-scoring.ts` (sửa) | `rankNightTargets` nhận `action`, `policy`; đưa lựa chọn lên đầu |
| `packages/game-engine/src/bot/roles/strategy.ts` (sửa) | `decideNight(..., probe?, policy?)` |
| `packages/game-engine/src/bot/roles/{seer,guard,werewolf,sorcerer,serial-killer,tracker,detective}.ts` (sửa) | truyền `action` + `policy` vào `rankNightTargets` |
| `packages/game-engine/src/bot/learning/mlp.ts` (sửa) | `MlpWeightsJson.residual`, `LearnedPolicy.residual`, validate |
| `packages/game-engine/src/bot/policy/learned-policy.ts` (sửa) | `LearnedPick.beta?` |
| `packages/game-engine/src/bot/policy/residual-policy.ts` (mới) | `residualRows`, `pickResidual`, `residualVotePolicy`, `residualNightPolicy` |
| `packages/game-engine/src/bot/BotRuntime.ts` (sửa) | chọn đường residual khi `learnedPolicy.residual` |
| `packages/game-engine/src/bot/learning/dataset.ts` (sửa) | `candidateBases` |
| `packages/game-engine/src/index.ts` (sửa) | export `residual-policy` |
| `apps/server/scripts/ai-encode.ts` (sửa) | `bases.f32.bin`, meta `policyKind`/`beta`, từ chối β/τ trộn |
| `ai-training/masoi_training/data.py` (sửa) | `bases` |
| `ai-training/masoi_training/export.py` (sửa) | `residual` đi kèm |
| `ai-training/masoi_training/init_residual.py` (mới) | tạo champion-0000 |
| `ai-training/masoi_training/train_ppo.py` (sửa) | chế độ residual |
| `ai-training/tests/test_ppo.py`, `test_export.py` (sửa) | ca residual |
| `ai-training/rl_loop.py` (sửa) | bench `--setups baseline,village,wolves,all` |
| `ai-training/README.md`, `docs/BOT_SELF_LEARNING_TRAINING.md` (sửa) | cách chạy residual |
| `reports/train-policy-0002.md` (sửa) | mục kết quả residual |

---

### Task 1: Seam đêm — `NightPolicyModel` cắm vào `rankNightTargets`

**Files:**
- Modify: `packages/game-engine/src/bot/policy/policy-model.ts`
- Modify: `packages/game-engine/src/bot/roles/night-scoring.ts`
- Modify: `packages/game-engine/src/bot/roles/strategy.ts`
- Modify: `packages/game-engine/src/bot/roles/seer.ts`, `guard.ts`, `werewolf.ts`, `sorcerer.ts`, `serial-killer.ts`, `tracker.ts`, `detective.ts`
- Test: `packages/game-engine/tests/bot-night-policy-seam.test.ts` (mới)

**Interfaces:**
- Produces:
```ts
// policy-model.ts
export interface NightCandidate { targetId: string; score: number }
export interface NightPolicyModel {
  readonly name: string;
  /** Bảng ĐÃ CHẤM (sort điểm giảm dần, hoà theo id) của MỘT loại hành động đêm. Trả targetId thuộc bảng, hoặc null = giữ thứ tự heuristic. Có thể rút RNG (lấy mẫu). */
  selectTarget(action: NightActionKind, candidates: ReadonlyArray<NightCandidate>): string | null;
}
// night-scoring.ts: options += { action?: NightActionKind; policy?: NightPolicyModel }
// strategy.ts: decideNight(context, state, rng, probe?, policy?: NightPolicyModel)
```

- [ ] **Step 1: Viết test (fail)**

`packages/game-engine/tests/bot-night-policy-seam.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { Role } from "@masoi/shared";
import { rankNightTargets } from "../src/bot/roles/night-scoring";
import { strategyFor } from "../src/bot/roles/registry";
import type { NightPolicyModel } from "../src/bot/policy/policy-model";
import { createSeededRng } from "../src/bot/rng";
import { createBotPersonality } from "../src/bot/personality/personality";
import { createBotBrainState } from "../src/bot/memory/memory-store";
import type {
  BotBrainState,
  BotDecisionContext,
  BotKnowledgeView,
  NightActionKind,
  NightKnowledge,
} from "../src/bot/types";

const PLAYERS = ["me", "a", "b", "c", "d"];

function stateFor(seed = "seam"): BotBrainState {
  return createBotBrainState("me", createBotPersonality(createSeededRng(seed)), PLAYERS);
}

function emptyTargets(): NightKnowledge["legalTargets"] {
  return {
    KILL: [], SEE: [], GUARD: [], HEAL: [], POISON: [], SKIP: [],
    DETECTIVE_CHECK: [], SERIAL_KILL: [], SORCERER_CHECK: [], TRACK: [],
  };
}

function context(night: Partial<NightKnowledge>, over: Partial<BotKnowledgeView> = {}): BotDecisionContext {
  return {
    knowledge: {
      dayOfTruthClaims: {}, neutralRolesInPlay: [], activeEventId: null,
      botId: "me", round: 2, phase: "NIGHT", phaseStartedAt: 0, phaseEndsAt: 30_000,
      selfRole: "VILLAGER",
      players: PLAYERS.map((id) => ({ id, name: id.toUpperCase(), alive: true })),
      knownRoles: {}, seerResult: null, sorcererResult: null,
      night: {
        bonusSecondTargetFor: null, canAct: true, legalActions: [], legalTargets: emptyTargets(),
        wolfTarget: null, guardPrevious: null, healUsed: false, poisonUsed: false, wolvesLocked: false,
        ...night,
      },
      trialAccusedId: null, canFinalVote: false, hunterShot: null, publicVoteHistory: [],
      currentVoteCounts: { players: {}, noElimination: 0 }, hasVoted: false, myVote: null,
      legalVoteChoices: [], lastNightDeaths: [],
      ...over,
    },
    visibleChat: [],
  };
}

/** Policy giả: luôn chọn ứng viên CUỐI bảng, ghi lại mọi lời gọi. */
function pickLast(): NightPolicyModel & { calls: Array<{ action: NightActionKind; ids: string[] }> } {
  const calls: Array<{ action: NightActionKind; ids: string[] }> = [];
  return {
    name: "pick-last",
    calls,
    selectTarget(action, candidates) {
      calls.push({ action, ids: candidates.map((c) => c.targetId) });
      return candidates[candidates.length - 1]!.targetId;
    },
  };
}

describe("rankNightTargets + NightPolicyModel", () => {
  const termsFor = (id: string) => [{ name: "t", value: { a: 3, b: 2, c: 1 }[id]! }];

  it("không policy: thứ tự điểm giảm dần như cũ", () => {
    const ranked = rankNightTargets(["c", "a", "b"], { termsFor });
    expect(ranked.map((r) => r.targetId)).toEqual(["a", "b", "c"]);
  });

  it("policy chọn một id không đứng đầu → id đó lên đầu, phần còn lại giữ thứ tự", () => {
    const policy = pickLast();
    const ranked = rankNightTargets(["c", "a", "b"], { termsFor, action: "SEE", policy });
    expect(ranked.map((r) => r.targetId)).toEqual(["c", "a", "b"]);
    expect(policy.calls).toEqual([{ action: "SEE", ids: ["a", "b", "c"] }]);
  });

  it("policy trả null hoặc id ngoài bảng → giữ nguyên; thiếu `action` → không hỏi policy", () => {
    const nul: NightPolicyModel = { name: "null", selectTarget: () => null };
    expect(rankNightTargets(["a", "b"], { termsFor, action: "SEE", policy: nul }).map((r) => r.targetId)).toEqual(["a", "b"]);
    const stray: NightPolicyModel = { name: "stray", selectTarget: () => "zzz" };
    expect(rankNightTargets(["a", "b"], { termsFor, action: "SEE", policy: stray }).map((r) => r.targetId)).toEqual(["a", "b"]);
    const spy = pickLast();
    rankNightTargets(["a", "b"], { termsFor, policy: spy });
    expect(spy.calls).toEqual([]);
  });
});

describe("7 vai truyền policy vào bảng của đúng loại hành động", () => {
  const cases: Array<{ role: Role; action: NightActionKind; night: Partial<NightKnowledge>; over?: Partial<BotKnowledgeView> }> = [
    { role: "SEER", action: "SEE", night: { legalActions: ["SEE"], legalTargets: { ...emptyTargets(), SEE: ["a", "b", "c"] } } },
    { role: "GUARD", action: "GUARD", night: { legalActions: ["GUARD"], legalTargets: { ...emptyTargets(), GUARD: ["a", "b", "c"] } } },
    { role: "WEREWOLF", action: "KILL", night: { legalActions: ["KILL"], legalTargets: { ...emptyTargets(), KILL: ["a", "b", "c"] } }, over: { selfRole: "WEREWOLF", knownRoles: { me: "WEREWOLF" } } },
    { role: "SORCERER", action: "SORCERER_CHECK", night: { legalActions: ["SORCERER_CHECK"], legalTargets: { ...emptyTargets(), SORCERER_CHECK: ["a", "b", "c"] } }, over: { selfRole: "SORCERER" } },
    { role: "SERIAL_KILLER", action: "SERIAL_KILL", night: { legalActions: ["SERIAL_KILL"], legalTargets: { ...emptyTargets(), SERIAL_KILL: ["a", "b", "c"] } }, over: { selfRole: "SERIAL_KILLER" } },
    { role: "TRACKER", action: "TRACK", night: { legalActions: ["TRACK"], legalTargets: { ...emptyTargets(), TRACK: ["a", "b", "c"] } }, over: { selfRole: "TRACKER" } },
    { role: "DETECTIVE", action: "DETECTIVE_CHECK", night: { legalActions: ["DETECTIVE_CHECK"], legalTargets: { ...emptyTargets(), DETECTIVE_CHECK: ["a", "b", "c"] } }, over: { selfRole: "DETECTIVE" } },
  ];

  for (const c of cases) {
    it(`${c.role}: policy chọn cuối bảng thì intention đi đúng người đó`, () => {
      const policy = pickLast();
      const ctx = context(c.night, { selfRole: c.role, ...c.over });
      const heuristic = strategyFor(c.role).decideNight(ctx, stateFor(), createSeededRng("h"), undefined);
      const steered = strategyFor(c.role).decideNight(ctx, stateFor(), createSeededRng("h"), undefined, policy);
      expect(policy.calls).toHaveLength(1);
      expect(policy.calls[0]!.action).toBe(c.action);
      expect(policy.calls[0]!.ids).toHaveLength(3);
      const last = policy.calls[0]!.ids[2]!;
      expect(steered?.action).toBe(c.action);
      expect(steered?.targetId).toBe(last);
      // Người thắng heuristic là ĐẦU bảng, và bảng có ≥ 2 điểm khác nhau nên hai bên khác nhau.
      expect(heuristic?.targetId).toBe(policy.calls[0]!.ids[0]);
      if (c.role === "DETECTIVE") expect(steered?.secondaryTargetId).toBe(policy.calls[0]!.ids[0]);
    });
  }

  it("Phù Thuỷ không có bảng → không hỏi policy", () => {
    const policy = pickLast();
    const ctx = context(
      { legalActions: ["POISON", "SKIP"], legalTargets: { ...emptyTargets(), POISON: ["a", "b"], SKIP: [] } },
      { selfRole: "WITCH" },
    );
    strategyFor("WITCH").decideNight(ctx, stateFor(), createSeededRng("w"), undefined, policy);
    expect(policy.calls).toEqual([]);
  });
});
```

Lưu ý: ở các vai mà mọi ứng viên hoà điểm (state mới, belief 0), jitter quyết định thứ tự — test vẫn đúng vì chỉ so "policy chọn cuối bảng → intention = cuối bảng", không so giá trị điểm. Nếu một vai thất bại vì bảng chỉ có 2 phần tử (lọc thêm), sửa `legalTargets` cho vai đó trong test, không sửa vai.

- [ ] **Step 2: Chạy test, xác nhận fail**

```bash
npx vitest run tests/bot-night-policy-seam.test.ts --root packages/game-engine
```
Expected: FAIL (TS: `action`/`policy` không có trong options; strategy không nhận tham số thứ 5).

- [ ] **Step 3: Sửa `policy-model.ts`**

Thêm sau `PolicyModel`:
```ts
import type { NightActionKind } from "../types";

/** Một dòng của bảng ứng viên đêm đã chấm. */
export interface NightCandidate {
  targetId: string;
  score: number;
}

/**
 * Seam CHỌN cho lượt đêm — đối xứng với `PolicyModel` của lượt bầu.
 *
 * `rankNightTargets` gọi nó SAU khi đã chấm và sort bảng của MỘT loại hành
 * động, rồi đưa lựa chọn lên đầu bảng; vai đọc `scored[0]` như cũ nên không
 * vai nào phải biết seam tồn tại. Khác `PolicyModel` ngày, model ĐƯỢC rút RNG
 * (lấy mẫu ở rollout) — RNG là của bot, đi qua `wrapRngForTrace`, nên vẫn
 * tái lập. Trả `null` = giữ nguyên thứ tự heuristic.
 */
export interface NightPolicyModel {
  readonly name: string;
  selectTarget(
    action: NightActionKind,
    candidates: ReadonlyArray<NightCandidate>,
  ): string | null;
}
```

- [ ] **Step 4: Sửa `night-scoring.ts`**

Import `NightPolicyModel` từ `../policy/policy-model` và `NightActionKind` từ `../types`. Options thêm:
```ts
    /** Loại hành động của bảng này; cần khi có `policy` (model ánh xạ ứng viên vào ô của đúng loại). */
    action?: NightActionKind;
    /** Seam chọn (spec residual D3). Thiếu `action` thì không hỏi. */
    policy?: NightPolicyModel;
```
Thay phần `.sort(...)` cuối bằng:
```ts
  const ranked = candidates
    .map(/* như cũ */)
    .sort((a, b) => b.score - a.score || a.targetId.localeCompare(b.targetId));
  // Seam: lựa chọn của policy lên ĐẦU, phần còn lại giữ thứ tự — `scored[0]` vẫn
  // là người thắng và `scored[1]` vẫn là dự bị (mục tiêu phụ của sự kiện, người
  // thứ hai của Thám Tử). Id ngoài bảng bị bỏ qua: policy không bịa được ứng viên.
  if (options.policy && options.action && ranked.length > 0) {
    const chosen = options.policy.selectTarget(options.action, ranked);
    if (chosen !== null && chosen !== ranked[0]!.targetId) {
      const at = ranked.findIndex((entry) => entry.targetId === chosen);
      if (at > 0) ranked.unshift(...ranked.splice(at, 1));
    }
  }
  return ranked;
```
Cập nhật doc đầu file: thêm mục 3 "policy chỉ ĐỔI THỨ TỰ, không đổi điểm và không đổi loại".

- [ ] **Step 5: Sửa `strategy.ts` và 7 vai**

`strategy.ts`: import `NightPolicyModel`; `decideNight(context, state, rng, probe?, policy?: NightPolicyModel)` với doc "Seam chọn của lượt đêm; vai có bảng ứng viên truyền nó vào `rankNightTargets` cùng `action`, vai không có bảng bỏ qua".

Mỗi vai: đổi chữ ký `decideNight(context, state, rng, probe, policy)` và thêm `action: "<KIND>", policy` vào options của `rankNightTargets` — SEE (seer), GUARD (guard), KILL (werewolf), SORCERER_CHECK (sorcerer), SERIAL_KILL (serial-killer), TRACK (tracker), DETECTIVE_CHECK (detective). Witch không đổi. `passiveStrategy` không đổi (bỏ qua tham số).

- [ ] **Step 6: Chạy test + toàn bộ engine**

```bash
npx vitest run tests/bot-night-policy-seam.test.ts --root packages/game-engine
npx vitest run --root packages/game-engine
```
Expected: PASS toàn bộ (không policy → byte một, các test cũ không đổi).

- [ ] **Step 7: Commit**

```bash
git add packages/game-engine/src/bot/policy/policy-model.ts packages/game-engine/src/bot/roles packages/game-engine/tests/bot-night-policy-seam.test.ts
git commit -m "feat(ai): seam đêm — NightPolicyModel cắm vào rankNightTargets, 7 vai truyền qua"
```

---

### Task 2: Model tự khai residual — `MlpWeightsJson.residual`, `LearnedPick.beta`

**Files:**
- Modify: `packages/game-engine/src/bot/learning/mlp.ts`
- Modify: `packages/game-engine/src/bot/policy/learned-policy.ts` (chỉ `LearnedPick`)
- Test: `packages/game-engine/tests/bot-mlp.test.ts`

**Interfaces:**
- Produces:
```ts
export interface MlpWeightsJson { /* … */ residual?: { beta: number } }
export interface LearnedPolicy { /* … */ readonly residual?: { beta: number } }
export interface LearnedPick { actionIndex; logProb; value; temperature; /** Có mặt = nước residual; β đã dùng. */ beta?: number }
```

- [ ] **Step 1: Test (fail)** — thêm vào `describe("loadMlpPolicy")`:
```ts
  it("residual: nạp `residual.beta` hữu hạn > 0; vắng thì không có trường; sai thì TỪ CHỐI", () => {
    const plain = loadMlpPolicy(zeroWeights());
    expect(plain.residual).toBeUndefined();
    const res = loadMlpPolicy({ ...zeroWeights(), residual: { beta: 10 } });
    expect(res.residual).toEqual({ beta: 10 });
    expect(() => loadMlpPolicy({ ...zeroWeights(), residual: { beta: 0 } })).toThrow(/residual/);
    expect(() => loadMlpPolicy({ ...zeroWeights(), residual: { beta: Number.NaN } })).toThrow(/residual/);
    expect(() => loadMlpPolicy({ ...zeroWeights(), residual: {} })).toThrow(/residual/);
  });
```

- [ ] **Step 2: Chạy, fail** — `npx vitest run tests/bot-mlp.test.ts --root packages/game-engine`.

- [ ] **Step 3: Sửa `mlp.ts`**

```ts
export interface MlpWeightsJson {
  // …
  /**
   * Có mặt = model là RESIDUAL (spec residual D2): logits là phần hiệu chỉnh
   * cộng vào điểm heuristic với hệ số `beta`, không phải logits thay teacher.
   * Nằm trong file để benchmark/replay không bao giờ dùng sai β.
   */
  residual?: { beta: number };
}
export interface LearnedPolicy {
  // …
  /** Xem `MlpWeightsJson.residual`. Vắng = policy logits thuần. */
  readonly residual?: { beta: number };
}
```
Trong `loadMlpPolicy`, sau `valueHead`:
```ts
  let residual: { beta: number } | undefined;
  if (w.residual !== undefined) {
    const beta = (w.residual as { beta?: unknown } | null)?.beta;
    if (typeof beta !== "number" || !Number.isFinite(beta) || beta <= 0) {
      throw new Error("residual.beta phải là số hữu hạn > 0");
    }
    residual = { beta };
  }
```
và trả `...(residual ? { residual } : {})` trong object kết quả.

`learned-policy.ts`: thêm `beta?: number` vào `LearnedPick` với doc "Có mặt = nước do residual policy sinh; encode đọc nó để biết tập rollout là residual và xuất `bases`".

- [ ] **Step 4: Chạy test, pass. Commit**
```bash
git add packages/game-engine/src/bot/learning/mlp.ts packages/game-engine/src/bot/policy/learned-policy.ts packages/game-engine/tests/bot-mlp.test.ts
git commit -m "feat(ai): model tự khai residual.beta; LearnedPick mang beta"
```

---

### Task 3: `residual-policy.ts` — lõi chọn + hai vỏ VOTE/NIGHT

**Files:**
- Create: `packages/game-engine/src/bot/policy/residual-policy.ts`
- Modify: `packages/game-engine/src/index.ts` (thêm `export * from "./bot/policy/residual-policy";`)
- Test: `packages/game-engine/tests/bot-residual-policy.test.ts` (mới, phần 1)

**Interfaces:**
- Consumes: `NightPolicyModel`, `NightCandidate` (Task 1); `LearnedPolicy.residual`, `LearnedPick.beta` (Task 2); `buildLiveObservation`, `encodeObservation`, `actionIndexOf`, `LearnedPickSink`, `LearnedPolicyOptions`.
- Produces:
```ts
export interface ResidualRow { targetId: string; actionIndex: number; adjusted: number }
export function residualRows(candidates: ReadonlyArray<{targetId: string; score: number}>, kind: string, logits: readonly number[], seats: readonly string[], beta: number, maxSeats?: number): ResidualRow[]; // [] nếu có ứng viên không ánh xạ được ghế
export function pickResidual(rows: readonly ResidualRow[], temperature: number, rng: BotRng): { row: ResidualRow; logProb: number } | null;
export function residualVotePolicy(policy: LearnedPolicy, weights: BotWeights, options?: LearnedPolicyOptions, onPick?: LearnedPickSink): PolicyModel<VoteScoringFrame>;
export function residualNightPolicy(policy: LearnedPolicy, weights: BotWeights, context: BotDecisionContext, state: BotBrainState, rng: BotRng, options?: LearnedPolicyOptions, onPick?: LearnedPickSink): NightPolicyModel;
```

- [ ] **Step 1: Test (fail)** — `tests/bot-residual-policy.test.ts`:
```ts
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
    const rows = residualRows([{ targetId: "p2", score: 10 }, { targetId: "p3", score: 8 }], "KILL", logits, seats, 10);
    expect(rows).toEqual([
      { targetId: "p2", actionIndex: actionIndexOf("KILL", 1), adjusted: 10 },
      { targetId: "p3", actionIndex: actionIndexOf("KILL", 2), adjusted: 13 },
    ]);
    expect(residualRows([{ targetId: "zz", score: 1 }], "KILL", logits, seats, 10)).toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy, fail (module không tồn tại).**

- [ ] **Step 3: Viết `residual-policy.ts`**

```ts
import type { BotWeights } from "../config/weights";
import type { VoteScoringFrame } from "../decision/vote-decision";
import { buildLiveObservation } from "../learning/live-observation";
import type { LearnedPolicy } from "../learning/mlp";
import {
  DAY_ACTION_KIND,
  DEFAULT_MAX_SEATS,
  actionIndexOf,
  encodeObservation,
  type EncodedObservation,
} from "../learning/observation";
import type { StrategyContext } from "../planning/planner";
import type { BotBrainState, BotDecisionContext, BotRng } from "../types";
import type { LearnedPickSink, LearnedPolicyOptions } from "./learned-policy";
import {
  heuristicPolicyModel,
  type NightPolicyModel,
  type PolicyModel,
} from "./policy-model";

/**
 * Residual policy (spec 2026-09-09-residual-policy-design):
 *
 *   adjusted_i = score_i + β · logits(obs)[ô hành động của ứng viên i]
 *
 * Model KHÔNG thay teacher, nó hiệu chỉnh teacher. `score_i` là điểm THẬT
 * bảng đã chấm (kể cả jitter) — cùng điểm mà heuristic sẽ dùng nếu không có
 * model — nên residual 0 và T=0 cho đúng nước heuristic, byte một; tệ nhất
 * bằng heuristic; PPO chỉ học phần hơn.
 *
 * Phân phối chỉ trên TẬP ỨNG VIÊN của bảng (không phải toàn mask encoder): ô
 * "không treo ai" hay các loại đêm khác không thuộc bảng nên không có xác
 * suất. Python dựng lại đúng phân phối này từ `bases` (điểm có jitter theo
 * ô), β và τ — không cần biết bảng đến từ đâu.
 */

export interface ResidualRow {
  targetId: string;
  actionIndex: number;
  adjusted: number;
}

/**
 * Ánh xạ bảng ứng viên → (ô hành động, điểm đã hiệu chỉnh). Một ứng viên
 * không có ghế trong observation là một bảng không hiệu chỉnh được: trả `[]`
 * để vòng gọi rơi về heuristic, thay vì hiệu chỉnh nửa bảng.
 */
export function residualRows(
  candidates: ReadonlyArray<{ targetId: string; score: number }>,
  kind: string,
  logits: readonly number[],
  seats: readonly string[],
  beta: number,
  maxSeats: number = DEFAULT_MAX_SEATS,
): ResidualRow[] {
  const rows: ResidualRow[] = [];
  for (const candidate of candidates) {
    const seat = seats.indexOf(candidate.targetId);
    if (seat < 0 || seat >= maxSeats) return [];
    const actionIndex = actionIndexOf(kind, seat, maxSeats);
    rows.push({
      targetId: candidate.targetId,
      actionIndex,
      adjusted: candidate.score + beta * logits[actionIndex]!,
    });
  }
  return rows;
}

/** log softmax(adjusted/t) trên bảng, trừ max trước khi exp (điểm chạy tới hàng trăm). */
function logProbTable(rows: readonly ResidualRow[], t: number): Map<string, number> {
  const max = Math.max(...rows.map((row) => row.adjusted / t));
  const exps = rows.map((row) => Math.exp(row.adjusted / t - max));
  const z = exps.reduce((a, b) => a + b, 0);
  return new Map(rows.map((row, k) => [row.targetId, Math.log(exps[k]! / z)]));
}

/**
 * T=0: argmax theo `adjusted`, hoà thì `targetId.localeCompare` — ĐÚNG
 * tie-break của `selectVote`/`rankNightTargets`, không phải theo thứ tự ghế
 * (ghế xoay về self nên "p10" đứng sau "p2" ở ghế mà đứng trước ở id). Không
 * rút RNG. `logProb` ở τ=1, cùng quy ước `sampleMasked`.
 * T>0: lấy mẫu softmax(adjusted/T) — đúng một lần rút, duyệt theo thứ tự
 * bảng để replay tái lập.
 */
export function pickResidual(
  rows: readonly ResidualRow[],
  temperature: number,
  rng: BotRng,
): { row: ResidualRow; logProb: number } | null {
  if (rows.length === 0) return null;
  if (temperature <= 0) {
    const sorted = [...rows].sort(
      (a, b) => b.adjusted - a.adjusted || a.targetId.localeCompare(b.targetId),
    );
    const best = sorted[0]!;
    return { row: best, logProb: logProbTable(rows, 1).get(best.targetId)! };
  }
  const table = logProbTable(rows, temperature);
  const u = rng();
  let acc = 0;
  for (const row of rows) {
    acc += Math.exp(table.get(row.targetId)!);
    if (u < acc) return { row, logProb: table.get(row.targetId)! };
  }
  const last = rows[rows.length - 1]!;
  return { row: last, logProb: table.get(last.targetId)! };
}

function betaOf(policy: LearnedPolicy): number {
  if (!policy.residual) throw new Error(`policy "${policy.id}" không phải residual (thiếu residual.beta)`);
  return policy.residual.beta;
}

/** `PolicyModel` lượt VOTE: hiệu chỉnh bảng planner đã chấm rồi chọn. */
export function residualVotePolicy(
  policy: LearnedPolicy,
  weights: BotWeights,
  options: LearnedPolicyOptions = {},
  onPick?: LearnedPickSink,
): PolicyModel<VoteScoringFrame> {
  const beta = betaOf(policy);
  const maxSeats = options.maxSeats ?? DEFAULT_MAX_SEATS;
  const fallback = heuristicPolicyModel<VoteScoringFrame>();
  return {
    name: `residual:${policy.id}`,
    selectAction(candidates, context: StrategyContext<VoteScoringFrame>, probe) {
      if (candidates.length === 0) return fallback.selectAction(candidates, context, probe);
      const live = buildLiveObservation(
        context.context.knowledge, context.state, weights, "VOTE", options.belief?.(),
      );
      const encoded = encodeObservation(live, { maxSeats });
      const features = encoded.features;
      const rows = residualRows(candidates, DAY_ACTION_KIND, policy.logits(features), encoded.seats, beta, maxSeats);
      const temperature = options.temperature ?? 0;
      const picked = pickResidual(rows, temperature, context.rng);
      if (!picked) return fallback.selectAction(candidates, context, probe);
      onPick?.(
        { actionIndex: picked.row.actionIndex, logProb: picked.logProb, value: policy.value(features), temperature, beta },
        { kind: DAY_ACTION_KIND, targetId: picked.row.targetId },
      );
      return { targetId: picked.row.targetId };
    },
  };
}

/**
 * `NightPolicyModel` cho MỘT lượt đêm: observation "NIGHT" dựng LƯỜI ở lần
 * hỏi đầu (strategy có thể không chấm bảng nào), rồi dùng lại cho mọi bảng
 * của cùng lượt.
 */
export function residualNightPolicy(
  policy: LearnedPolicy,
  weights: BotWeights,
  context: BotDecisionContext,
  state: BotBrainState,
  rng: BotRng,
  options: LearnedPolicyOptions = {},
  onPick?: LearnedPickSink,
): NightPolicyModel {
  const beta = betaOf(policy);
  const maxSeats = options.maxSeats ?? DEFAULT_MAX_SEATS;
  let cached: { encoded: EncodedObservation; logits: number[] } | undefined;
  const prepare = (): { encoded: EncodedObservation; logits: number[] } => {
    if (!cached) {
      const live = buildLiveObservation(context.knowledge, state, weights, "NIGHT", options.belief?.());
      const encoded = encodeObservation(live, { maxSeats });
      cached = { encoded, logits: policy.logits(encoded.features) };
    }
    return cached;
  };
  return {
    name: `residual:${policy.id}`,
    selectTarget(action, candidates) {
      if (candidates.length === 0) return null;
      const { encoded, logits } = prepare();
      const rows = residualRows(candidates, action, logits, encoded.seats, beta, maxSeats);
      const temperature = options.temperature ?? 0;
      const picked = pickResidual(rows, temperature, rng);
      if (!picked) return null;
      onPick?.(
        { actionIndex: picked.row.actionIndex, logProb: picked.logProb, value: policy.value(encoded.features), temperature, beta },
        { kind: action, targetId: picked.row.targetId },
      );
      return picked.row.targetId;
    },
  };
}
```

- [ ] **Step 4: Export ở `src/index.ts`, chạy test, pass. Commit**
```bash
git add packages/game-engine/src/bot/policy/residual-policy.ts packages/game-engine/src/index.ts packages/game-engine/tests/bot-residual-policy.test.ts
git commit -m "feat(ai): residual policy — điểm heuristic + β·net, argmax tie-break như heuristic, lấy mẫu qua RNG bot"
```

---

### Task 4: Cắm vào `BotRuntime` — byte-identical với residual 0, rollout ghi `learned` cho VOTE lẫn NIGHT

**Files:**
- Modify: `packages/game-engine/src/bot/BotRuntime.ts:393-410` (decideVote), `:508-531` (decideNight)
- Test: `packages/game-engine/tests/bot-residual-policy.test.ts` (phần 2)

**Interfaces:**
- Consumes: `residualVotePolicy`, `residualNightPolicy` (Task 3); `LearnedPolicy.residual` (Task 2); `decideNight(..., policy)` (Task 1).

- [ ] **Step 1: Test (fail)** — thêm vào `bot-residual-policy.test.ts`:
```ts
import { replayGame, runSelfPlay, type SelfPlayGame } from "../src/bot/evaluation/selfplay";
import { gameToTrajectories } from "../src/bot/evaluation/trajectory";
import { actionSize, encodeObservation } from "../src/bot/learning/observation";
import type { LearnedPolicy } from "../src/bot/learning/mlp";

/** Residual = 0 với mọi obs: policy phải là heuristic đúng byte. */
function zeroResidual(beta = 10): LearnedPolicy {
  return { id: `res0-b${beta}`, logits: () => new Array<number>(actionSize()).fill(0), value: () => 0, residual: { beta } };
}
/** Residual thích một vài ô: β·10 = +100 điểm, át mọi chênh lệch heuristic. */
function residualPreferring(indices: number[], beta = 10): LearnedPolicy {
  return {
    id: `res-prefer-${indices.join("-")}`,
    logits: () => { const l = new Array<number>(actionSize()).fill(0); for (const i of indices) l[i] = 10; return l; },
    value: () => 0.25,
    residual: { beta },
  };
}
const decisions = (g: SelfPlayGame) =>
  g.traces.map((t) => [t.botId, t.round, t.decision, t.chosen.actionKind ?? null, t.chosen.targetId]);

describe("residual 0, T=0 → heuristic đúng byte (VOTE + NIGHT)", () => {
  for (let i = 0; i < 20; i += 1) {
    const seed = `res-byte-${i}`;
    it(seed, () => {
      const plain = runSelfPlay({ seed, playerCount: 8, maxRounds: 8, trace: true });
      const res = runSelfPlay({ seed, playerCount: 8, maxRounds: 8, trace: true, learnedPolicy: zeroResidual() });
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
      const g = runSelfPlay({ seed: "res-ld", playerCount: 8, maxRounds: 6, trace: true, learnedPolicy: zeroResidual(), learnedDecisions: ld });
      expect(decisions(g)).toEqual(decisions(plain));
    }
  });
});

describe("residual có thiên hướng lái được cả ngày lẫn đêm", () => {
  it("thích KILL ghế 2 → Sói cắn đúng người đó khi hợp lệ; thích CHOOSE ghế 1 → phiếu đi ghế 1 khi hợp lệ", () => {
    const policy = residualPreferring([actionIndexOf("KILL", 2), actionIndexOf("CHOOSE", 1)]);
    const game = runSelfPlay({ seed: "res-steer", playerCount: 8, maxRounds: 6, trace: true, traceLiveInput: true, learnedPolicy: policy });
    expect(game.violations).toEqual([]);
    let kills = 0;
    let votes = 0;
    for (const t of game.traces) {
      if (!t.liveInput) continue;
      const enc = encodeObservation(t.liveInput);
      if (t.decision === "NIGHT" && t.chosen.actionKind === "KILL") {
        const legal = t.liveInput.observation.nightLegalTargets?.KILL ?? [];
        const seat2 = enc.seats[2];
        if (seat2 !== undefined && legal.includes(seat2)) { expect(t.chosen.targetId).toBe(seat2); kills += 1; }
      }
      if (t.decision === "VOTE" && t.chosen.targetId !== null) {
        const seat1 = enc.seats[1];
        // Chỉ khi seat1 là ứng viên (sống, không phải mình): residual lái, cổng hysteresis có thể giữ phiếu cũ.
        if (seat1 !== undefined && t.candidates.some((c) => c.targetId === seat1) && t.chosen.learned) {
          expect(t.chosen.targetId).toBe(seat1); votes += 1;
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
    const game = runSelfPlay({ seed: "res-roll", playerCount: 8, maxRounds: 6, trace: true, learnedPolicy: policy, learnedTemperature: 5 });
    expect(game.violations).toEqual([]);
    const picks = game.traces.filter((t) => t.chosen.learned);
    expect(picks.some((t) => t.decision === "VOTE")).toBe(true);
    expect(picks.some((t) => t.decision === "NIGHT")).toBe(true);
    for (const t of picks) {
      expect(t.chosen.learned!.beta).toBe(10);
      expect(t.chosen.learned!.temperature).toBe(5);
      expect(t.chosen.learned!.logProb).toBeLessThanOrEqual(0);
    }
    const witch = game.traces.filter((t) => t.decision === "NIGHT" && game.roles[t.botId] === "WITCH");
    for (const t of witch) expect(t.chosen.learned).toBeUndefined();
    const lines = gameToTrajectories(game).filter((l) => l.learned);
    expect(lines).toHaveLength(picks.length);
    for (const l of lines) expect(encodeObservation(l).actionIndex).toBe(l.learned!.actionIndex);
    const again = replayGame(game.record, undefined, policy);
    expect(again.actions).toBe(game.actions);
    expect(again.winner).toBe(game.winner);
    expect(decisions(again)).toEqual(decisions(game));
  });
});
```
(Thám Tử: nếu bộ bài 8 người không có Thám Tử thì bỏ assert Thám Tử; kiểm bằng `PRESET_DECKS` lúc chạy.)

- [ ] **Step 2: Chạy, fail** (BotRuntime chưa đi đường residual → `learned.beta` undefined, Sói không bị lái).

- [ ] **Step 3: Sửa `BotRuntime.ts`**

Import `residualNightPolicy, residualVotePolicy` từ `./policy/residual-policy`.

`decideVote`:
```ts
    const learnedOptions = { temperature: this.learnedTemperature, belief: () => this.beliefAfter };
    const votePolicy =
      this.votePolicy ??
      (this.learnedPolicy && this.learnedDecisions !== "night"
        ? this.learnedPolicy.residual
          ? residualVotePolicy(this.learnedPolicy, this.weights, learnedOptions, run.onPick)
          : learnedPolicyModel(this.learnedPolicy, this.weights, learnedOptions, run.onPick)
        : undefined);
```
`decideNight`:
```ts
    const learnedNight =
      this.learnedPolicy && this.learnedDecisions !== "vote" ? this.learnedPolicy : undefined;
    const learnedOptions = { temperature: this.learnedTemperature, belief: () => this.beliefAfter };
    // Residual đi TRONG strategy (seam `rankNightTargets`), không phải sau nó:
    // nó hiệu chỉnh bảng điểm trước khi vai chọn, và mọi cổng phía sau của vai
    // (Sát Nhân "đêm yên", mục tiêu phụ) vẫn chạy trên lựa chọn đã hiệu chỉnh.
    const nightPolicy = learnedNight?.residual
      ? residualNightPolicy(learnedNight, this.weights, context, this.state, run.rng, learnedOptions, run.onPick)
      : undefined;
    const heuristicNight = strategyFor(context.knowledge.selfRole, this.weights).decideNight(
      context, this.state, run.rng, run.probe, nightPolicy,
    );
    const night =
      learnedNight && !learnedNight.residual
        ? selectLearnedNight(learnedNight, this.weights, context, this.state, heuristicNight, run.rng, learnedOptions, run.onPick)
        : heuristicNight;
```
Cập nhật doc `BotRuntimeOptions.learnedPolicy`: "Model residual (`residual.beta`) hiệu chỉnh bảng điểm heuristic ở cả hai lượt; residual 0 = heuristic đúng byte."

- [ ] **Step 4: Chạy test file + toàn bộ engine, pass.** `npx vitest run --root packages/game-engine`.

- [ ] **Step 5: build:deps + lint, đọc mã thoát**
```bash
npm run build:deps; echo "exit=$?"
npm run lint; echo "exit=$?"
```

- [ ] **Step 6: Commit**
```bash
git add packages/game-engine/src/bot/BotRuntime.ts packages/game-engine/tests/bot-residual-policy.test.ts
git commit -m "feat(ai): BotRuntime đi đường residual khi model tự khai — residual 0 byte-identical heuristic ở VOTE lẫn NIGHT"
```

---

### Task 5: Encode rollout residual — `candidateBases`, `bases.f32.bin`, meta β/τ, từ chối trộn

**Files:**
- Modify: `packages/game-engine/src/bot/learning/dataset.ts:521-566`
- Modify: `apps/server/scripts/ai-encode.ts`
- Test: `packages/game-engine/tests/bot-learning.test.ts` (candidateBases), `bot-residual-policy.test.ts` (tái tính logProb)

**Interfaces:**
- Produces:
```ts
/** Điểm THẬT (có jitter) của từng ứng viên theo ô hành động; NaN ở ô khác. Điểm nền của residual. */
export function candidateBases(line: BotTrajectory, encoded: EncodedObservation, maxSeats?: number): number[];
```
- meta.json thêm: `policyKind: "residual" | "logits" | null`, `beta: number | null`.

- [ ] **Step 1: Test (fail)**

`bot-learning.test.ts`, cạnh test `candidateScores` hiện có (tìm `describe` chứa nó và dùng cùng helper `line(...)`):
```ts
  it("candidateBases: giữ jitter; candidateScores: bỏ jitter; cùng ô", () => {
    const l = line({
      candidates: [
        { targetId: "p1", score: 50, terms: [{ name: "belief", value: 40 }, { name: "jitter", value: 10 }], evidenceIds: [] },
        { targetId: "p3", score: 40, terms: [{ name: "belief", value: 40 }, { name: "jitter", value: 0 }], evidenceIds: [] },
      ],
    });
    const enc = encodeObservation(l);
    const bases = candidateBases(l, enc);
    const scores = candidateScores(l, enc);
    const p1 = enc.seats.indexOf("p1");
    const p3 = enc.seats.indexOf("p3");
    expect(bases[actionIndexOf("CHOOSE", p1)]).toBe(50);
    expect(scores[actionIndexOf("CHOOSE", p1)]).toBe(40);
    expect(bases[actionIndexOf("CHOOSE", p3)]).toBe(40);
    expect(bases.filter((v) => !Number.isNaN(v))).toHaveLength(2);
  });
```
`bot-residual-policy.test.ts` thêm:
```ts
import { candidateBases } from "../src/bot/learning/dataset";

describe("bases + β + τ dựng lại đúng logProb đã ghi (điều kiện approxKl ≈ 0)", () => {
  it("log softmax((bases + β·logits)/τ)[a] == learned.logProb ở mọi line rollout", () => {
    const policy = residualPreferring([actionIndexOf("KILL", 2), actionIndexOf("CHOOSE", 3)]);
    const game = runSelfPlay({ seed: "res-recon", playerCount: 8, maxRounds: 6, trace: true, learnedPolicy: policy, learnedTemperature: 5 });
    const lines = gameToTrajectories(game).filter((l) => l.learned);
    expect(lines.length).toBeGreaterThan(10);
    for (const l of lines) {
      const enc = encodeObservation(l);
      const bases = candidateBases(l, enc);
      const logits = policy.logits(enc.features);
      const adj = bases.map((b, i) => (Number.isNaN(b) ? Number.NaN : (b + 10 * logits[i]!) / 5));
      const idx = adj.map((v, i) => (Number.isNaN(v) ? -1 : i)).filter((i) => i >= 0);
      const max = Math.max(...idx.map((i) => adj[i]!));
      const z = idx.reduce((s, i) => s + Math.exp(adj[i]! - max), 0);
      const a = l.learned!.actionIndex;
      expect(idx).toContain(a);
      expect(adj[a]! - max - Math.log(z)).toBeCloseTo(l.learned!.logProb, 9);
    }
  });
});
```

- [ ] **Step 2: Chạy, fail.**

- [ ] **Step 3: `dataset.ts`** — đổi `scoredSlots(line, encoded, maxSeats, keepJitter = false)`: chỉ trừ jitter khi `!keepJitter`. Thêm:
```ts
/**
 * Điểm THẬT (có jitter) theo ô hành động — điểm nền mà residual policy đã
 * cộng β·net vào. Khác `candidateScores` đúng ở term jitter: Python dựng lại
 * phân phối của policy đã đi từ đây, nên nó phải là đúng số policy đã thấy.
 */
export function candidateBases(line, encoded, maxSeats = DEFAULT_MAX_SEATS): number[] {
  const out = new Array<number>(actionSize(maxSeats)).fill(Number.NaN);
  for (const [index, score] of scoredSlots(line, encoded, maxSeats, true)) out[index] = score;
  return out;
}
```

- [ ] **Step 4: `ai-encode.ts`**

- Import `candidateBases`. Biến mới `let beta: number | null = null; let basesStream: WriteStream | null = null; let warnedMixed = false;`.
- Đưa kiểm tra rollout lên TRƯỚC khi ghi bất kỳ stream nào (ngay sau kiểm `actionIndex` lệch):
```ts
    if (rolloutStreams && line.learned) {
      const lineBeta = line.learned.beta ?? null;
      if (temperature === null) { temperature = line.learned.temperature; beta = lineBeta; }
      else if (line.learned.temperature !== temperature || lineBeta !== beta) {
        rejected += 1;
        if (!warnedMixed) { warnedMixed = true; process.stderr.write(`CẢNH BÁO: line rollout có T/β (${line.learned.temperature}/${lineBeta}) khác line đầu (${temperature}/${beta}) ở ván ${line.gameId} — tập trộn hai policy là tập PPO sai. Chỉ báo một lần.\n`); }
        continue;
      }
    }
```
- Sau khi ghi `scores`: 
```ts
    if (rolloutStreams && line.learned && beta !== null) {
      basesStream ??= createWriteStream(join(outDir, "bases.f32.bin"));
      basesStream.write(Buffer.from(Float32Array.from(candidateBases(line, encoded, options.maxSeats)).buffer));
    }
```
- Đưa `basesStream` vào danh sách `end` (nếu khác null).
- meta: `policyKind: options.rollout ? (beta !== null ? "residual" : "logits") : null, beta,`.
- Dòng in: `rollout     T = … β = … (${policyKind})`.
- Doc đầu file: mô tả `bases.f32.bin`.

- [ ] **Step 5: Chạy test engine, pass. build:deps + lint (server lint bao gồm scripts), đọc mã thoát. Commit**
```bash
git add packages/game-engine/src/bot/learning/dataset.ts apps/server/scripts/ai-encode.ts packages/game-engine/tests/bot-learning.test.ts packages/game-engine/tests/bot-residual-policy.test.ts
git commit -m "feat(ai): encode rollout residual — bases.f32.bin (điểm có jitter), meta β/τ, từ chối tập trộn"
```

---

### Task 6: Python — `bases`, export `residual`, `init_residual.py`, PPO residual, test

**Files:**
- Modify: `ai-training/masoi_training/data.py`, `export.py`, `train_ppo.py`
- Create: `ai-training/masoi_training/init_residual.py`
- Test: `ai-training/tests/test_ppo.py`, `ai-training/tests/test_export.py`

**Interfaces:**
- `Dataset.bases: np.ndarray | None  # (N, action_size) float32, NaN = không ứng viên`
- `export_weights_json(..., residual: dict | None = None)` → `payload["residual"]` khi có.
- `load_init(path, obs, act) -> (model, hidden, residual | None)`.
- `python -m masoi_training.init_residual --from <json> --out <json> [--beta 10] [--model-id residual-0000] [--fresh]`.

- [ ] **Step 1: Test (fail)**

`test_export.py` thêm trước `print("ok")`:
```python
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "res.weights.json"
        export_weights_json(model, meta, path, model_id="r", training_seed=1, hidden=hidden, residual={"beta": 10.0})
        r = json.loads(path.read_text(encoding="utf8"))
    assert r["residual"] == {"beta": 10.0}, r.get("residual")
    assert "residual" not in w, "model thường không được mang residual"
```
`test_ppo.py`: tách thân `main()` hiện có thành `logits_case()`; thêm `residual_case()`:
```python
def residual_case() -> None:
    torch.manual_seed(1)
    rng = np.random.default_rng(1)
    beta, tau = 10.0, 5.0
    init = PolicyValueNet(OBS, ACT, 8).eval()
    with torch.no_grad():
        init.policy_head.weight.zero_(); init.policy_head.bias.zero_()   # champion-0000: residual 0
    feats = rng.random((ROWS, OBS), dtype=np.float32)
    masks = np.zeros((ROWS, ACT), dtype=np.uint8); masks[:, :5] = 1        # mask encoder rộng hơn bảng
    bases = np.full((ROWS, ACT), np.nan, dtype=np.float32)
    bases[:, :4] = rng.random((ROWS, 4), dtype=np.float32) * 20             # bảng = 4 ứng viên
    cand = ~np.isnan(bases)
    with torch.no_grad():
        lg, val = init(torch.from_numpy(feats))
        adj = (torch.from_numpy(np.nan_to_num(bases)) + beta * lg) / tau
        lp = torch.log_softmax(masked_logits(adj, torch.from_numpy(cand)), 1)
    actions = torch.distributions.Categorical(logits=lp).sample().numpy().astype("<i4")
    logprobs = lp[np.arange(ROWS), actions].numpy().astype("<f4")
    rewards = np.where(actions == 0, 1, -1).astype(np.int8)
    roles = (np.arange(ROWS) % 2).astype(np.uint8)
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp) / "enc"; d.mkdir()
        feats.astype("<f4").tofile(d / "features.f32.bin"); masks.tofile(d / "masks.u8.bin")
        actions.tofile(d / "actions.i32.bin"); rewards.tofile(d / "rewards.i8.bin")
        np.zeros(ROWS, np.uint8).tofile(d / "splits.u8.bin"); roles.tofile(d / "roles.u8.bin")
        np.zeros(ROWS, np.uint8).tofile(d / "decisions.u8.bin")
        logprobs.tofile(d / "logprobs.f32.bin"); val.numpy().astype("<f4").tofile(d / "values.f32.bin")
        bases.astype("<f4").tofile(d / "bases.f32.bin")
        meta = {"rows": ROWS, "obsSize": OBS, "actionSize": ACT, "datasetVersion": "rollout-test",
                "roles": ["A", "B"], "decisions": ["VOTE"], "featureNames": [f"f{i}" for i in range(OBS)],
                "actionNames": [f"a{i}" for i in range(ACT)], "policyKind": "residual", "beta": beta, "temperature": tau}
        (d / "meta.json").write_text(json.dumps(meta), encoding="utf8")
        initp = Path(tmp) / "init.weights.json"
        export_weights_json(init, meta, initp, model_id="res0", training_seed=0, hidden=8, residual={"beta": beta})
        out = Path(tmp) / "out"
        sys.argv = ["train_ppo", "--data", str(d), "--init", str(initp), "--out", str(out), "--epochs", "8", "--batch-size", "64", "--model-id", "r"]
        train_ppo.main()
        m = json.loads((out / "metrics.json").read_text(encoding="utf8"))
        assert m["history"][0]["approxKl"] < 1e-4, ("residual: ratio ban đầu phải ≈ 1", m["history"][0])
        assert m["policyKind"] == "residual" and m["beta"] == beta and m["temperature"] == tau, m
        w = json.loads((out / "model.weights.json").read_text(encoding="utf8"))
        assert w["residual"] == {"beta": beta}, w.get("residual")
        new = PolicyValueNet(OBS, ACT, 8); new.load_state_dict(torch.load(out / "model.pt")); new.eval()
        with torch.no_grad():
            lg2, _ = new(torch.from_numpy(feats))
            adj2 = (torch.from_numpy(np.nan_to_num(bases)) + beta * lg2) / tau
            p = torch.softmax(masked_logits(adj2, torch.from_numpy(cand)), 1)
        assert float(p[:, 4:].max()) < 1e-6, "ô ngoài bảng phải giữ xác suất 0"
        assert float(p[:, 0].mean()) > float(torch.softmax(lp, 1)[:, 0].mean()), "hành động thắng phải tăng xác suất"
```
`main()` gọi `logits_case(); residual_case(); print("ok")`.

- [ ] **Step 2: Chạy, fail** (script ở scratchpad không cần; lệnh trực tiếp):
```bash
cd ai-training && PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python tests/test_export.py; PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python tests/test_ppo.py
```

- [ ] **Step 3: `data.py`** — thêm trường `bases`, đọc `bases.f32.bin` như `scores`, kiểm kích thước `rows*action_size`, reshape, truyền qua `split()`.

- [ ] **Step 4: `export.py`** — `residual: dict | None = None`; `if residual: payload["residual"] = {"beta": float(residual["beta"])}`.

- [ ] **Step 5: `init_residual.py`**
```python
"""Tạo champion-0000 cho residual policy (spec residual D2).

Chép trunk + value head + tên đặc trưng từ một model có sẵn (policy-0004:
đặc trưng đã học), ZERO `policyHead` để residual = 0 với mọi observation, và
gắn `residual.beta`. Kết quả nạp vào engine là heuristic đúng byte — điểm xuất
phát của PPO là teacher, không phải một bản sao thua teacher.
"""
from __future__ import annotations
import argparse, json
from pathlib import Path
import torch
from .model import PolicyValueNet

def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--from", dest="source", required=True, help="model.weights.json nguồn (schema encoder hiện tại)")
    p.add_argument("--out", required=True)
    p.add_argument("--beta", type=float, default=10.0)
    p.add_argument("--model-id", default="residual-0000")
    p.add_argument("--fresh", action="store_true", help="trunk ngẫu nhiên (seed 0) thay vì chép từ nguồn")
    a = p.parse_args()
    assert a.beta > 0, "beta phải > 0"
    w = json.loads(Path(a.source).read_text(encoding="utf8"))
    assert w["format"] == "masoi-mlp-1", w.get("format")
    obs, act, hidden = int(w["obsSize"]), int(w["actionSize"]), int(w["hidden"])
    if a.fresh:
        torch.manual_seed(0)
        m = PolicyValueNet(obs, act, hidden)
        w["layers"] = [{"w": l.weight.tolist(), "b": l.bias.tolist()} for l in (m.trunk[0], m.trunk[2])]
        w["valueHead"] = {"w": m.value_head[0].weight.tolist(), "b": m.value_head[0].bias.tolist()}
    w["policyHead"] = {"w": [[0.0] * hidden for _ in range(act)], "b": [0.0] * act}
    w["residual"] = {"beta": a.beta}
    w["modelId"] = a.model_id
    w["trainingSeed"] = 0
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(w), encoding="utf8")
    print(f"Đã ghi {a.out}: residual β={a.beta}, policyHead = 0, trunk {'mới' if a.fresh else 'chép từ ' + a.source}")

if __name__ == "__main__":
    main()
```

- [ ] **Step 6: `train_ppo.py`**

- `load_init` trả thêm `w.get("residual")`.
- Sau `d = load(a.data)`:
```python
    residual = d.meta.get("policyKind") == "residual"
    if residual:
        assert d.bases is not None, "meta nói residual nhưng thiếu bases.f32.bin"
        beta = float(d.meta["beta"]); tau = float(d.meta["temperature"])
        assert tau > 0, "rollout residual phải có temperature > 0"
        assert init_residual is not None and abs(float(init_residual["beta"]) - beta) < 1e-9, (
            f"β của init ({init_residual}) khác β của rollout ({beta})")
        BASES = torch.from_numpy(np.nan_to_num(d.bases, nan=0.0).astype(np.float32))
        CAND = torch.from_numpy(~np.isnan(d.bases))
        assert bool(CAND[torch.arange(len(d)), torch.from_numpy(d.actions)].all()), (
            "có hàng mà hành động đã đi không nằm trong bảng ứng viên — tập không nhất quán")
    else:
        assert init_residual is None, "init là residual nhưng rollout không phải — hai policy khác nhau"
```
- Hàm dùng chung:
```python
    def policy_logp(logits: torch.Tensor, idx: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        """(log-softmax toàn hàng, mask đang dùng) của policy trên batch `idx`."""
        if residual:
            adj = (BASES[idx] + beta * logits) / tau
            return torch.log_softmax(masked_logits(adj, CAND[idx]), dim=1), CAND[idx]
        return torch.log_softmax(masked_logits(logits, M[idx]), dim=1), M[idx]
```
Trong vòng batch: `logp_all, used = policy_logp(logits, idx)`; entropy dùng `used` thay `M[idx]`. Phần `agreementWithInit`: `all_idx = torch.arange(len(d))`; `new = policy_logp(model(X)[0], all_idx)[0].argmax(1)`; tương tự cho `ref`.
- Export: `export_weights_json(..., residual=init_residual)`. Metrics thêm `"policyKind": "residual" if residual else "logits", "beta": beta if residual else None, "temperature": d.meta.get("temperature")`.
- Docstring: thêm đoạn "Residual: ratio trên softmax((bases + β·net)/τ); bases là điểm THẬT (có jitter) đã ghi, cùng cho cũ và mới nên jitter triệt tiêu."

- [ ] **Step 7: Chạy 4 test Python, `ok`; commit**
```bash
cd ai-training
for t in test_data test_export test_train_smoke test_ppo; do PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python tests/$t.py || echo "FAIL $t"; done
git add ai-training/masoi_training ai-training/tests
git commit -m "feat(ai): PPO residual — ratio trên (bases + β·net)/τ; init_residual tạo champion-0000 = heuristic"
```

---

### Task 7: `rl_loop.py` bench 4 cấu hình; tài liệu

**Files:**
- Modify: `ai-training/rl_loop.py` (hai lệnh benchmark), `ai-training/README.md`, `docs/BOT_SELF_LEARNING_TRAINING.md`

- [ ] **Step 1:** Hai lệnh `ai:benchmark` trong `rl_loop.py` thêm `"--setups", "baseline,village,wolves,all"`. Docstring thêm: "Residual: champion là file do `init_residual` tạo; chạy với `--temperature 5` (thang belief). `all` chỉ để đọc cân bằng — `score_of` vẫn theo village/wolves."
- [ ] **Step 2:** README `ai-training`: mục "Residual policy" — 3 lệnh (init_residual, rl_loop, benchmark) và ý nghĩa `bases`. `docs/BOT_SELF_LEARNING_TRAINING.md`: bước "Residual" ngắn, trỏ spec.
- [ ] **Step 3:** Commit `docs(ai): residual — cách chạy rl_loop, benchmark 4 cấu hình`.

---

### Task 8: Bằng chứng — champion-0000 Δ = 0,0; `rl_loop` 3 vòng; báo cáo; PR

**Files:**
- Modify: `reports/train-policy-0002.md` (mục mới), tạo `reports/bench-residual-0000.json`

- [ ] **Step 1: Kiểm toàn bộ**
```bash
npm run build; echo "exit=$?"
npm run lint; echo "exit=$?"
npx vitest run --root packages/game-engine; npx vitest run --root apps/server
```
- [ ] **Step 2: champion-0000**
```bash
cd ai-training && PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m masoi_training.init_residual --from ../.tmp/model-ob/model.weights.json --out ../.tmp/residual/champion-0000.weights.json --beta 10
```
- [ ] **Step 3: Δ = 0,0**
```bash
npm run ai:benchmark -- --model .tmp/residual/champion-0000.weights.json --setups baseline,village,wolves,all --seed rl-bench --out reports/bench-residual-0000.json
```
Expected: ba dòng Δ đúng `+0.0 ± 0.0`. Khác 0 = bug ở Task 4 (không được "trong nhiễu").
- [ ] **Step 4: Rollout thử nhỏ để kiểm encode TỪ CHỐI 0**
```bash
npx tsx apps/server/scripts/selfplay.ts --games 20 --players 8 --preset --defense --seed res-smoke --policy .tmp/residual/champion-0000.weights.json --temperature 5 --learned-seats all --trajectories .tmp/residual/smoke --trace-games 20 --quiet
npm run ai:encode -- --in .tmp/residual/smoke/trajectories.jsonl --out .tmp/residual/smoke-enc --rollout
```
Expected: `TỪ CHỐI 0`, `rollout T = 5 β = 10 (residual)`, có `bases.f32.bin`. Rồi một PPO thật trên tập nhỏ: `approxKl` epoch 1 phải < 1e-3.
- [ ] **Step 5: Chạy thật (nền, ~1 giờ)**
```bash
cd ai-training && PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python rl_loop.py --champion ../.tmp/residual/champion-0000.weights.json --iterations 3 --games 900 --temperature 5 --out ../.tmp/rl-residual
```
- [ ] **Step 6: Báo cáo** — mục mới trong `reports/train-policy-0002.md`: bảng vòng × (village, wolves, all) ± SE (đọc `paired` trong `bench.json` mỗi vòng), `approxKl` epoch 1 mỗi vòng, agreementWithInit, kết luận trung thực. Commit.
- [ ] **Step 7: PR** qua REST API (`repos/the-nightforge/Nightfall/pulls`, base `main`), body = tóm tắt + bảng; comment PR = bảng kết quả.

---

## Self-review

- Spec D1 (giữ jitter) → Task 3 (`residualRows` dùng `candidate.score` thật), Task 5 (`candidateBases`). D2 → Task 2, 6. D3 → Task 1. D4 → Task 3, 4. D5 → Task 5. D6 → Task 6. D7 → Task 7. D8 → không task nào đụng `session-registry.ts`. Tiêu chí xong → Task 4 (byte-identical, rollout), Task 5 (logProb tái tính), Task 6 (approxKl), Task 8 (Δ=0, 3 vòng, build/lint/test).
- Tên nhất quán: `NightPolicyModel.selectTarget(action, candidates)`, `residualVotePolicy`, `residualNightPolicy`, `pickResidual`, `residualRows`, `candidateBases`, `LearnedPick.beta`, `LearnedPolicy.residual`, `bases.f32.bin`, meta `policyKind`/`beta`.
