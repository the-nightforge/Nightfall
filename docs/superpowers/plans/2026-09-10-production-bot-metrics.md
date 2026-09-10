# Đo giao tiếp của bot trên ván thật — Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mỗi ván thật kết thúc lưu kèm chỉ số giao tiếp của bot (cột `GameResult.botMetrics`), tính bằng đúng `collectMetrics` của self-play, kèm một script cộng dồn nhiều ván.

**Architecture:** Tách sổ câu hỏi của `runSelfPlay` thành module thuần dùng chung (`question-ledger.ts`). Server ghi sự kiện `SPEECH` / `SPEECH_BLOCKED` / `QUESTION_OUTCOME` đúng hình dạng self-play vào một sổ trong `Room` (sống qua restart), lúc hết ván chạy `collectMetrics` trên sổ đó và lưu một bản rút gọn không chứa chữ nào.

**Tech Stack:** TypeScript, Vitest, Prisma 5 (Postgres, cột `Json`), zod (persistence).

**Spec:** `docs/superpowers/specs/2026-09-10-production-bot-metrics-design.md`

## Global Constraints

- Self-play phải giữ nguyên **từng bit** sau Task 1 — kiểm bằng ảnh vàng.
- **Một định nghĩa**: server đo bằng `collectMetrics`, không đếm lại chỉ số nào bằng tay.
- `botMetrics` **không chứa chữ nào**: không nội dung chat, không tên, không id người chơi.
- Lỗi của bộ ghi **không bao giờ** được làm mất một câu nói; đếm vào `recorderErrors`.
- `metricsVersion: 1`. Trần sổ: 2.000 sự kiện (`MAX_ARCHIVED_MESSAGES`).
- Chỉ mở câu hỏi khi **người bị hỏi là bot**. Câu hỏi còn mở lúc hết ván bị bỏ.
- Server import engine từ `dist`: sau mọi thay đổi ở `packages/`, chạy `npm run build:deps` trước khi chạy test server.
- Chạy suite engine và server **tuần tự**, không song song (tranh CPU làm `selfplay-invariants` timeout).
- Lệnh test một file: `npx vitest run --root packages/game-engine tests/<file>` và `npx vitest run --root apps/server tests/<file>`.
- Mỗi task kết thúc bằng **dừng để người dùng kiểm tra**. Không tự commit; bước commit chỉ chạy khi người dùng bảo.

## Cấu trúc file

| File | Loại | Trách nhiệm |
| --- | --- | --- |
| `packages/game-engine/src/bot/evaluation/question-ledger.ts` | mới | Sổ câu hỏi thuần: mở, đánh dấu, chốt |
| `packages/game-engine/src/bot/evaluation/selfplay.ts` | sửa | Dùng sổ thay closure; `QUESTION_OUTCOME` có `humanAsker?` |
| `packages/game-engine/src/bot/evaluation/metrics.ts` | sửa | `humanQuestionOutcomes`, `casualToneRateProvider` |
| `packages/game-engine/src/index.ts` | sửa | Export `question-ledger` |
| `apps/server/src/game/bot-speech-log.ts` | mới | Ghi sổ của phòng; mọi móc bọc `try/catch` |
| `apps/server/src/game/bot-metrics.ts` | mới | Dựng `SelfPlayGame` tối thiểu, rút gọn `botMetrics`, hàm cộng dồn |
| `apps/server/src/rooms/store.ts` | sửa | `speechLog`, `questionLedger`, `botSpeechLogTruncated`, `recorderErrors` trên `Room` |
| `apps/server/src/persistence/{serialize,schema,restore}.ts` | sửa | Sổ sống qua restart; envelope cũ → `null` |
| `apps/server/src/game/discussion-scheduler.ts` | sửa | Móc khi bot quan sát / tới lượt / bị chặn / nói |
| `apps/server/src/game/machine.ts` | sửa | Khởi tạo/bỏ sổ; móc `deterministicVote`; chốt ở `endVoting` và `beginNight` |
| `apps/server/src/rooms/service.ts` | sửa | Mở câu hỏi khi người thật hỏi bot |
| `apps/server/src/game/game-result.ts` | sửa | Ghi `botMetrics` cùng lệnh `create` |
| `apps/server/prisma/schema.prisma` + migration | sửa/mới | Cột `botMetrics Json?` |
| `apps/server/scripts/prod-metrics.ts` | mới | Đọc cột, lọc, cộng dồn, in báo cáo |

---

### Task 1: Tách sổ câu hỏi khỏi `runSelfPlay`

**Files:**
- Create: `packages/game-engine/src/bot/evaluation/question-ledger.ts`
- Modify: `packages/game-engine/src/bot/evaluation/selfplay.ts`
- Modify: `packages/game-engine/src/index.ts`
- Test: `packages/game-engine/tests/bot-question-ledger.test.ts`
- Công cụ một lần: `.tmp/golden.mjs` (không commit)

**Interfaces:**
- Produces:
  - `interface PendingQuestion { messageId; askerId; targetId; round; recognized: boolean | null; turns: number; blocked: SpeechBlockReason | null; answered: boolean; spokeOther: boolean; humanAsker?: true }`
  - `interface QuestionLedgerState { open: PendingQuestion[] }`
  - `createQuestionLedger(): QuestionLedgerState`
  - `openQuestion(state, q: { messageId: string; askerId: string; targetId: string; round: number; humanAsker?: boolean }): void`
  - `markObserved(state, targetId: string, visibleChat: readonly { id: string }[], memories: readonly { sourceId: string; targetId?: string }[]): void`
  - `markSpeechTurn(state, targetId: string, isInChat: (messageId: string) => boolean): void`
  - `markBlocked(state, replyToMessageId: string | undefined, speakerId: string, reason: SpeechBlockReason): void`
  - `markSpoke(state, speakerId: string, replyToMessageId: string | undefined, isInChat: (messageId: string) => boolean): void`
  - `settleQuestions(state): QuestionOutcomeEvent[]` — chốt rồi làm rỗng `state.open`
  - `type QuestionOutcomeEvent = Extract<SelfPlayEvent, { kind: "QUESTION_OUTCOME" }>`
  - Sự kiện `QUESTION_OUTCOME` có thêm `humanAsker?: true`

- [ ] **Step 1: Chụp ảnh vàng TRƯỚC khi sửa dòng nào**

Tạo `.tmp/golden.mjs`:

```js
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { runSelfPlay, BOT_WEIGHTS_PRESETS } from "../packages/game-engine/dist/index.js";
import { PRESET_DECKS } from "../packages/shared/dist/index.js";

// Ba kiểu bàn: mặc định có trace, bộ bài 12 người có phiên xử, bàn có 2 ghế người.
const VARIANTS = {
  "8p+trace": (w, seed) => ({ seed, weights: w, trace: true }),
  "12p-deck+defense": (w, seed) => ({ seed, weights: w, playerCount: 12, config: PRESET_DECKS[12], defense: true }),
  "8p+2humans": (w, seed) => ({ seed, weights: w, humanSeats: 2 }),
};
const SEEDS = ["g0", "g1", "g2", "g3", "g4", "g5"];

const out = {};
for (const [version, weights] of Object.entries(BOT_WEIGHTS_PRESETS).sort()) {
  for (const [name, make] of Object.entries(VARIANTS)) {
    const h = createHash("sha256");
    for (const seed of SEEDS) h.update(JSON.stringify(runSelfPlay(make(weights, seed))));
    out[`${version} ${name}`] = h.digest("hex").slice(0, 16);
  }
}

const [mode, file] = process.argv.slice(2);
if (mode === "write") {
  writeFileSync(file, JSON.stringify(out, null, 1));
  console.log("wrote", Object.keys(out).length, "golden hashes ->", file);
} else {
  const before = JSON.parse(readFileSync(file, "utf8"));
  const keys = new Set([...Object.keys(before), ...Object.keys(out)]);
  const diff = [...keys].filter((k) => before[k] !== out[k]);
  console.log("compared", keys.size, diff.length === 0 ? "IDENTICAL" : `${diff.length} DIFFER`);
  for (const k of diff) console.log("  DIFF:", k, before[k], "->", out[k]);
  process.exitCode = diff.length === 0 ? 0 : 1;
}
```

Run: `npm run build:deps && node .tmp/golden.mjs write .tmp/golden-ledger-before.json`
Expected: `wrote N golden hashes` (N = số preset × 3).

- [ ] **Step 2: Viết test cho sổ câu hỏi (chưa có module → đỏ)**

Tạo `packages/game-engine/tests/bot-question-ledger.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createQuestionLedger,
  markBlocked,
  markObserved,
  markSpeechTurn,
  markSpoke,
  openQuestion,
  settleQuestions,
  type QuestionLedgerState,
} from "../src/bot/evaluation/question-ledger";

const ALWAYS = (): boolean => true;
const Q = { messageId: "m1", askerId: "a", targetId: "t", round: 2 };
const SEEN = [{ id: "m1" }];
const PARSED = [{ sourceId: "m1", targetId: "t" }];

function asked(extra: Partial<Parameters<typeof openQuestion>[1]> = {}): QuestionLedgerState {
  const ledger = createQuestionLedger();
  openQuestion(ledger, { ...Q, ...extra });
  return ledger;
}

const outcomeOf = (ledger: QuestionLedgerState) => settleQuestions(ledger)[0]!.outcome;

describe("question-ledger — bảy ngăn", () => {
  it("đáp đúng câu hỏi: ANSWERED", () => {
    const l = asked();
    markObserved(l, "t", SEEN, PARSED);
    markSpeechTurn(l, "t", ALWAYS);
    markSpoke(l, "t", "m1", ALWAYS);
    expect(outcomeOf(l)).toBe("ANSWERED");
  });

  it("câu đáp bị phòng chặn: BLOCKED_ROOM", () => {
    const l = asked();
    markObserved(l, "t", SEEN, PARSED);
    markBlocked(l, "m1", "t", "REPLIES_PER_MESSAGE");
    expect(outcomeOf(l)).toBe("BLOCKED_ROOM");
  });

  it("người bị hỏi chưa quan sát lần nào: UNDETERMINED", () => {
    expect(outcomeOf(asked())).toBe("UNDETERMINED");
  });

  it("thấy câu mà parser không đọc ra: NOT_PARSED", () => {
    const l = asked();
    markObserved(l, "t", SEEN, []);
    expect(outcomeOf(l)).toBe("NOT_PARSED");
  });

  it("đọc ra nhưng không được lượt: NO_TURN", () => {
    const l = asked();
    markObserved(l, "t", SEEN, PARSED);
    expect(outcomeOf(l)).toBe("NO_TURN");
  });

  it("có lượt, nói chuyện khác: DECLINED_SPOKE_OTHER", () => {
    const l = asked();
    markObserved(l, "t", SEEN, PARSED);
    markSpeechTurn(l, "t", ALWAYS);
    markSpoke(l, "t", "m9", ALWAYS);
    expect(outcomeOf(l)).toBe("DECLINED_SPOKE_OTHER");
  });

  it("có lượt, im: DECLINED_SILENT", () => {
    const l = asked();
    markObserved(l, "t", SEEN, PARSED);
    markSpeechTurn(l, "t", ALWAYS);
    expect(outcomeOf(l)).toBe("DECLINED_SILENT");
  });
});

describe("question-ledger — luật chi tiết", () => {
  it("chỉ lần quan sát ĐẦU TIÊN có câu hỏi mới tính", () => {
    const l = asked();
    markObserved(l, "t", SEEN, []);
    markObserved(l, "t", SEEN, PARSED);
    expect(outcomeOf(l)).toBe("NOT_PARSED");
  });

  it("quan sát khi câu chưa hiện trong chat thì không tính", () => {
    const l = asked();
    markObserved(l, "t", [], PARSED);
    expect(outcomeOf(l)).toBe("UNDETERMINED");
  });

  it("chỉ người bị hỏi mới được tính lượt, và chỉ khi câu đã vào chat", () => {
    const l = asked();
    markObserved(l, "t", SEEN, PARSED);
    markSpeechTurn(l, "someone-else", ALWAYS);
    markSpeechTurn(l, "t", () => false);
    expect(outcomeOf(l)).toBe("NO_TURN");
  });

  it("bị chặn khi đáp một câu KHÁC thì không tính là bị chặn", () => {
    const l = asked();
    markObserved(l, "t", SEEN, PARSED);
    markBlocked(l, "m9", "t", "CHAIN_DEPTH");
    expect(outcomeOf(l)).toBe("NO_TURN");
  });

  it("sự kiện mang đúng các trường, đúng thứ tự khoá; câu hỏi của bot không có humanAsker", () => {
    const [event] = settleQuestions(asked());
    expect(JSON.stringify(event)).toBe(
      JSON.stringify({ kind: "QUESTION_OUTCOME", round: 2, messageId: "m1", askerId: "a", targetId: "t", outcome: "UNDETERMINED" }),
    );
  });

  it("cờ humanAsker đi tới sự kiện", () => {
    const [event] = settleQuestions(asked({ humanAsker: true }));
    expect(event!.humanAsker).toBe(true);
  });

  it("chốt theo đúng thứ tự mở, rồi làm rỗng sổ", () => {
    const l = createQuestionLedger();
    openQuestion(l, { ...Q, messageId: "m1" });
    openQuestion(l, { ...Q, messageId: "m2" });
    expect(settleQuestions(l).map((e) => e.messageId)).toEqual(["m1", "m2"]);
    expect(l.open).toEqual([]);
    expect(settleQuestions(l)).toEqual([]);
  });

  it("mở lại cùng messageId thì thay TẠI CHỖ, đúng như Map.set cũ", () => {
    const l = createQuestionLedger();
    openQuestion(l, { ...Q, messageId: "m1" });
    openQuestion(l, { ...Q, messageId: "m2" });
    openQuestion(l, { ...Q, messageId: "m1", askerId: "b" });
    expect(l.open.map((q) => [q.messageId, q.askerId])).toEqual([["m1", "b"], ["m2", "a"]]);
  });

  it("qua JSON giữa chừng rồi đi tiếp cho cùng kết quả — điều kiện để sống qua restart", () => {
    const l = asked();
    markObserved(l, "t", SEEN, PARSED);
    const revived: QuestionLedgerState = JSON.parse(JSON.stringify(l));
    markSpeechTurn(revived, "t", ALWAYS);
    markSpoke(revived, "t", "m1", ALWAYS);
    expect(outcomeOf(revived)).toBe("ANSWERED");
  });
});
```

