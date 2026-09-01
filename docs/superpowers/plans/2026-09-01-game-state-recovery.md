# Game State Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sau khi backend restart, người chơi reconnect vào cùng room code trở lại đúng ván đang chơi - đúng pha, đúng phiếu, đúng bot, đúng đồng hồ - và không có side effect nào chạy hai lần.

**Architecture:** Snapshot engine có version ghi write-through vào Redis (`room:{code}`), validate bằng Zod khi nạp, dựng lại `GameEngine` + `BotSession` + con trỏ RNG, rồi arm lại đúng bước chuyển pha đang chờ (`pendingStep`) theo `runAt` tuyệt đối. Mọi lời chuyển pha đi qua một sổ đăng ký bước có phase token (CAS) nên không bước nào chạy được hai lần.

**Tech Stack:** TypeScript, Node 20, ioredis, Zod 3, Prisma/Postgres, Vitest, socket.io.

**Spec:** `docs/superpowers/specs/2026-09-01-game-state-recovery-design.md`

## Global Constraints

- `PERSISTENCE_VERSION = 1`. Envelope sai version hoặc hỏng ⇒ quarantine, KHÔNG đoán, KHÔNG im lặng reset.
- Redis best-effort lúc chạy: lỗi ghi không được chặn gameplay. Lỗi ĐỌC lúc restore thì phải báo rõ và không tạo phòng mới.
- Sàn thời gian resume: `RESUME_FLOOR_MS = 10_000`, chỉ áp dụng cho pha cần thao tác (`NIGHT`, `DAY_DISCUSSION`, `VOTING`, `DEFENSE`, `FINAL_VOTE`, `HUNTER_SHOT`). Pha tự động (`ROLE_REVEAL`, `NIGHT_RESULT`, `ELIMINATION`, `CHECK_WIN`) quá hạn thì chạy ngay, đúng một lần.
- Không đụng multi-instance, matchmaking, hay persistence cho voice.
- TTL: `ROOM_TTL_SECONDS = 6 * 3600`; sau `GAME_OVER` là `1 * 3600`; quarantine `24 * 3600`.
- Payload persistence chỉ ở server. Không thêm byte nào vào `RoomSnapshot` gửi client.
- Comment code viết tiếng Việt, giải thích VÌ SAO (theo phong cách hiện có của repo).
- Mỗi task kết thúc bằng một commit. Commit message tiếng Việt, prefix `feat:`/`test:`/`refactor:`/`docs:`.

---

### Task 1: RNG khôi phục được vị trí

**Files:**
- Modify: `packages/game-engine/src/bot/rng.ts`
- Modify: `packages/game-engine/src/bot/types.ts` (kiểu `BotRng`)
- Test: `packages/game-engine/tests/bot-rng-cursor.test.ts`

**Interfaces:**
- Produces: `createSeededRng(seed: string, cursor?: number): SeededRng`, với `interface SeededRng { (): number; readonly cursor: number }`. `BotRng` giữ nguyên là `() => number` để mọi chỗ gọi cũ không đổi.

- [ ] **Step 1: Viết test hỏng**

```ts
import { describe, expect, it } from "vitest";
import { createSeededRng } from "../src/bot/rng";

describe("con trỏ RNG", () => {
  it("đếm số lần đã gọi", () => {
    const rng = createSeededRng("seed");
    expect(rng.cursor).toBe(0);
    rng(); rng(); rng();
    expect(rng.cursor).toBe(3);
  });

  it("tua tới cursor cho ra đúng dòng số gốc", () => {
    const original = createSeededRng("seed:bot:brain");
    const expected = [original(), original(), original(), original(), original()];

    const resumed = createSeededRng("seed:bot:brain", 3);
    expect(resumed.cursor).toBe(3);
    expect([resumed(), resumed()]).toEqual(expected.slice(3));
  });
});
```

- [ ] **Step 2: Chạy test để chắc chắn nó hỏng**

Run: `npm run test --workspace @masoi/game-engine -- bot-rng-cursor`
Expected: FAIL - `rng.cursor` là `undefined`.

- [ ] **Step 3: Cài đặt tối thiểu**

```ts
import type { BotRng } from "./types";

const STEP = 0x6d2b79f5;

function fnv1a32(seed: string): number { /* giữ nguyên */ }

/**
 * PRNG dựa trên BỘ ĐẾM cộng dồn, nên "đang ở đâu trong dòng số" chỉ là số lần
 * đã gọi. Nhờ vậy khôi phục sau restart không cần lưu nội trạng: lưu một con
 * số nguyên là đủ, và tua tới bằng công thức đóng nên O(1) dù cursor lớn.
 */
export interface SeededRng extends BotRng {
  readonly cursor: number;
}

export function createSeededRng(seed: string, cursor = 0): SeededRng {
  const base = fnv1a32(seed);
  let calls = cursor;
  // (base + calls * STEP) | 0 - tích lớn nhất còn dưới 2^53 với cursor thực tế,
  // nên ToInt32 vẫn cho đúng kết quả của `calls` lần cộng dồn.
  let state = (base + calls * STEP) | 0;

  const rng = (): number => {
    calls += 1;
    state = (state + STEP) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };

  Object.defineProperty(rng, "cursor", { get: () => calls });
  return rng as SeededRng;
}
```

