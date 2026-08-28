# Trial: Defense and Confirmation Vote Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single lethal day vote with a five-step trial — discussion, preliminary vote, a 25-second defense by the leading suspect, a binary confirmation vote, then lynch or acquit.

**Architecture:** Split `resolveVote()` into a non-lethal `resolveNomination()` and a lethal `resolveFinalVote()`, and insert two real phases (`DEFENSE`, `FINAL_VOTE`) between `VOTING` and `ELIMINATION`. The trial lives in one serializable nullable object on `GameState`, mirroring `hunterReaction`. Bots run both new decisions through the existing brain chain — the confirmation-vote prompt reads the defense speech out of the day chat, so a bot can actually change its mind — with a local heuristic as the last-resort fallback.

**Tech Stack:** TypeScript, npm workspaces, Zod, Vitest, Socket.IO, Next.js 16, React 19, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-08-28-trial-defense-vote-design.md`

## Global Constraints

- Read the spec completely before Task 1.
- Write each behavior test first and observe the expected RED failure before production edits.
- `VOTING` keeps its constant name and changes meaning to "nomination". Only its user-facing label changes.
- The preliminary vote never kills. Every death from the day now flows through `resolveFinalVote()`.
- Preserve the existing tally semantics exactly: `NO_ELIMINATION` is a peer candidate that can win and can tie.
- Lynch threshold is integer-only: `guilty * 2 > eligible`, where `eligible` excludes the accused. Abstain equals acquit.
- The accused may not vote in their own trial; the engine rejects it.
- Exactly one trial per day. Acquittal goes to night, not back to discussion.
- Only the accused may send to the `day` channel during `DEFENSE`. Dead players keep the `dead` channel throughout.
- Both new bot decisions call the brain chain. The confirmation-vote prompt must include the defense speech; a bot that cannot see it defeats the purpose of the phase.
- Every provider call needs a hard deadline and a local fallback, following `scheduleNightBots`. A late result must never land in a later phase.
- No new runtime dependency. Stage exact files only. Do not push without explicit permission.

## File Map

- Shared: `packages/shared/src/phases.ts`, `schemas.ts`, `events.ts`, `snapshot.ts`.
- Engine: `packages/game-engine/src/types.ts`, `engine.ts`, `tests/engine.test.ts`.
- Server: `apps/server/src/game/machine.ts`, `game/bot-room-state.ts`, `ws.ts`, `rooms/snapshot.ts`, `rooms/store.ts`, `config.ts`.
- Bots: `apps/server/src/bots/types.ts`, `targets.ts`, `decide.ts`, `prompt.ts`, `random-brain.ts`, `fallback-brain.ts`, `gemini-brain.ts`, `openai-compat-brain.ts`.
- Web: `apps/web/src/components/DayViews.tsx`, new `TrialPanel.tsx`, `PhaseBanner.tsx`, `Lobby.tsx`, `apps/web/src/app/room/[code]/page.tsx`, `lib/audio-track.ts`, `lib/audio-cues.ts`.
- Tests to migrate: `no-elimination-vote-contract.test.ts`, `no-elimination-vote-snapshot.test.ts`, `game-lifecycle.test.ts`, `hunter-flow.test.ts`, `day-bot-scheduling.test.ts`, `bot-vote.test.ts`, `chat-visibility.test.ts`, `production-config.test.ts`, `apps/web/src/lib/audio-track.test.ts`.

---

### Task 1: Shared phases, configuration, payload, event, and view types

**Files:**
- Modify: `packages/shared/src/phases.ts`
- Modify: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/events.ts`
- Modify: `packages/shared/src/snapshot.ts`
- Create: `apps/server/tests/trial-schema.test.ts`

**Interfaces:**
- Produces: phases `DEFENSE` and `FINAL_VOTE`; config `defenseSeconds` and `finalVoteSeconds`; `finalVotePayload`; `CLIENT_EVENTS.GAME_FINAL_VOTE`; `TrialView`; `TrialRecap`.
- Consumes: existing `RecapPlayer`, `RoomSnapshot`, `roomConfigSchema`.

- [ ] **Step 1: Write the failing schema test**