- [ ] **Step 3: Chạy để thấy đỏ**

Run: `npx vitest run --root packages/game-engine tests/bot-question-ledger.test.ts`
Expected: FAIL — `Failed to resolve import "../src/bot/evaluation/question-ledger"`.

- [ ] **Step 4: Viết module và thêm `humanAsker` vào sự kiện**

Tạo `packages/game-engine/src/bot/evaluation/question-ledger.ts`:

```ts
import type { QuestionOutcome, SelfPlayEvent, SpeechBlockReason } from "./selfplay";

/**
 * Sổ câu hỏi nhắm thẳng vào một người: người bị hỏi có đọc ra không, có được
 * lượt không, có bị phòng chặn không, và cuối cùng có đáp không.
 *
 * Tách khỏi closure của `runSelfPlay` để phòng thật đo được CÙNG một thứ bằng
 * CÙNG một luật (`docs/superpowers/specs/2026-09-10-production-bot-metrics-design.md`).
 * Chuyển nguyên, không đổi điều kiện hay thứ tự: ảnh vàng của self-play giữ
 * từng bit.
 *
 * Trạng thái là dữ liệu thuần - không `Map`, không closure - để server lưu được
 * vào envelope và khôi phục sau restart. Mảng giữ thứ tự chèn, đúng thứ tự mà
 * `Map` cũ duyệt, và thứ tự đó quyết định thứ tự các `QUESTION_OUTCOME`.
 *
 * THUẦN: không RNG, không đồng hồ, chỉ đọc những gì chỗ gọi truyền vào.
 */

export interface PendingQuestion {
  messageId: string;
  askerId: string;
  targetId: string;
  round: number;
  /** `null`: người được hỏi CHƯA quan sát chat nào có câu này. */
  recognized: boolean | null;
  /** Số lượt người được hỏi được nói SAU khi câu đã hiện trong chat. */
  turns: number;
  blocked: SpeechBlockReason | null;
  answered: boolean;
  spokeOther: boolean;
  /** Chỉ phòng thật đặt cờ này: người hỏi là người thật. */
  humanAsker?: true;
}

export interface QuestionLedgerState {
  open: PendingQuestion[];
}

export type QuestionOutcomeEvent = Extract<SelfPlayEvent, { kind: "QUESTION_OUTCOME" }>;

export function createQuestionLedger(): QuestionLedgerState {
  return { open: [] };
}

export function openQuestion(
  state: QuestionLedgerState,
  question: { messageId: string; askerId: string; targetId: string; round: number; humanAsker?: boolean },
): void {
  const fresh: PendingQuestion = {
    messageId: question.messageId,
    askerId: question.askerId,
    targetId: question.targetId,
    round: question.round,
    recognized: null,
    turns: 0,
    blocked: null,
    answered: false,
    spokeOther: false,
    ...(question.humanAsker ? { humanAsker: true as const } : {}),
  };
  // `Map.set` trên khoá đã có thì thay giá trị mà giữ vị trí. Làm y hệt.
  const index = state.open.findIndex((item) => item.messageId === question.messageId);
  if (index === -1) state.open.push(fresh);
  else state.open[index] = fresh;
}

/** Sau mỗi `observe`: parser của người được hỏi có nhận ra câu hỏi không. */
export function markObserved(
  state: QuestionLedgerState,
  targetId: string,
  visibleChat: readonly { id: string }[],
  memories: readonly { sourceId: string; targetId?: string }[],
): void {
  for (const question of state.open) {
    if (question.targetId !== targetId || question.recognized !== null) continue;
    if (!visibleChat.some((m) => m.id === question.messageId)) continue;
    question.recognized = memories.some(
      (memory) => memory.sourceId === question.messageId && memory.targetId === targetId,
    );
  }
}

/** Trước mỗi lượt nói: người được hỏi có thêm một cơ hội đáp. */
export function markSpeechTurn(
  state: QuestionLedgerState,
  targetId: string,
  isInChat: (messageId: string) => boolean,
): void {
  for (const question of state.open) {
    if (question.targetId === targetId && isInChat(question.messageId)) question.turns += 1;
  }
}

/** Câu đáp bị PHÒNG chặn (hạn mức, chuỗi, số phản hồi). */
export function markBlocked(
  state: QuestionLedgerState,
  replyToMessageId: string | undefined,
  speakerId: string,
  reason: SpeechBlockReason,
): void {
  if (!replyToMessageId) return;
  const asked = state.open.find((item) => item.messageId === replyToMessageId);
  if (asked && asked.targetId === speakerId) asked.blocked = reason;
}

/**
 * Sau khi người được hỏi phát một câu: câu đó ĐÁP câu hỏi, hay là chuyện khác?
 * Chỉ tính khi câu hỏi đã hiện trong chat - nói trước khi thấy câu hỏi không
 * phải là "chọn nói việc khác".
 */
export function markSpoke(
  state: QuestionLedgerState,
  speakerId: string,
  replyToMessageId: string | undefined,
  isInChat: (messageId: string) => boolean,
): void {
  for (const question of state.open) {
    if (question.targetId !== speakerId || !isInChat(question.messageId)) continue;
    if (replyToMessageId === question.messageId) question.answered = true;
    else question.spokeOther = true;
  }
}

/** Chốt số phận mọi câu hỏi đang mở rồi làm rỗng sổ. Xem `QuestionOutcome`. */
export function settleQuestions(state: QuestionLedgerState): QuestionOutcomeEvent[] {
  const events = state.open.map((question): QuestionOutcomeEvent => {
    let outcome: QuestionOutcome;
    if (question.answered) outcome = "ANSWERED";
    else if (question.blocked !== null) outcome = "BLOCKED_ROOM";
    else if (question.recognized === null) outcome = "UNDETERMINED";
    else if (!question.recognized) outcome = "NOT_PARSED";
    else if (question.turns === 0) outcome = "NO_TURN";
    else outcome = question.spokeOther ? "DECLINED_SPOKE_OTHER" : "DECLINED_SILENT";
    // Thứ tự khoá phải đúng như literal cũ trong `runSelfPlay`: ảnh vàng băm
    // `JSON.stringify` của sự kiện.
    return {
      kind: "QUESTION_OUTCOME",
      round: question.round,
      messageId: question.messageId,
      askerId: question.askerId,
      targetId: question.targetId,
      outcome,
      ...(question.humanAsker ? { humanAsker: true as const } : {}),
    };
  });
  state.open = [];
  return events;
}
```

Trong `packages/game-engine/src/bot/evaluation/selfplay.ts`, ở kiểu sự kiện `QUESTION_OUTCOME` (khối có `kind: "QUESTION_OUTCOME";`), thay:

```ts
      targetId: string;
      outcome: QuestionOutcome;
    }
```

bằng:

```ts
      targetId: string;
      outcome: QuestionOutcome;
      /**
       * Người hỏi là NGƯỜI THẬT. Chỉ phòng thật đặt cờ này; self-play không
       * bao giờ có, nên JSON của nó không đổi một ký tự.
       */
      humanAsker?: true;
    }
```

- [ ] **Step 5: Chạy test sổ — phải xanh**

Run: `npx vitest run --root packages/game-engine tests/bot-question-ledger.test.ts`
Expected: PASS, 16 test.

- [ ] **Step 6: Cho `runSelfPlay` dùng sổ mới — bốn chỗ sửa trong `selfplay.ts`**

(a) Thêm import, ngay dưới khối `import { ... } from "../conversation/fingerprint";`:

```ts
import {
  createQuestionLedger,
  markBlocked,
  markObserved,
  markSpeechTurn,
  markSpoke,
  openQuestion,
  settleQuestions,
} from "./question-ledger";
```

(b) Xoá trọn khối từ dòng `  interface PendingQuestion {` tới hết hàm `settleQuestions` cục bộ (khối kết thúc bằng `    pendingQuestions.clear();` rồi `  };`). Giữ nguyên chú thích `/** ... */` đứng ngay trên `interface PendingQuestion`. Thay bằng:

```ts
  const questions = createQuestionLedger();
  const chatHas = (messageId: string): boolean => chat.some((m) => m.id === messageId);

  /** Sau mỗi `observe`: parser của người được hỏi có nhận ra câu hỏi không. */
  const noteObserved = (playerId: string, context: BotDecisionContext): void =>
    markObserved(questions, playerId, context.visibleChat, runtimes.get(playerId)!.state.memories);

  /** Trước mỗi `decideSpeech`: người được hỏi có thêm một cơ hội đáp. */
  const noteSpeechTurn = (playerId: string): void =>
    markSpeechTurn(questions, playerId, chatHas);
```

(c) Trong nhánh bị chặn của `emitSpeech`, thay:

```ts
      const asked = speech.replyToMessageId
        ? pendingQuestions.get(speech.replyToMessageId)
        : undefined;
      if (asked && asked.targetId === playerId) asked.blocked = blockReason;
```

bằng:

```ts
      markBlocked(questions, speech.replyToMessageId, playerId, blockReason);
```

(d) Ở cuối `emitSpeech`, giữ ba dòng chú thích `// Sổ câu hỏi: ...`, thay:

```ts
    for (const question of pendingQuestions.values()) {
      if (question.targetId !== playerId || !chatHas(question.messageId)) continue;
      if (speech.replyToMessageId === question.messageId) question.answered = true;
      else question.spokeOther = true;
    }
    if (
      (speech.kind === "QUESTION" || speech.kind === "ASK_EVIDENCE") &&
      speech.targetId !== undefined &&
      speech.targetId !== playerId
    ) {
      pendingQuestions.set(messageId, {
        messageId,
        askerId: playerId,
        targetId: speech.targetId,
        round,
        recognized: null,
        turns: 0,
        blocked: null,
        answered: false,
        spokeOther: false,
      });
    }
```

bằng:

```ts
    markSpoke(questions, playerId, speech.replyToMessageId, chatHas);
    if (
      (speech.kind === "QUESTION" || speech.kind === "ASK_EVIDENCE") &&
      speech.targetId !== undefined &&
      speech.targetId !== playerId
    ) {
      openQuestion(questions, { messageId, askerId: playerId, targetId: speech.targetId, round });
    }
```

(e) Ở chỗ chốt duy nhất (ngay trước `engine.resolveNomination(...)`), thay `    settleQuestions();` bằng:

```ts
    log.push(...settleQuestions(questions));
```

Trong `packages/game-engine/src/index.ts`, ngay dưới `export * from "./bot/evaluation/selfplay";` thêm:

```ts
export * from "./bot/evaluation/question-ledger";
```

Run: `grep -n "pendingQuestions" packages/game-engine/src/bot/evaluation/selfplay.ts`
Expected: không in dòng nào.

- [ ] **Step 7: Typecheck và so ảnh vàng — phải giống hệt từng bit**

Run: `npx tsc -p packages/game-engine/tsconfig.json --noEmit && npm run build:deps && node .tmp/golden.mjs compare .tmp/golden-ledger-before.json`
Expected: `compared N IDENTICAL`.

Nếu có dòng `DIFF`: dừng, không sửa test. Nguyên nhân gần như chắc chắn là thứ tự khoá của sự kiện `QUESTION_OUTCOME`, hoặc thứ tự duyệt câu hỏi khác thứ tự chèn.

- [ ] **Step 8: Chạy toàn bộ engine**

Run: `npm run test --workspace @masoi/game-engine`
Expected: mọi file xanh; tổng số test tăng đúng 16.

- [ ] **Step 9: Dừng để người dùng kiểm. Commit khi được bảo:**

```bash
git add packages/game-engine/src/bot/evaluation/question-ledger.ts packages/game-engine/src/bot/evaluation/selfplay.ts packages/game-engine/src/index.ts packages/game-engine/tests/bot-question-ledger.test.ts
git commit -m "refactor(selfplay): extract question ledger into shared module"
```

---

### Task 2: Hai chỉ số mới trong `collectMetrics`

**Files:**
- Modify: `packages/game-engine/src/bot/evaluation/metrics.ts`
- Test: `packages/game-engine/tests/bot-production-metrics.test.ts`
- Modify (sinh lại): `docs/fixtures/selfplay-sample.json`
- Công cụ một lần: `.tmp/refix.mjs` (không commit)

**Interfaces:**
- Consumes: `QUESTION_OUTCOME.humanAsker?: true` (Task 1).
- Produces: `SelfPlayMetrics.humanQuestionOutcomes: Record<QuestionOutcome, Ratio>`; `SelfPlayMetrics.casualToneRateProvider: Ratio`.

- [ ] **Step 1: Viết test (đỏ)**