- [ ] **Step 4: Chạy lại test**

Run: `npm run test --workspace @masoi/game-engine -- bot-rng-cursor`
Expected: PASS. Chạy thêm `npm run test --workspace @masoi/game-engine` để chắc chắn dòng số cũ KHÔNG đổi (mọi test determinism hiện có phải xanh).

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/bot/rng.ts packages/game-engine/tests/bot-rng-cursor.test.ts
git commit -m "feat(engine): RNG có con trỏ để khôi phục đúng vị trí dòng số"
```

---

### Task 2: BotRuntime nạp lại được brain state

**Files:**
- Modify: `packages/game-engine/src/bot/BotRuntime.ts`
- Modify: `packages/game-engine/src/index.ts` (export kiểu mới nếu cần)
- Test: `packages/game-engine/tests/bot-runtime-restore.test.ts`

**Interfaces:**
- Consumes: `createSeededRng` từ Task 1.
- Produces: `BotRuntimeOptions.state?: BotBrainState`, `BotRuntimeOptions.lastDecayRound?: number`, và `BotRuntime.serialize(): { state: BotBrainState; lastDecayRound: number }`.

- [ ] **Step 1: Viết test hỏng**

```ts
import { describe, expect, it } from "vitest";
import { BotRuntime, createSeededRng } from "../src/index";

describe("khôi phục BotRuntime", () => {
  it("nạp lại state đã serialize thay vì dựng brain mới", () => {
    const original = new BotRuntime({
      playerId: "b1",
      rng: createSeededRng("s:b1:brain"),
      playerIds: ["b1", "b2", "b3"],
    });
    original.state.suspicion["b2"]!.score = 42;

    const dumped = original.serialize();
    const restored = new BotRuntime({
      playerId: "b1",
      rng: createSeededRng("s:b1:brain", 5),
      playerIds: ["b1", "b2", "b3"],
      state: dumped.state,
      lastDecayRound: dumped.lastDecayRound,
    });

    expect(restored.state.suspicion["b2"]!.score).toBe(42);
    expect(restored.serialize().lastDecayRound).toBe(dumped.lastDecayRound);
  });

  it("không tiêu thêm số RNG khi đã có state", () => {
    const rng = createSeededRng("s:b1:brain", 7);
    const state = new BotRuntime({
      playerId: "b1",
      rng: createSeededRng("s:b1:brain"),
      playerIds: ["b1", "b2"],
    }).serialize().state;

    new BotRuntime({ playerId: "b1", rng, playerIds: ["b1", "b2"], state });
    expect(rng.cursor).toBe(7);
  });

  it("giữ nguyên phong cách nói dẫn xuất từ personality đã lưu", () => {
    const original = new BotRuntime({
      playerId: "b1",
      rng: createSeededRng("s:b1:brain"),
      playerIds: ["b1", "b2"],
    });
    const restored = new BotRuntime({
      playerId: "b1",
      rng: createSeededRng("s:b1:brain", 3),
      playerIds: ["b1", "b2"],
      state: original.serialize().state,
    });
    expect(restored.style).toEqual(original.style);
  });
});
```

- [ ] **Step 2: Chạy test để chắc chắn nó hỏng**

Run: `npm run test --workspace @masoi/game-engine -- bot-runtime-restore`
Expected: FAIL - `serialize` không tồn tại.

- [ ] **Step 3: Cài đặt tối thiểu**

Trong `BotRuntimeOptions` thêm:

```ts
  /**
   * Brain đã lưu từ trước khi process chết. Có nó thì constructor KHÔNG gọi
   * `createBotPersonality` nữa: lời gọi đó tiêu một số của RNG, nên gọi lại sẽ
   * đẩy con trỏ lệch đi một nhịp và mọi quyết định sau đó trôi khỏi dòng gốc.
   */
  state?: BotBrainState;
  /** Đi kèm `state`; thiếu nó thì memory bị decay lại một lần thừa. */
  lastDecayRound?: number;
```

Trong constructor, thay hai dòng cuối bằng:

```ts
    if (options.state) {
      this.state = options.state;
      this.lastDecayRound = options.lastDecayRound ?? -1;
    } else {
      const personality = options.personality ?? createBotPersonality(options.rng, this.weights);
      this.state = createBotBrainState(options.playerId, personality, options.playerIds);
    }
    this.style = deriveSpeechStyle(this.state.personality);