Create `apps/server/tests/trial-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_ROOM_CONFIG, finalVotePayload, roomConfigSchema } from "@masoi/shared";

describe("Trial schemas", () => {
  it("accepts the new timers within range and rejects outside it", () => {
    const config = roomConfigSchema.parse({ ...DEFAULT_ROOM_CONFIG, defenseSeconds: 30, finalVoteSeconds: 15 });
    expect(config.defenseSeconds).toBe(30);
    expect(() => roomConfigSchema.parse({ ...DEFAULT_ROOM_CONFIG, defenseSeconds: 5 })).toThrow();
    // Cận dưới 15: chuỗi não mất tới 13s ở trường hợp xấu nhất.
    expect(() => roomConfigSchema.parse({ ...DEFAULT_ROOM_CONFIG, finalVoteSeconds: 10 })).toThrow();
    expect(() => roomConfigSchema.parse({ ...DEFAULT_ROOM_CONFIG, finalVoteSeconds: 90 })).toThrow();
  });

  it("accepts only a boolean confirmation vote", () => {
    expect(finalVotePayload.parse({ guilty: true })).toEqual({ guilty: true });
    expect(() => finalVotePayload.parse({ guilty: null })).toThrow();
    expect(() => finalVotePayload.parse({ targetId: "p1" })).toThrow();
  });
});
```

- [ ] **Step 2: Add the phases and config fields**

In `phases.ts`, insert `"DEFENSE"` and `"FINAL_VOTE"` into `PHASES` between `"VOTING"` and `"ELIMINATION"`. Add `defenseSeconds: number` and `finalVoteSeconds: number` to `RoomConfig`. In `DEFAULT_ROOM_CONFIG` set `defenseSeconds: 25`, `finalVoteSeconds: 20`, and change `discussionSeconds` from `90` to `60`.

- [ ] **Step 3: Add the schema, payload, and event**

In `schemas.ts` add to `roomConfigSchema`:

```ts
defenseSeconds: z.number().int().min(10).max(60),
finalVoteSeconds: z.number().int().min(15).max(60),
```

`finalVoteSeconds` bottoms out at 15, not 10: the brain chain costs up to 13s worst case, so a 10s window would drop every bot to the local fallback.

and export `export const finalVotePayload = z.object({ guilty: z.boolean() }).strict();`

In `events.ts` add `GAME_FINAL_VOTE: "game:final-vote"` to `CLIENT_EVENTS`.

- [ ] **Step 4: Add the view types**

In `snapshot.ts` add `TrialView` and `TrialRecap` exactly as written in the spec, then add `trial: TrialView | null` and `lastTrial: TrialRecap | null` to `RoomSnapshot`.

- [ ] **Step 5: Verify**

Run `npm run build -w @masoi/shared` and `npx vitest run apps/server/tests/trial-schema.test.ts`. Expect the schema test GREEN. Other packages will not compile yet — that is expected until Task 2.

---

### Task 2: Engine trial state and the two-step resolution

**Files:**
- Modify: `packages/game-engine/src/types.ts`
- Modify: `packages/game-engine/src/engine.ts`
- Modify: `packages/game-engine/tests/engine.test.ts`

**Interfaces:**
- Produces: `GameState.trial`, `GameState.lastTrial`, `resolveNomination()`, `beginFinalVote()`, `submitFinalVote()`, `finalVoteTally()`, `allFinalVotersVoted()`, `resolveFinalVote()`, `PlayerGameView.trialInfo`, `PlayerGameView.lastTrial`.
- Consumes: existing `voteTally()`, `queueHunterReaction()`, `alivePlayers()`.
- Removes: `resolveVote()`.

- [ ] **Step 1: Write the failing engine tests**

Add a `describe("Phiên toà")` block to `packages/game-engine/tests/engine.test.ts` covering:

```ts
it("dẫn phiếu duy nhất trở thành bị cáo và chưa ai chết", () => {
  // 3 phiếu cho p2, 1 phiếu cho p3
  const outcome = engine.resolveNomination();
  expect(outcome).toEqual({ kind: "TRIAL", accusedId: "p2" });
  expect(engine.state.phase).toBe("DEFENSE");
  expect(engine.player("p2")!.alive).toBe(true);
});

it("hoà phiếu và 'không treo ai' thắng đều không mở phiên toà", () => {
  // hai nhánh riêng; cả hai kết thúc ở ELIMINATION với lastEliminated === null
  // và trial === null
});

it("bị cáo không được bỏ phiếu xác nhận", () => {
  expect(() => engine.submitFinalVote("p2", false)).toThrow(GameError);
});

it("treo khi đạt đa số tuyệt đối trên số cử tri hợp lệ", () => {
  // 6 sống, bị cáo p2 -> eligible 5 -> cần 3 phiếu Treo
});

it("phiếu trắng tính là tha", () => {
  // eligible 5, chỉ 2 phiếu Treo, 0 phiếu Tha -> không treo
  expect(engine.resolveFinalVote()).toBeNull();
  expect(engine.state.lastTrial!.lynched).toBe(false);
  expect(engine.state.lastTrial!.abstain).toBe(3);
});

it("hoà phiếu xác nhận là tha", () => {
  // eligible 4, 2 Treo 2 Tha -> 2*2 > 4 là false
});

it("treo Thợ Săn xếp hàng lượt bắn, tha thì không", () => { /* ... */ });
```

Run and observe RED.

- [ ] **Step 2: Add the trial state**