Tạo `packages/game-engine/tests/bot-production-metrics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runSelfPlay, type SelfPlayEvent, type SelfPlayGame } from "../src/bot/evaluation/selfplay";
import { collectMetrics } from "../src/bot/evaluation/metrics";

type Speech = Extract<SelfPlayEvent, { kind: "SPEECH" }>;

const BASE = runSelfPlay({ seed: "prod-metrics" });
const FIRST_SPEECH = BASE.events.find((e): e is Speech => e.kind === "SPEECH")!;

function withEvents(extra: SelfPlayEvent[]): SelfPlayGame {
  return { ...BASE, events: [...BASE.events, ...extra] };
}

function humanQuestion(outcome: "ANSWERED" | "NO_TURN"): SelfPlayEvent {
  return {
    kind: "QUESTION_OUTCOME",
    round: 1,
    messageId: `h-${outcome}`,
    askerId: "human",
    targetId: FIRST_SPEECH.actorId,
    outcome,
    humanAsker: true,
  };
}

function providerLine(text: string, messageId: string): SelfPlayEvent {
  return { ...FIRST_SPEECH, messageId, text, fromTemplate: false };
}

describe("collectMetrics — câu hỏi của người thật", () => {
  it("đi bảng riêng, không lẫn vào bảng bot hỏi bot", () => {
    const base = collectMetrics([BASE]).overall;
    const mixed = collectMetrics([withEvents([humanQuestion("ANSWERED"), humanQuestion("NO_TURN")])]).overall;
    expect(mixed.directQuestionOutcomes).toEqual(base.directQuestionOutcomes);
    expect(mixed.humanQuestionOutcomes.ANSWERED).toEqual({ value: 0.5, numerator: 1, denominator: 2 });
    expect(mixed.humanQuestionOutcomes.NO_TURN).toEqual({ value: 0.5, numerator: 1, denominator: 2 });
  });

  it("self-play không có người hỏi: mẫu số 0, giá trị null", () => {
    const m = collectMetrics([BASE]).overall;
    expect(m.humanQuestionOutcomes.ANSWERED).toEqual({ value: null, numerator: 0, denominator: 0 });
  });
});

describe("collectMetrics — giọng của riêng nhà cung cấp", () => {
  it("chỉ đếm câu fromTemplate === false", () => {
    const m = collectMetrics([
      withEvents([
        providerLine("ừ t nghi An", "p1"),
        providerLine("Tôi cho rằng chúng ta nên cân nhắc kỹ lưỡng mọi bằng chứng đã được trình bày.", "p2"),
      ]),
    ]).overall;
    expect(m.casualToneRateProvider).toEqual({ value: 0.5, numerator: 1, denominator: 2 });
  });

  it("self-play toàn bảng mẫu: null", () => {
    expect(collectMetrics([BASE]).overall.casualToneRateProvider).toEqual({
      value: null,
      numerator: 0,
      denominator: 0,
    });
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ**

Run: `npx vitest run --root packages/game-engine tests/bot-production-metrics.test.ts`
Expected: FAIL — `Cannot read properties of undefined (reading 'ANSWERED')`.

- [ ] **Step 3: Sửa `metrics.ts`**

(a) Trong `interface SelfPlayMetrics`, ngay dưới `  directQuestionOutcomes: Record<QuestionOutcome, Ratio>;` thêm:

```ts
  /**
   * Số phận câu hỏi của NGƯỜI THẬT nhắm vào bot: cùng bảy ngăn với
   * `directQuestionOutcomes`, cùng cách lấy mẫu số. Tách bảng vì bảng kia nói
   * về bot hỏi bot, và trộn hai quần thể vào một mẫu số làm cả hai con số vô
   * nghĩa. Self-play không có người hỏi nên mọi ngăn là `null`.
   */
  humanQuestionOutcomes: Record<QuestionOutcome, Ratio>;
```

và ngay dưới `  casualToneRate: Ratio;` thêm:

```ts
  /**
   * `casualToneRate` chỉ trên câu do NHÀ CUNG CẤP viết (`fromTemplate === false`).
   * Con số gộp trộn cả bảng mẫu (~0,90), nên nó trôi LÊN đúng lúc nhà cung cấp
   * chết. Self-play toàn bảng mẫu nên `null`.
   */
  casualToneRateProvider: Ratio;
```

(b) Ngay dưới hàm `mean` ở cấp module, thêm:

```ts
/** Bảy ngăn số phận câu hỏi thành bảy `Ratio` cùng một mẫu số, giữ thứ tự khoá. */
function outcomeRatios(
  counts: Record<QuestionOutcome, number>,
  total: number,
): Record<QuestionOutcome, Ratio> {
  return Object.fromEntries(
    (Object.keys(counts) as QuestionOutcome[]).map((key) => [key, ratio(counts[key], total)]),
  ) as Record<QuestionOutcome, Ratio>;
}
```

(c) Ngay dưới `  let questionOutcomeTotal = 0;` thêm:

```ts
  const humanQuestionOutcomes: Record<QuestionOutcome, number> = { ...questionOutcomes };
  let humanQuestionOutcomeTotal = 0;
```

và ngay dưới `  let casualLines = 0;` thêm:

```ts
  let providerLines = 0;
  let casualProviderLines = 0;
```

(d) Trong vòng duyệt sự kiện có `SPEECH_BLOCKED`, thay:

```ts
        if (e.kind === "QUESTION_OUTCOME") {
          questionOutcomes[e.outcome] += 1;
          questionOutcomeTotal += 1;
        } else if (e.kind === "SPEECH_BLOCKED") {
```

bằng:

```ts
        if (e.kind === "QUESTION_OUTCOME") {
          if (e.humanAsker) {
            humanQuestionOutcomes[e.outcome] += 1;
            humanQuestionOutcomeTotal += 1;
          } else {
            questionOutcomes[e.outcome] += 1;
            questionOutcomeTotal += 1;
          }
        } else if (e.kind === "SPEECH_BLOCKED") {
```

(e) Trong vòng `SPEECH`, ngay dưới `        if (looksCasual(event.text)) casualLines += 1;` thêm:

```ts
        if (event.fromTemplate === false) {
          providerLines += 1;
          if (looksCasual(event.text)) casualProviderLines += 1;
        }
```

(f) Trong object trả về, thay cả khối:

```ts
    directQuestionOutcomes: {
      ANSWERED: ratio(questionOutcomes.ANSWERED, questionOutcomeTotal),
      NOT_PARSED: ratio(questionOutcomes.NOT_PARSED, questionOutcomeTotal),
      BLOCKED_ROOM: ratio(questionOutcomes.BLOCKED_ROOM, questionOutcomeTotal),
      NO_TURN: ratio(questionOutcomes.NO_TURN, questionOutcomeTotal),
      DECLINED_SPOKE_OTHER: ratio(questionOutcomes.DECLINED_SPOKE_OTHER, questionOutcomeTotal),
      DECLINED_SILENT: ratio(questionOutcomes.DECLINED_SILENT, questionOutcomeTotal),
      UNDETERMINED: ratio(questionOutcomes.UNDETERMINED, questionOutcomeTotal),
    },
```

bằng:

```ts
    directQuestionOutcomes: outcomeRatios(questionOutcomes, questionOutcomeTotal),
    humanQuestionOutcomes: outcomeRatios(humanQuestionOutcomes, humanQuestionOutcomeTotal),
```

và ngay dưới `    casualToneRate: ratio(casualLines, speechTotal),` thêm:

```ts
    casualToneRateProvider: ratio(casualProviderLines, providerLines),
```

- [ ] **Step 4: Chạy test — phải xanh**

Run: `npx vitest run --root packages/game-engine tests/bot-production-metrics.test.ts`
Expected: PASS, 4 test.

- [ ] **Step 5: Chốt "không số cũ nào đổi", rồi mới sinh lại fixture**

Tạo `.tmp/refix.mjs`:

```js
import { readFileSync, writeFileSync } from "node:fs";
import { buildReport, runBatch, weightsPreset } from "../packages/game-engine/dist/index.js";

const path = new URL("../docs/fixtures/selfplay-sample.json", import.meta.url);
const before = JSON.parse(readFileSync(path, "utf8"));
const input = { seedBase: before.seedBase, games: before.games, weights: weightsPreset(before.weightsVersion) };
const after = buildReport(input, runBatch(input));

// Bỏ đúng hai khoá mới rồi so. Sinh lại fixture mà không so trước là giấu mất
// đúng loại lỗi mà fixture tồn tại để bắt.
const { humanQuestionOutcomes, casualToneRateProvider, ...rest } = after.metrics;
if (JSON.stringify(rest) !== JSON.stringify(before.metrics)) {
  console.error("OLD NUMBERS CHANGED - fixture NOT rewritten");
  process.exit(1);
}
writeFileSync(path, JSON.stringify(after, null, 2) + "\n", "utf8");
console.log("fixture rewritten; old numbers unchanged");
```

Run: `npm run build:deps && node .tmp/refix.mjs && npx vitest run --root packages/game-engine tests/selfplay-report.test.ts`
Expected: `fixture rewritten; old numbers unchanged`, rồi PASS.

Nếu in `OLD NUMBERS CHANGED`: dừng. Nghi phạm đầu tiên là thứ tự khoá của `outcomeRatios` khác literal cũ.

- [ ] **Step 6: Typecheck và chạy toàn bộ engine**

Run: `npm run lint --workspace @masoi/game-engine && npm run test --workspace @masoi/game-engine`
Expected: lint sạch; mọi file xanh.

- [ ] **Step 7: Dừng để người dùng kiểm. Commit khi được bảo:**

```bash
git add packages/game-engine/src/bot/evaluation/metrics.ts packages/game-engine/tests/bot-production-metrics.test.ts docs/fixtures/selfplay-sample.json
git commit -m "feat(metrics): add human question outcomes and provider-only casual tone"
```

---

### Task 3: Sổ lời nói trong phòng (server) và persistence

**Files:**
- Create: `apps/server/src/game/bot-speech-log.ts`
- Modify: `apps/server/src/rooms/store.ts`
- Modify: `apps/server/src/persistence/serialize.ts`, `schema.ts`, `restore.ts`
- Test: `apps/server/tests/bot-speech-log.test.ts` (mới), `apps/server/tests/persistence-roundtrip.test.ts` (thêm)

**Interfaces:**
- Consumes (Task 1, qua `@masoi/game-engine`): `createQuestionLedger`, `markObserved`, `markSpeechTurn`, `markBlocked`, `markSpoke`, `openQuestion`, `settleQuestions`, `QuestionLedgerState`, `SelfPlayEvent`, `SpeechBlockReason`; cùng `analyzeChat`, `speechTextFingerprint`, `speechShapeFingerprint`, `speechSemanticFingerprint`, `BotSpeechIntention`.
- Produces:
  - `type BotSpeechLogEvent = Extract<SelfPlayEvent, { kind: "SPEECH" | "SPEECH_BLOCKED" | "QUESTION_OUTCOME" }>`
  - Trên `Room`: `speechLog?: BotSpeechLogEvent[] | null`, `questionLedger?: QuestionLedgerState | null`, `botSpeechLogTruncated?: boolean`, `recorderErrors?: number`
  - `startBotSpeechLog(room)`, `discardBotSpeechLog(room)`
  - `noteBotObserved(room, botId, visibleChat, memories)`
  - `noteBotSpeechTurn(room, botId)`
  - `noteBotBlocked(room, botId, round, speech, reason)`
  - `noteBotSpoke(room, line: { botId; round; messageId; text; speech; chainDepth; fromTemplate })`
  - `noteHumanChat(room, message: { id; playerId; text; at }, channel: string)`
  - `settleBotQuestions(room)`

- [ ] **Step 1: Viết test của module ghi sổ (đỏ)**

Tạo `apps/server/tests/bot-speech-log.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { GameEngine, speechShapeFingerprint, type BotSpeechIntention } from "@masoi/game-engine";
import type { Room } from "../src/rooms/store";
import { ROOM_SCAFFOLD } from "./helpers/room";

vi.mock("../src/db", () => ({ prisma: {} }));
vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: () => undefined,
  persistRoom: async () => undefined,
  setRoomTimer: () => undefined,
}));

const log = await import("../src/game/bot-speech-log");
const { MAX_ARCHIVED_MESSAGES } = await import("../src/game/match-chat");

const PLAYERS = [
  { id: "h1", name: "An", isBot: false },
  { id: "h2", name: "Dũng", isBot: false },
  { id: "b1", name: "Bình", isBot: true },
  { id: "b2", name: "Chi", isBot: true },
  { id: "b3", name: "Em", isBot: true },
  { id: "b4", name: "Giang", isBot: true },
];

function room(): Room {
  const config = { ...DEFAULT_ROOM_CONFIG, werewolves: 1 };
  const engine = GameEngine.create(PLAYERS, config, 1_000);
  engine.state.phase = "DAY_DISCUSSION";
  engine.state.round = 2;
  return {
    ...ROOM_SCAFFOLD,
    code: "LOGGR",
    hostId: "h1",
    status: "IN_GAME",
    members: PLAYERS.map((p) => ({
      playerId: p.id,
      name: p.name,
      ready: true,
      connected: !p.isBot,
      isBot: p.isBot,
    })),
    config,
    engine,
    chatLog: [],
    createdAt: 0,
  };
}

function intention(over: Partial<BotSpeechIntention> = {}): BotSpeechIntention {
  return { kind: "ACCUSE", targetId: "b2", confidence: 0.7, evidence: [], tone: "FIRM", ...over };
}

function spoke(r: Room, over: Partial<Parameters<typeof log.noteBotSpoke>[1]> = {}): void {
  log.noteBotSpoke(r, {
    botId: "b1",
    round: 2,
    messageId: "bot-chat:2:0",
    text: "t nghi Chi",
    speech: intention(),
    chainDepth: 0,
    fromTemplate: false,
    ...over,
  });
}