```

Thêm method:

```ts
  /**
   * Ảnh chụp đủ để dựng lại đúng con BOT này. `style` và `weights` KHÔNG có ở
   * đây vì cả hai là hàm thuần của những thứ đã nằm trong ảnh.
   */
  serialize(): { state: BotBrainState; lastDecayRound: number } {
    return { state: this.state, lastDecayRound: this.lastDecayRound };
  }
```

- [ ] **Step 4: Chạy lại test**

Run: `npm run test --workspace @masoi/game-engine`
Expected: PASS toàn bộ (mọi test bot cũ vẫn xanh vì nhánh `else` giữ nguyên hành vi).

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/bot/BotRuntime.ts packages/game-engine/tests/bot-runtime-restore.test.ts
git commit -m "feat(engine): BotRuntime serialize/nạp lại brain state"
```

---

### Task 3: BotSession serialize/restore

**Files:**
- Modify: `apps/server/src/bots/session-registry.ts`
- Test: `apps/server/tests/bot-session-restore.test.ts`

**Interfaces:**
- Consumes: `BotRuntime.serialize`, `createSeededRng(seed, cursor)`.
- Produces:

```ts
export interface PersistedBotSession {
  seed: string;
  playerIds: string[];
  brains: Record<string, { state: BotBrainState; lastDecayRound: number }>;
  cursors: Record<string, number>; // khoá "botId:channel"
}
export function serializeBotSession(roomCode: string): PersistedBotSession | null;
export function restoreBotSession(roomCode: string, data: PersistedBotSession): BotSession;
```

- [ ] **Step 1: Viết test hỏng**

```ts
import { describe, expect, it } from "vitest";
import {
  botSessionFor,
  clearBotSession,
  restoreBotSession,
  serializeBotSession,
} from "../src/bots/session-registry";
import type { Room } from "../src/rooms/store";

function room(): Room {
  return {
    code: "ABCDE", hostId: "p1", status: "IN_GAME",
    members: [
      { playerId: "p1", name: "A", ready: true, connected: true, isBot: false },
      { playerId: "b1", name: "B", ready: true, connected: true, isBot: true },
    ],
    config: {} as Room["config"], engine: null, chatLog: [], createdAt: 1,
  } as Room;
}

describe("serialize BotSession", () => {
  it("dựng lại brain và đúng vị trí RNG", () => {
    const r = room();
    const session = botSessionFor(r);
    const runtime = session.runtimeFor("b1");
    runtime.state.suspicion["p1"]!.score = 17;
    const rng = session.rngFor("b1", "vote-schedule");
    const consumed = [rng(), rng()];

    const dumped = serializeBotSession(r.code)!;
    expect(dumped.cursors["b1:vote-schedule"]).toBe(2);

    clearBotSession(r.code);
    const restored = restoreBotSession(r.code, dumped);

    expect(restored.runtimeFor("b1").state.suspicion["p1"]!.score).toBe(17);
    const fresh = createSeededRngFrom(dumped.seed);
    void fresh; void consumed;
    // dòng số tiếp tục, không quay lại đầu
    expect(restored.rngFor("b1", "vote-schedule")()).not.toBe(consumed[0]);
  });

  it("trả null khi phòng chưa có session", () => {
    clearBotSession("ZZZZZ");
    expect(serializeBotSession("ZZZZZ")).toBeNull();
  });
});
```

(Bỏ `createSeededRngFrom` - viết test không cần nó; dòng `void` ở trên chỉ để nhắc: khẳng định thật là "không quay lại đầu dòng".)

- [ ] **Step 2: Chạy test để chắc chắn nó hỏng**

Run: `npm run test --workspace @masoi/server -- bot-session-restore`
Expected: FAIL - `serializeBotSession` không tồn tại.

- [ ] **Step 3: Cài đặt**

Trong `BotSession`, đổi `channels` sang `Map<string, SeededRng>` và thêm:

```ts
  /** Ảnh chụp mọi brain và vị trí mọi dòng RNG đã mở. */
  serialize(): PersistedBotSession {
    const brains: PersistedBotSession["brains"] = {};
    for (const [botId, runtime] of this.runtimes) brains[botId] = runtime.serialize();
    const cursors: Record<string, number> = {};
    for (const [key, rng] of this.channels) cursors[key] = rng.cursor;
    return { seed: this.seed, playerIds: [...this.playerIds], brains, cursors };
  }

  /**
   * Dựng lại session từ ảnh chụp. Runtime và kênh RNG được nạp SẴN chứ không
   * lazy: lazy sẽ tạo lại chúng bằng cursor 0 nếu ai đó hỏi trước khi ảnh được
   * áp, và một BOT mất trí nhớ giữa ván là thứ khó lần ra nhất.
   */
  static restore(data: PersistedBotSession): BotSession {
    const session = new BotSession(data.seed, data.playerIds);
    for (const [botId, dumped] of Object.entries(data.brains)) {
      session.runtimes.set(botId, new BotRuntime({
        playerId: botId,
        rng: createSeededRng(`${data.seed}:${botId}:brain`, data.cursors[`${botId}:brain`] ?? 0),
        playerIds: data.playerIds,
        state: dumped.state,
        lastDecayRound: dumped.lastDecayRound,
      }));
    }
    for (const [key, cursor] of Object.entries(data.cursors)) {
      session.channels.set(key, createSeededRng(`${data.seed}:${key}`, cursor));
    }
    return session;
  }
```