In `types.ts` add `TrialState` and `TrialRecap` per the spec and add `trial: TrialState | null` and `lastTrial: TrialRecap | null` to `GameState`. In the `GameEngine` constructor normalize both with `??= null` alongside the existing `hunterReaction` normalization. In `GameEngine.create` initialize both to `null`.

- [ ] **Step 3: Clear the trial on phase entry**

In `setPhase`, clear `this.state.trial = null` when entering `NIGHT` and when entering `DAY_DISCUSSION`, next to the existing `votes = {}` resets. A trial must never survive into the next day.

- [ ] **Step 4: Replace `resolveVote` with `resolveNomination`**

Keep the candidate-building and sorting block verbatim. Replace the outcome block:

```ts
resolveNomination(now = Date.now()): NominationOutcome {
  const st = this.state;
  if (st.phase !== "VOTING") throw new GameError("Chỉ xử lý phiếu khi đang bỏ phiếu");
  // ...existing candidate/leader/uniqueLeader computation, unchanged...

  if (uniqueLeader && leader.type === "PLAYER") {
    const accused = this.player(leader.targetId);
    if (accused?.alive) {
      st.trial = { accusedId: accused.id, finalVotes: {} };
      st.lastEliminated = null;
      st.lastTrial = null;
      st.log.push(`${accused.name} bị đưa ra biện hộ.`);
      st.phase = "DEFENSE";
      st.phaseEndsAt = now + durationMs; // caller passes the defense window
      return { kind: "TRIAL", accusedId: accused.id };
    }
  }

  st.lastEliminated = null;
  st.lastTrial = null;
  const reason = leader === undefined ? "no-votes" : uniqueLeader ? "no-elimination" : "tie";
  st.log.push(reason === "no-elimination"
    ? "Dân làng quyết định không treo ai."
    : "Hoà phiếu, không ai bị loại.");
  st.phase = "ELIMINATION";
  st.phaseEndsAt = now + 8_000;
  return { kind: "NONE", reason };
}
```

Take the defense duration as a parameter — `resolveNomination(defenseMs, now)` — so the engine does not read timing config the machine already owns. Delete `resolveVote()`.

- [ ] **Step 5: Add the confirmation vote**

```ts
private mustTrial(): TrialState { /* throws GameError when trial is null */ }

finalVoters(): EnginePlayer[] {
  const trial = this.mustTrial();
  return this.alivePlayers().filter((p) => p.id !== trial.accusedId);
}

submitFinalVote(voterId: string, guilty: boolean): void {
  // phase must be FINAL_VOTE; voter must be alive; voter must not be the accused;
  // reject a second vote by checking `finalVotes[voterId] !== undefined`
}

allFinalVotersVoted(): boolean
finalVoteTally(): { guilty: number; innocent: number; abstain: number; eligible: number }
```

`finalVoteTally` must ignore entries whose voter is no longer alive, the same way `wolfVoteTally` filters by living wolves — a Hunter shot fired between the nomination and the confirmation can kill a voter mid-trial.

- [ ] **Step 6: Add `beginFinalVote` and `resolveFinalVote`**

```ts
beginFinalVote(durationMs: number, now = Date.now()): void {
  if (!this.state.trial) throw new GameError("Không có phiên toà đang diễn ra");
  this.state.phase = "FINAL_VOTE";
  this.state.phaseEndsAt = now + durationMs;
}

resolveFinalVote(now = Date.now()): PublicDeath | null {
  const trial = this.mustTrial();
  const { guilty, innocent, abstain, eligible } = this.finalVoteTally();
  const accused = this.player(trial.accusedId);
  const lynched = eligible > 0 && guilty * 2 > eligible && accused?.alive === true;

  let eliminated: PublicDeath | null = null;
  if (lynched && accused) {
    accused.alive = false;
    eliminated = { playerId: accused.id, name: accused.name };
    this.queueHunterReaction([eliminated], "vote");
  }

  this.state.lastEliminated = eliminated;
  this.state.lastTrial = {
    accused: { id: accused!.id, name: accused!.name },
    guilty, innocent, abstain, lynched,
  };
  this.state.trial = null;
  this.state.log.push(lynched
    ? `Dân làng đã treo ${accused!.name} (${guilty}-${innocent}).`
    : `Dân làng đã tha ${accused!.name} (${guilty}-${innocent}).`);
  this.state.phase = "ELIMINATION";
  this.state.phaseEndsAt = now + 8_000;
  return eliminated;
}
```

- [ ] **Step 7: Extend `snapshotFor`**

Add `trialInfo: TrialView | null` and `lastTrial: TrialRecap | null` to `PlayerGameView`. Build `trialInfo` only in `DEFENSE` and `FINAL_VOTE`:

```ts
canSpeak: st.phase === "DEFENSE" && viewerId === trial.accusedId && viewer?.alive === true,
canVote: st.phase === "FINAL_VOTE" && viewer?.alive === true
  && viewerId !== trial.accusedId && trial.finalVotes[viewerId] === undefined,
myVote: trial.finalVotes[viewerId] ?? null,
guiltyRequired: Math.floor(eligible / 2) + 1,
```

Expose `lastTrial` only in `ELIMINATION`, `CHECK_WIN`, and `GAME_OVER`. Extend `showVoteCounts` and `votesRevealed` to include `DEFENSE` and `FINAL_VOTE`.

- [ ] **Step 8: Verify**

Run `npx vitest run packages/game-engine`. Expect the new block GREEN and pre-existing engine tests either passing or failing only where they call the removed `resolveVote` — fix those call sites to `resolveNomination` + `resolveFinalVote` in Task 8.

---

### Task 3: Server phase machine

**Files:**
- Modify: `apps/server/src/game/machine.ts`
- Modify: `apps/server/src/game/bot-room-state.ts`
- Create: `apps/server/tests/trial-flow.test.ts`

**Interfaces:**
- Produces: `beginFinalVote()`, `maybeEndFinalVoteEarly()`, `submitFinalVote()` (server-side wrapper), `pendingEndFinalVote`.
- Consumes: `continueAfterDeathResult(room, "vote")`, `setRoomTimer`, `clearRoomTimers`.

- [ ] **Step 1: Write the failing flow test**

Create `apps/server/tests/trial-flow.test.ts` modeled on `hunter-flow.test.ts` with fake timers, asserting:
- A clear nomination leader moves `VOTING -> DEFENSE -> FINAL_VOTE` on timers.
- A tie moves `VOTING -> ELIMINATION` and never enters `DEFENSE`.
- Reaching the guilty threshold kills the accused and then reaches `NIGHT`.
- Falling short acquits and still reaches `NIGHT`.
- Lynching a Hunter reaches `HUNTER_SHOT` before `NIGHT`.
- All eligible voters voting ends `FINAL_VOTE` early.

- [ ] **Step 2: Add the constant and the pending flag**

Add `pendingEndFinalVote = new Map<string, boolean>()` to `bot-room-state.ts` and clear it in `cleanupRoomBotState`. It exists for the same reason as `pendingEndVote`: without it, each late vote schedules another 800ms end timer.

- [ ] **Step 3: Rewrite `endVoting`**

```ts
function endVoting(room: Room): void {
  clearRoomTimers(room.code);
  if (!room.engine || room.engine.state.phase !== "VOTING") return;
  const outcome = engine(room).resolveNomination(room.config.defenseSeconds * 1000);
  sync(room);

  if (outcome.kind === "NONE") {
    setRoomTimer(room.code, () => continueAfterDeathResult(room, "vote"), RESULT_MS);
    return;
  }
  scheduleDefenseBot(room, outcome.accusedId);
  setRoomTimer(room.code, () => beginFinalVote(room), room.config.defenseSeconds * 1000 + 500);
}
```

`resolveNomination` already set the phase and deadline, so the machine only schedules.

- [ ] **Step 4: Add `beginFinalVote` and `endFinalVote`**

```ts
function beginFinalVote(room: Room): void {
  if (!room.engine || room.engine.state.phase !== "DEFENSE") return;
  clearRoomTimers(room.code);
  pendingEndFinalVote.set(room.code, false);
  engine(room).beginFinalVote(room.config.finalVoteSeconds * 1000);
  scheduleFinalVoteBots(room);
  setRoomTimer(room.code, () => endFinalVote(room), room.config.finalVoteSeconds * 1000 + 500);
  sync(room);
}

function endFinalVote(room: Room): void {
  clearRoomTimers(room.code);
  if (!room.engine || room.engine.state.phase !== "FINAL_VOTE") return;
  engine(room).resolveFinalVote();
  sync(room);
  setRoomTimer(room.code, () => continueAfterDeathResult(room, "vote"), RESULT_MS);
}

export function maybeEndFinalVoteEarly(room: Room): void {
  if (!room.engine || room.engine.state.phase !== "FINAL_VOTE") return;
  if (!room.engine.allFinalVotersVoted()) return;
  if (pendingEndFinalVote.get(room.code)) return;
  pendingEndFinalVote.set(room.code, true);
  setRoomTimer(room.code, () => endFinalVote(room), 800);
}
```

Mirror `maybeEndVotingEarly` exactly, including the flag guard.

- [ ] **Step 5: Verify**

Run `npx vitest run apps/server/tests/trial-flow.test.ts`. Expect GREEN.

---

### Task 4: Chat gating and snapshot wiring

