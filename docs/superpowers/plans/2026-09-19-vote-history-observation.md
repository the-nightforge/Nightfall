# Dự án con B — lịch sử phiếu trong observation: kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho model thấy lịch sử phiếu công khai (384 chiều nối cuối observation), đấu được đối đầu với `village-ppo-0001`, rồi train lại BC → RL để làng học trừng phạt sói "không bao giờ vote đồng bọn".

**Architecture:** Chiều mới nối SAU khối theo ghế; loader chấp nhận model có `featureNames` là tiền tố và tự cắt vector, nên model cũ vẫn chạy y hệt. Lịch sử đi qua `snapshotKnowledge` → `observationFromTrace` (đường duy nhất cho train lẫn runtime). Self-play nhận `opponentPolicy` cho phe không học; benchmark có setup đối đầu; `rl_loop` cho rollout của phe đang train gặp đối thủ; `rl_stages` có bộ hằng số dự án `b`.

**Tech Stack:** TypeScript (`packages/game-engine`, `apps/server/scripts`, vitest), Python 3 (`ai-training`, script test `python tests/x.py`), notebook Jupyter.

**Spec:** `docs/superpowers/specs/2026-09-19-vote-history-observation-design.md`

## Global Constraints

- 413 chiều observation hiện có giữ NGUYÊN tên, thứ tự, giá trị; chiều mới chỉ nối cuối.
- Observation mới: 413 + 16 × 8 + 16 × 16 = **797** chiều (maxSeats 16).
- Mọi chiều lịch sử ∈ [0, 1]; mẫu số 0 → 0; ghế trống → 0.
- "Vai đã lộ" chỉ lấy từ `knownRoles` của chính bot — không bao giờ vai thật.
- Model 413 chiều (`village-bc-0002`, `village-ppo-0001`) phải nạp được và chơi ra ĐÚNG cùng kết quả như trước thay đổi.
- `learnedSeats = "all"` kèm `opponentPolicy` → ném.
- Trajectory chỉ mang `learned` ở ghế dùng `learnedPolicy`; ghế đối thủ không bao giờ sinh dòng PPO.
- Confirm B: `--temperature 0.5`, seed `confirm-0919`, 5 × 300 ván.
- Tiêu chí đóng gói `village-ppo-0002`: Δ làng đối đầu ≥ +2; mỗi phe ≥ ppo-0001 − 1 (so với heuristic); `imbalance(all)` ≤ ppo-0001 + 1; 0 vi phạm.
- Tên model: BC mới `village-bc-0003`; RL mới `village-ppo-0002`.
- Người dùng tự chạy dataset/BC/RL/confirm (notebook hoặc terminal); agent không chạy các giai đoạn train.
- Commit kết thúc bằng `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File Structure

| File | Trách nhiệm | Task |
|---|---|---|
| `packages/game-engine/src/bot/learning/mlp.ts` | Loader chấp nhận tiền tố, forward cắt vector | 1 |
| `packages/game-engine/src/bot/trace/trace.ts` | Kiểu `VoteDaySummary`, trường `voteHistory` trong snapshot | 2 |
| `packages/game-engine/src/bot/trace/snapshot.ts` | `summarizeVoteDay`, chép lịch sử vào snapshot | 2 |
| `packages/game-engine/src/bot/evaluation/trajectory.ts` | `voteHistory` trong observation; bỏ `learned` ở ghế đối thủ | 2, 4 |
| `packages/game-engine/src/bot/learning/observation.ts` | Tên + mã hoá 384 chiều lịch sử | 3 |
| `packages/game-engine/src/bot/evaluation/selfplay.ts` | `opponentPolicy`, record, replay | 4 |
| `packages/game-engine/src/bot/evaluation/report.ts` | `SelfPlayBatchInput.opponentPolicy` | 4 |
| `apps/server/scripts/selfplay.ts` | `--opponent-policy` | 5 |
| `apps/server/scripts/ai-benchmark.ts` | `--opponent`, setup `h2h-village`/`h2h-wolves`/`opponent` | 5 |
| `ai-training/rl_loop.py` | `--opponent` cho rollout phe | 6 |
| `ai-training/rl_stages.py` | `set_project("b")`, `confirm_b` | 7 |
| `ai-training/colab/train_rl_local.ipynb` | Biến `PROJECT` | 7 |
| Test: `packages/game-engine/tests/bot-mlp.test.ts`, `bot-vote-history.test.ts` (mới), `bot-learned-policy.test.ts`, `ai-training/tests/test_rl_gates.py`, `ai-training/tests/test_rl_stages.py` | | 1–7 |

---

### Task 1: Loader chấp nhận model có observation là tiền tố

**Files:**
- Modify: `packages/game-engine/src/bot/learning/mlp.ts` (hàm `sameList`, `loadMlpPolicy`)
- Test: `packages/game-engine/tests/bot-mlp.test.ts`

**Interfaces:**
- Consumes: `observationSize(maxSeats)`, `observationFeatureNames(maxSeats)` (không đổi).
- Produces: `loadMlpPolicy(json, options)` — chấp nhận `obsSize ≤ observationSize()` khi `featureNames` là tiền tố; `LearnedPolicy.logits/value(features)` vẫn nhận vector ĐỦ `observationSize()` chiều và tự cắt còn `obsSize`.

- [ ] **Step 1: Viết test hỏng**

Thêm vào `packages/game-engine/tests/bot-mlp.test.ts` (dùng lại `zeroWeights()` sẵn có ở đầu file):

```ts
describe("loadMlpPolicy — model train trên observation TIỀN TỐ (spec 2026-09-19 D1)", () => {
  /** zeroWeights nhưng chỉ `keep` chiều đầu, và một trọng số ≠ 0 để output phụ thuộc input. */
  function prefixWeights(keep: number): MlpWeightsJson {
    const w = zeroWeights();
    const hidden = w.hidden;
    return {
      ...w,
      modelId: "prefix",
      obsSize: keep,
      featureNames: observationFeatureNames().slice(0, keep),
      layers: [
        { w: Array.from({ length: hidden }, (_, r) => Array.from({ length: keep }, (_, c) => (r === 0 && c === 0 ? 1 : 0))), b: [0, 0] },
        { w: [[1, 0], [0, 1]], b: [0, 0] },
      ],
      policyHead: { w: Array.from({ length: w.actionSize }, (_, r) => [r === 0 ? 1 : 0, 0]), b: new Array<number>(w.actionSize).fill(0) },
    };
  }

  it("nạp được, nhận vector đủ chiều, và bỏ qua phần đuôi", () => {
    const keep = observationSize() - 5;
    const policy = loadMlpPolicy(prefixWeights(keep));
    const x = new Array<number>(observationSize()).fill(0);
    x[0] = 2;
    const base = policy.logits(x);
    expect(base[0]).toBeGreaterThan(0);
    const tail = [...x];
    for (let i = keep; i < tail.length; i += 1) tail[i] = 9;
    expect(policy.logits(tail)).toEqual(base);
  });

  it("vẫn ném khi tên lệch TRONG phần tiền tố", () => {
    const w = prefixWeights(observationSize() - 5);
    w.featureNames = [...w.featureNames];
    w.featureNames[3] = "khac";
    expect(() => loadMlpPolicy(w)).toThrow(/featureNames/);
  });

  it("vẫn ném khi model dài hơn encoder", () => {
    const w = zeroWeights();
    w.obsSize = observationSize() + 1;
    w.featureNames = [...observationFeatureNames(), "thua"];
    expect(() => loadMlpPolicy(w)).toThrow(/obsSize/);
  });

  it("vẫn ném khi vector đưa vào không đủ chiều encoder", () => {
    const policy = loadMlpPolicy(prefixWeights(observationSize() - 5));
    expect(() => policy.logits(new Array<number>(observationSize() - 5).fill(0))).toThrow(/chiều/);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận hỏng**

Run: `cd packages/game-engine && npx vitest run tests/bot-mlp.test.ts`
Expected: FAIL ở "nạp được…" với `obsSize … ≠ encoder …`.

- [ ] **Step 3: Sửa loader**

Trong `mlp.ts`, thay `sameList` bằng hàm kiểm tiền tố (giữ `sameList` cho `actionNames`):

```ts
/** `got` phải là TIỀN TỐ dài đúng `length` của `want` (spec 2026-09-19 D1). */
function prefixList(name: string, got: unknown, want: readonly string[], length: number): void {
  if (!Array.isArray(got) || got.length !== length || got.some((v, i) => v !== want[i])) {
    throw new Error(
      `${name} không khớp encoder hiện tại — model này train trên schema khác, từ chối nạp`,
    );
  }
}
```

Trong `loadMlpPolicy`, thay khối kiểm `obsSize`/`featureNames`:

```ts
  const obs = observationSize(options.maxSeats);
  const act = actionSize(options.maxSeats);
  // Chiều mới chỉ NỐI CUỐI (spec 2026-09-19 D1): model cũ đọc tiền tố của
  // vector mới, nên rollback về model cũ vẫn chơi y hệt.
  const input = w.obsSize;
  if (typeof input !== "number" || !Number.isInteger(input) || input <= 0 || input > obs) {
    throw new Error(`obsSize ${w.obsSize} ≠ encoder ${obs} (chỉ nhận tiền tố ≤ ${obs})`);
  }
  if (w.actionSize !== act) throw new Error(`actionSize ${w.actionSize} ≠ encoder ${act}`);
  prefixList("featureNames", w.featureNames, observationFeatureNames(options.maxSeats), input);
  sameList("actionNames", w.actionNames, actionNames(options.maxSeats));
```

Đổi `let width = obs;` thành `let width = input;`, và trong `valueLayers` đổi `i === 0 ? obs : …` thành `i === 0 ? input : …`.

Thay `guard` và hai hàm cuối:

```ts
  const fit = (x: readonly number[]): readonly number[] => {
    if (x.length !== obs) throw new Error(`features phải có ${obs} chiều, nhận ${x.length}`);
    return input === obs ? x : x.slice(0, input);
  };
  return {
    id,
    ...(residual ? { residual } : {}),
    logits(features) {
      return mlpForward(weights, fit(features)).logits;
    },
    value(features) {
      return mlpForward(weights, fit(features)).value;
    },
  };
```

- [ ] **Step 4: Chạy test, xác nhận đạt**

Run: `cd packages/game-engine && npx vitest run tests/bot-mlp.test.ts`
Expected: PASS. Nếu một test CŨ trong file khẳng định "obsSize nhỏ hơn thì ném" với `featureNames` đúng tiền tố, đó là hành vi cũ đã cố ý đổi: sửa test đó dùng `obsSize` lớn hơn encoder.

- [ ] **Step 5: Kiểm mọi chỗ khác đọc `obsSize`**

Run: `git grep -n "obsSize\|observationSize(" -- packages apps ':!*.test.ts'`
Expected: chỉ `mlp.ts`, `observation.ts`, `ai-encode.ts` (ghi meta). Nếu một policy khác (`residual-policy.ts`, `hybrid.ts`) tự kiểm `features.length === w.obsSize`, cho nó đi qua `LearnedPolicy.logits` thay vì tự kiểm.

- [ ] **Step 6: Commit**

```bash
git add packages/game-engine/src/bot/learning/mlp.ts packages/game-engine/tests/bot-mlp.test.ts
git commit -m "feat(engine): load models trained on an observation prefix (spec 2026-09-19 D1)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Lịch sử phiếu vào snapshot và trajectory

**Files:**
- Modify: `packages/game-engine/src/bot/trace/trace.ts` (`TraceKnowledgeSnapshot`)
- Modify: `packages/game-engine/src/bot/trace/snapshot.ts` (`snapshotKnowledge`)
- Modify: `packages/game-engine/src/bot/evaluation/trajectory.ts` (`BotTrajectory.observation`, `observationFromTrace`)
- Test: `packages/game-engine/tests/bot-vote-history.test.ts` (mới)

**Interfaces:**
- Consumes: `BotKnowledgeView.publicVoteHistory: DayVoteRecap[]` (engine `recordDayVoteRecap` đẩy recap khi ngày bầu phân xử xong; `finalJudgment` điền sau phiên toà — nên lúc FINAL_VOTE, recap hôm nay đã có mặt với `finalJudgment: null`. Đó là thông tin công khai, dùng được).
- Produces:
  - `export interface VoteDaySummary { round: number; ballots: Record<string, string | null>; changed: string[]; accusedId: string | null; guilty: string[]; innocent: string[] }` trong `trace.ts`.
  - `export function summarizeVoteDay(recap: DayVoteRecap): VoteDaySummary` trong `snapshot.ts`.
  - `TraceKnowledgeSnapshot.voteHistory?: VoteDaySummary[]`.
  - `BotTrajectory["observation"].voteHistory?: VoteDaySummary[]` (optional: đọc được JSONL cũ), luôn được `observationFromTrace` điền (`[]` khi trace cũ).

- [ ] **Step 1: Viết test hỏng**

Tạo `packages/game-engine/tests/bot-vote-history.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { DayVoteRecap } from "@masoi/shared";
import { runSelfPlay } from "../src/bot/evaluation/selfplay";
import { gameToTrajectories, observationFromTrace } from "../src/bot/evaluation/trajectory";
import { summarizeVoteDay } from "../src/bot/trace/snapshot";

const recap: DayVoteRecap = {
  round: 1,
  mutations: [
    { id: "m1", round: 1, voterId: "c", previousChoice: null, choice: { type: "PLAYER", targetId: "d" }, castAt: 1, phaseStartedAt: 0, phaseEndsAt: 9, sequence: 1 },
    { id: "m2", round: 1, voterId: "c", previousChoice: { type: "PLAYER", targetId: "d" }, choice: { type: "PLAYER", targetId: "b" }, castAt: 2, phaseStartedAt: 0, phaseEndsAt: 9, sequence: 2 },
  ],
  finalBallots: [
    { voterId: "a", choice: { type: "PLAYER", targetId: "b" } },
    { voterId: "c", choice: { type: "PLAYER", targetId: "b" } },
    { voterId: "d", choice: { type: "NO_ELIMINATION" } },
  ],
  nomination: { kind: "TRIAL", accusedId: "b" },
  finalJudgment: {
    ballots: [{ voterId: "c", guilty: true }, { voterId: "a", guilty: true }, { voterId: "d", guilty: false }],
    guilty: 2, innocent: 1, abstain: 0, lynched: true,
  },
};

describe("summarizeVoteDay", () => {
  it("giữ phiếu chốt, người đổi phiếu, bị cáo, phiếu treo/tha — đã sort", () => {
    expect(summarizeVoteDay(recap)).toEqual({
      round: 1,
      ballots: { a: "b", c: "b", d: null },
      changed: ["c"],
      accusedId: "b",
      guilty: ["a", "c"],
      innocent: ["d"],
    });
  });

  it("ngày không ra toà: accusedId null, không có phiếu treo/tha", () => {
    const s = summarizeVoteDay({ ...recap, nomination: { kind: "NONE", reason: "tie" }, finalJudgment: null });
    expect(s.accusedId).toBeNull();
    expect(s.guilty).toEqual([]);
    expect(s.innocent).toEqual([]);
  });
});

describe("voteHistory trong trace/trajectory", () => {
  it("ván thật: từ vòng 2 trở đi observation có lịch sử, và lịch sử không vượt vòng hiện tại", () => {
    const game = runSelfPlay({ seed: "vh-1", playerCount: 8, maxRounds: 6, trace: true });
    const lines = gameToTrajectories(game);
    const later = lines.filter((l) => l.turn >= 2 && l.decision === "VOTE");
    expect(later.length).toBeGreaterThan(0);
    for (const line of later) {
      expect(line.observation.voteHistory!.length).toBeGreaterThan(0);
      for (const day of line.observation.voteHistory!) expect(day.round).toBeLessThanOrEqual(line.turn);
    }
  });

  it("trace cũ không có voteHistory → observation mang mảng rỗng", () => {
    const game = runSelfPlay({ seed: "vh-2", playerCount: 8, maxRounds: 3, trace: true });
    const trace = game.traces[0]!;
    const { voteHistory: _drop, ...oldSnapshot } = trace.knowledgeSnapshot;
    expect(observationFromTrace({ ...trace, knowledgeSnapshot: oldSnapshot }).observation.voteHistory).toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận hỏng**

Run: `cd packages/game-engine && npx vitest run tests/bot-vote-history.test.ts`
Expected: FAIL — `summarizeVoteDay` không được export.

- [ ] **Step 3: Thêm kiểu và trường vào `trace.ts`**

Ngay trên `export interface TraceKnowledgeSnapshot`:

```ts
/**
 * Một ngày bầu, rút gọn từ `DayVoteRecap` còn đúng thứ encoder đọc (spec
 * 2026-09-19 D2). Gọn vì nó đi vào MỌI dòng trajectory: bản đầy đủ mang
 * timestamp của từng lần đổi phiếu, vô ích cho model và làm dataset phình.
 */
export interface VoteDaySummary {
  round: number;
  /** voterId → người bị bầu ở phiếu CHỐT; `null` = không treo ai. */
  ballots: Record<string, string | null>;
  /** Người đã đổi phiếu ít nhất một lần trong ngày, sort. */
  changed: string[];
  /** Bị cáo nếu ngày đó ra toà. */
  accusedId: string | null;
  /** Phiếu Treo / Tha ở phiên toà, sort. Rỗng khi chưa phán quyết. */
  guilty: string[];
  innocent: string[];
}
```

Cuối `TraceKnowledgeSnapshot` (sau `trialAccusedId`):

```ts
  /** `publicVoteHistory` rút gọn: công khai. Trace cũ không có → lịch sử rỗng. */
  voteHistory?: VoteDaySummary[];
```

- [ ] **Step 4: `summarizeVoteDay` và chép vào snapshot**

Trong `snapshot.ts`, import `DayVoteRecap` từ `@masoi/shared` và `VoteDaySummary` từ `./trace`, thêm:

```ts
export function summarizeVoteDay(recap: DayVoteRecap): VoteDaySummary {
  const ballots: Record<string, string | null> = {};
  for (const ballot of recap.finalBallots) {
    ballots[ballot.voterId] = ballot.choice.type === "PLAYER" ? ballot.choice.targetId : null;
  }
  const changed = [
    ...new Set(recap.mutations.filter((m) => m.previousChoice !== null).map((m) => m.voterId)),
  ].sort();
  const judged = recap.finalJudgment?.ballots ?? [];
  return {
    round: recap.round,
    ballots,
    changed,
    accusedId: recap.nomination.kind === "TRIAL" ? recap.nomination.accusedId : null,
    guilty: judged.filter((b) => b.guilty).map((b) => b.voterId).sort(),
    innocent: judged.filter((b) => !b.guilty).map((b) => b.voterId).sort(),
  };
}
```

Trong `snapshotKnowledge`, sau `trialAccusedId: knowledge.trialAccusedId,`:

```ts
    voteHistory: knowledge.publicVoteHistory.map(summarizeVoteDay),
```

- [ ] **Step 5: Đưa vào observation của trajectory**

Trong `trajectory.ts`, import `VoteDaySummary` từ `../trace/trace`. Trong `BotTrajectory.observation` thêm sau `trialAccusedId: string | null;`:

```ts
    /** Lịch sử phiếu công khai (spec 2026-09-19). Vắng ở JSONL cũ. */
    voteHistory?: VoteDaySummary[];
```

Trong `observationFromTrace`, sau `trialAccusedId: snapshot.trialAccusedId ?? null,`:

```ts
      voteHistory: (snapshot.voteHistory ?? []).map((day) => ({
        round: day.round,
        ballots: { ...day.ballots },
        changed: [...day.changed],
        accusedId: day.accusedId,
        guilty: [...day.guilty],
        innocent: [...day.innocent],
      })),
```

- [ ] **Step 6: Chạy test**

Run: `cd packages/game-engine && npx vitest run tests/bot-vote-history.test.ts tests/bot-trajectory.test.ts tests/bot-live-observation.test.ts`
Expected: PASS. Nếu một test khoá danh sách khoá của observation/snapshot, thêm `voteHistory` vào danh sách đó (trường mới có chủ ý).

- [ ] **Step 7: Commit**

```bash
git add packages/game-engine/src/bot/trace/trace.ts packages/game-engine/src/bot/trace/snapshot.ts packages/game-engine/src/bot/evaluation/trajectory.ts packages/game-engine/tests/bot-vote-history.test.ts
git commit -m "feat(engine): public vote history in knowledge snapshots and trajectories (spec 2026-09-19 D3)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Mã hoá 384 chiều lịch sử

**Files:**
- Modify: `packages/game-engine/src/bot/learning/observation.ts`
- Test: `packages/game-engine/tests/bot-vote-history.test.ts`

**Interfaces:**
- Consumes: `VoteDaySummary` (Task 2); `ObservationInput.observation.voteHistory?`.
- Produces: `HISTORY_SEAT_FEATURE_NAMES` (export, 8 tên theo thứ tự D2); `observationSize()` = 797; `observationFeatureNames()` nối `hist:seat{i}:{f}` rồi `hist:vote:{i}>{j}`.

- [ ] **Step 1: Ghi mốc hành vi của ppo-0001 TRƯỚC khi đổi encoder**

Run (từ gốc repo):

```bash
npm run build:deps --silent
npm run ai:benchmark --silent -- --model apps/server/assets/models/village-ppo-0001.weights.json --games 40 --repeat 1 --seed prefix-lock --setups village,wolves,all --learned-decisions vote,night,final,hunter --out .tmp/prefix-lock-before.json
```

Expected: file `.tmp/prefix-lock-before.json` tồn tại. Giữ nó tới Step 7.

- [ ] **Step 2: Viết test hỏng**

Thêm vào `bot-vote-history.test.ts`:

```ts
import {
  encodeObservation,
  observationFeatureNames,
  observationSize,
} from "../src/bot/learning/observation";
import type { ObservationInput } from "../src/bot/evaluation/trajectory";
import type { VoteDaySummary } from "../src/bot/trace/trace";

const OLD = 413;
const HIST = OLD; // chỉ số chiều lịch sử đầu tiên
const MATRIX = OLD + 16 * 8;
const at = (seat: number, feature: number): number => HIST + seat * 8 + feature;
const cell = (i: number, j: number): number => MATRIX + i * 16 + j;

function line(voteHistory: VoteDaySummary[], knownRoles: Record<string, string>): ObservationInput {
  return {
    playerId: "a",
    turn: 3,
    phase: "DAY_VOTE",
    decision: "VOTE",
    legalActions: ["c", "d", "NO_ELIMINATION"],
    observation: {
      aliveIds: ["a", "c", "d"],
      legalActions: ["c", "d", "NO_ELIMINATION"],
      nightLegalTargets: null,
      knownRoles: knownRoles as ObservationInput["observation"]["knownRoles"],
      seerResult: null,
      belief: [],
      personality: { aggressiveness: 0, talkativeness: 0, riskTolerance: 0, deceptionSkill: 0, analyticalSkill: 0, loyalty: 0, stubbornness: 0 },
      nightWolfTarget: null,
      healUsed: false,
      poisonUsed: false,
      guardPrevious: null,
      lastNightDeaths: ["b"],
      voteCounts: { players: {}, noElimination: 0 },
      trialAccusedId: null,
      voteHistory,
    },
  };
}

const DAYS: VoteDaySummary[] = [
  { round: 1, ballots: { a: "b", b: "c", c: "b", d: "b" }, changed: ["c"], accusedId: "b", guilty: ["a", "c"], innocent: ["d"] },
  { round: 2, ballots: { a: "c", c: "d", d: "c" }, changed: [], accusedId: null, guilty: [], innocent: [] },
];

describe("encodeObservation — lịch sử phiếu (spec 2026-09-19 D2)", () => {
  it("797 chiều; 413 tên đầu không phải hist, tên thứ 414 là hist:seat0:votesCast", () => {
    expect(observationSize()).toBe(797);
    const names = observationFeatureNames();
    expect(names).toHaveLength(797);
    expect(names.slice(0, OLD).some((n) => n.startsWith("hist:"))).toBe(false);
    expect(names[HIST]).toBe("hist:seat0:votesCast");
    expect(names[MATRIX]).toBe("hist:vote:0>0");
    expect(names[796]).toBe("hist:vote:15>15");
  });

  it("lịch sử rỗng → 384 chiều 0", () => {
    const f = encodeObservation(line([], { a: "SEER" })).features;
    expect(f).toHaveLength(797);
    expect(f.slice(OLD).every((v) => v === 0)).toBe(true);
  });

  it("từng chiều theo tay — ghế a,b,c,d = 0,1,2,3; b lộ Sói", () => {
    const f = encodeObservation(line(DAYS, { a: "SEER", b: "WEREWOLF" })).features;
    // ghế a: 2 phiếu / 2 ngày; trúng sói 1/2; trúng dân 0; theo toà 1/2; đổi 0; treo 1/1; tha 0; né d cả 2 ngày.
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((k) => f[at(0, k)])).toEqual([1, 0.5, 0, 0.5, 0, 1, 0, 1]);
    // ghế b (đã chết): 1 phiếu (c) / 2 ngày; không né ai còn sống (a và d đều từng vote b).
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((k) => f[at(1, k)])).toEqual([0.5, 0, 0, 0, 0, 0, 0, 0]);
    // ghế c: đổi phiếu 1/2 ngày; treo 1/1.
    expect(f[at(2, 4)]).toBe(0.5);
    expect(f[at(2, 5)]).toBe(1);
    // ghế d: tha 1/1.
    expect(f[at(3, 6)]).toBe(1);
    // ma trận: a→b = phiếu ngày 1 + treo b = 2 / (2 × 2 ngày).
    expect(f[cell(0, 1)]).toBe(0.5);
    expect(f[cell(0, 2)]).toBe(0.25);
    expect(f[cell(2, 1)]).toBe(0.5);
    expect(f[cell(3, 1)]).toBe(0.25); // phiếu Tha không tính
    expect(f[cell(1, 2)]).toBe(0.25);
    expect(f[cell(2, 3)]).toBe(0.25);
  });

  it("vai CHƯA lộ không vào votedRevealed*", () => {
    const f = encodeObservation(line(DAYS, { a: "SEER" })).features;
    expect(f[at(0, 1)]).toBe(0);
    expect(f[at(0, 2)]).toBe(0);
  });

  it("413 chiều đầu không đổi khi thêm lịch sử", () => {
    const none = encodeObservation(line([], { a: "SEER", b: "WEREWOLF" })).features;
    const some = encodeObservation(line(DAYS, { a: "SEER", b: "WEREWOLF" })).features;
    expect(some.slice(0, OLD)).toEqual(none.slice(0, OLD));
  });
});
```

Nếu `phase: "DAY_VOTE"` không phải tên pha của `PHASES`, dùng tên pha bầu thật (`git grep -n "PHASES" packages/shared/src`); nếu kiểu `personality` có thêm khoá, thêm đủ khoá với giá trị 0.

- [ ] **Step 3: Chạy test, xác nhận hỏng**

Run: `cd packages/game-engine && npx vitest run tests/bot-vote-history.test.ts`
Expected: FAIL — `observationSize()` là 413.

- [ ] **Step 4: Tên chiều**

Trong `observation.ts`, sau `SEAT_FEATURE_NAMES`:

```ts
/**
 * Tóm tắt lịch sử phiếu của MỘT ghế (spec 2026-09-19 D2), nối SAU khối theo
 * ghế — không bao giờ chèn giữa: model cũ đọc tiền tố của vector (D1).
 */
export const HISTORY_SEAT_FEATURE_NAMES = [
  "votesCast",
  "votedRevealedWolf",
  "votedRevealedVillage",
  "votedWithMajority",
  "voteChanges",
  "guiltyBallots",
  "innocentBallots",
  "maxMutualAvoidance",
] as const;
```

`observationSize`:

```ts
export function observationSize(maxSeats: number = DEFAULT_MAX_SEATS): number {
  return (
    globalFeatureNames().length +
    maxSeats * SEAT_FEATURE_NAMES.length +
    maxSeats * HISTORY_SEAT_FEATURE_NAMES.length +
    maxSeats * maxSeats
  );
}
```

`observationFeatureNames`, trước `return names;`:

```ts
  for (let seat = 0; seat < maxSeats; seat += 1) {
    for (const feature of HISTORY_SEAT_FEATURE_NAMES) names.push(`hist:seat${seat}:${feature}`);
  }
  for (let i = 0; i < maxSeats; i += 1) {
    for (let j = 0; j < maxSeats; j += 1) names.push(`hist:vote:${i}>${j}`);
  }
```

- [ ] **Step 5: Mã hoá**

Import `VoteDaySummary` từ `../trace/trace`. Thêm hàm (cạnh `clamp`):

```ts
/**
 * 384 chiều lịch sử phiếu (spec 2026-09-19 D2). Mẫu số là số ngày đã có
 * recap; mọi tỉ lệ kẹp [0, 1], mẫu số 0 → 0. Vai "đã lộ" chỉ từ `knownRoles`
 * của chính bot.
 */
function encodeVoteHistory(
  days: readonly VoteDaySummary[],
  seats: readonly string[],
  maxSeats: number,
  knownRoles: Readonly<Record<string, string>>,
  alive: ReadonlySet<string>,
): number[] {
  const n = days.length;
  const ratio = (a: number, b: number): number => (b > 0 ? clamp(a / b, 0, 1) : 0);
  const slot = new Map(seats.map((id, i) => [id, i]));
  const teamOf = (id: string): Team | null => {
    const role = knownRoles[id];
    return role !== undefined && isRole(role) ? ROLE_TEAM[role] : null;
  };

  const matrix = new Array<number>(maxSeats * maxSeats).fill(0);
  for (const day of days) {
    for (const [voter, target] of Object.entries(day.ballots)) {
      const i = slot.get(voter);
      const j = target === null ? undefined : slot.get(target);
      if (i !== undefined && j !== undefined) matrix[i * maxSeats + j]! += 1;
    }
    const j = day.accusedId === null ? undefined : slot.get(day.accusedId);
    if (j === undefined) continue;
    for (const voter of day.guilty) {
      const i = slot.get(voter);
      if (i !== undefined) matrix[i * maxSeats + j]! += 1;
    }
  }

  const perSeat: number[] = [];
  for (let s = 0; s < maxSeats; s += 1) {
    const id = seats[s];
    if (id === undefined) {
      for (let k = 0; k < HISTORY_SEAT_FEATURE_NAMES.length; k += 1) perSeat.push(0);
      continue;
    }
    let cast = 0, wolf = 0, village = 0, majority = 0, changes = 0, trials = 0, guilty = 0, innocent = 0;
    for (const day of days) {
      const target = day.ballots[id];
      if (typeof target === "string") {
        cast += 1;
        const team = teamOf(target);
        if (team === "wolves") wolf += 1;
        if (team === "village") village += 1;
        if (day.accusedId === target) majority += 1;
      }
      if (day.changed.includes(id)) changes += 1;
      if (day.guilty.includes(id)) { trials += 1; guilty += 1; }
      else if (day.innocent.includes(id)) { trials += 1; innocent += 1; }
    }
    let avoid = 0;
    for (const other of seats) {
      if (other === id || !alive.has(other)) continue;
      let apart = 0;
      for (const day of days) {
        const mine = day.ballots[id];
        const theirs = day.ballots[other];
        if (typeof mine === "string" && typeof theirs === "string" && mine !== other && theirs !== id) {
          apart += 1;
        }
      }
      avoid = Math.max(avoid, apart);
    }
    perSeat.push(
      ratio(cast, n),
      ratio(wolf, cast),
      ratio(village, cast),
      ratio(majority, cast),
      ratio(changes, n),
      ratio(guilty, trials),
      ratio(innocent, trials),
      ratio(avoid, n),
    );
  }
  return [...perSeat, ...matrix.map((count) => ratio(count, 2 * n))];
}
```

Trong `encodeObservation`, ngay sau vòng `for (let seat = 0; seat < maxSeats; seat += 1) { … }` và TRƯỚC `const slots = slotsPerKind(maxSeats);`:

```ts
  for (const value of encodeVoteHistory(
    observation.voteHistory ?? [],
    seats,
    maxSeats,
    observation.knownRoles,
    alive,
  )) {
    features.push(value);
  }
```

- [ ] **Step 6: Chạy test engine**

Run: `cd packages/game-engine && npx vitest run`
Expected: PASS. Test nào khoá `observationSize() === 413` hoặc độ dài vector 413 là hợp đồng cũ đã cố ý đổi: sửa thành 797 (hoặc `observationSize()`). Fixture JSON của `bot-mlp.test.ts` có `featureNames` giả (5 chiều) và gọi `mlpForward` trực tiếp — không bị ảnh hưởng.

- [ ] **Step 7: Khoá rollback — ppo-0001 chơi y hệt**

Run (từ gốc repo):

```bash
npm run build:deps --silent
npm run ai:benchmark --silent -- --model apps/server/assets/models/village-ppo-0001.weights.json --games 40 --repeat 1 --seed prefix-lock --setups village,wolves,all --learned-decisions vote,night,final,hunter --out .tmp/prefix-lock-after.json
node -e "const a=require('./.tmp/prefix-lock-before.json').rows,b=require('./.tmp/prefix-lock-after.json').rows;const s=r=>JSON.stringify(r.map(x=>[x.setup,x.villageWin,x.violations]));if(s(a)!==s(b)){console.error('LỆCH',s(a),s(b));process.exit(1)}console.log('y hệt',s(a))"
```

Expected: `y hệt …`. Lệch = encoder đã đổi một chiều trong 413 chiều đầu: dừng, sửa.

- [ ] **Step 8: Test server**

Run: `cd apps/server && npx vitest run`
Expected: PASS (`learned-policy.test.ts` nạp `village-ppo-0001` 413 chiều trên encoder 797).

- [ ] **Step 9: Commit**

```bash
git add packages/game-engine/src/bot/learning/observation.ts packages/game-engine/tests/bot-vote-history.test.ts
git add -u packages/game-engine/tests
git commit -m "feat(engine): encode vote history as 384 trailing observation dims (spec 2026-09-19 D2)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Bàn trộn — `opponentPolicy` trong self-play

**Files:**
- Modify: `packages/game-engine/src/bot/evaluation/selfplay.ts` (`SelfPlayRecord`, `SelfPlayInput`, `SelfPlayGame`, `runSelfPlay`, `replayGame`)
- Modify: `packages/game-engine/src/bot/evaluation/report.ts` (`SelfPlayBatchInput`, `runBatch`)
- Modify: `packages/game-engine/src/bot/evaluation/trajectory.ts` (`gameToTrajectories`)
- Test: `packages/game-engine/tests/bot-learned-policy.test.ts`

**Interfaces:**
- Consumes: `LearnedPolicy`, `LearnedSeats`.
- Produces:
  - `SelfPlayInput.opponentPolicy?: LearnedPolicy`, `SelfPlayBatchInput.opponentPolicy?: LearnedPolicy`.
  - `SelfPlayRecord.opponentPolicyId?: string` (chỉ có khi có đối thủ).
  - `SelfPlayGame.opponentIds?: string[]` — id các ghế chạy `opponentPolicy`.
  - `replayGame(record, weights?, learnedPolicy?, opponentPolicy?)`.

- [ ] **Step 1: Viết test hỏng**

Thêm vào `bot-learned-policy.test.ts`:

```ts
describe("opponentPolicy — mỗi phe một model (spec 2026-09-19 D4)", () => {
  const mine = preferring(actionIndexOf("CHOOSE", DEFAULT_MAX_SEATS));
  const theirs = preferring(actionIndexOf("CHOOSE", 1));
  const run = () =>
    runSelfPlay({
      seed: "opp-1",
      playerCount: 8,
      maxRounds: 6,
      trace: true,
      learnedPolicy: mine,
      opponentPolicy: theirs,
      learnedSeats: "village",
      learnedTemperature: 1,
    });

  it("sói chạy đối thủ, nhưng trajectory chỉ mang `learned` ở ghế làng", () => {
    const game = run();
    const wolfPicks = game.traces.filter((t) => isWolfPack(game.roles[t.botId]!) && t.chosen.learned);
    expect(wolfPicks.length).toBeGreaterThan(0);
    const lines = gameToTrajectories(game);
    expect(lines.some((l) => l.learned)).toBe(true);
    for (const l of lines) if (l.learned) expect(isWolfPack(game.roles[l.playerId]!)).toBe(false);
    expect(game.record.opponentPolicyId).toBe(theirs.id);
  });

  it("replay đòi đúng đối thủ và tái lập ván", () => {
    const game = run();
    expect(() => replayGame(game.record, undefined, mine)).toThrow(/opponentPolicy/);
    expect(() => replayGame(game.record, undefined, mine, mine)).toThrow(/opponentPolicy/);
    const again = replayGame(game.record, undefined, mine, theirs);
    expect(again.winner).toBe(game.winner);
    expect(again.actions).toBe(game.actions);
  });

  it("'all' kèm đối thủ, hoặc đối thủ không kèm policy → ném", () => {
    expect(() =>
      runSelfPlay({ seed: "opp-2", playerCount: 8, maxRounds: 2, learnedPolicy: mine, opponentPolicy: theirs, learnedSeats: "all" }),
    ).toThrow(/opponentPolicy/);
    expect(() => runSelfPlay({ seed: "opp-3", playerCount: 8, maxRounds: 2, opponentPolicy: theirs })).toThrow(/opponentPolicy/);
  });

  it("không có đối thủ thì record không mang opponentPolicyId", () => {
    const game = runSelfPlay({ seed: "opp-4", playerCount: 8, maxRounds: 2, learnedPolicy: mine, learnedSeats: "village" });
    expect(Object.keys(game.record)).not.toContain("opponentPolicyId");
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận hỏng**

Run: `cd packages/game-engine && npx vitest run tests/bot-learned-policy.test.ts`
Expected: FAIL (lỗi kiểu `opponentPolicy` không tồn tại, hoặc sói không có `learned`).

- [ ] **Step 3: Kiểu**

`SelfPlayRecord`, sau `learnedDecisions?: LearnedDecisions;`:

```ts
  /**
   * Id của policy chơi phe KIA (ghế ngoài `learnedSeats`); vắng = phe kia là
   * heuristic. `replayGame` đòi đúng policy này, như `learnedPolicyId`.
   */
  opponentPolicyId?: string;
```

`SelfPlayInput`, sau `learnedDecisions?`:

```ts
  /**
   * Policy cho ghế NGOÀI `learnedSeats` (spec 2026-09-19 D4). Vắng = phe kia
   * heuristic. Đòi `learnedPolicy` và `learnedSeats` là village/wolves.
   */
  opponentPolicy?: LearnedPolicy;
```

`SelfPlayGame`, sau `roles`:

```ts
  /** Ghế chạy `opponentPolicy`. Trajectory không lấy nhãn PPO từ các ghế này. */
  opponentIds?: string[];
```

`SelfPlayBatchInput` (report.ts), sau `learnedDecisions?`:

```ts
  /** Xem `SelfPlayInput.opponentPolicy`. */
  opponentPolicy?: LearnedPolicy;
```

- [ ] **Step 4: `runSelfPlay`**

Trước vòng `for (const player of engine.state.players)` dựng runtime:

```ts
  if (input.opponentPolicy) {
    if (!input.learnedPolicy) throw new Error("opponentPolicy cần learnedPolicy");
    if (learnedSeats === "all") {
      throw new Error("opponentPolicy cần learnedSeats village|wolves: 'all' không còn ghế cho đối thủ");
    }
  }
  const opponentIds: string[] = [];
```

Trong vòng, sau `usesLearned`:

```ts
    const usesOpponent = input.opponentPolicy !== undefined && !usesLearned;
    if (usesOpponent) opponentIds.push(player.id);
```

và đổi `learnedPolicy: usesLearned ? input.learnedPolicy : undefined,` thành:

```ts
        learnedPolicy: usesLearned ? input.learnedPolicy : usesOpponent ? input.opponentPolicy : undefined,
```

Trong record, bên trong nhánh `...(input.learnedPolicy ? { … } : {})`, thêm:

```ts
          ...(input.opponentPolicy ? { opponentPolicyId: input.opponentPolicy.id } : {}),
```

Nơi dựng object `SelfPlayGame` trả về (tìm `roles:` trong `runSelfPlay`), thêm `opponentIds,`.

- [ ] **Step 5: `replayGame` và `runBatch`**

`replayGame` thêm tham số và kiểm:

```ts
export function replayGame(
  record: SelfPlayRecord,
  weights?: BotWeights,
  learnedPolicy?: LearnedPolicy,
  opponentPolicy?: LearnedPolicy,
): SelfPlayGame {
```

sau khối kiểm `learnedPolicyId`:

```ts
  if (record.opponentPolicyId !== undefined) {
    if (!opponentPolicy) {
      throw new Error(`Record cần opponentPolicy "${record.opponentPolicyId}" nhưng không được cấp`);
    }
    if (opponentPolicy.id !== record.opponentPolicyId) {
      throw new Error(
        `Record cần opponentPolicy "${record.opponentPolicyId}" nhưng nhận "${opponentPolicy.id}"`,
      );
    }
  }
```

và truyền `opponentPolicy: record.opponentPolicyId !== undefined ? opponentPolicy : undefined,` vào `runSelfPlay`.

`runBatch` (report.ts): thêm `opponentPolicy: input.opponentPolicy,` vào CẢ HAI lời gọi `runSelfPlay` (lần chính và lần `verifyReplay`, cạnh `learnedPolicy`).

- [ ] **Step 6: Trajectory bỏ nhãn của ghế đối thủ**

Trong `gameToTrajectories`, trước vòng `for (const trace of game.traces)`:

```ts
  // PPO chỉ học từ nước của CHÍNH policy đang train: logProb của model đối thủ
  // không phải xác suất của policy này (spec 2026-09-19 D4).
  const opponents = new Set(game.opponentIds ?? []);
```

và đổi dòng `...(trace.chosen.learned ? { learned: { ...trace.chosen.learned } } : {}),` thành:

```ts
      ...(trace.chosen.learned && !opponents.has(trace.botId)
        ? { learned: { ...trace.chosen.learned } }
        : {}),
```

- [ ] **Step 7: Chạy test**

Run: `cd packages/game-engine && npx vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/game-engine/src/bot/evaluation/selfplay.ts packages/game-engine/src/bot/evaluation/report.ts packages/game-engine/src/bot/evaluation/trajectory.ts packages/game-engine/tests/bot-learned-policy.test.ts
git commit -m "feat(engine): opponentPolicy - each side its own model; PPO labels only from the trained policy (spec 2026-09-19 D4)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Script — `--opponent-policy` và benchmark đối đầu

**Files:**
- Modify: `apps/server/scripts/selfplay.ts`
- Modify: `apps/server/scripts/ai-benchmark.ts`

**Interfaces:**
- Consumes: `SelfPlayBatchInput.opponentPolicy` (Task 4).
- Produces:
  - `selfplay.ts --opponent-policy <file>` (đòi `--policy`, `--learned-seats` village|wolves).
  - `ai-benchmark.ts --opponent <file>`; setup `h2h-village`, `h2h-wolves`, `opponent`; khoá `paired["h2h-village"]`, `paired["h2h-wolves"]` trong JSON `--out` (cùng dạng `{ mean, se }`), và khoá gốc `opponent: <id>`.

- [ ] **Step 1: `selfplay.ts`**

Trong `interface Options`, sau `policy: string | null;`:

```ts
  /** Policy cho phe NGOÀI `--learned-seats` (spec 2026-09-19 D4); `null` = heuristic. */
  opponentPolicy: string | null;
```

Mặc định trong `parseArgs`: `opponentPolicy: null,`. Dòng usage sau dòng `--policy`:

```ts
    "  --opponent-policy <file> model cho phe KIA của --learned-seats (village|wolves); mặc định heuristic",
```

Trong `switch`, cạnh `case "--policy":`:

```ts
      case "--opponent-policy":
        options.opponentPolicy = argv[++i] ?? "";
        break;
```

Cuối `parseArgs` (trước `return options;`):

```ts
  if (options.opponentPolicy !== null) {
    if (!options.policy) throw new Error("--opponent-policy cần --policy");
    if (options.learnedSeats === "all") throw new Error("--opponent-policy cần --learned-seats village|wolves");
  }
```

Trong `main`, cạnh `learnedPolicy`:

```ts
  const opponentPolicy = options.opponentPolicy
    ? loadMlpPolicy(JSON.parse(readFileSync(resolve(options.opponentPolicy), "utf8")))
    : undefined;
```

và trong nhánh `...(learnedPolicy ? { … } : {})` của `batch`, thêm `...(opponentPolicy ? { opponentPolicy } : {}),`.

- [ ] **Step 2: `ai-benchmark.ts` — tham số**

```ts
const SETUP_NAMES = ["baseline", "village", "wolves", "all", "teacher", "h2h-village", "h2h-wolves", "opponent"] as const;
const OPPONENT_SETUPS: readonly SetupName[] = ["h2h-village", "h2h-wolves", "opponent"];
```

`Options` thêm `opponent: string | null;`, mặc định `opponent: null`, usage:

```ts
    "  --opponent <path>    Model đối thủ cho h2h-village / h2h-wolves / opponent (spec 2026-09-19 D5)",
```

parse: `else if (a === "--opponent") o.opponent = next();`. Sau kiểm `--setups rỗng`:

```ts
  if (o.setups.some((name) => OPPONENT_SETUPS.includes(name)) && !o.opponent) {
    throw new Error(`setup ${OPPONENT_SETUPS.join("/")} cần --opponent`);
  }
```

- [ ] **Step 3: `ai-benchmark.ts` — setup và chạy**

`Setup` thêm `model: "model" | "opponent"; withOpponent: boolean;`. `SETUPS`: thêm `model: "model", withOpponent: false` vào năm setup cũ, và:

```ts
  "h2h-village": { label: "làng model × sói đối thủ", seats: "village", weights: DEFAULT_BOT_WEIGHTS, model: "model", withOpponent: true },
  "h2h-wolves": { label: "làng đối thủ × sói model", seats: "wolves", weights: DEFAULT_BOT_WEIGHTS, model: "model", withOpponent: true },
  opponent: { label: "đối thủ cả bàn", seats: "all", weights: DEFAULT_BOT_WEIGHTS, model: "opponent", withOpponent: false },
```

Trong `main`, sau `const policy = …`:

```ts
  const opponent = o.opponent ? loadMlpPolicy(JSON.parse(readFileSync(resolve(o.opponent), "utf8"))) : undefined;
```

Trong `runBatch({ … })`, thay dòng `learnedPolicy:` và thêm `opponentPolicy`:

```ts
        learnedPolicy: setup.seats ? (setup.model === "opponent" ? opponent : policy) : undefined,
        opponentPolicy: setup.withOpponent ? opponent : undefined,
```

- [ ] **Step 4: `ai-benchmark.ts` — hiệu ghép đối đầu**

Ngay trước `if (o.out) {`:

```ts
  // Đối đầu (spec 2026-09-19 D5): cùng gặp phe kia của đối thủ, phe model hơn
  // phe đối thủ bao nhiêu. Làng mạnh hơn đẩy villageWin LÊN, sói mạnh hơn đẩy XUỐNG.
  if (o.setups.includes("opponent")) {
    const ref = winsOf("opponent");
    const h2h: Array<[SetupName, 1 | -1, string]> = [
      ["h2h-village", 1, "(dương = làng model mạnh hơn làng đối thủ)"],
      ["h2h-wolves", -1, "(dương = sói model mạnh hơn sói đối thủ)"],
    ];
    process.stdout.write("\n");
    for (const [name, sign, note] of h2h) {
      if (!o.setups.includes(name)) continue;
      const stat = pairedStats(winsOf(name).map((v, i) => sign * (v - ref[i]!) * 100));
      paired[name] = stat;
      process.stdout.write(
        `Δ ${SETUPS[name].label.padEnd(22)} ${stat.mean >= 0 ? "+" : ""}${stat.mean.toFixed(1)}` +
          `${Number.isNaN(stat.se) ? "" : ` ± ${stat.se.toFixed(1)}`} điểm  ${note}\n`,
      );
    }
  }
```

Trong `JSON.stringify({ model: policy.id, … })` thêm `opponent: opponent?.id ?? null,`.

- [ ] **Step 5: Chạy thử (không có unit test cho CLI — kiểm bằng lần chạy nhỏ)**

Run (từ gốc repo):

```bash
npm run build:deps --silent
npm run ai:benchmark --silent -- --model apps/server/assets/models/village-ppo-0001.weights.json --opponent apps/server/assets/models/village-bc-0002.weights.json --games 20 --repeat 2 --seed h2h-smoke --setups baseline,h2h-village,h2h-wolves,opponent --out .tmp/h2h-smoke.json
npm run ai:benchmark --silent -- --model apps/server/assets/models/village-ppo-0001.weights.json --games 5 --repeat 1 --setups h2h-village
npx tsx apps/server/scripts/selfplay.ts --games 3 --players 8 --preset --policy apps/server/assets/models/village-ppo-0001.weights.json --learned-seats village --opponent-policy apps/server/assets/models/village-bc-0002.weights.json --verify-replay --quiet
```

Expected: lệnh 1 in hai dòng `Δ làng model × sói đối thủ` và `Δ làng đối thủ × sói model`, vi phạm 0, và `.tmp/h2h-smoke.json` có `paired["h2h-village"]`; lệnh 2 ném `… cần --opponent`; lệnh 3 chạy xong không có `REPLAY_DIVERGENCE`.

- [ ] **Step 6: Test server + commit**

Run: `cd apps/server && npx vitest run`
Expected: PASS.

```bash
git add apps/server/scripts/selfplay.ts apps/server/scripts/ai-benchmark.ts
git commit -m "feat(scripts): --opponent-policy for selfplay, head-to-head setups in ai:benchmark (spec 2026-09-19 D5)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `rl_loop --opponent`

**Files:**
- Modify: `ai-training/rl_loop.py` (`rollout_cmd`, `main`)
- Test: `ai-training/tests/test_rl_gates.py`

**Interfaces:**
- Consumes: `selfplay.ts --opponent-policy` (Task 5).
- Produces: `rollout_cmd(source, seats, iteration, part, games, temperature, decisions, opponent: Path | None = None) -> list[str]`; cờ `rl_loop.py --opponent <model>`: chỉ rollout có `seats == --side` nhận đối thủ.

- [ ] **Step 1: Viết test hỏng**

Trong `test_rl_gates.py`, ngay sau khối `roll = rollout_cmd(...)` hiện có:

```python
    assert "--opponent-policy" not in roll, roll
    opp = rollout_cmd(Path("m.json"), "village", 3, Path("part"), 1000, 1.0, decisions, Path("ppo1.json"))
    assert opp[opp.index("--opponent-policy") + 1] == "ppo1.json", opp
    assert opp[opp.index("--learned-seats") + 1] == "village", opp
```

- [ ] **Step 2: Chạy, xác nhận hỏng**

Run: `cd ai-training && PYTHONUTF8=1 .venv/Scripts/python.exe tests/test_rl_gates.py`
Expected: FAIL — `rollout_cmd() takes 7 positional arguments but 8 were given`.

- [ ] **Step 3: Sửa `rollout_cmd`**

```python
def rollout_cmd(
    source: Path, seats: str, iteration: int, part: Path, games: int, temperature: float, decisions: str,
    opponent: Path | None = None,
) -> list[str]:
    cmd = [
        tool("npx"), "tsx", "apps/server/scripts/selfplay.ts",
        "--games", str(games), "--players", "8", "--preset", "--defense",
        "--seed", f"rl-{iteration}-{seats}", "--policy", str(source),
        "--temperature", str(temperature), "--learned-seats", seats,
        "--learned-decisions", decisions,
        "--trajectories", str(part), "--trace-games", str(games), "--quiet",
    ]
    # Spec 2026-09-19 D6: phe đang train gặp đối thủ thay cho heuristic.
    if opponent is not None:
        cmd += ["--opponent-policy", str(opponent)]
    return cmd
```

Trong `main`, thêm tham số:

```python
    p.add_argument("--opponent", type=Path, default=None,
                   help="model cho phe KIA trong rollout của --side (spec 2026-09-19 D6); mặc định heuristic")
```

Kiểm sau `parse_args`:

```python
    if a.opponent is not None and a.side == "all":
        raise SystemExit("--opponent cần --side village|wolves")
```

Ở lời gọi `rollout_cmd(source, seats, iteration, part, a.games // 3, a.temperature, a.learned_decisions)` (dòng ~364) thêm đối số cuối:

```python
                             a.opponent if seats == a.side else None)
```

- [ ] **Step 4: Chạy test**

Run: `cd ai-training && PYTHONUTF8=1 .venv/Scripts/python.exe tests/test_rl_gates.py && PYTHONUTF8=1 .venv/Scripts/python.exe rl_loop.py --help | grep -A1 opponent`
Expected: `ok`, và dòng help của `--opponent`.

- [ ] **Step 5: Commit**

```bash
git add ai-training/rl_loop.py ai-training/tests/test_rl_gates.py
git commit -m "feat(rl): rl_loop --opponent - side rollouts face a fixed model (spec 2026-09-19 D6)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: `rl_stages` dự án B + notebook

**Files:**
- Modify: `ai-training/rl_stages.py`
- Modify: `ai-training/colab/train_rl_local.ipynb`
- Test: `ai-training/tests/test_rl_stages.py`

**Interfaces:**
- Consumes: `rl_loop --opponent` (Task 6), `ai:benchmark --opponent` + khoá `paired["h2h-village"]` (Task 5), `rl_loop.score_of/imbalance_of`.
- Produces: `rs.set_project(name: str) -> None` ("a" | "b"); `rs.PROJECT`; `rs.confirm_b(rl, deadline, model=None)`; CLI `rl_stages.py --project b <stage>`; notebook biến `PROJECT`.

- [ ] **Step 1: Viết test hỏng**

Cuối `main()` của `test_rl_stages.py`, trước `print("ok")`:

```python
    # Dự án B (spec 2026-09-19): hằng số riêng, stage làng có đối thủ ppo-0001.
    rs.set_project("b")
    try:
        assert rs.CHAMPION0.name == "village-bc-0003.weights.json"
        name, side, iterations, extra = rs.STAGES["village"]
        assert name == "b-village" and side == "village" and iterations == 20
        assert extra[extra.index("--opponent") + 1].endswith("village-ppo-0001.weights.json"), extra
        assert "--opponent" not in rs.STAGES["wolves"][3]
        with tempfile.TemporaryDirectory() as tmp:
            rl = Path(tmp)
            make_run(rl, "bc-village-v3", promoted=True)  # lượt của dự án A không được tính
            assert rs.status(rl) == "village"
            try:
                rs.start_model(rl, "wolves")
                raise AssertionError("wolves B phải đòi b-village đã thăng hạng")
            except SystemExit:
                pass
            make_run(rl, "b-village", promoted=True)
            assert rs.start_model(rl, "wolves").parent.parent.name == "b-village"
            assert rs.status(rl) == "wolves"
    finally:
        rs.set_project("a")
    assert rs.STAGES["village"][0] == "bc-village-v3"
```

- [ ] **Step 2: Chạy, xác nhận hỏng**

Run: `cd ai-training && PYTHONUTF8=1 .venv/Scripts/python.exe tests/test_rl_stages.py`
Expected: FAIL — `module 'rl_stages' has no attribute 'set_project'`.

- [ ] **Step 3: Bộ hằng số theo dự án**

Trong `rl_stages.py`, ngay sau `NIGHT_RUNS = …`:

```python
PROJECT = "a"
PPO1 = ROOT / "apps" / "server" / "assets" / "models" / "village-ppo-0001.weights.json"
_PROJECT_A = (CHAMPION0, STAGES, VILLAGE_RUNS, WOLVES_RUNS, NIGHT_RUNS)
_PROJECT_B = (
    ROOT / "apps" / "server" / "assets" / "models" / "village-bc-0003.weights.json",
    {
        "village": ("b-village", "village", 20,
                    ["--train-decisions", NO_NIGHT, *SIDE_STAGE, "--opponent", str(PPO1)]),
        "village-lr3": ("b-village-lr3", "village", 20,
                        ["--train-decisions", NO_NIGHT, *SIDE_STAGE, "--opponent", str(PPO1), "--lr", "3e-4"]),
        "wolves": ("b-wolves", "wolves", 20,
                   ["--train-decisions", NO_NIGHT, "--shaping-decisions", "vote", *SIDE_STAGE]),
        "wolves-lr3": ("b-wolves-lr3", "wolves", 20,
                       ["--train-decisions", NO_NIGHT, "--shaping-decisions", "vote", *SIDE_STAGE, "--lr", "3e-4"]),
    },
    ("b-village-lr3", "b-village"),
    ("b-wolves-lr3", "b-wolves"),
    ("b-night-wolves", "b-night-village"),
)


def set_project(name: str) -> None:
    """'a' = spec 2026-09-17 (mặc định), 'b' = spec 2026-09-19. Mọi hàm đọc các
    hằng số này lúc gọi, nên đổi ở đây là đổi cả status/run_stage/confirm."""
    global PROJECT, CHAMPION0, STAGES, VILLAGE_RUNS, WOLVES_RUNS, NIGHT_RUNS
    if name not in ("a", "b"):
        raise SystemExit(f"dự án lạ: {name!r} (có: a, b)")
    PROJECT = name
    CHAMPION0, STAGES, VILLAGE_RUNS, WOLVES_RUNS, NIGHT_RUNS = _PROJECT_A if name == "a" else _PROJECT_B
```

- [ ] **Step 4: Bỏ tên thư mục cứng**

`status()`:

```python
def status(rl: Path) -> str:
    names = {v[0] for v in STAGES.values()} | set(NIGHT_RUNS)
    runs = sorted(rl / n for n in names if (rl / n / "state.json").exists()) if rl.exists() else []
    if not runs:
        return "village"
    for run in runs:
        show_state(run)
    for stage in ("village", "village-lr3", "wolves", "wolves-lr3"):  # lượt đang dở: chạy tiếp nó
        name, _, iterations, _ = STAGES[stage]
        state = rl / name / "state.json"
        if state.exists() and len(json.loads(state.read_text(encoding="utf8"))["done"]) < iterations:
            return stage
    if promoted_champion(rl, VILLAGE_RUNS) is None:
        return "village-lr3" if (rl / STAGES["village"][0] / "state.json").exists() else "village"
    if promoted_champion(rl, WOLVES_RUNS) is None:
        return "wolves-lr3" if (rl / STAGES["wolves"][0] / "state.json").exists() else "wolves"
    return "night (tuỳ chọn) hoặc confirm"
```

Trong `run_stage`, nhánh `night`: đổi `"bc-night-village-v3"` thành `NIGHT_RUNS[1]` và `"bc-night-wolves-v3"` thành `NIGHT_RUNS[0]`.

- [ ] **Step 5: `confirm_b`**

Sau hàm `confirm`:

```python
CONFIRM_B = ["--games", "300", "--repeat", "5", "--seed", "confirm-0919", "--temperature", "0.5",
             "--learned-decisions", "vote,night,final,hunter"]


def confirm_b(rl: Path, deadline: float | None, model: Path | None = None) -> None:
    """Tiêu chí spec 2026-09-19 (T=0,5, seed mới): đối đầu, không thụt lùi, cân bằng, 0 vi phạm."""
    cand = model or candidate(rl)
    if cand is None:
        raise SystemExit("chưa có lượt chạy nào thăng hạng - không có gì để xác nhận")
    ref_json = rl / "confirm-b-ppo0001.json"
    cand_json = rl / ("confirm-b-candidate.json" if model is None
                      else f"confirm-b-{'_'.join(Path(cand).resolve().parts[-3:])}")
    npm = shutil.which("npm") or "npm"
    runs = (
        (PPO1, ref_json, ["--setups", "baseline,village,wolves,all"]),
        (cand, cand_json, ["--opponent", PPO1,
                           "--setups", "baseline,village,wolves,all,h2h-village,h2h-wolves,opponent"]),
    )
    for m, dest, extra in runs:
        if not dest.exists():
            run_logged([npm, "run", "ai:benchmark", "--", "--model", m, *CONFIRM_B, *extra, "--out", dest],
                       rl / "confirm-b.log", cwd=ROOT, deadline=deadline)
    sys.path.insert(0, str(TRAIN_DIR))
    from rl_loop import imbalance_of, score_of

    report = json.loads(cand_json.read_text(encoding="utf8"))
    h2h = {s: report["paired"][f"h2h-{s}"]["mean"] for s in ("village", "wolves")}
    delta = {s: score_of(cand_json, s) - score_of(ref_json, s) for s in ("village", "wolves")}
    imbalance, ref_imbalance = imbalance_of(cand_json), imbalance_of(ref_json)
    violations = sum(r["violations"] for r in report["rows"])
    checks = {
        "đối đầu: làng hơn làng ppo-0001 >= +2": h2h["village"] >= 2.0,
        "không phe nào < ppo-0001 - 1": all(d >= -1.0 for d in delta.values()),
        f"lệch cân bằng <= ppo-0001 ({ref_imbalance:.2f}) + 1": imbalance <= ref_imbalance + 1.0,
        "0 vi phạm": violations == 0,
    }
    print("=" * 60)
    print(f"đối đầu  làng {h2h['village']:+.2f} | sói {h2h['wolves']:+.2f} (theo dõi)")
    for side, d in delta.items():
        print(f"{side:<8} so với ppo-0001 (đều so heuristic) {d:+.2f}")
    print(f"lệch cân bằng {imbalance:.2f} | vi phạm {violations}")
    for name, ok in checks.items():
        print(f"  [{'x' if ok else ' '}] {name}")
    print("VERDICT:", "PASS" if all(checks.values()) else "FAIL")
    print("candidate:", cand)
    print("=" * 60)
```

Trong `run_stage`, nhánh `confirm`:

```python
        if stage == "confirm":
            (confirm_b if PROJECT == "b" else confirm)(rl, deadline, model)
            return "gửi khối VERDICT cho Claude"
```

- [ ] **Step 6: CLI**

Trong `main()` thêm tham số và gọi trước mọi thứ khác:

```python
    p.add_argument("--project", choices=("a", "b"), default="a",
                   help="a = spec 2026-09-17; b = spec 2026-09-19 (lịch sử phiếu)")
```

ngay sau `a = p.parse_args()`: `set_project(a.project)`.

Cập nhật docstring đầu file thêm dòng:

```
Dự án B (spec 2026-09-19): thêm `--project b` vào mọi lệnh, vd
    ai-training/.venv/Scripts/python.exe ai-training/rl_stages.py --project b village
```

- [ ] **Step 7: Chạy test**

Run: `cd ai-training && PYTHONUTF8=1 .venv/Scripts/python.exe tests/test_rl_stages.py`
Expected: `ok`.

- [ ] **Step 8: Notebook**

Notebook có thể đang có output/thay đổi riêng của người dùng: sửa bằng script JSON, chỉ đổi hai ô, giữ output.

```bash
cd /d/Source/ma-soi-online && PYTHONUTF8=1 python - <<'EOF'
import json
p = "ai-training/colab/train_rl_local.ipynb"
nb = json.load(open(p, encoding="utf-8"))

def edit(old, new):
    hits = [c for c in nb["cells"] if old in "".join(c["source"])]
    assert len(hits) == 1, old
    text = "".join(hits[0]["source"]).replace(old, new)
    parts = text.split("\n")
    hits[0]["source"] = [s + "\n" for s in parts[:-1]] + [parts[-1]]

edit('STAGE = "village"', 'PROJECT = "a"          # a = spec 2026-09-17 | b = spec 2026-09-19 (vote history)\nSTAGE = "village"')
edit("rs.PYTHON = VENV_PY", "rs.PYTHON = VENV_PY\nrs.set_project(PROJECT)")
open(p, "w", encoding="utf-8", newline="\n").write(json.dumps(nb, indent=1, ensure_ascii=False) + "\n")
EOF
```

Expected: không lỗi `assert`.

- [ ] **Step 9: Commit**

```bash
git add ai-training/rl_stages.py ai-training/tests/test_rl_stages.py ai-training/colab/train_rl_local.ipynb
git commit -m "feat(rl): rl_stages --project b (b-* runs, ppo-0001 opponent, head-to-head confirm at T=0.5)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Hướng dẫn chạy (người dùng) và đóng gói (agent, có điều kiện)

**Files:**
- Create (sau BC đạt): `apps/server/assets/models/village-bc-0003.weights.json`
- Create (sau VERDICT PASS): `apps/server/assets/models/village-ppo-0002.weights.json`
- Modify (sau PASS): `apps/server/tests/learned-policy.test.ts`, `.env.example`, `deploy/env.production.example`, `apps/server/src/bots/learned-policy.ts` (comment), spec B (mục Kết quả)

**Interfaces:**
- Consumes: mọi task trước.
- Produces: `village-bc-0003` (điểm xuất phát RL), rồi `village-ppo-0002` hoặc báo cáo FAIL.

- [ ] **Step 1: Báo người dùng các lệnh chạy dataset + BC**

Gửi người dùng (họ chạy, từ gốc repo, Git Bash):

```bash
npm run build:deps
npm run ai:dataset -- --games 10000 --players 8 --preset --defense --seed bc --trajectories .tmp/traj-b --trace-games 10000 --no-jitter
npm run ai:validate-dataset -- .tmp/traj-b/trajectories.jsonl
npm run ai:encode -- --in .tmp/traj-b/trajectories.jsonl --out .tmp/enc-b
```

Rồi trong `ai-training/colab/train_bc_local.ipynb`, ô "0. Environment": đổi `DATA = ROOT / '.tmp' / 'enc'` thành `DATA = ROOT / '.tmp' / 'enc-b'` và `OUT = ROOT / '.tmp' / 'model-local'` thành `OUT = ROOT / '.tmp' / 'model-b'`; chạy mục 1–4. Gửi lại `metrics.test.agreementTieAware`.

- [ ] **Step 2: Kiểm dataset có tín hiệu lịch sử (agent)**

```bash
cd /d/Source/ma-soi-online/ai-training && PYTHONUTF8=1 ./.venv/Scripts/python.exe -c "
from masoi_training.data import load
d = load('../.tmp/enc-b'); names = d.meta['featureNames']
hist = [i for i, n in enumerate(names) if n.startswith('hist:')]
print('obs', d.obs_size, '| hist dims', len(hist), '| hist dims ever non-zero', int((d.features[:, hist] != 0).any(axis=0).sum()))
"
```

Expected: `obs 797 | hist dims 384 | hist dims ever non-zero` > 0 (phần lớn chiều ghế 0–7 khác 0; ghế 8–15 bằng 0 ở bàn 8 người là đúng). Nếu thuộc tính mảng không tên là `features`, đọc `masoi_training/data.py` để lấy đúng tên. Bằng 0 → dây dẫn dữ liệu đứt: dừng.

- [ ] **Step 3: Cổng BC và đóng gói `village-bc-0003` (agent)**

Cổng: `agreementTieAware` ≥ 0,923. Rồi benchmark (người dùng chạy hoặc agent chạy — ~20 phút):

```bash
npm run ai:benchmark -- --model .tmp/model-b/model.weights.json --setups baseline,village,wolves,all,teacher --out .tmp/bench-bc0003.json
npm run ai:benchmark -- --model apps/server/assets/models/village-bc-0002.weights.json --setups baseline,village,wolves,all,teacher --out .tmp/bench-bc0002.json
```

Cổng: `paired["all-vs-teacher"].mean` của bc-0003 ≥ của bc-0002 − 1. Đạt:

```bash
cd /d/Source/ma-soi-online/ai-training && PYTHONUTF8=1 ./.venv/Scripts/python.exe -c "
import json
w = json.load(open('../.tmp/model-b/model.weights.json', encoding='utf8'))
w['modelId'] = 'village-bc-0003'
json.dump(w, open('../apps/server/assets/models/village-bc-0003.weights.json', 'w', encoding='utf8'))
print('ok', w['format'], w['obsSize'])
"
cd .. && git add apps/server/assets/models/village-bc-0003.weights.json
git commit -m "feat(bot): village-bc-0003 - BC clone on dataset-0005 (797-dim observation, vote history)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Expected: `ok masoi-mlp-2 797`. Không đạt → báo người dùng số liệu, dừng (không RL từ một bản sao kém).

- [ ] **Step 4: Báo người dùng các lệnh RL**

Notebook `train_rl_local.ipynb`: `PROJECT = "b"`, lần lượt `STAGE = "village"` → (`village-lr3` nếu cần) → `wolves` → (`wolves-lr3`) → `confirm`. Hoặc terminal:

```bash
ai-training/.venv/Scripts/python.exe ai-training/rl_stages.py --project b village
ai-training/.venv/Scripts/python.exe ai-training/rl_stages.py --project b wolves
ai-training/.venv/Scripts/python.exe ai-training/rl_stages.py --project b confirm
```

Người dùng gửi lại khối `VERDICT`.

- [ ] **Step 5: Chấm lại verdict độc lập (agent)**

```bash
cd /d/Source/ma-soi-online/ai-training && PYTHONUTF8=1 ./.venv/Scripts/python.exe -c "
import json
from pathlib import Path
from rl_loop import imbalance_of, score_of
ref = Path('../.tmp/rl/confirm-b-ppo0001.json'); cand = Path('../.tmp/rl/confirm-b-candidate.json')
r = json.loads(cand.read_text(encoding='utf8'))
print('h2h', {k: round(v['mean'], 2) for k, v in r['paired'].items() if k.startswith('h2h')})
for s in ('village', 'wolves'): print(s, '%+.2f' % (score_of(cand, s) - score_of(ref, s)))
print('imbalance %.2f vs %.2f' % (imbalance_of(cand), imbalance_of(ref)))
print('violations', sum(x['violations'] for x in r['rows']))
"
```

Expected: trùng khối VERDICT. Nếu người dùng đã confirm một model cụ thể (`--model`), đổi `cand` sang file `confirm-b-<…>` tương ứng. Lệch → dừng, báo.

- [ ] **Step 6a (FAIL): ghi kết quả vào spec B, giữ ppo-0001**

Thêm mục `## Kết quả (ngày)` cuối spec B: bảng `status`, khối VERDICT, số chấm lại, kết luận "giữ village-ppo-0001", và theo dõi `wolfSelfSabotage` (chạy chẩn đoán như `.tmp/diag-ppo`). Commit `docs(rl): sub-project B results (not promoted)`. Dừng.

- [ ] **Step 6b (PASS): đóng gói `village-ppo-0002`**

```bash
cd /d/Source/ma-soi-online/ai-training && CAND=<dòng candidate: của VERDICT> && PYTHONUTF8=1 ./.venv/Scripts/python.exe -c "
import json, sys
w = json.load(open(sys.argv[1], encoding='utf8'))
w['modelId'] = 'village-ppo-0002'
json.dump(w, open('../apps/server/assets/models/village-ppo-0002.weights.json', 'w', encoding='utf8'))
print('ok', w['format'], w['obsSize'])
" "$CAND"
```

Expected: `ok masoi-mlp-2 797`. Rồi:
- `apps/server/tests/learned-policy.test.ts`: `"village-ppo-0001.weights.json"` → `"village-ppo-0002.weights.json"` (2 chỗ), `toBe("village-ppo-0001")` → `toBe("village-ppo-0002")` (2 chỗ), comment đầu file: model hiện là village-ppo-0002 (PPO từ village-bc-0003, observation có lịch sử phiếu, spec 2026-09-19); ppo-0001 giữ để rollback.
- `.env.example` và `deploy/env.production.example`: `village-ppo-0001` → `village-ppo-0002`, ghi chú ppo-0001 giữ để rollback.
- `apps/server/src/bots/learned-policy.ts`: comment số đo thay bằng số confirm B.
- Spec B: mục `## Kết quả` như 6a nhưng kết luận "đóng gói village-ppo-0002".

Run: `cd apps/server && npx vitest run` — Expected: PASS.

```bash
git add apps/server/assets/models/village-ppo-0002.weights.json apps/server/tests/learned-policy.test.ts .env.example deploy/env.production.example apps/server/src/bots/learned-policy.ts docs/superpowers/specs/2026-09-19-vote-history-observation-design.md
git commit -m "feat(bot): ship village-ppo-0002 (vote-history observation, beats ppo-0001 head-to-head)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Dừng trước deploy**

Không push, không PR, không đổi env production. Báo người dùng: số chấm lại, và rằng deploy cần họ duyệt (code lên VPS TRƯỚC, rồi mới đổi `BOT_POLICY_FILE` trong `/opt/masoi/.env`).