describe("bot-speech-log — không có sổ thì không làm gì", () => {
  it("phòng đọc từ envelope cũ (sổ null): mọi móc im lặng, không ném", () => {
    const r = room();
    r.speechLog = null;
    r.questionLedger = null;
    spoke(r);
    log.noteHumanChat(r, { id: "m1", playerId: "h1", text: "Bình ơi sao im thế", at: 1 }, "day");
    log.settleBotQuestions(r);
    expect(r.speechLog).toBeNull();
    expect(r.recorderErrors ?? 0).toBe(0);
  });
});

describe("bot-speech-log — câu của bot", () => {
  it("ghi một SPEECH đúng hình dạng self-play", () => {
    const r = room();
    log.startBotSpeechLog(r);
    spoke(r);
    expect(r.speechLog).toHaveLength(1);
    const event = r.speechLog![0]!;
    expect(event).toMatchObject({
      kind: "SPEECH",
      round: 2,
      actorId: "b1",
      messageId: "bot-chat:2:0",
      speech: "ACCUSE",
      targetId: "b2",
      replyToMessageId: null,
      chainDepth: 0,
      tone: "FIRM",
      topic: null,
      text: "t nghi Chi",
      fromTemplate: false,
      claimedRole: null,
    });
    expect(event.kind === "SPEECH" && event.shapeFingerprint).toBe(
      speechShapeFingerprint("t nghi Chi", PLAYERS.map((p) => p.name)),
    );
  });

  it("bot hỏi bot thì mở câu hỏi; bot hỏi người thật thì KHÔNG", () => {
    const r = room();
    log.startBotSpeechLog(r);
    spoke(r, { messageId: "q-bot", speech: intention({ kind: "QUESTION", targetId: "b3" }) });
    spoke(r, { messageId: "q-human", speech: intention({ kind: "QUESTION", targetId: "h1" }) });
    expect(r.questionLedger!.open.map((q) => q.messageId)).toEqual(["q-bot"]);
  });

  it("bị phòng chặn: ghi SPEECH_BLOCKED và đánh dấu câu hỏi đang chờ", () => {
    const r = room();
    log.startBotSpeechLog(r);
    spoke(r, { messageId: "q1", speech: intention({ kind: "QUESTION", targetId: "b3" }) });
    log.noteBotObserved(r, "b3", [{ id: "q1" }], [{ sourceId: "q1", targetId: "b3" }]);
    log.noteBotBlocked(r, "b3", 2, intention({ kind: "REPLY", replyToMessageId: "q1" }), "REPLIES_PER_MESSAGE");
    log.settleBotQuestions(r);
    expect(r.speechLog!.map((e) => e.kind)).toEqual(["SPEECH", "SPEECH_BLOCKED", "QUESTION_OUTCOME"]);
    expect(r.speechLog!.at(-1)).toMatchObject({ outcome: "BLOCKED_ROOM" });
  });
});

describe("bot-speech-log — người thật hỏi bot", () => {
  it("mở câu hỏi có cờ humanAsker; bot đáp thì ANSWERED", () => {
    const r = room();
    log.startBotSpeechLog(r);
    log.noteHumanChat(r, { id: "hq", playerId: "h1", text: "Bình ơi sao im thế", at: 1 }, "day");
    expect(r.questionLedger!.open).toEqual([expect.objectContaining({ messageId: "hq", targetId: "b1", humanAsker: true })]);

    log.noteBotObserved(r, "b1", [{ id: "hq" }], [{ sourceId: "hq", targetId: "b1" }]);
    log.noteBotSpeechTurn(r, "b1");
    spoke(r, { messageId: "ans", speech: intention({ kind: "REPLY", targetId: "h1", replyToMessageId: "hq" }) });
    log.settleBotQuestions(r);
    expect(r.speechLog!.at(-1)).toMatchObject({ kind: "QUESTION_OUTCOME", outcome: "ANSWERED", humanAsker: true });
  });

  it("ngoài pha ngày, ngoài kênh day, hay người hỏi là bot: không mở gì", () => {
    const r = room();
    log.startBotSpeechLog(r);
    log.noteHumanChat(r, { id: "x1", playerId: "h1", text: "Bình ơi sao im thế", at: 1 }, "dead");
    log.noteHumanChat(r, { id: "x2", playerId: "b2", text: "Bình ơi sao im thế", at: 1 }, "day");
    r.engine!.state.phase = "VOTING";
    log.noteHumanChat(r, { id: "x3", playerId: "h1", text: "Bình ơi sao im thế", at: 1 }, "day");
    expect(r.questionLedger!.open).toEqual([]);
  });
});