**Files:**
- Modify: `apps/server/src/rooms/snapshot.ts`
- Modify: `apps/server/src/rooms/store.ts`
- Create: `apps/server/tests/defense-chat.test.ts`

**Interfaces:**
- Produces: the defense speaking lock; `trial` and `lastTrial` on `RoomSnapshot`; config normalization for old Redis rooms.
- Consumes: `resolveChat`, `visibleChatLog`, `buildSnapshot`.

- [ ] **Step 1: Write the failing chat test**

Create `apps/server/tests/defense-chat.test.ts` in the style of `chat-visibility.test.ts`:

```ts
it("chỉ bị cáo được nói trong pha biện hộ", () => {
  expect(resolveChat(room, accusedId)).toMatchObject({ ok: true, channel: "day" });
  expect(resolveChat(room, otherAliveId)).toEqual({ ok: false, error: "Chỉ người đang biện hộ được nói" });
});

it("người chết vẫn chat kênh dead trong lúc biện hộ", () => {
  expect(resolveChat(room, deadId)).toMatchObject({ ok: true, channel: "dead" });
});

it("mọi người nói lại được ở pha bỏ phiếu xác nhận", () => { /* FINAL_VOTE */ });
```

- [ ] **Step 2: Gate the chat**

In `resolveChat`, after the dead-player branch and before the shared day branch, add the `DEFENSE` rejection from the spec. Then add `"DEFENSE"` and `"FINAL_VOTE"` to the day-phase list in both `resolveChat` and `visibleChatLog`.

- [ ] **Step 3: Wire the snapshot**

In `buildSnapshot` add `trial: gameView?.trialInfo ?? null` and `lastTrial: gameView?.lastTrial ?? null`.

- [ ] **Step 4: Normalize persisted configs**

In `loadRoomFromRedis` extend the existing normalization block:

```ts
const storedConfig = data.config as RoomConfig & {
  hunter?: boolean; cursed?: boolean; defenseSeconds?: number; finalVoteSeconds?: number;
};
const normalizedConfig: RoomConfig = {
  ...storedConfig,
  hunter: storedConfig.hunter ?? false,
  cursed: storedConfig.cursed ?? false,
  defenseSeconds: storedConfig.defenseSeconds ?? DEFAULT_ROOM_CONFIG.defenseSeconds,
  finalVoteSeconds: storedConfig.finalVoteSeconds ?? DEFAULT_ROOM_CONFIG.finalVoteSeconds,
};
```

Without this, every room saved before the feature fails `roomConfigSchema` on the next config update, because the schema is `.strict()`.

- [ ] **Step 5: Verify**

Run `npx vitest run apps/server/tests/defense-chat.test.ts apps/server/tests/chat-visibility.test.ts apps/server/tests/reconnect.test.ts`. Expect GREEN.

---

### Task 5: Socket handler

**Files:**
- Modify: `apps/server/src/ws.ts`

**Interfaces:**
- Produces: the `game:final-vote` handler.
- Consumes: `finalVotePayload`, `engine.submitFinalVote`, `maybeEndFinalVoteEarly`.

- [ ] **Step 1: Add the handler**

Copy the shape of the `GAME_VOTE` handler exactly, including the `allowAction` rate limit and the write-through persist:

```ts
handler(CLIENT_EVENTS.GAME_FINAL_VOTE, async (payload) => {
  const { guilty } = finalVotePayload.parse(payload);
  if (!allowAction(`final-vote:${playerId}`, 10, 3_000)) throw new RoomError("Thao tác quá nhanh");
  const roomCode = getRoomSyncByPlayer(playerId);
  if (!roomCode) throw new RoomError("Bạn chưa vào phòng nào");
  const room = getRoom(roomCode);
  if (!room?.engine) throw new RoomError("Không có trận đấu đang chạy");

  room.engine.submitFinalVote(playerId, guilty);
  maybeEndFinalVoteEarly(room);
  broadcastRoom(roomCode);
  void import("./rooms/store").then((m) => m.persistRoom(room));
});
```

- [ ] **Step 2: Verify**

Run `npm run build -w @masoi/server`. Expect a clean compile.

---

### Task 6: Bots — defense speech and AI confirmation vote

**Files:**
- Modify: `apps/server/src/bots/types.ts`, `targets.ts`, `decide.ts`, `prompt.ts`, `random-brain.ts`, `fallback-brain.ts`, `gemini-brain.ts`, `openai-compat-brain.ts`
- Modify: `apps/server/src/game/machine.ts`, `apps/server/src/config.ts`
- Create: `apps/server/tests/trial-bot.test.ts`
- Modify: `apps/server/tests/production-config.test.ts`