Lưu ý: kênh `brain` của runtime KHÔNG nằm trong `channels` (nó được tạo thẳng trong `runtimeFor`), nên `serialize` phải ghi nó thủ công: thêm `cursors[`${botId}:brain`] = <rng của runtime>.cursor`. Để làm được, `BotSession.runtimeFor` phải giữ luôn rng đã tạo trong một map `brainRngs`.

Hàm module-level:

```ts
export function serializeBotSession(roomCode: string): PersistedBotSession | null {
  return sessions.get(roomCode)?.serialize() ?? null;
}

export function restoreBotSession(roomCode: string, data: PersistedBotSession): BotSession {
  const session = BotSession.restore(data);
  sessions.set(roomCode, session);
  return session;
}
```

- [ ] **Step 4: Chạy lại test**

Run: `npm run test --workspace @masoi/server -- bot-session`
Expected: PASS (cả `bot-session.test.ts` cũ).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/bots/session-registry.ts apps/server/tests/bot-session-restore.test.ts
git commit -m "feat(bots): serialize/khôi phục BotSession kèm con trỏ RNG"
```

---

### Task 4: Ngân sách governor đọc/ghi được

**Files:**
- Modify: `apps/server/src/bots/governor.ts`, `apps/server/src/bots/index.ts`
- Test: `apps/server/tests/bot-governor.test.ts` (bổ sung)

**Interfaces:**
- Produces: `BotGovernor.callsUsed(roomCode): number`, `BotGovernor.restore(roomCode, calls): void`, và ở `bots/index.ts`: `botBudgetUsed(roomCode)`, `restoreBotBudget(roomCode, calls)`.

- [ ] **Step 1: Viết test hỏng**

```ts
it("đọc và nạp lại ngân sách đã tiêu", () => {
  const gov = new BotGovernor(5);
  gov.recordCall("ABCDE");
  gov.recordCall("ABCDE");
  expect(gov.callsUsed("ABCDE")).toBe(2);

  const fresh = new BotGovernor(5);
  fresh.restore("ABCDE", 2);
  expect(fresh.callsUsed("ABCDE")).toBe(2);
  expect(fresh.canCall("ABCDE")).toBe(true);
});
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `npm run test --workspace @masoi/server -- bot-governor`
Expected: FAIL - `callsUsed` không tồn tại.

- [ ] **Step 3: Cài đặt**

```ts
  /** Ngân sách đã tiêu, để snapshot ghi lại được. */
  callsUsed(roomCode: string): number {
    return this.budgets.get(roomCode)?.calls ?? 0;
  }

  /**
   * Nạp lại ngân sách sau restart. Không có bước này thì mỗi lần restart lại
   * cấp thêm một hạn mức đầy cho cùng một ván.
   */
  restore(roomCode: string, calls: number): void {
    this.budgets.set(roomCode, { calls });
  }
```

Ở `bots/index.ts` thêm hai hàm mỏng dùng `sharedGovernor`.

- [ ] **Step 4: Chạy lại test** → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/bots/governor.ts apps/server/src/bots/index.ts apps/server/tests/bot-governor.test.ts
git commit -m "feat(bots): đọc/nạp lại ngân sách AI theo phòng"
```

---

### Task 5: Bộ đếm phiên thảo luận đọc/ghi được

**Files:**
- Modify: `apps/server/src/game/discussion-scheduler.ts`
- Test: `apps/server/tests/discussion-run-restore.test.ts`

**Interfaces:**
- Produces:

```ts
export interface PersistedDiscussionRun {
  round: number;
  phaseEndsAt: number | null;
  total: number;
  lastAt: number;
  spoken: Record<string, number>;
  lastSpokenAt: Record<string, number>;
  messageDepths: Record<string, number>;
  replyCounts: Record<string, number>;
}
export function serializeDiscussionRun(roomCode: string): PersistedDiscussionRun | null;
export function runDiscussionScheduler(room: Room, resumeFrom?: PersistedDiscussionRun | null): void;
```

- [ ] **Step 1: Viết test hỏng**

```ts
it("phiên khôi phục tiếp tục bộ đếm thay vì phát lại id tin nhắn cũ", () => {
  // dựng room DAY_DISCUSSION có bot, chạy scheduler, ép run.total = 2
  // rồi runDiscussionScheduler(room, dumped) và khẳng định
  expect(serializeDiscussionRun(room.code)!.total).toBe(2);
});
```

Test đầy đủ: tạo room có 2 bot, `runDiscussionScheduler(room)`, lấy `serializeDiscussionRun`, khẳng định `null` khi chưa có phiên; sau khi chạy thì có `round`/`total`; và `runDiscussionScheduler(room, dumped)` cho ra `serializeDiscussionRun(...).total === dumped.total`.

- [ ] **Step 2: Chạy để thấy hỏng** - `serializeDiscussionRun` không tồn tại.

- [ ] **Step 3: Cài đặt**

Thêm hàm serialize (Map → Record) và cho `runDiscussionScheduler` nhận tham số thứ hai; khi có `resumeFrom` **và** `resumeFrom.round === state.round`, khởi tạo `run` bằng số liệu đó thay vì số 0. Comment nêu rõ lý do: id tin nhắn bot là `bot-chat:${round}:${total}`, reset `total` sẽ sinh id trùng với tin đã nằm trong `chatLog`.

- [ ] **Step 4: Chạy lại test** → PASS, kèm `discussion-scheduler.test.ts` cũ vẫn xanh.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/game/discussion-scheduler.ts apps/server/tests/discussion-run-restore.test.ts
git commit -m "feat(bots): phiên thảo luận khôi phục được bộ đếm và độ sâu chuỗi"
```