describe("bot-speech-log — lỗi và trần", () => {
  it("móc ném thì câu nói vẫn đi, lỗi được ĐẾM chứ không nuốt im", () => {
    const r = room();
    log.startBotSpeechLog(r);
    spoke(r, { messageId: "q1", speech: intention({ kind: "QUESTION", targetId: "b3" }) });
    const broken = null as unknown as { sourceId: string }[];
    expect(() => log.noteBotObserved(r, "b3", [{ id: "q1" }], broken)).not.toThrow();
    expect(r.recorderErrors).toBe(1);
  });

  it("chạm trần thì ngừng ghi và đánh dấu truncated", () => {
    const r = room();
    log.startBotSpeechLog(r);
    const filler = { kind: "SPEECH_BLOCKED", round: 1, actorId: "b1", speech: "REPLY", replyToMessageId: null, reason: "CHAIN_DEPTH" } as const;
    r.speechLog = Array.from({ length: MAX_ARCHIVED_MESSAGES }, () => ({ ...filler }));
    spoke(r);
    expect(r.speechLog).toHaveLength(MAX_ARCHIVED_MESSAGES);
    expect(r.botSpeechLogTruncated).toBe(true);
  });

  it("về sảnh thì bỏ sổ", () => {
    const r = room();
    log.startBotSpeechLog(r);
    spoke(r);
    log.discardBotSpeechLog(r);
    expect(r.speechLog).toBeNull();
    expect(r.questionLedger).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ**

Run: `npm run build:deps && npx vitest run --root apps/server tests/bot-speech-log.test.ts`
Expected: FAIL — `Failed to resolve import "../src/game/bot-speech-log"`.

- [ ] **Step 3: Thêm trường vào `Room` và viết module**

Trong `apps/server/src/rooms/store.ts`, thêm import kiểu ở đầu file:

```ts
import type { QuestionLedgerState } from "@masoi/game-engine";
import type { BotSpeechLogEvent } from "../game/bot-speech-log";
```

và trong `interface Room`, ngay dưới `  matchChat?: ArchivedChatMessage[];` thêm:

```ts
  /**
   * Sổ lời nói của bot trong ván, cùng hình dạng sự kiện với self-play, để lúc
   * hết ván `collectMetrics` đo được ván thật bằng đúng định nghĩa của nó.
   *
   * `null` nghĩa là KHÔNG có sổ từ đầu ván (envelope ghi trước khi có trường
   * này). Ván đó không được đo: một sổ chỉ có nửa sau cho số sai mà trông như
   * đúng. Xem `game/bot-speech-log.ts`.
   */
  speechLog?: BotSpeechLogEvent[] | null;
  /** Câu hỏi đang mở của ván. Cùng luật `null` với `speechLog`. */
  questionLedger?: QuestionLedgerState | null;
  /** Sổ đã chạm trần `MAX_ARCHIVED_MESSAGES` và ngừng ghi. */
  botSpeechLogTruncated?: boolean;
  /** Số lần một móc ghi sổ tự ném lỗi trong ván này. */
  recorderErrors?: number;
```

Tạo `apps/server/src/game/bot-speech-log.ts`:

```ts
import {
  analyzeChat,
  createQuestionLedger,
  markBlocked,
  markObserved,
  markSpeechTurn,
  markSpoke,
  openQuestion,
  settleQuestions,
  speechSemanticFingerprint,
  speechShapeFingerprint,
  speechTextFingerprint,
  type BotSpeechIntention,
  type QuestionLedgerState,
  type SelfPlayEvent,
  type SpeechBlockReason,
} from "@masoi/game-engine";
import type { Room } from "../rooms/store";
import { MAX_ARCHIVED_MESSAGES } from "./match-chat";

/**
 * Sổ lời nói của bot trong một ván THẬT, ghi đúng hình dạng sự kiện của
 * self-play để lúc hết ván `collectMetrics` đo nó bằng đúng một định nghĩa
 * (`docs/superpowers/specs/2026-09-10-production-bot-metrics-design.md`).
 *
 * Mọi móc ở đây đều đi qua `record`: không có sổ thì không làm gì, và móc nào
 * ném thì bị nuốt rồi ĐẾM vào `recorderErrors`. Một lỗi của bộ ghi không bao giờ
 * được làm mất một câu nói - nhưng cũng không được im lặng, nếu không một bộ
 * ghi gãy sẽ trông y hệt một ván không ai hỏi ai.
 */

export type BotSpeechLogEvent = Extract<
  SelfPlayEvent,
  { kind: "SPEECH" | "SPEECH_BLOCKED" | "QUESTION_OUTCOME" }
>;

/**
 * Trên server, câu hỏi chỉ được mở SAU `pushChat`, nên nó luôn đã nằm trong
 * chat. `chatHas` của self-play tồn tại vì ở đó câu mới vào chat chung sau cả
 * lượt; ở đây điều kiện đó luôn đúng.
 */
const IN_CHAT = (): boolean => true;

export function startBotSpeechLog(room: Room): void {
  room.speechLog = [];
  room.questionLedger = createQuestionLedger();
  room.botSpeechLogTruncated = false;
  room.recorderErrors = 0;
}

export function discardBotSpeechLog(room: Room): void {
  room.speechLog = null;
  room.questionLedger = null;
  room.botSpeechLogTruncated = false;
  room.recorderErrors = 0;
}

function record(
  room: Room,
  write: (log: BotSpeechLogEvent[], ledger: QuestionLedgerState) => void,
): void {
  if (!room.speechLog || !room.questionLedger) return;
  try {
    write(room.speechLog, room.questionLedger);
  } catch {
    room.recorderErrors = (room.recorderErrors ?? 0) + 1;
  }
}

function push(room: Room, log: BotSpeechLogEvent[], event: BotSpeechLogEvent): void {
  if (log.length >= MAX_ARCHIVED_MESSAGES) {
    room.botSpeechLogTruncated = true;
    return;
  }
  log.push(event);
}

function isBot(room: Room, playerId: string): boolean {
  return room.members.find((member) => member.playerId === playerId)?.isBot === true;
}

/** Sau mỗi `runtime.observe` của một bot. */
export function noteBotObserved(
  room: Room,
  botId: string,
  visibleChat: readonly { id: string }[],
  memories: readonly { sourceId: string; targetId?: string }[],
): void {
  record(room, (_log, ledger) => markObserved(ledger, botId, visibleChat, memories));
}

/** Trước lượt nói của một bot - CHỈ ở pha thảo luận, như self-play. */
export function noteBotSpeechTurn(room: Room, botId: string): void {
  record(room, (_log, ledger) => markSpeechTurn(ledger, botId, IN_CHAT));
}

/** Ý định đã chốt mà phòng không cho phát. */
export function noteBotBlocked(
  room: Room,
  botId: string,
  round: number,
  speech: BotSpeechIntention,
  reason: SpeechBlockReason,
): void {
  record(room, (log, ledger) => {
    push(room, log, {
      kind: "SPEECH_BLOCKED",
      round,
      actorId: botId,
      speech: speech.kind,
      replyToMessageId: speech.replyToMessageId ?? null,
      reason,
    });
    markBlocked(ledger, speech.replyToMessageId, botId, reason);
  });
}

/** Sau khi câu của bot đã nằm trong chat (`pushChat`). */
export function noteBotSpoke(
  room: Room,
  line: {
    botId: string;
    round: number;
    messageId: string;
    text: string;
    speech: BotSpeechIntention;
    chainDepth: number;
    fromTemplate: boolean;
  },
): void {
  record(room, (log, ledger) => {
    const { speech } = line;
    const names = (room.engine?.state.players ?? []).map((player) => player.name);
    push(room, log, {
      kind: "SPEECH",
      round: line.round,
      actorId: line.botId,
      messageId: line.messageId,
      speech: speech.kind,
      targetId: speech.targetId ?? null,
      replyToMessageId: speech.replyToMessageId ?? null,
      chainDepth: line.chainDepth,
      tone: speech.tone,
      topic: speech.topic ?? null,
      text: line.text,
      textFingerprint: speechTextFingerprint(line.text),
      shapeFingerprint: speechShapeFingerprint(line.text, names),
      semanticFingerprint: speechSemanticFingerprint(speech),
      evidenceSourceIds: speech.evidence.map((item) => item.sourceId),
      fromTemplate: line.fromTemplate,
      claimedRole: speech.claimedRole ?? null,
    });
    markSpoke(ledger, line.botId, speech.replyToMessageId, IN_CHAT);
    // Chỉ mở khi người bị hỏi là BOT: người thật không có `BotRuntime` để
    // `markObserved` đọc, nên câu hỏi nhắm vào họ luôn chốt `UNDETERMINED` và
    // làm bẩn bảng của bot. Self-play toàn bot nên luật này không đổi gì ở đó.
    if (
      (speech.kind === "QUESTION" || speech.kind === "ASK_EVIDENCE") &&
      speech.targetId !== undefined &&
      speech.targetId !== line.botId &&
      isBot(room, speech.targetId)
    ) {
      openQuestion(ledger, {
        messageId: line.messageId,
        askerId: line.botId,
        targetId: speech.targetId,
        round: line.round,
      });
    }
  });
}

/** Sau khi câu của một NGƯỜI THẬT đã nằm trong chat. */
export function noteHumanChat(
  room: Room,
  message: { id: string; playerId: string; text: string; at: number },
  channel: string,
): void {
  record(room, (_log, ledger) => {
    const engine = room.engine;
    if (!engine || channel !== "day") return;
    if (engine.state.phase !== "DAY_DISCUSSION" && engine.state.phase !== "DEFENSE") return;
    if (isBot(room, message.playerId)) return;

    const players = engine.state.players.map((player) => ({
      id: player.id,
      name: player.name,
      alive: player.alive,
    }));
    const memories = analyzeChat(
      [{ id: message.id, actorId: message.playerId, text: message.text, at: message.at }],
      players,
    );
    // Đúng MỘT câu hỏi cho mỗi câu chat: sổ khoá theo `messageId`, như self-play.
    // Một câu gọi hai bot thì bot đầu tiên parser đọc ra được giữ.
    const asked = memories.find(
      (memory) =>
        memory.type === "DIRECT_QUESTION" &&
        memory.targetId !== undefined &&
        players.find((player) => player.id === memory.targetId)?.alive === true &&
        isBot(room, memory.targetId),
    );
    if (!asked?.targetId) return;
    openQuestion(ledger, {
      messageId: message.id,
      askerId: message.playerId,
      targetId: asked.targetId,
      round: engine.state.round,
      humanAsker: true,
    });
  });
}

/**
 * Chốt câu hỏi của ngày. Chỉ hai chỗ gọi: `endVoting` ngay trước
 * `resolveNomination` (đúng vị trí chốt của self-play), và `beginNight` khi pha
 * đang rời là `DAY_DISCUSSION` (ngày không có bỏ phiếu).
 */
export function settleBotQuestions(room: Room): void {
  record(room, (log, ledger) => {
    for (const event of settleQuestions(ledger)) push(room, log, event);
  });
}
```

- [ ] **Step 4: Chạy test module — phải xanh**

Run: `npx vitest run --root apps/server tests/bot-speech-log.test.ts`
Expected: PASS, 9 test.

Nếu test "người thật hỏi bot" đỏ vì không mở câu hỏi nào: kiểm `analyzeChat` có đọc `"Bình ơi sao im thế"` thành `DIRECT_QUESTION` nhắm `b1` không. Nếu không, đổi câu trong test sang một câu có trong `HUMAN_QUESTIONS` của `human-chat-corpus.ts` — không nới luật của module.

- [ ] **Step 5: Viết test restart (đỏ)**

Trong `apps/server/tests/persistence-roundtrip.test.ts`, ngay dưới dòng `const { discussionSkipVotes } = await import("../src/game/discussion-skip");` thêm:

```ts
const { startBotSpeechLog } = await import("../src/game/bot-speech-log");
const { openQuestion } = await import("@masoi/game-engine");
```

và thêm vào cuối file:

```ts
describe("sổ lời nói của bot qua restart", () => {
  it("sổ, câu hỏi đang mở, cờ trần và số lỗi sống qua serialize → schema → restore", () => {
    const room = nightRoom("LOGRT");
    startBotSpeechLog(room);
    room.speechLog!.push({
      kind: "SPEECH_BLOCKED",
      round: 1,
      actorId: "p5",
      speech: "REPLY",
      replyToMessageId: "m1",
      reason: "CHAIN_DEPTH",
    });
    openQuestion(room.questionLedger!, {
      messageId: "m1",
      askerId: "p6",
      targetId: "p5",
      round: 1,
      humanAsker: true,
    });
    room.recorderErrors = 2;

    const envelope = roomEnvelopeSchema.parse(JSON.parse(JSON.stringify(serializeRoom(room, 7))));
    const restored = restoreRoomFromEnvelope(envelope);

    expect(restored.speechLog).toEqual(room.speechLog);
    expect(restored.questionLedger).toEqual(room.questionLedger);
    expect(restored.botSpeechLogTruncated).toBe(false);
    expect(restored.recorderErrors).toBe(2);
  });

  it("envelope ghi trước khi có sổ đọc lên thành null, KHÔNG phải [] — ván đó không được đo", () => {
    const room = nightRoom("LOGOLD");
    const raw = JSON.parse(JSON.stringify(serializeRoom(room, 8)));
    for (const key of ["speechLog", "questionLedger", "botSpeechLogTruncated", "recorderErrors"]) {
      delete raw.room[key];
    }
    const restored = restoreRoomFromEnvelope(roomEnvelopeSchema.parse(raw));
    expect(restored.speechLog).toBeNull();
    expect(restored.questionLedger).toBeNull();
  });
});
```

Run: `npx vitest run --root apps/server tests/persistence-roundtrip.test.ts`
Expected: FAIL ở hai test mới (`restored.speechLog` là `undefined`).

- [ ] **Step 6: Cho sổ đi qua persistence**

`apps/server/src/persistence/serialize.ts` — ngay dưới `      matchChat: room.matchChat,` thêm:

```ts
      // Sổ đo lời nói của bot. `?? null` giữ đúng nghĩa "ván này không có sổ".
      speechLog: room.speechLog ?? null,
      questionLedger: room.questionLedger ?? null,
      botSpeechLogTruncated: room.botSpeechLogTruncated ?? false,
      recorderErrors: room.recorderErrors ?? 0,
```

`apps/server/src/persistence/schema.ts` — thêm `QuestionLedgerState,` vào khối `import type { BotBrainState, ... } from "@masoi/game-engine";`, thêm dòng `import type { BotSpeechLogEvent } from "../game/bot-speech-log";` cạnh các import `../game/...`, rồi ngay dưới `  matchChat: z.array(archivedChatMessageSchema).optional(),` thêm:

```ts
  // OPTIONAL vì cùng lý do với các trường ngay trên. Vắng mặt đọc lên thành
  // `null` chứ không phải `[]`: ván đó không có sổ từ đầu và không được đo.
  // `objectOf` như `speechMemory`: một zod mirror đầy đủ của `SelfPlayEvent`
  // sẽ trôi lệch khỏi kiểu nhanh hơn là bắt được lỗi thật.
  speechLog: z.array(objectOf<BotSpeechLogEvent>()).nullable().optional(),
  questionLedger: objectOf<QuestionLedgerState>().nullable().optional(),
  botSpeechLogTruncated: z.boolean().optional(),
  recorderErrors: z.number().int().min(0).optional(),
```

`apps/server/src/persistence/restore.ts` — ngay dưới `    matchChat: data.matchChat ?? [],` thêm:

```ts
    // `?? null`, KHÔNG `?? []`: snapshot ghi trước khi có sổ là một ván không
    // có sổ từ đầu, và ván đó không được đo. Xem `Room.speechLog`.
    speechLog: data.speechLog ?? null,
    questionLedger: data.questionLedger ?? null,
    botSpeechLogTruncated: data.botSpeechLogTruncated ?? false,
    recorderErrors: data.recorderErrors ?? 0,
```

- [ ] **Step 7: Chạy hai file test và typecheck server**

Run: `npx vitest run --root apps/server tests/persistence-roundtrip.test.ts tests/bot-speech-log.test.ts && npm run lint --workspace @masoi/server`
Expected: PASS cả hai file; lint sạch.

- [ ] **Step 8: Chạy toàn bộ server**

Run: `npm run test --workspace @masoi/server`
Expected: mọi file xanh.

- [ ] **Step 9: Dừng để người dùng kiểm. Commit khi được bảo:**

```bash
git add apps/server/src/game/bot-speech-log.ts apps/server/src/rooms/store.ts apps/server/src/persistence/serialize.ts apps/server/src/persistence/schema.ts apps/server/src/persistence/restore.ts apps/server/tests/bot-speech-log.test.ts apps/server/tests/persistence-roundtrip.test.ts
git commit -m "feat(server): record bot speech log per room and persist it across restarts"
```

---

### Task 4: Móc sổ vào luồng chơi

**Files:**
- Modify: `apps/server/src/game/bot-speech-log.ts` (thêm `settleBotQuestionsIfLeavingDiscussion`)
- Modify: `apps/server/src/game/discussion-scheduler.ts`
- Modify: `apps/server/src/game/machine.ts`
- Modify: `apps/server/src/rooms/service.ts`
- Test: `apps/server/tests/bot-speech-log.test.ts` (thêm), `apps/server/tests/bot-speech-log-wiring.test.ts` (mới), `apps/server/tests/day-bot-scheduling.test.ts` (thêm)

**Interfaces:**
- Consumes (Task 3): `startBotSpeechLog`, `discardBotSpeechLog`, `noteBotObserved`, `noteBotSpeechTurn`, `noteBotBlocked`, `noteBotSpoke`, `noteHumanChat`, `settleBotQuestions`.
- Produces: `settleBotQuestionsIfLeavingDiscussion(room: Room): void` — chốt khi và chỉ khi `room.engine.state.phase === "DAY_DISCUSSION"`.

- [ ] **Step 1: Viết test (đỏ)**

(a) Thêm vào cuối `apps/server/tests/bot-speech-log.test.ts`:

```ts
describe("bot-speech-log — chốt khi rời thảo luận", () => {
  function withOpenQuestion(phase: "DAY_DISCUSSION" | "VOTING" | "DEFENSE"): Room {
    const r = room();
    log.startBotSpeechLog(r);
    log.noteHumanChat(r, { id: "hq", playerId: "h1", text: "Bình ơi sao im thế", at: 1 }, "day");
    r.engine!.state.phase = phase;
    return r;
  }

  it("đang ở thảo luận (ngày không bỏ phiếu): chốt", () => {
    const r = withOpenQuestion("DAY_DISCUSSION");
    log.settleBotQuestionsIfLeavingDiscussion(r);
    expect(r.questionLedger!.open).toEqual([]);
    expect(r.speechLog!.map((e) => e.kind)).toEqual(["QUESTION_OUTCOME"]);
  });

  it("rời phiên xử hay bỏ phiếu: KHÔNG chốt — câu hỏi chờ tới lần chốt hôm sau, như self-play", () => {
    for (const phase of ["VOTING", "DEFENSE"] as const) {
      const r = withOpenQuestion(phase);
      log.settleBotQuestionsIfLeavingDiscussion(r);
      expect(r.questionLedger!.open, phase).toHaveLength(1);
      expect(r.speechLog, phase).toEqual([]);
    }
  });
});
```

(b) Tạo `apps/server/tests/bot-speech-log-wiring.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { GameEngine, openQuestion, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";
import { ROOM_SCAFFOLD } from "./helpers/room";
import { NIGHT_SCAFFOLD } from "./helpers/night";
import { GAME_STATE_SCAFFOLD } from "./helpers/game-state";

vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: () => undefined,
  persistRoom: async () => undefined,
  setRoomTimer: () => undefined,
}));
vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));
vi.mock("../src/db", () => ({ prisma: {} }));

const { endVoting } = await import("../src/game/machine");
const { startBotSpeechLog } = await import("../src/game/bot-speech-log");

function votingRoom(): Room {
  const state: GameState = {
    ...GAME_STATE_SCAFFOLD,
    phase: "VOTING",
    round: 1,
    phaseEndsAt: Date.now() + 30_000,
    players: [
      { id: "human1", name: "Người 1", role: "VILLAGER", alive: true, isBot: false },
      { id: "human2", name: "Người 2", role: "SEER", alive: true, isBot: false },
      { id: "bot", name: "Bot Sói", role: "WEREWOLF", alive: true, isBot: true },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    winner: null,
    night: {
      ...NIGHT_SCAFFOLD,
      killTarget: null,
      guardTarget: null,
      healTonight: false,
      poisonTarget: null,
      witchSkipped: false,
      seerResults: {},
    },
    votes: {},
    guardPrevious: null,
    healUsed: false,
    poisonUsed: false,
    lastNightDeaths: [],
    nightHistory: [],
    lastEliminated: null,
    log: [],
  };
  return {
    ...ROOM_SCAFFOLD,
    code: "WIRED",
    hostId: "human1",
    status: "IN_GAME",
    members: [
      { playerId: "human1", name: "Người 1", ready: true, connected: true, isBot: false },
      { playerId: "human2", name: "Người 2", ready: true, connected: true, isBot: false },
      { playerId: "bot", name: "Bot Sói", ready: true, connected: false, isBot: true },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: new GameEngine(state),
    chatLog: [],
    createdAt: 0,
  };
}

describe("móc sổ vào luồng chơi", () => {
  it("endVoting chốt câu hỏi của ngày ngay trước khi chốt đề cử", () => {
    const room = votingRoom();
    startBotSpeechLog(room);
    openQuestion(room.questionLedger!, {
      messageId: "q",
      askerId: "human1",
      targetId: "bot",
      round: 1,
      humanAsker: true,
    });

    endVoting(room);

    expect(room.questionLedger!.open).toEqual([]);
    expect(room.speechLog).toEqual([
      expect.objectContaining({ kind: "QUESTION_OUTCOME", messageId: "q", outcome: "UNDETERMINED", humanAsker: true }),
    ]);
  });
});
```

(c) Trong `apps/server/tests/day-bot-scheduling.test.ts`:
- trong khối `vi.mock("../src/bots/session-registry", ...)`, thêm `memories: [] as unknown[],` vào object `state` của `runtime` giả (cạnh `previousVotes`);
- thêm import `import { startBotSpeechLog } from "../src/game/bot-speech-log";` cạnh các import `../src/game/...`;
- thêm test này vào cuối `describe("scheduleDayBots", ...)`:

```ts
  it("câu bot đã phát đi vào sổ đo, đúng một SPEECH, không lỗi bộ ghi", async () => {
    const room = discussionRoom();
    startBotSpeechLog(room);
    scheduleDayBots(room);

    await vi.advanceTimersByTimeAsync(Math.floor(room.config.discussionSeconds * 1_000 / 2));
    brainControl.resolveDay?.({ ok: true, value: { chat: "t nghi Người 1" } });
    await vi.advanceTimersByTimeAsync(0);

    expect(room.speechLog).toEqual([
      expect.objectContaining({ kind: "SPEECH", actorId: "bot", text: "t nghi Người 1", fromTemplate: false }),
    ]);
    expect(room.recorderErrors).toBe(0);
  });
```

- [ ] **Step 2: Chạy để thấy đỏ**

Run: `npx vitest run --root apps/server tests/bot-speech-log.test.ts tests/bot-speech-log-wiring.test.ts tests/day-bot-scheduling.test.ts`
Expected: FAIL — `settleBotQuestionsIfLeavingDiscussion is not a function`; `endVoting` để câu hỏi còn mở; `room.speechLog` rỗng.

- [ ] **Step 3: Thêm hàm chốt có kiểm pha**

Cuối `apps/server/src/game/bot-speech-log.ts`:

```ts
/**
 * Cho `beginNight`: chốt khi và chỉ khi pha đang rời là thảo luận - tức ngày
 * không có bỏ phiếu (bỏ qua thảo luận ở Ngày Hoà Hoãn). `beginNight` còn được
 * gọi sau cái chết do bị treo, sau phát bắn Thợ Săn và từ bảng step handler;
 * ở ba chỗ đó câu hỏi của phiên xử phải chờ lần chốt hôm sau, như self-play.
 */
export function settleBotQuestionsIfLeavingDiscussion(room: Room): void {
  if (room.engine?.state.phase !== "DAY_DISCUSSION") return;
  settleBotQuestions(room);
}
```

- [ ] **Step 4: Móc vào `discussion-scheduler.ts`**

Thêm import:

```ts
import { noteBotBlocked, noteBotObserved, noteBotSpeechTurn, noteBotSpoke } from "./bot-speech-log";
```

Trong hàm `step` của `startTurnQueue`, thay:

```ts
        runtime.observe(context);

        const planned = plan.speak(runtime, context, member);
```

bằng:

```ts
        runtime.observe(context);
        noteBotObserved(room, member.playerId, context.visibleChat, runtime.state.memories);
        // Chỉ pha thảo luận mới đếm lượt: self-play không gọi `noteSpeechTurn`
        // trong phiên xử, và hai bên phải hiểu "được lượt" theo một nghĩa.
        if (plan.phase === "DAY_DISCUSSION") noteBotSpeechTurn(room, member.playerId);

        const planned = plan.speak(runtime, context, member);
```

thay:

```ts
        if (position.blockedBy !== null) {
```

(khối bắt đầu bằng dòng đó, đứng sau `judgeChainPosition`) — chèn một dòng ngay trước `runtime.declineSpeech(speech);` bên trong khối:

```ts
          noteBotBlocked(room, member.playerId, run.round, speech, position.blockedBy);
```

và ngay dưới `        pushChat(room, message);` thêm:

```ts
        noteBotSpoke(room, {
          botId: member.playerId,
          round: run.round,
          messageId: message.id,
          text: rendered.text,
          speech,
          chainDepth: position.depth,
          fromTemplate: rendered.fromTemplate,
        });
```

- [ ] **Step 5: Móc vào `machine.ts`**

Thêm import:

```ts
import {
  discardBotSpeechLog,
  noteBotObserved,
  settleBotQuestions,
  settleBotQuestionsIfLeavingDiscussion,
  startBotSpeechLog,
} from "./bot-speech-log";
```

(a) `startGame` — ngay dưới `  resetMatchChat(room);` thêm:

```ts
  startBotSpeechLog(room);
```

(b) `resetToLobby` — ngay trước `  room.engine = null;` (dòng đứng sau `  room.config.lastLetter = false;`) thêm:

```ts
  discardBotSpeechLog(room);
```

(c) `beginNight` — ngay dưới `  clearRoomTimers(room.code);` (dòng đầu thân hàm, TRƯỚC `e.startNight(...)`) thêm:

```ts
  // Phải đứng trước `startNight`: sau đó pha đã là NIGHT và phép kiểm pha
  // trong hàm này không còn biết mình vừa rời pha nào.
  settleBotQuestionsIfLeavingDiscussion(room);
```

(d) `endVoting` — ngay trước `  const outcome = engine(room).resolveNomination(defenseMs);` thêm:

```ts
  // Đúng vị trí chốt của self-play: sau lượt bỏ phiếu, ngay trước khi đề cử
  // được chốt. Chốt sớm hơn (lúc rời thảo luận) thì câu hỏi hỏi cuối thảo luận
  // ra UNDETERMINED ở đây mà NO_TURN ở self-play.
  settleBotQuestions(room);
```

(e) `deterministicVote` — ngay dưới `    runtime.observe(context);` thêm:

```ts
    noteBotObserved(room, botId, context.visibleChat, runtime.state.memories);
```

KHÔNG móc vào `scheduleFinalVoteBots`: self-play không gọi `noteObserved` ở vòng phiếu cuối.

- [ ] **Step 6: Móc vào `rooms/service.ts`**

Thêm import `import { noteHumanChat } from "../game/bot-speech-log";`, rồi trong `roomService.chat`, ngay dưới `    pushChat(room, message);` thêm:

```ts
    noteHumanChat(room, message, result.channel);
```

Dòng này không có test riêng: luật của nó (kênh, pha, người hỏi, người bị hỏi) đã được test ở module trong Task 3.

- [ ] **Step 7: Chạy ba file test — phải xanh; typecheck server**

Run: `npx vitest run --root apps/server tests/bot-speech-log.test.ts tests/bot-speech-log-wiring.test.ts tests/day-bot-scheduling.test.ts && npm run lint --workspace @masoi/server`
Expected: PASS cả ba file; lint sạch.

- [ ] **Step 8: Chạy toàn bộ server**

Run: `npm run test --workspace @masoi/server`
Expected: mọi file xanh. Test nào dựng runtime giả không có `state.memories` sẽ **không** đỏ — lỗi đó bị bộ ghi nuốt và đếm vào `recorderErrors`, đúng thiết kế.

- [ ] **Step 9: Dừng để người dùng kiểm. Commit khi được bảo:**

```bash
git add apps/server/src/game/bot-speech-log.ts apps/server/src/game/discussion-scheduler.ts apps/server/src/game/machine.ts apps/server/src/rooms/service.ts apps/server/tests/bot-speech-log.test.ts apps/server/tests/bot-speech-log-wiring.test.ts apps/server/tests/day-bot-scheduling.test.ts
git commit -m "feat(server): hook bot speech log into discussion, voting and chat"
```

---

### Task 5: Tính `botMetrics` lúc hết ván và lưu vào `GameResult`

**Files:**
- Create: `apps/server/src/game/bot-metrics.ts`
- Modify: `apps/server/src/game/game-result.ts`
- Modify: `apps/server/prisma/schema.prisma`
- Create: `apps/server/prisma/migrations/20260910120000_add_bot_metrics_to_game_result/migration.sql`
- Test: `apps/server/tests/bot-metrics.test.ts`

**Interfaces:**
- Consumes: `BotSpeechLogEvent`, các trường sổ trên `Room` (Task 3); `collectMetrics`, `SelfPlayMetrics.humanQuestionOutcomes`, `casualToneRateProvider` (Task 2).
- Produces:
  - `BOT_METRICS_VERSION = 1`
  - `RATIO_KEYS` — mảng hằng các khoá `Ratio` được lưu
  - `interface BotMetrics` (hình dạng ở spec, mục *Mô hình dữ liệu*)
  - `buildBotMetrics(input: BotMetricsInput): BotMetrics` — thuần
  - `botMetricsForRoom(room: Room): BotMetrics | null`

- [ ] **Step 1: Viết test (đỏ)**

Tạo `apps/server/tests/bot-metrics.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ROOM_CONFIG, PRESET_DECKS } from "@masoi/shared";
import {
  DEFAULT_BOT_WEIGHTS,
  GameEngine,
  collectMetrics,
  createQuestionLedger,
  openQuestion,
  runSelfPlay,
} from "@masoi/game-engine";
import type { Room } from "../src/rooms/store";
import type { BotSpeechLogEvent } from "../src/game/bot-speech-log";
import { ROOM_SCAFFOLD } from "./helpers/room";

const db = vi.hoisted(() => ({ created: [] as Array<Record<string, unknown>> }));

vi.mock("../src/db", () => ({
  prisma: {
    gameResult: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        db.created.push(data);
        return data;
      },
    },
  },
}));
vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));
vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: () => undefined,
  persistRoom: async () => undefined,
  setRoomTimer: () => undefined,
}));
vi.mock("../src/redis", () => ({ redis: { status: "ready" } }));

const { buildBotMetrics, RATIO_KEYS } = await import("../src/game/bot-metrics");
const { writeGameResultOnce } = await import("../src/game/game-result");

const KINDS = new Set(["SPEECH", "SPEECH_BLOCKED", "QUESTION_OUTCOME"]);
const GAME = runSelfPlay({ seed: "bot-metrics-parity", playerCount: 12, config: PRESET_DECKS[12], defense: true });
const EVENTS = GAME.events.filter((e) => KINDS.has(e.kind)) as BotSpeechLogEvent[];
const DIRECT = collectMetrics([GAME], DEFAULT_BOT_WEIGHTS).overall;
const BUILT = buildBotMetrics({
  events: EVENTS,
  roles: GAME.roles,
  winner: GAME.winner,
  rounds: GAME.rounds,
  personalWins: GAME.personalWins,
  players: 12,
  bots: 12,
  weights: DEFAULT_BOT_WEIGHTS,
  brain: "test-brain",
  truncated: false,
  recorderErrors: 0,
  config: PRESET_DECKS[12]!,
});

describe("botMetrics — cùng định nghĩa với self-play", () => {
  it("điều kiện tiên quyết: ván này thật sự có câu hỏi, lời khai và câu bị chặn để so", () => {
    // Không có dòng này thì một ván không ai hỏi ai làm cả test xanh mà không so gì.
    expect(DIRECT.directQuestionOutcomes.ANSWERED.denominator).toBeGreaterThan(0);
    expect(DIRECT.claimsPerGame).toBeGreaterThan(0);
  });

  it("chỉ ba loại sự kiện là đủ: mọi tỉ lệ được lưu khớp collectMetrics trên TOÀN BỘ sự kiện", () => {
    for (const key of RATIO_KEYS) {
      expect(BUILT.ratios[key], key).toEqual([DIRECT[key].numerator, DIRECT[key].denominator]);
    }
  });

  it("bảy ngăn câu hỏi, trần chuỗi, lời khai, lượt bị chặn khớp", () => {
    for (const [key, ratio] of Object.entries(DIRECT.directQuestionOutcomes)) {
      expect(BUILT.questionOutcomes.bot[key as keyof typeof BUILT.questionOutcomes.bot], key).toBe(ratio.numerator);
    }
    expect(BUILT.maxChain).toBe(DIRECT.maxDialogueChainLength);
    expect(BUILT.claims).toBe(DIRECT.claimsPerGame);
    expect(BUILT.hadCounterClaim).toBe(DIRECT.counterClaimRate.numerator > 0);
    expect(BUILT.blocked).toEqual(DIRECT.speechBlockedByRoom);
  });

  it("botDays suy ngược đúng trung bình số câu mỗi (vòng, bot)", () => {
    expect(BUILT.botDays[0] / BUILT.botDays[1]).toBeCloseTo(DIRECT.messagesPerBotPerDay!, 10);
  });
});

describe("botMetrics — không một chữ nào", () => {
  it("không id, không nội dung câu nào lọt vào JSON", () => {
    const json = JSON.stringify(BUILT);
    for (const id of Object.keys(GAME.roles)) expect(json).not.toContain(`"${id}"`);
    for (const event of EVENTS) {
      if (event.kind === "SPEECH" && event.text.length >= 4) expect(json).not.toContain(event.text);
    }
  });
});

describe("writeGameResultOnce ghi botMetrics", () => {
  beforeEach(() => {
    db.created.length = 0;
  });

  function finishedRoom(code: string): Room {
    const players = Array.from({ length: 6 }, (_, i) => ({
      id: `p${i + 1}`,
      name: `Người ${i + 1}`,
      isBot: i >= 4,
    }));
    const config = { ...DEFAULT_ROOM_CONFIG, werewolves: 1 };
    const engine = GameEngine.create(players, config, 1_000);
    engine.state.round = 3;
    engine.state.winner = "village";
    return {
      ...ROOM_SCAFFOLD,
      code,
      gameId: `game-${code}`,
      hostId: "p1",
      status: "IN_GAME",
      members: players.map((p) => ({
        playerId: p.id,
        name: p.name,
        ready: true,
        connected: !p.isBot,
        isBot: p.isBot,
      })),
      config,
      engine,
      chatLog: [],
      createdAt: 0,
      speechLog: [],
      questionLedger: createQuestionLedger(),
      botSpeechLogTruncated: false,
      recorderErrors: 0,
    };
  }

  it("ván có sổ: lưu botMetrics cùng lệnh create", async () => {
    await writeGameResultOnce(finishedRoom("BMOK"));
    expect(db.created).toHaveLength(1);
    expect(db.created[0]!.botMetrics).toMatchObject({
      metricsVersion: 1,
      players: 6,
      bots: 2,
      rounds: 3,
      truncated: false,
      recorderErrors: 0,
    });
    // Quyền riêng tư: không tên, không id người chơi nào của phòng lọt xuống DB.
    const json = JSON.stringify(db.created[0]!.botMetrics);
    for (let i = 1; i <= 6; i += 1) {
      expect(json).not.toContain(`"p${i}"`);
      expect(json).not.toContain(`Người ${i}`);
    }
  });

  it("ván không có sổ từ đầu: botMetrics trống, kết quả vẫn được ghi", async () => {
    const room = finishedRoom("BMNUL");
    room.speechLog = null;
    await writeGameResultOnce(room);
    expect(db.created).toHaveLength(1);
    expect(db.created[0]!.botMetrics).toBeUndefined();
  });

  it("tính hỏng: botMetrics trống, kết quả vẫn được ghi", async () => {
    const room = finishedRoom("BMBAD");
    room.speechLog = [{ kind: "SPEECH", text: null } as unknown as BotSpeechLogEvent];
    await writeGameResultOnce(room);
    expect(db.created).toHaveLength(1);
    expect(db.created[0]!.botMetrics).toBeUndefined();
  });

  it("câu hỏi còn mở lúc hết ván bị bỏ, không thành QUESTION_OUTCOME — như self-play", async () => {
    const room = finishedRoom("BMOPEN");
    openQuestion(room.questionLedger!, { messageId: "late", askerId: "p1", targetId: "p5", round: 3, humanAsker: true });
    await writeGameResultOnce(room);
    const metrics = db.created[0]!.botMetrics as { questionOutcomes: { human: Record<string, number> } };
    expect(Object.values(metrics.questionOutcomes.human).every((n) => n === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ**

Run: `npx vitest run --root apps/server tests/bot-metrics.test.ts`
Expected: FAIL — `Failed to resolve import "../src/game/bot-metrics"`.

- [ ] **Step 3: Viết `bot-metrics.ts`**

Tạo `apps/server/src/game/bot-metrics.ts`:

```ts
import {
  DEFAULT_BOT_WEIGHTS,
  collectMetrics,
  type BotWeights,
  type QuestionOutcome,
  type Ratio,
  type SelfPlayGame,
  type SelfPlayMetrics,
} from "@masoi/game-engine";
import type { Role, RoomConfig, Winner } from "@masoi/shared";
import { botBrain } from "../bots";
import { botSessionFor } from "../bots/session-registry";
import type { Room } from "../rooms/store";
import type { BotSpeechLogEvent } from "./bot-speech-log";

/**
 * Chỉ số giao tiếp của bot trong MỘT ván thật, tính lúc kết thúc bằng chính
 * `collectMetrics` của self-play. Một định nghĩa duy nhất: không chỉ số nào
 * ở đây được đếm lại bằng tay.
 *
 * Không chứa một chữ nào - không nội dung chat, không tên, không id người chơi.
 * Có test quét JSON để khoá điều đó.
 */

/** Tăng khi danh sách hay định nghĩa đổi; script cộng dồn chỉ cộng cùng phiên bản. */
export const BOT_METRICS_VERSION = 1;

/**
 * Các tỉ lệ được lưu. Chỉ những chỉ số tính thuần từ `SPEECH`,
 * `SPEECH_BLOCKED` và `QUESTION_OUTCOME` - ba loại sự kiện server ghi. Chỉ số
 * đọc lá phiếu (`claimFollowRate`, `claimAccuracy`, `wolfBluffBelievedRate`) và
 * `silenceRate` (cần danh sách bot còn sống từng vòng) cố ý vắng mặt.
 */
export const RATIO_KEYS = [
  "fromTemplateRate",
  "casualToneRate",
  "casualToneRateProvider",
  "exactRepetitionRate",
  "normalizedRepetitionRate",
  "semanticRepetitionRate",
  "crossBotRepetitionRate",
  "repeatedOpeningRate",
  "distinctOpeningRate",
  "consecutiveSameTargetRate",
  "replyRate",
  "directQuestionResponseRate",
  "counterClaimRate",
] as const satisfies readonly (keyof SelfPlayMetrics)[];

export type BotMetricsRatioKey = (typeof RATIO_KEYS)[number];

export interface BotMetrics {
  metricsVersion: number;
  weightsVersion: string;
  /** `botBrain().name`: tên nhà cung cấp, chuỗi `"a->b"`, hoặc tên randomBrain khi không có nhà cung cấp nào. */
  brain: string;
  players: number;
  bots: number;
  rounds: number;
  truncated: boolean;
  recorderErrors: number;
  /** `[tử số, mẫu số]`. */
  ratios: Record<BotMetricsRatioKey, [number, number]>;
  /** Số đếm thô của bảy ngăn; mẫu số là tổng các ngăn. */
  questionOutcomes: {
    bot: Record<QuestionOutcome, number>;
    human: Record<QuestionOutcome, number>;
  };
  blocked: Record<string, number>;
  /** `[tổng số câu, số cặp (vòng, bot) có nói]` - đủ để tính `messagesPerBotPerDay` sau khi cộng dồn. */
  botDays: [number, number];
  maxChain: number;
  claims: number;
  hadCounterClaim: boolean;
}

export interface BotMetricsInput {
  events: readonly BotSpeechLogEvent[];
  roles: Record<string, Role>;
  winner: Winner;
  rounds: number;
  personalWins?: SelfPlayGame["personalWins"];
  players: number;
  bots: number;
  weights: BotWeights;
  brain: string;
  truncated: boolean;
  recorderErrors: number;
  config: RoomConfig;
}

const pair = (ratio: Ratio): [number, number] => [ratio.numerator, ratio.denominator];

const counts = (table: Record<QuestionOutcome, Ratio>): Record<QuestionOutcome, number> =>
  Object.fromEntries(
    Object.entries(table).map(([key, ratio]) => [key, ratio.numerator]),
  ) as Record<QuestionOutcome, number>;

/** THUẦN: cùng đầu vào cho cùng kết quả. Ném nếu sổ méo - chỗ gọi bắt. */
export function buildBotMetrics(input: BotMetricsInput): BotMetrics {
  // `SelfPlayGame` tối thiểu: `collectMetrics` chỉ đọc events, roles, winner,
  // rounds, personalWins, rejected, skipped, violations. Các trường chỉ
  // self-play có thì để rỗng; `record` không được đọc.
  const game: SelfPlayGame = {
    record: {
      seed: "production",
      playerCount: input.players,
      config: input.config,
      weightsVersion: input.weights.version,
      maxRounds: input.rounds,
      events: false,
      speech: true,
    },
    winner: input.winner,
    rounds: input.rounds,
    actions: 0,
    rejected: 0,
    skipped: 0,
    events: [...input.events],
    violations: [],
    traces: [],
    roles: input.roles,
    personalWins: input.personalWins,
  };
  const m = collectMetrics([game], input.weights).overall;

  const lines = m.fromTemplateRate.denominator;
  const perBotDay = m.messagesPerBotPerDay;

  return {
    metricsVersion: BOT_METRICS_VERSION,
    weightsVersion: input.weights.version,
    brain: input.brain,
    players: input.players,
    bots: input.bots,
    rounds: input.rounds,
    truncated: input.truncated,
    recorderErrors: input.recorderErrors,
    ratios: Object.fromEntries(RATIO_KEYS.map((key) => [key, pair(m[key])])) as BotMetrics["ratios"],
    questionOutcomes: {
      bot: counts(m.directQuestionOutcomes),
      human: counts(m.humanQuestionOutcomes),
    },
    blocked: { ...m.speechBlockedByRoom },
    // `messagesPerBotPerDay` là trung bình. Suy ngược số cặp (vòng, bot) từ
    // chính output để cộng dồn đúng qua nhiều ván mà không đếm lại lần hai.
    botDays: perBotDay === null || perBotDay === 0 ? [0, 0] : [lines, Math.round(lines / perBotDay)],
    maxChain: m.maxDialogueChainLength,
    claims: m.claimsPerGame ?? 0,
    hadCounterClaim: m.counterClaimRate.numerator > 0,
  };
}

/**
 * `null` khi không có gì để đo: ván chưa xong, ván không có bot, hoặc ván không
 * có sổ từ đầu (envelope ghi trước khi có sổ - một sổ chỉ có nửa sau cho số sai
 * mà trông như đúng).
 */
export function botMetricsForRoom(room: Room): BotMetrics | null {
  const state = room.engine?.getState();
  if (!state || !state.winner || !room.speechLog) return null;
  const bots = room.members.filter((member) => member.isBot);
  if (bots.length === 0) return null;

  let weights: BotWeights = DEFAULT_BOT_WEIGHTS;
  try {
    weights = botSessionFor(room).runtimeFor(bots[0]!.playerId).weights;
  } catch {
    // Session đã bị dọn (hiếm): đo bằng mặc định, `weightsVersion` nói rõ điều đó.
  }

  return buildBotMetrics({
    events: room.speechLog,
    roles: Object.fromEntries(state.players.map((player) => [player.id, player.role])),
    winner: state.winner,
    rounds: state.round,
    personalWins: state.personalWins,
    players: state.players.length,
    bots: bots.length,
    weights,
    brain: botBrain().name,
    truncated: room.botSpeechLogTruncated ?? false,
    recorderErrors: room.recorderErrors ?? 0,
    config: room.config,
  });
}
```

- [ ] **Step 4: Thêm cột `botMetrics` vào Prisma**

Trong `apps/server/prisma/schema.prisma`, model `GameResult`, ngay dưới dòng `  caseFile    Json?` thêm:

```prisma
  /// Chỉ số giao tiếp của bot trong ván, tính lúc kết thúc bằng `collectMetrics`
  /// (`game/bot-metrics.ts`). Không chứa chữ, tên hay id người chơi nào.
  ///
  /// Null với ván ghi trước cột này, ván không có bot, ván không có sổ từ đầu,
  /// và ván mà việc tính bị lỗi. Không chặn việc lưu kết quả trong trường hợp nào.
  botMetrics  Json?
```

Tạo `apps/server/prisma/migrations/20260910120000_add_bot_metrics_to_game_result/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "GameResult" ADD COLUMN "botMetrics" JSONB;
```

Run: `npm run db:generate --workspace @masoi/server`
Expected: `Generated Prisma Client` — kiểu của `prisma.gameResult.create` có trường `botMetrics`.

- [ ] **Step 5: Ghi `botMetrics` trong `writeGameResultOnce`**

Trong `apps/server/src/game/game-result.ts`, thêm import:

```ts
import { botMetricsForRoom, type BotMetrics } from "./bot-metrics";
```

thêm hàm ngay trên `function isUniqueViolation`:

```ts
/**
 * Chỉ số giao tiếp của bot, hoặc `null` khi không có gì để đo hay việc tính hỏng.
 *
 * Như `caseFileForHistory`: đây là phần thêm. Hỏng nó không được làm mất kết
 * quả ván - nhưng cũng không được im lặng, nên ghi một dòng log.
 */
function botMetricsForHistory(room: Room): BotMetrics | null {
  try {
    return botMetricsForRoom(room);
  } catch {
    console.warn(
      JSON.stringify({ event: "game-result.bot-metrics-failed", roomCode: room.code, gameId: room.gameId }),
    );
    return null;
  }
}
```

và trong object `data` của `prisma.gameResult.create`, ngay dưới dòng `caseFile: ...` thêm:

```ts
        // Cùng kiểu ép với `caseFile` và cùng lý do: `BotMetrics` là một
        // interface đóng, không có index signature mà `InputJsonValue` đòi.
        botMetrics: (botMetricsForHistory(room) ?? undefined) as Prisma.InputJsonValue | undefined,
```

- [ ] **Step 6: Chạy test Task 5 — phải xanh; typecheck server**

Run: `npx vitest run --root apps/server tests/bot-metrics.test.ts && npm run lint --workspace @masoi/server`
Expected: PASS, 9 test; lint sạch.

Nếu test "botDays suy ngược đúng trung bình" đỏ: `messagesPerBotPerDay` không phải tổng số `SPEECH` chia số cặp (vòng, bot). Dừng và báo lại — không đếm lại bằng tay trong `bot-metrics.ts`, vì làm vậy là dựng định nghĩa thứ hai.

- [ ] **Step 7: Chạy toàn bộ server**

Run: `npm run test --workspace @masoi/server`
Expected: mọi file xanh — gồm cả các test `writeGameResultOnce` có sẵn (`game-result-idempotent`, `match-chat-archive`, …), vì phòng dựng tay trong đó không có sổ và `botMetrics` rơi về `undefined`.

- [ ] **Step 8: Dừng để người dùng kiểm. Commit khi được bảo:**

```bash
git add apps/server/src/game/bot-metrics.ts apps/server/src/game/game-result.ts apps/server/prisma/schema.prisma apps/server/prisma/migrations/20260910120000_add_bot_metrics_to_game_result apps/server/tests/bot-metrics.test.ts
git commit -m "feat(server): store bot communication metrics with each game result"
```

---

### Task 6: Cộng dồn nhiều ván — `prod-metrics`

**Files:**
- Modify: `apps/server/src/game/bot-metrics.ts` (thêm hàm cộng dồn thuần)
- Create: `apps/server/scripts/prod-metrics.ts`
- Modify: `package.json` (root — khai script)
- Test: `apps/server/tests/bot-metrics.test.ts` (thêm)

**Interfaces:**
- Consumes: `BotMetrics`, `RATIO_KEYS`, `BotMetricsRatioKey` (Task 5).
- Produces:
  - `interface AggregateOptions { weightsVersion?: string; minHumans?: number }`
  - `interface BotMetricsReport` (xem code)
  - `aggregateBotMetrics(rows: readonly BotMetrics[], options?: AggregateOptions): BotMetricsReport | null`

- [ ] **Step 1: Viết test cộng dồn (đỏ)**

Trong `apps/server/tests/bot-metrics.test.ts`:
- thêm import kiểu ở đầu file: `import type { BotMetrics } from "../src/game/bot-metrics";`
- thay dòng `const { buildBotMetrics, RATIO_KEYS } = await import("../src/game/bot-metrics");` bằng:

```ts
const { aggregateBotMetrics, buildBotMetrics, RATIO_KEYS } = await import("../src/game/bot-metrics");
```

- thêm vào cuối file:

```ts
describe("aggregateBotMetrics — cộng dồn nhiều ván", () => {
  const row = (over: Partial<BotMetrics> = {}): BotMetrics => ({ ...BUILT, ...over });

  it("cộng tử số và mẫu số, KHÔNG lấy trung bình tỉ lệ từng ván", () => {
    const a = row({ ratios: { ...BUILT.ratios, casualToneRateProvider: [1, 1] } });
    const b = row({ ratios: { ...BUILT.ratios, casualToneRateProvider: [0, 9] } });
    const report = aggregateBotMetrics([a, b])!;
    // Trung bình hai tỉ lệ là 0,5; cộng dồn đúng là 1/10.
    expect(report.ratios.casualToneRateProvider).toEqual([1, 10]);
    expect(report.games).toBe(2);
  });

  it("chỉ cộng bản metricsVersion mới nhất, và báo số ván bị bỏ", () => {
    const report = aggregateBotMetrics([row(), row({ metricsVersion: 0 })])!;
    expect(report.metricsVersion).toBe(1);
    expect(report.games).toBe(1);
    expect(report.skippedOtherVersion).toBe(1);
  });

  it("lọc theo số ghế người và theo weightsVersion", () => {
    const rows = [
      row({ players: 8, bots: 8 }),
      row({ players: 8, bots: 5 }),
      row({ players: 8, bots: 5, weightsVersion: "29.0.0" }),
    ];
    expect(aggregateBotMetrics(rows, { minHumans: 1 })!.games).toBe(2);
    expect(aggregateBotMetrics(rows, { minHumans: 1 })!.skippedFilters).toBe(1);
    expect(aggregateBotMetrics(rows, { minHumans: 1, weightsVersion: "29.0.0" })!.games).toBe(1);
  });

  it("đếm ván theo brain, ván bị cắt sổ và tổng lỗi bộ ghi", () => {
    const report = aggregateBotMetrics([
      row({ brain: "gemini" }),
      row({ brain: "gemini", truncated: true, recorderErrors: 2 }),
      row({ brain: "random" }),
    ])!;
    expect(report.byBrain).toEqual({ gemini: 2, random: 1 });
    expect(report.truncatedGames).toBe(1);
    expect(report.recorderErrors).toBe(2);
  });

  it("không có ván nào thì null, không phải một báo cáo toàn số 0", () => {
    expect(aggregateBotMetrics([])).toBeNull();
  });
});
```

Run: `npx vitest run --root apps/server tests/bot-metrics.test.ts`
Expected: FAIL — `aggregateBotMetrics is not a function`.

- [ ] **Step 2: Viết hàm cộng dồn**

Cuối `apps/server/src/game/bot-metrics.ts`:

```ts
export interface AggregateOptions {
  /** Chỉ cộng các ván chạy đúng phiên bản trọng số này. */
  weightsVersion?: string;
  /** Chỉ cộng các ván có ít nhất bấy nhiêu ghế người thật. */
  minHumans?: number;
}

export interface BotMetricsReport {
  metricsVersion: number;
  games: number;
  skippedOtherVersion: number;
  skippedFilters: number;
  truncatedGames: number;
  recorderErrors: number;
  /** Số ván theo `brain` - gồm cả số ván chạy lúc không có nhà cung cấp nào. */
  byBrain: Record<string, number>;
  ratios: Record<BotMetricsRatioKey, [number, number]>;
  /**
   * Số đếm thô của bảy ngăn. `Record<string, number>` chứ không phải
   * `Partial<Record<QuestionOutcome, number>>`: thuộc tính optional mang kiểu
   * `number | undefined`, không cộng dồn qua `addCounts` được khi bật strict.
   */
  questionOutcomes: { bot: Record<string, number>; human: Record<string, number> };
  blocked: Record<string, number>;
  botDays: [number, number];
  maxChain: number;
  claims: number;
  gamesWithCounterClaim: number;
}

function addCounts(into: Record<string, number>, from: Record<string, number>): void {
  for (const [key, value] of Object.entries(from)) into[key] = (into[key] ?? 0) + value;
}

/**
 * Cộng dồn nhiều ván: cộng tử số và mẫu số - không lấy trung bình các tỉ lệ
 * từng ván - đúng cách báo cáo self-play cộng. Chỉ cộng các ván cùng
 * `metricsVersion`, mặc định là bản mới nhất có mặt. THUẦN.
 */
export function aggregateBotMetrics(
  rows: readonly BotMetrics[],
  options: AggregateOptions = {},
): BotMetricsReport | null {
  if (rows.length === 0) return null;
  const version = Math.max(...rows.map((row) => row.metricsVersion));
  const sameVersion = rows.filter((row) => row.metricsVersion === version);
  const kept = sameVersion.filter(
    (row) =>
      (options.weightsVersion === undefined || row.weightsVersion === options.weightsVersion) &&
      (options.minHumans === undefined || row.players - row.bots >= options.minHumans),
  );

  const report: BotMetricsReport = {
    metricsVersion: version,
    games: kept.length,
    skippedOtherVersion: rows.length - sameVersion.length,
    skippedFilters: sameVersion.length - kept.length,
    truncatedGames: 0,
    recorderErrors: 0,
    byBrain: {},
    ratios: Object.fromEntries(RATIO_KEYS.map((key) => [key, [0, 0]])) as BotMetricsReport["ratios"],
    questionOutcomes: { bot: {}, human: {} },
    blocked: {},
    botDays: [0, 0],
    maxChain: 0,
    claims: 0,
    gamesWithCounterClaim: 0,
  };

  for (const row of kept) {
    if (row.truncated) report.truncatedGames += 1;
    report.recorderErrors += row.recorderErrors;
    report.byBrain[row.brain] = (report.byBrain[row.brain] ?? 0) + 1;
    for (const key of RATIO_KEYS) {
      const [n, d] = row.ratios[key];
      report.ratios[key] = [report.ratios[key][0] + n, report.ratios[key][1] + d];
    }
    addCounts(report.questionOutcomes.bot, row.questionOutcomes.bot);
    addCounts(report.questionOutcomes.human, row.questionOutcomes.human);
    addCounts(report.blocked, row.blocked);
    report.botDays = [report.botDays[0] + row.botDays[0], report.botDays[1] + row.botDays[1]];
    report.maxChain = Math.max(report.maxChain, row.maxChain);
    report.claims += row.claims;
    if (row.hadCounterClaim) report.gamesWithCounterClaim += 1;
  }
  return report;
}
```

Run: `npx vitest run --root apps/server tests/bot-metrics.test.ts`
Expected: PASS, 14 test.

- [ ] **Step 3: Viết script**

Tạo `apps/server/scripts/prod-metrics.ts`:

```ts
import { aggregateBotMetrics, type BotMetrics, type BotMetricsReport } from "../src/game/bot-metrics";
import { prisma } from "../src/db";

/**
 * Cộng dồn chỉ số giao tiếp của bot trên ván thật (`GameResult.botMetrics`).
 *
 * CHỈ đọc cột đó - không đọc bảng chat, không đọc tên người chơi. Mọi phép cộng
 * nằm ở `aggregateBotMetrics` (thuần, có test); file này chỉ đọc DB và in.
 *
 * Chạy:  npm run prod-metrics -- --since 2026-09-10 --min-humans 1
 */

interface Options {
  since: Date | null;
  weights: string | undefined;
  minHumans: number | undefined;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { since: null, weights: undefined, minHumans: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`Thiếu giá trị cho ${arg}`);
      i += 1;
      return value;
    };
    if (arg === "--since") {
      const date = new Date(next());
      if (Number.isNaN(date.getTime())) throw new Error("--since phải là một ngày, ví dụ 2026-09-10");
      options.since = date;
    } else if (arg === "--weights") {
      options.weights = next();
    } else if (arg === "--min-humans") {
      const value = Number(next());
      if (!Number.isInteger(value) || value < 0) throw new Error("--min-humans phải là số nguyên không âm");
      options.minHumans = value;
    } else {
      throw new Error(`Tham số lạ: ${arg}`);
    }
  }
  return options;
}

const pct = ([n, d]: [number, number]): string =>
  d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}% (${n}/${d})`;

const total = (counts: Record<string, number>): number =>
  Object.values(counts).reduce((sum, value) => sum + value, 0);

function format(report: BotMetricsReport): string {
  const { bot, human } = report.questionOutcomes;
  const outcomeKeys = [...new Set([...Object.keys(bot), ...Object.keys(human)])];
  return [
    `metricsVersion ${report.metricsVersion} — ${report.games} ván ` +
      `(bỏ ${report.skippedOtherVersion} ván khác phiên bản, ${report.skippedFilters} ván không qua bộ lọc)`,
    `ván bị cắt sổ: ${report.truncatedGames} · lỗi bộ ghi: ${report.recorderErrors}`,
    `ván theo brain: ${Object.entries(report.byBrain).map(([brain, n]) => `${brain}=${n}`).join(", ")}`,
    "",
    "tỉ lệ:",
    ...Object.entries(report.ratios).map(([key, value]) => `  ${key.padEnd(28)} ${pct(value)}`),
    "",
    "câu hỏi — bot hỏi bot | người hỏi bot:",
    ...outcomeKeys.map(
      (key) =>
        `  ${key.padEnd(22)} ${pct([bot[key] ?? 0, total(bot)])} | ${pct([human[key] ?? 0, total(human)])}`,
    ),
    "",
    `câu bị phòng chặn: ${JSON.stringify(report.blocked)}`,
    `câu/bot/ngày: ${report.botDays[1] === 0 ? "n/a" : (report.botDays[0] / report.botDays[1]).toFixed(2)}`,
    `chuỗi đối đáp dài nhất: ${report.maxChain}`,
    `lời khai/ván: ${report.games === 0 ? "n/a" : (report.claims / report.games).toFixed(2)}` +
      ` · ván có phản bác: ${report.gamesWithCounterClaim}/${report.games}`,
  ].join("\n");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const rows = await prisma.gameResult.findMany({
    where: options.since ? { createdAt: { gte: options.since } } : {},
    select: { botMetrics: true },
  });
  const metrics = rows
    .map((row) => row.botMetrics as unknown as BotMetrics | null)
    .filter((value): value is BotMetrics => value !== null);
  console.log(`[prod-metrics] ${rows.length} ván trong khoảng, ${metrics.length} ván có botMetrics`);

  const report = aggregateBotMetrics(metrics, { weightsVersion: options.weights, minHumans: options.minHumans });
  console.log(report ? format(report) : "Chưa có ván nào có botMetrics.");
}

main()
  .catch((error) => {
    console.error("[prod-metrics]", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
```

Trong `package.json` ở root, ngay dưới dòng `"mine-aliases": "tsx apps/server/scripts/mine-aliases.ts",` thêm:

```json
    "preprod-metrics": "npm run build:deps",
    "prod-metrics": "tsx apps/server/scripts/prod-metrics.ts",
```

- [ ] **Step 4: Chạy thử script**

`apps/server/scripts/` không nằm trong `include` của `tsconfig.json` hay `tsconfig.test.json`, nên `npm run lint` **không** kiểm kiểu file này — các script có sẵn như `mine-aliases.ts` cũng vậy. Đó là lý do mọi phép tính nằm trong `aggregateBotMetrics` (có kiểm kiểu, có test) và file script chỉ đọc DB rồi in. Kiểm nó bằng cách chạy:

Run (cần DB local, `npm run dev:infra` đã chạy và đã `npm run db:migrate`): `npm run prod-metrics`
Expected: dòng đầu `[prod-metrics] N ván trong khoảng, M ván có botMetrics`, rồi báo cáo hoặc `Chưa có ván nào có botMetrics.` Nếu không có DB local, ghi rõ bước này là **chưa chạy**.

Run: `npm run prod-metrics -- --bogus`
Expected: `[prod-metrics] Error: Tham số lạ: --bogus`, mã thoát 1.

- [ ] **Step 5: Chạy toàn bộ server**

Run: `npm run test --workspace @masoi/server`
Expected: mọi file xanh.

- [ ] **Step 6: Dừng để người dùng kiểm. Commit khi được bảo:**

```bash
git add apps/server/src/game/bot-metrics.ts apps/server/scripts/prod-metrics.ts apps/server/tests/bot-metrics.test.ts package.json
git commit -m "feat(scripts): add prod-metrics report over stored bot metrics"
```

---

### Task 7: Kiểm cuối và kiểm tay

**Files:** không sửa file nào.

- [ ] **Step 1: Chạy lại toàn bộ, tuần tự**

Run: `npm run build:deps && npm run test --workspace @masoi/game-engine && npm run test --workspace @masoi/server && npm run test --workspace @masoi/shared && npm run test --workspace @masoi/web && npm run lint`
Expected: mọi suite xanh, lint sạch.

- [ ] **Step 2: So ảnh vàng lần cuối**

Run: `node .tmp/golden.mjs compare .tmp/golden-ledger-before.json`
Expected: `IDENTICAL` — Task 2–6 không được đổi một bit nào của self-play.

- [ ] **Step 3: Kiểm tay với nhà cung cấp thật**

Test không gọi được nhà cung cấp thật. Với một key provider trong `.env` và DB local: chạy `npm run dev:server` + `npm run dev:web`, chơi một ván có ít nhất 3 bot tới lúc kết thúc, hỏi thẳng một bot một câu trong pha thảo luận. Rồi chạy `npm run prod-metrics`.

Expected:
- `ván theo brain` hiện tên nhà cung cấp, không phải tên `randomBrain`
- `casualToneRateProvider` có mẫu số khác 0
- cột *người hỏi bot* có ít nhất một ngăn khác 0

Nếu không có key để chạy: ghi rõ trong báo cáo cuối là bước này **chưa kiểm**.