**Interfaces:**
- Produces: `DefenseDecision`, `FinalVoteDecision`, `BotBrain.decideDefense`, `BotBrain.decideFinalVote`, `buildDefensePrompt`, `buildFinalVotePrompt`, `interpretDefense`, `interpretFinalVote`, `derivedFinalVote()`, `scheduleDefenseBot()`, `scheduleFinalVoteBots()`.
- Consumes: the existing brain chain, `buildSnapshot`, `pushChat`, `emitToPlayers`, `chatBlock`.

- [ ] **Step 1: Write the failing bot tests**

Create `apps/server/tests/trial-bot.test.ts`:

```ts
describe("prompt phiên toà", () => {
  it("prompt phiếu xác nhận có kèm lời biện hộ vừa nghe", () => {
    // chatLog chứa lời bị cáo; buildFinalVotePrompt(view).user phải chứa nguyên văn
  });
  it("không dựng prompt phiếu xác nhận cho chính bị cáo", () => {
    expect(buildFinalVotePrompt(accusedView)).toBeNull();
  });
  it("không dựng prompt biện hộ cho người không phải bị cáo", () => {
    expect(buildDefensePrompt(otherView)).toBeNull();
  });
});

describe("interpretFinalVote", () => {
  it("nhận đúng hai giá trị guilty", () => { /* true và false đều decided() */ });
  it("thiếu trường guilty là bad_shape, không phải phiếu Tha", () => {
    // đây là lỗi hình dạng: coi nó là Tha sẽ biến một lượt hỏng thành một
    // lá phiếu thật, và chuỗi dự phòng không bao giờ được gọi
  });
});

describe("derivedFinalVote (đường lui)", () => {
  it("Sói tha đồng bọn bị đưa ra toà", () => { /* ... */ });
  it("Sói treo người không phải đồng bọn", () => { /* ... */ });
  it("bot đã bỏ phiếu 'không treo ai' thì tha", () => { /* ... */ });
  it("dân làng mặc định treo dù đã đề cử người khác", () => { /* ... */ });
});

describe("xếp lịch bot", () => {
  it("bot bị cáo phát đúng một lời thoại vào kênh day", async () => { /* ... */ });
  it("không hỏi não khi bị cáo là người thật", async () => { /* brain spy not called */ });
  it("mọi bot còn sống trừ bị cáo đều nộp phiếu xác nhận", async () => { /* ... */ });
  it("não hỏng thì nộp phiếu đường lui, không bỏ trắng", async () => { /* ... */ });
  it("kết quả về sau khi pha đã đổi thì bị bỏ", async () => { /* ... */ });
});
```

Run and observe RED.

- [ ] **Step 2: Add both decisions to the brain interface**

In `types.ts`:

```ts
export interface DefenseDecision {
  chat: string;
}

/** Lá phiếu xác nhận. Object chứ không phải boolean trần để Attempt<T> phân
 *  biệt được "chọn Tha" với "không quyết được" — cùng lý do HunterShotDecision. */
export interface FinalVoteDecision {
  guilty: boolean;
}
```

Add `decideDefense(view)` and `decideFinalVote(view)` to `BotBrain`, and delegate both in `FallbackBrain` via the existing `first()` helper.

- [ ] **Step 3: Add the prompts**

In `prompt.ts`:

`buildDefensePrompt(view)` returns `null` unless `view.trial?.canSpeak`. Reuse `systemFor`, `roleContext`, `playerLines`, and `chatBlock`, then state the task: the bot is on trial, `voteCount` is revealed in this phase so they can see who pushed them there, and they have one or two sentences to answer. Schema `{ think, defense }`, both required.

`buildFinalVotePrompt(view)` returns `null` unless `view.trial?.canVote`. Same context blocks, plus an explicit pointer at the defense:

```ts
const accused = view.players.find((p) => p.id === view.trial!.accusedId);
// chatBlock đã kèm lời biện hộ (kênh day, 20 dòng gần nhất). Phải chỉ đích danh
// nó, nếu không model đọc lướt như một dòng chat thường và pha biện hộ vô nghĩa.
`${accused?.name} đang bị đưa ra treo cổ và vừa tự bào chữa ở cuối đoạn chat trên.`,
`Cần ${view.trial!.guiltyRequired} phiếu Treo để kết án.`,
"Cân nhắc lời bào chữa đó cùng số phiếu sơ bộ, rồi quyết: guilty true là treo, false là tha.",
```

Schema `{ think, guilty }` with `guilty` typed `{ type: "boolean" }` and both required.

- [ ] **Step 4: Add the interpreters**

In `decide.ts` add:

```ts
export const defenseSchema = z.object({ think: z.string(), defense: z.string() });
export const finalVoteSchema = z.object({ think: z.string(), guilty: z.boolean() });
```

`interpretDefense(view, raw, chatMaxLength, log)` truncates to `chatMaxLength` like `interpretDay`. An empty string after trimming is `bad_shape`, not a valid silent defense: silence is what the fallback produces, and it must not consume the successful branch of the chain.