---

### Task 6: Sổ đăng ký bước chuyển pha + phase token

**Files:**
- Create: `apps/server/src/game/steps.ts`
- Test: `apps/server/tests/phase-steps.test.ts`

**Interfaces:**
- Produces:

```ts
export type PendingStepName =
  | "beginNight" | "lockWolves" | "endNight" | "beginVoting" | "endVoting"
  | "beginFinalVote" | "endFinalVote" | "afterDeathResult"
  | "timeoutHunterShot" | "finishHunterShot";

export interface PendingStep {
  name: PendingStepName;
  token: string;
  runAt: number;
  source?: "night" | "vote"; // chỉ cho afterDeathResult
}

export function phaseToken(room: Room): string;           // `${round}:${phase}:${phaseSeq}`
export function armStep(room: Room, step: Omit<PendingStep, "token" | "runAt">, delayMs: number): void;
export function clearPendingStep(room: Room): void;
export function registerStepHandlers(handlers: Record<PendingStepName, (room: Room, step: PendingStep) => void>): void;
export function runPendingStep(room: Room, step: PendingStep): void;
```

`registerStepHandlers` tồn tại để `steps.ts` không phải import `machine.ts` (machine đã import steps) - cùng lý do `bot-room-state.ts` được tách ra.

- [ ] **Step 1: Viết test hỏng**

```ts
it("bỏ qua bước mang token cũ", () => {
  const room = inGameRoom(); // phase NIGHT, round 1
  const ran: string[] = [];
  registerStepHandlers({ ...noopHandlers, endNight: () => ran.push("endNight") });

  armStep(room, { name: "endNight" }, 1000);
  const stale = room.pendingStep!;

  room.engine!.state.round = 2;          // tình thế đã đổi
  runPendingStep(room, stale);
  expect(ran).toEqual([]);
});

it("chạy bước mang token hiện tại đúng một lần", () => { /* ... */ });

it("mỗi lần arm sinh token mới nên bước cũ hết hiệu lực", () => {
  armStep(room, { name: "lockWolves" }, 100);
  const first = room.pendingStep!;
  armStep(room, { name: "endNight" }, 100);
  runPendingStep(room, first);
  expect(ran).toEqual([]);
});
```

- [ ] **Step 2: Chạy để thấy hỏng.**

- [ ] **Step 3: Cài đặt** - `armStep` tăng `room.phaseSeq`, ghi `room.pendingStep = { ...step, token, runAt: Date.now() + delayMs }`, rồi `setRoomTimer(room.code, () => runPendingStep(room, room.pendingStep!), delayMs)`. `runPendingStep` so `step.token !== phaseToken(room)` ⇒ return.

- [ ] **Step 4: Chạy lại test** → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/game/steps.ts apps/server/tests/phase-steps.test.ts
git commit -m "feat(game): sổ đăng ký bước chuyển pha với phase token chống chạy hai lần"
```

---

### Task 7: `Room` mang trường phục hồi; machine dùng armStep

**Files:**
- Modify: `apps/server/src/rooms/store.ts` (interface `Room`), `apps/server/src/game/machine.ts`
- Test: `apps/server/tests/phase-step-wiring.test.ts`

**Interfaces:**
- Produces: `Room.gameId: string | null`, `Room.resultWritten: boolean`, `Room.pendingStep: PendingStep | null`, `Room.phaseSeq: number`. `machine.ts` export `STEP_HANDLERS` và gọi `registerStepHandlers` ở cấp module.

- [ ] **Step 1: Viết test hỏng**

```ts
it("mọi lần chuyển pha đều để lại pendingStep đúng tên", () => {
  const room = lobbyRoom();
  startGame(room);
  expect(room.pendingStep?.name).toBe("beginNight");
  expect(room.gameId).toMatch(/^[0-9a-f-]{36}$/);
});
```

- [ ] **Step 2: Chạy để thấy hỏng.**

- [ ] **Step 3: Cài đặt** - thay từng `setRoomTimer(room.code, () => X(room), ms)` chuyển pha trong `machine.ts` bằng `armStep(room, { name: "X" }, ms)`. Các timer KHÔNG phải chuyển pha (lịch nói của bot, `scheduleDiscussionSkipRecheck`, `maybeEndWitchWindow`, `maybeEndFinalVoteEarly`) giữ nguyên `setRoomTimer`: chúng là gia tốc, và `runPendingStep` vẫn là cửa duy nhất để thật sự đổi pha. `startGame` sinh `room.gameId = randomUUID()`, `room.resultWritten = false`, `room.phaseSeq = 0`.

- [ ] **Step 4: Chạy toàn bộ test server** - mọi test flow cũ (`hunter-flow`, `trial-flow`, `game-over-flow`, `witch-window-scheduling`, ...) phải xanh. Đây là bước dễ vỡ nhất của kế hoạch; test cũ chính là lưới an toàn.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/rooms/store.ts apps/server/src/game/machine.ts apps/server/tests/phase-step-wiring.test.ts
git commit -m "refactor(game): mọi chuyển pha đi qua armStep, room mang gameId và pendingStep"
```

---

### Task 8: `GameResult` idempotent theo `gameId`

**Files:**
- Create: `apps/server/prisma/migrations/20260901120000_add_game_id_to_game_result/migration.sql`
- Modify: `apps/server/prisma/schema.prisma`, `apps/server/src/game/machine.ts`
- Create: `apps/server/src/game/game-result.ts`
- Test: `apps/server/tests/game-result-idempotent.test.ts`

**Interfaces:**
- Produces: `writeGameResultOnce(room: Room): Promise<void>` - ghi đúng một lần, nuốt `P2002`, đặt `room.resultWritten = true`.

- [ ] **Step 1: Viết test hỏng**

```ts
it("gọi hai lần chỉ ghi một bản ghi", async () => {
  const created: unknown[] = [];
  // prisma giả: lần thứ hai ném lỗi có code P2002
  await writeGameResultOnce(room);
  await writeGameResultOnce(room);
  expect(created).toHaveLength(1);
  expect(room.resultWritten).toBe(true);
});

it("coi lỗi trùng khoá là đã ghi xong", async () => { /* prisma ném P2002 ngay lần đầu */ });

it("không ghi khi thiếu gameId", async () => { /* ván cũ nạp từ snapshot v1 luôn có gameId; phòng chưa vào trận thì bỏ qua */ });
```

- [ ] **Step 2: Chạy để thấy hỏng.**

- [ ] **Step 3: Cài đặt**

`schema.prisma`: thêm `gameId String? @unique` vào `GameResult` kèm comment giải thích nullable (ván ghi trước migration này để `NULL`; Postgres cho phép nhiều `NULL` trong unique index).

`migration.sql`:

```sql
ALTER TABLE "GameResult" ADD COLUMN "gameId" TEXT;
CREATE UNIQUE INDEX "GameResult_gameId_key" ON "GameResult"("gameId");
```

`game-result.ts` gói toàn bộ logic đang nằm trong `onGameOver` (kể cả `caseFileForHistory`), thêm `if (room.resultWritten || !room.gameId) return;` ở đầu và `catch` bắt `P2002`.

- [ ] **Step 4: Chạy lại test** → PASS. Chạy `npm run test --workspace @masoi/server -- match-history` để chắc chắn không vỡ.

- [ ] **Step 5: Commit**

```bash
git add apps/server/prisma apps/server/src/game/game-result.ts apps/server/src/game/machine.ts apps/server/tests/game-result-idempotent.test.ts
git commit -m "feat(db): GameResult.gameId unique để ghi kết quả ván idempotent"
```

---

### Task 9: Schema Zod cho snapshot

**Files:**
- Create: `apps/server/src/persistence/schema.ts`
- Test: `apps/server/tests/persistence-schema.test.ts`

**Interfaces:**
- Produces: `PERSISTENCE_VERSION`, `roomEnvelopeSchema`, `type RoomEnvelopeV1`, `type PersistedRoom`.

- [ ] **Step 1: Viết test hỏng**

```ts
it("nhận envelope hợp lệ", () => {
  expect(roomEnvelopeSchema.safeParse(validEnvelope()).success).toBe(true);
});
it("từ chối version khác", () => {
  expect(roomEnvelopeSchema.safeParse({ ...validEnvelope(), persistenceVersion: 2 }).success).toBe(false);
});
it("từ chối phase không có thật", () => { /* engineState.phase = "TEA_BREAK" */ });
it("từ chối thiếu opSeq", () => { /* ... */ });
it("giữ nguyên lịch sử đêm dạng cấu trúc", () => { /* nightHistory qua được mà không bị bóc field */ });
```