`interpretFinalVote(view, raw, log)` returns `decided({ guilty })`. A missing or non-boolean `guilty` is `bad_shape` — never coerce it to `false`, or a broken call would silently become a real acquittal and the fallback chain would never run.

- [ ] **Step 5: Wire the two provider brains**

Add `decideDefense` and `decideFinalVote` to `GeminiBrain` and `OpenAiCompatBrain`, following their existing `decideDay` implementations exactly: same governor check, cooldown, timeout, `logOutcome` label, and null-prompt short circuit.

- [ ] **Step 6: Add the RandomBrain fallbacks**

```ts
const DEFENSE_LINES = [
  "Tôi là dân thường, treo tôi là mất một phiếu của làng.",
  "Các bạn đang nhắm nhầm người, tối nay sẽ rõ thôi.",
  "Tôi không có gì để giấu, ai đẩy phiếu tôi mới là đáng ngờ.",
];
```

`decideDefense` returns `nothingToDo()` when `!view.trial?.canSpeak`, otherwise one random line — a silent accused reads as a broken screen, and RandomBrain is the only brain guaranteed to answer.

`decideFinalVote` returns `nothingToDo()` when `!view.trial?.canVote`, otherwise `decided({ guilty: derivedFinalVote(view, planned) })`.

- [ ] **Step 7: Add the derived fallback vote**

In `targets.ts`:

```ts
/**
 * Phiếu xác nhận suy ra tại chỗ, không gọi mạng. Chỉ là ĐƯỜNG LUI khi chuỗi
 * não hỏng hoặc lỡ hạn — quyết định thật đi qua decideFinalVote.
 */
export function derivedFinalVote(view: RoomSnapshot, myNomination: PlannedVote | undefined): boolean {
  const accusedId = view.trial?.accusedId;
  if (!accusedId) return false;
  const accused = view.players.find((p) => p.id === accusedId);
  // Sói thấy vai đồng bọn trong snapshot của chính mình, đúng như legalNightTargets dùng.
  if (view.you?.role === "WEREWOLF" && accused?.role === "WEREWOLF") return false;
  if (myNomination?.type === "NO_ELIMINATION") return false;
  // Mặc định Treo: nếu đường lui chỉ treo người mình đã đề cử thì một làng bot
  // rải phiếu không bao giờ đạt đa số tuyệt đối, và Sói thắng bằng bào mòn mỗi
  // lần nhà cung cấp gặp sự cố.
  return true;
}
```

- [ ] **Step 8: Raise the call budget**

In `config.ts` change the default returned by `resolveBotAiMaxCallsPerGame` from `60` to `180`, and update the expectation in `apps/server/tests/production-config.test.ts`. A full 8-bot 6-round game now costs roughly 126 calls; 60 would trip the governor mid-game and mute the bots during the trials. `BOT_AI_MAX_CALLS_PER_GAME` stays the per-environment override and must be set on Render separately.

- [ ] **Step 9: Schedule the bots**

In `machine.ts`, both schedulers follow the `scheduleNightBots` shape — call at t=0, submit at `max(delay, result)`, hard-deadline timer submits the fallback, and re-check the phase before applying:

```ts
function scheduleDefenseBot(room: Room, accusedId: string): void {
  // Bỏ qua nếu bị cáo là người thật. Guard phase === "DEFENSE" và trial.accusedId
  // trước khi phát: kết quả về muộn không được lọt sang pha sau.
}

function scheduleFinalVoteBots(room: Room): void {
  const votes = pendingVote.get(room.code);
  // Mỗi bot còn sống khác bị cáo: hỏi botBrain().decideFinalVote(view) ở t=0,
  // nộp ở max(2-6s ngẫu nhiên, lúc kết quả về). Hạn chót cứng
  //   min(FINAL_VOTE_BOT_DEADLINE_MS, remainingMs - 1_000)
  // nộp derivedFinalVote(view, votes?.get(botId)) thay.
  // Sau mỗi lần nộp: sync(room) rồi maybeEndFinalVoteEarly(room).
}
```

`scheduleFinalVoteBots` must call `sync(room)` after each submission for the same reason `scheduleVoteBots` does: a bot vote is not broadcast by any socket handler, so without it the counters sit at zero until the phase ends.

Guard every submission with a `settled` flag so the provider result and the deadline timer cannot both cast a vote — `submitFinalVote` rejects the second one, but relying on that turns a scheduling bug into a swallowed exception.

- [ ] **Step 10: Verify**

Run `npx vitest run apps/server/tests/trial-bot.test.ts apps/server/tests/bot-vote.test.ts apps/server/tests/fallback-brain.test.ts apps/server/tests/random-brain.test.ts apps/server/tests/bot-prompt.test.ts apps/server/tests/production-config.test.ts apps/server/tests/gemini-brain.test.ts apps/server/tests/openai-compat-brain.test.ts`. Expect GREEN.