- [ ] **Step 2: Chạy để thấy hỏng.**

- [ ] **Step 3: Cài đặt** - zod strict cho phần mang quyết định, `.passthrough()`/`z.array(z.object({...}).passthrough())` cho lịch sử hiển thị (theo mục "Độ sâu validation" của spec). Cuối file đặt hai kiểm tra gán để schema không trôi khỏi type:

```ts
type Assignable<A, B> = [A] extends [B] ? true : never;
// tsc hỏng ngay khi engine thêm field mà schema quên
const _stateForward: Assignable<GameState, z.infer<typeof gameStateSchema>> = true;
const _stateBackward: Assignable<z.infer<typeof gameStateSchema>, GameState> = true;
void _stateForward; void _stateBackward;
```

- [ ] **Step 4: Chạy test + `npm run lint --workspace @masoi/server`** → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/persistence/schema.ts apps/server/tests/persistence-schema.test.ts
git commit -m "feat(persistence): schema Zod có version cho snapshot phòng"
```

---

### Task 10: Serialize / restore phòng

**Files:**
- Create: `apps/server/src/persistence/serialize.ts`, `apps/server/src/persistence/restore.ts`
- Test: `apps/server/tests/persistence-roundtrip.test.ts`

**Interfaces:**
- Produces: `serializeRoom(room: Room, opSeq: number): RoomEnvelopeV1`, `restoreRoom(envelope: RoomEnvelopeV1): Room` (dựng `GameEngine`, nạp `BotSession`, ngân sách governor).

- [ ] **Step 1: Viết test hỏng** - round-trip một ván NIGHT thật: vai, phiếu sói, `phaseEndsAt`, `pendingStep`, brain của bot, cursor RNG, ngân sách, `gameId` đều bằng nhau trước và sau.

- [ ] **Step 2: Chạy để thấy hỏng.**

- [ ] **Step 3: Cài đặt.**

- [ ] **Step 4: Chạy lại test** → PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(persistence): serialize/khôi phục phòng nguyên vẹn qua envelope"
```

---

### Task 11: Redis store có phân loại lỗi và quarantine

**Files:**
- Create: `apps/server/src/persistence/redis-store.ts`
- Test: `apps/server/tests/persistence-redis-store.test.ts`

**Interfaces:**
- Produces:

```ts
export type LoadResult =
  | { status: "ok"; envelope: RoomEnvelopeV1 }
  | { status: "missing" }
  | { status: "unavailable" }
  | { status: "corrupt"; reason: string };

export function saveEnvelope(envelope: RoomEnvelopeV1, ttlSeconds: number): Promise<void>;
export function loadEnvelope(code: string): Promise<LoadResult>;
export function quarantine(code: string, raw: string, reason: string): Promise<void>;
export function deleteEnvelope(code: string): Promise<void>;
```

- [ ] **Step 1: Viết test hỏng** với ioredis giả: đọc key không có → `missing`; `get` ném → `unavailable`; JSON hỏng → `corrupt` + key quarantine tồn tại + key gốc biến mất; version 2 → `corrupt`; ghi với `opSeq` nhỏ hơn bản đang có → bị bỏ qua.

- [ ] **Step 2: Chạy để thấy hỏng.**

- [ ] **Step 3: Cài đặt** - CAS bằng `redis.eval` (script so `opSeq` trong JSON đang lưu). Log có cấu trúc `console.warn(JSON.stringify({ event: "snapshot.invalid", ... }))`.

- [ ] **Step 4: Chạy lại test** → PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(persistence): store Redis phân biệt mất kết nối, thiếu và hỏng"
```

---

### Task 12: `resumeRoom` - sàn 10 giây và catch-up một lần

**Files:**
- Create: `apps/server/src/game/resume.ts`
- Test: `apps/server/tests/resume-phase.test.ts`

**Interfaces:**
- Consumes: `runPendingStep`, `armStep`, các `schedule*Bots`.
- Produces: `resumeRoom(room: Room): void`, `INTERACTIVE_PHASES`, `RESUME_FLOOR_MS`.

- [ ] **Step 1: Viết test hỏng** - bảng theo pha:

| Tình huống | Kỳ vọng |
|---|---|
| NIGHT còn 20s | `phaseEndsAt` KHÔNG đổi, `pendingStep` được arm lại |
| NIGHT còn 2s | `phaseEndsAt` = now + 10s |
| VOTING quá hạn 5 phút | `phaseEndsAt` = now + 10s, chưa `endVoting` |
| NIGHT_RESULT quá hạn | `afterDeathResult` chạy NGAY, đúng một lần |
| ROLE_REVEAL quá hạn | `beginNight` chạy ngay |
| GAME_OVER, `resultWritten=false` | ghi kết quả một lần, không arm timer |
| GAME_OVER, `resultWritten=true` | không ghi thêm |
| DAY_DISCUSSION | scheduler nhận lại `discussionRun` cũ |

- [ ] **Step 2: Chạy để thấy hỏng.**
- [ ] **Step 3: Cài đặt** theo mục "resumeRoom" của spec.
- [ ] **Step 4: Chạy lại test** → PASS.
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(game): resume phòng với sàn 10 giây và catch-up đúng một lần"
```

---

### Task 13: Nối `store.ts` và các call site

**Files:**
- Modify: `apps/server/src/rooms/store.ts`, `apps/server/src/rooms/service.ts`, `apps/server/src/rooms/reconnect.ts`, `apps/server/src/ws.ts`
- Test: `apps/server/tests/room-load-degraded.test.ts`, cập nhật `reconnect.test.ts`

**Interfaces:**
- Produces: `loadRoom(code): Promise<LoadResult & { room?: Room }>`; `loadRoomFromRedis` giữ chữ ký cũ (`Promise<Room | null>`) cho các chỗ chỉ cần "có hay không", cài đặt bằng `loadRoom`.

- [ ] **Step 1: Viết test hỏng** - Redis `unavailable` lúc join ⇒ ném `RoomError` với thông điệp rõ, KHÔNG tạo phòng mới; `findRoomOf` KHÔNG xoá `player-room` khi `unavailable`; snapshot `corrupt` ⇒ người chơi nhận `SERVER_EVENTS.ERROR` và key bị quarantine.

- [ ] **Step 2: Chạy để thấy hỏng.**
- [ ] **Step 3: Cài đặt.** Xoá hẳn khối hạ `IN_GAME` → `LOBBY` trong `loadRoomFromRedis`; thay bằng `resumeRoom`.
- [ ] **Step 4: Chạy toàn bộ test server** → PASS.
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(rooms): nạp phòng đang chơi từ Redis thay vì trả về sảnh chờ"
```

---

### Task 14: Test tích hợp restart

**Files:**
- Create: `apps/server/tests/restart-recovery.test.ts`
- Create: `apps/server/tests/helpers/fake-redis.ts`

- [ ] **Step 1: Viết test** - với mỗi pha trong danh sách nghiệm thu: dựng ván thật, đẩy tới pha đó, đọc envelope từ redis giả, `vi.resetModules()`, import lại module (mọi Map cấp module trống trơn = process mới), restore, khẳng định:
  - vòng/pha/sống chết/vai/phiếu/lịch sử/`activeEvent` khớp
  - `phaseEndsAt` giữ nguyên khi còn >10s
  - không transition nào chạy hai lần (đếm qua spy)
  - `GameResult` chỉ một bản ghi
  - VOTING có người đổi phiếu: `voteMutations` giữ nguyên
  - snapshot gửi cho một Dân Làng không lộ vai người khác

- [ ] **Step 2-4: Chạy, sửa tới khi xanh.**
- [ ] **Step 5: Commit**

```bash
git commit -m "test(server): tích hợp khôi phục ván qua restart cho mọi pha"
```

---

### Task 15: Test bot không đổi quyết định vì restart

**Files:**
- Create: `apps/server/tests/restart-bot-determinism.test.ts`

- [ ] **Step 1: Viết test** - chạy hai ván cùng seed: một ván liền mạch, một ván bị serialize/restore giữa `DAY_DISCUSSION` và giữa `VOTING`. Khẳng định chuỗi *quyết định* (phiếu, hành động đêm, mục tiêu) trùng nhau.
- [ ] **Step 2-4: Chạy, sửa tới khi xanh.**
- [ ] **Step 5: Commit**

```bash
git commit -m "test(bots): quyết định của bot không đổi vì restart"
```

---

### Task 16: E2E recovery + tài liệu

**Files:**
- Modify: `apps/server/scripts/e2e.ts`, `README.md`
- Create: `docs/operations-recovery.md`

- [ ] **Step 1:** Thêm kịch bản recovery vào `e2e.ts`: tạo phòng, vào trận, ép serialize + wipe + restore, khẳng định client nhận lại snapshot đúng.
- [ ] **Step 2:** Chạy `npm run test:e2e`.
- [ ] **Step 3:** Viết `docs/operations-recovery.md`: sơ đồ khoá Redis, ý nghĩa `persistenceVersion`, cách đọc log `snapshot.invalid`, cách dọn quarantine, và checklist khi deploy.
- [ ] **Step 4:** Cập nhật README mục vận hành + giới hạn đã biết.
- [ ] **Step 5: Commit**

```bash
git commit -m "docs: hướng dẫn vận hành khôi phục ván sau restart"
```

---

## Nghiệm thu cuối

- [ ] `npm test`
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm run test:e2e`
- [ ] Báo cáo giới hạn còn lại (mục "Giới hạn đã biết" của spec).