---

### Task 7: Web UI

**Files:**
- Create: `apps/web/src/components/TrialPanel.tsx`
- Modify: `apps/web/src/components/DayViews.tsx`, `PhaseBanner.tsx`, `Lobby.tsx`
- Modify: `apps/web/src/app/room/[code]/page.tsx`
- Modify: `apps/web/src/lib/audio-track.ts`, `lib/audio-cues.ts`

**Interfaces:**
- Produces: the defense screen, the Treo/Tha screen, the acquittal result.
- Consumes: `snapshot.trial`, `snapshot.lastTrial`, `game:final-vote`.

- [ ] **Step 1: Build `TrialPanel`**

One component handling both phases off `snapshot.phase`.

`DEFENSE`: name the accused prominently, show their preliminary vote count, run the countdown, and show either "Bạn đang bị buộc tội — hãy tự bào chữa trong khung chat" (accused) or "Chỉ <tên> được nói lúc này" (everyone else).

`FINAL_VOTE`: two buttons, `Treo cổ` and `Tha`, with live `guiltyVotes`/`innocentVotes` and the `guiltyRequired` threshold spelled out. Disable both when `!trial.canVote`, and after voting show the choice — read it from `hasVoted`, never from `myVote` truthiness, because `myVote === false` is a cast Tha vote, not an unvoted state. The accused sees "Bạn không được bỏ phiếu cho chính mình."

- [ ] **Step 2: Route the phases**

In `page.tsx` add `case "DEFENSE":` and `case "FINAL_VOTE":` returning `TrialPanel` with `onFinalVote={(guilty) => room.emit("game:final-vote", { guilty })}`.

- [ ] **Step 3: Handle acquittal in `EliminationView`**

Add the branch before the existing null case:

```tsx
{!snapshot.lastEliminated && snapshot.lastTrial && (
  <p>Làng đã tha <span className="text-emerald-300">{snapshot.lastTrial.accused.name}</span>
     {" "}({snapshot.lastTrial.guilty} treo - {snapshot.lastTrial.innocent} tha).</p>
)}
```

The existing "Không ai bị loại hôm nay." stays as the fallback for a tie or a winning `NO_ELIMINATION`.

- [ ] **Step 4: Labels, timers, and audio**

`PhaseBanner`: `VOTING` becomes "Bỏ phiếu sơ bộ"; add `DEFENSE` "Biện hộ" and `FINAL_VOTE` "Bỏ phiếu xác nhận". `Lobby`: add sliders for `defenseSeconds` and `finalVoteSeconds` beside the existing timer controls. `audio-track.ts`: map both new phases to the `vote` track. `audio-cues.ts`: the acquittal case must not fire the elimination cue.

- [ ] **Step 5: Verify**

Run `npx vitest run apps/web` and `npm run build -w @masoi/web`. Expect GREEN.

---

### Task 8: Migrate existing tests and verify end to end

**Files:**
- Modify: `apps/server/tests/no-elimination-vote-contract.test.ts`, `no-elimination-vote-snapshot.test.ts`, `game-lifecycle.test.ts`, `hunter-flow.test.ts`, `day-bot-scheduling.test.ts` (`production-config.test.ts` is already handled in Task 6, Step 8)
- Modify: `packages/game-engine/tests/engine.test.ts`
- Modify: `apps/server/scripts/e2e.ts`

- [ ] **Step 1: Update config fixtures**

Every `RoomConfig` literal in tests and in `apps/server/scripts/e2e.ts` needs `defenseSeconds` and `finalVoteSeconds`. Grep for `voteSeconds:` to find them all.

- [ ] **Step 2: Migrate the vote tests**

`no-elimination-vote-*` keep asserting the same rules but against `resolveNomination` — the `NO_ELIMINATION` and tie branches are unchanged by design, so only the call site and the "nobody died" assertion move. Tests that asserted a leading player dies at `VOTING` must now drive the trial through to `resolveFinalVote`.

- [ ] **Step 3: Migrate the lifecycle and hunter tests**

`game-lifecycle` and `hunter-flow` advance through the day; both need the two extra phases and their timers in the fake-timer sequence.

- [ ] **Step 4: Full verification**

Run in order and paste real output for each:

```
npm run build
npx vitest run
```

Do not claim completion until both are clean. Report any test you changed and why.

- [ ] **Step 5: Manual smoke test**

Start the server and web app, create a room with 1 human and 6 bots, and confirm across one full day: the preliminary vote names an accused without killing them, only the accused can chat during `DEFENSE`, a bot accused speaks once, the Treo/Tha counters move live, the threshold text matches the outcome, and an acquitted player is still alive at night.
