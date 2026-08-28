# Hunter Role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one optional village Hunter who, after dying from a wolf attack, poison, or elimination vote, gets 15 seconds to shoot one living player or skip before the game checks its winner.

**Architecture:** Add a serializable `HUNTER_SHOT` reaction phase owned by `GameEngine`, a dedicated socket action, and one server timer. The reaction stores whether the death came from night or vote so the machine resumes the correct flow; snapshots expose only the public Hunter actor and a viewer-specific `canAct`.

**Tech Stack:** TypeScript, npm workspaces, Zod, Vitest, Socket.IO, Next.js 16, React 19, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-08-28-hunter-role-design.md`

## Global Constraints

- Read the spec completely before Task 1.
- Preserve and never reset unrelated worktree files. At plan time these were `apps/server/tests/discussion-skip-flow.test.ts`, `apps/server/scripts/skip-debug.ts`, and `apps/server/tests/skip-repro.test.ts`.
- Write each behavior test first and observe the expected RED failure before production edits.
- Keep at most one `HUNTER`; `hunter` defaults to `false` and old persisted lobby configs normalize to `false`.
- Hunter reacts to `wolf`, `poison`, and `vote`, cannot shoot self/dead targets, and may submit `null` to skip.
- `checkWin()` returns `null` while a Hunter reaction is unresolved.
- Hunter shot bypasses Guard/Witch and is recorded separately from `nightHistory.deaths`.
- Human timeout is skip. Only a bot Hunter may choose a target automatically.
- `HUNTER_SHOT` lasts 15,000 ms; an accepted action finishes after 800 ms.
- Reconnect in the same process restores the view naturally. Server restart keeps the existing behavior of returning in-progress rooms to lobby.
- Add no runtime dependency. Stage exact files only. Do not push without explicit permission.

## File Map

- Shared: `packages/shared/src/phases.ts`, `roles.ts`, `schemas.ts`, `events.ts`, `snapshot.ts`.
- Engine: `packages/game-engine/src/assignRoles.ts`, `types.ts`, `engine.ts`, `tests/engine.test.ts`.
- Server: `apps/server/src/game/machine.ts`, `ws.ts`, `rooms/snapshot.ts`, `rooms/store.ts`, `rooms/service.ts`.
- Bots: `apps/server/src/bots/types.ts`, `targets.ts`, `random-brain.ts`, `decide.ts`, `prompt.ts`, `fallback-brain.ts`, `gemini-brain.ts`, `openai-compat-brain.ts`.
- Web: `apps/web/src/components/Lobby.tsx`, new `HunterShotPanel.tsx`, `PhaseBanner.tsx`, `DayViews.tsx`, new `HunterShotTimeline.tsx`, `apps/web/src/app/room/[code]/page.tsx`, new `apps/web/src/lib/hunter-shot.ts` and test.

---

### Task 1: Shared role, configuration, schemas, events, and role deck

**Files:**
- Modify: `packages/shared/src/phases.ts`
- Modify: `packages/shared/src/roles.ts`
- Modify: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/events.ts`
- Modify: `packages/shared/src/snapshot.ts`
- Modify: `packages/game-engine/src/assignRoles.ts`
- Test: `packages/game-engine/tests/engine.test.ts`
- Create: `apps/server/tests/hunter-schema.test.ts`
- Modify: `apps/server/scripts/e2e.ts`

**Interfaces:**
- Produces: role `HUNTER`, config `hunter: boolean`, phase `HUNTER_SHOT`, `hunterShotPayload`, `CLIENT_EVENTS.GAME_HUNTER_SHOT`, `HunterShotView`, and `HunterShotRecap`.
- Consumes: existing `RecapPlayer`, `RoomSnapshot`, Zod schemas, and `buildRoleDeck`.

- [ ] **Step 1: Write failing deck and schema tests**

Add `hunter: false` to the `RoomConfig` fixtures in `packages/game-engine/tests/engine.test.ts` and `apps/server/scripts/e2e.ts`, then add:

```ts
it("thêm đúng một Thợ Săn khi cấu hình bật", () => {
  const deck = buildRoleDeck({ ...CONFIG, hunter: true }, 8);
  expect(deck.filter((role) => role === "HUNTER")).toHaveLength(1);
  expect(deck.filter((role) => role === "VILLAGER").length).toBeGreaterThan(0);
});
```

Create `hunter-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_ROOM_CONFIG, hunterShotPayload, roomConfigSchema } from "@masoi/shared";

describe("Hunter schemas", () => {
  it("accepts the toggle, a target, and an intentional skip", () => {
    expect(roomConfigSchema.parse({ ...DEFAULT_ROOM_CONFIG, hunter: true }).hunter).toBe(true);
    expect(hunterShotPayload.parse({ targetId: "p2" })).toEqual({ targetId: "p2" });
    expect(hunterShotPayload.parse({ targetId: null })).toEqual({ targetId: null });
  });
});
```

- [ ] **Step 2: Run RED**

```powershell
npm test --workspace @masoi/game-engine -- -t "Thợ Săn"
npm test --workspace @masoi/server -- hunter-schema.test.ts
```

Expected: missing `hunter`, `HUNTER`, and `hunterShotPayload` failures.

- [ ] **Step 3: Implement shared contracts**

Add `HUNTER_SHOT` before `CHECK_WIN`. Add `hunter: boolean` to `RoomConfig`, schema, validation special count, and defaults with `false`. Add:

```ts
HUNTER: {
  id: "HUNTER",
  name: "Thợ Săn",
  description: "Khi chết, có thể bắn một người còn sống hoặc không bắn ai.",
  team: "village",
},
```

Add event `GAME_HUNTER_SHOT: "game:hunter-shot"` and schema:

```ts
export const hunterShotPayload = z.object({
  targetId: z.string().min(1).nullable(),
}).strict();
```

Add shared snapshot types:

```ts
export interface HunterShotView {
  hunterId: string;
  hunterName: string;
  canAct: boolean;
  resolved: boolean;
}

export interface HunterShotRecap {
  round: number;
  hunter: RecapPlayer;
  target: RecapPlayer | null;
  source: "night" | "vote";
}
```

Add `hunterShot: HunterShotView | null` and `hunterShots: HunterShotRecap[]` to `RoomSnapshot`. In `buildRoleDeck` add `if (config.hunter) deck.push("HUNTER");`.

- [ ] **Step 4: Build and run GREEN**

```powershell
npm run build:shared
npm test --workspace @masoi/game-engine -- -t "Thợ Săn"
npm test --workspace @masoi/server -- hunter-schema.test.ts
```

- [ ] **Step 5: Commit**

Stage only Task 1 files and commit:

```powershell
git commit -m "feat: add hunter role contracts"
```

---

### Task 2: Engine reaction, shot validation, recap, and winner gate

**Files:**
- Modify: `packages/game-engine/src/types.ts`
- Modify: `packages/game-engine/src/engine.ts`
- Test: `packages/game-engine/tests/engine.test.ts`

**Interfaces:**
- Produces: `hasPendingHunterShot()`, `beginHunterShot(durationMs, now?)`, `submitHunterShot(playerId, targetId)`, `completeHunterReaction()`, `hunterShotInfo`, and game-over `hunterShots`.
- Consumes: Task 1 contracts.

- [ ] **Step 1: Write RED trigger tests**

Use deterministic `GameState` fixtures. Test Hunter death by wolf, poison, and vote:

```ts
expect(engine.state.hunterReaction).toEqual({
  hunterId: "hunter",
  source: "night",
  resolved: false,
});
```

Test a normal Villager death leaves `hunterReaction` null.

- [ ] **Step 2: Write RED action and win tests**

Cover:
- `beginHunterShot(15_000, 1_000)` sets phase and `phaseEndsAt = 16_000`.
- unresolved reaction makes `checkWin()` return null.
- valid shot kills target and records one recap.
- `null` records a skip.
- wrong actor, wrong phase, self, dead target, and double submit throw `GameError`.
- shooting the last wolf yields village; shooting a villager into parity yields wolves.

Desired API:

```ts
e.beginHunterShot(15_000, 1_000);
expect(e.submitHunterShot("hunter", "wolf")).toEqual({
  playerId: "wolf",
  name: "Sói",
});
expect(e.state.hunterShots.at(-1)?.target?.id).toBe("wolf");
expect(e.checkWin()).toBe("village");
```

- [ ] **Step 3: Run RED**

```powershell
npm test --workspace @masoi/game-engine -- -t "Thợ Săn|Hunter"
```

- [ ] **Step 4: Add serializable state**

```ts
export interface HunterReactionState {
  hunterId: string;
  source: "night" | "vote";
  resolved: boolean;
}

export interface GameState {
  hunterReaction: HunterReactionState | null;
  hunterShots: HunterShotRecap[];
}
```

Initialize to `null`/`[]` in `create` and normalize old states in the constructor with nullish assignment.

- [ ] **Step 5: Implement trigger and action**

After `resolveNight` applies deaths, queue the dead Hunter with source `night`. After `resolveVote` eliminates a player, queue Hunter with source `vote`.

Implement:

```ts
hasPendingHunterShot(): boolean {
  return !!this.state.hunterReaction && !this.state.hunterReaction.resolved;
}

beginHunterShot(durationMs: number, now = Date.now()): void {
  if (!this.hasPendingHunterShot()) throw new GameError("Không có lượt bắn của Thợ Săn");
  this.state.phase = "HUNTER_SHOT";
  this.state.phaseEndsAt = now + durationMs;
}
```

`submitHunterShot` must enforce phase, actor, dead Hunter status, unresolved state, and living non-self target. On success it marks a target dead or skips, sets `resolved = true`, appends `HunterShotRecap`, and adds one public Vietnamese log line.

`completeHunterReaction()` requires a resolved reaction, returns `"night" | "vote"`, and clears `hunterReaction`. At the top of `checkWin()` add:

```ts
if (st.hunterReaction && !st.hunterReaction.resolved) return null;
```

In `snapshotFor`, expose `hunterShotInfo` only during the phase; `canAct` is true only for the matching Hunter while unresolved. Return `hunterShots` only in `GAME_OVER`.

- [ ] **Step 6: Verify engine**

```powershell
npm test --workspace @masoi/game-engine -- -t "Thợ Săn|Hunter"
npm test --workspace @masoi/game-engine
npm run build:engine
```

- [ ] **Step 7: Commit**

```powershell
git commit -m "feat: add hunter reaction rules"
```

---

### Task 3: Server phase, timeout, socket, snapshot, and old-config normalization

**Files:**
- Modify: `apps/server/src/game/machine.ts`
- Modify: `apps/server/src/ws.ts`
- Modify: `apps/server/src/rooms/snapshot.ts`
- Modify: `apps/server/src/rooms/store.ts`
- Modify: `apps/server/src/rooms/service.ts`
- Create: `apps/server/tests/hunter-flow.test.ts`
- Create: `apps/server/tests/hunter-snapshot.test.ts`

**Interfaces:**
- Produces: `continueAfterDeathResult(room, source)` and `submitHunterShot(room, playerId, targetId)`.
- Consumes: Tasks 1–2.

- [ ] **Step 1: Write RED fake-timer flow tests**

Follow mocks in `night-bot-scheduling.test.ts`. Test:
- night source opens `HUNTER_SHOT` and timeout skips, then enters `DAY_DISCUSSION`;
- vote source manual skip finishes after 800 ms, then enters `NIGHT`;
- timeout/action race creates exactly one recap.

```ts
continueAfterDeathResult(room, "night");
expect(room.engine?.state.phase).toBe("HUNTER_SHOT");
await vi.advanceTimersByTimeAsync(15_501);
expect(room.engine?.state.hunterShots).toHaveLength(1);
expect(room.engine?.state.hunterShots[0].target).toBeNull();
expect(room.engine?.state.phase).toBe("DAY_DISCUSSION");
```

- [ ] **Step 2: Write RED snapshot privacy tests**

Assert Hunter sees `canAct: true`, everyone else sees false, other secret roles remain hidden, `hunterShots` is empty before `GAME_OVER`, and complete in `GAME_OVER`.

- [ ] **Step 3: Run RED**

```powershell
npm run build:shared
npm run build:engine
npm test --workspace @masoi/server -- hunter-flow.test.ts hunter-snapshot.test.ts
```

- [ ] **Step 4: Implement machine flow**

Use:

```ts
const HUNTER_SHOT_MS = 15_000;

export function continueAfterDeathResult(room: Room, source: "night" | "vote"): void {
  const e = engine(room);
  if (!e.hasPendingHunterShot()) {
    checkWinOrContinue(room, () => source === "night" ? beginDiscussion(room) : beginNight(room));
    return;
  }
  clearRoomTimers(room.code);
  e.beginHunterShot(HUNTER_SHOT_MS);
  scheduleHunterBot(room);
  setRoomTimer(room.code, () => timeoutHunterShot(room), HUNTER_SHOT_MS + 500);
  sync(room);
}

export function submitHunterShot(room: Room, playerId: string, targetId: string | null): void {
  engine(room).submitHunterShot(playerId, targetId);
  sync(room);
  setRoomTimer(room.code, () => finishHunterShot(room), 800);
}
```

`timeoutHunterShot` submits `null` only if phase/reaction are still pending. `finishHunterShot` checks phase, calls `completeHunterReaction()`, then checks winner and resumes discussion for `night` or night for `vote`. Replace existing post-result winner callbacks in `endNight` and `endVoting` with `continueAfterDeathResult`.

- [ ] **Step 5: Add socket and snapshot mapping**

Register `GAME_HUNTER_SHOT`, parse `hunterShotPayload`, rate limit at 3 actions/3 seconds, find the player's current room, then call the machine's `submitHunterShot`. Map engine `hunterShotInfo` and `hunterShots` into `RoomSnapshot`.

- [ ] **Step 6: Normalize config and update validation**

In `loadRoomFromRedis`:

```ts
const storedConfig = data.config as RoomConfig & { hunter?: boolean };
const normalizedConfig: RoomConfig = {
  ...storedConfig,
  hunter: storedConfig.hunter ?? false,
};
```

Use it for room and engine state config. Include `config.hunter ? 1 : 0` in `roomService.updateConfig` special count. Keep current restart-to-lobby behavior.

- [ ] **Step 7: Run GREEN and server regression**

```powershell
npm test --workspace @masoi/server -- hunter-flow.test.ts hunter-snapshot.test.ts hunter-schema.test.ts
npm test --workspace @masoi/server
npm run build:server
```

- [ ] **Step 8: Commit**

```powershell
git commit -m "feat: run hunter reaction phase"
```

---

### Task 4: Bot Hunter decision and fallback

**Files:**
- Modify: `apps/server/src/bots/types.ts`
- Modify: `apps/server/src/bots/targets.ts`
- Modify: `apps/server/src/bots/random-brain.ts`
- Modify: `apps/server/src/bots/decide.ts`
- Modify: `apps/server/src/bots/prompt.ts`
- Modify: `apps/server/src/bots/fallback-brain.ts`
- Modify: `apps/server/src/bots/gemini-brain.ts`
- Modify: `apps/server/src/bots/openai-compat-brain.ts`
- Modify: `apps/server/src/game/machine.ts`
- Create: `apps/server/tests/hunter-bot.test.ts`
- Modify: existing bot tests only where fake `BotBrain` objects need the new method.

**Interfaces:**
- Produces: `HunterShotDecision`, `legalHunterTargets`, `buildHunterPrompt`, `interpretHunterShot`, and `BotBrain.decideHunterShot`.
- Consumes: Hunter snapshot and server submit flow.

- [ ] **Step 1: Write RED bot tests**

Test target filtering, random fallback, bad target rejection, intentional AI skip, fallback chaining, and a hanging provider that results in exactly one engine submission before the phase timeout.

```ts
expect(legalHunterTargets(hunterView)).toEqual(["wolf", "villager"]);
expect(interpretHunterShot(hunterView, { think: "nghi ngờ", targetId: "dead" }, log)).toEqual({ ok: false });
expect(interpretHunterShot(hunterView, { think: "không chắc", targetId: null }, log)).toEqual({
  ok: true,
  value: { targetId: null },
});
```

- [ ] **Step 2: Run RED**

```powershell
npm test --workspace @masoi/server -- hunter-bot.test.ts
```

- [ ] **Step 3: Add contracts and pure logic**

```ts
export interface HunterShotDecision {
  targetId: string | null;
}

export interface BotBrain {
  readonly name: string;
  decideNight(view: RoomSnapshot): Promise<Attempt<NightDecision>>;
  decideDay(view: RoomSnapshot): Promise<Attempt<DayDecision>>;
  decideHunterShot(view: RoomSnapshot): Promise<Attempt<HunterShotDecision>>;
}

export function legalHunterTargets(view: RoomSnapshot): string[] {
  if (!view.hunterShot?.canAct || view.you?.role !== "HUNTER") return [];
  return view.players
    .filter((player) => player.alive && player.id !== view.you?.id)
    .map((player) => player.id);
}
```

`RandomBrain` returns `decided({ targetId: randomOf(targets) ?? null })`. `FallbackBrain` delegates through its existing `first` helper.

Add a Zod `hunterSchema` and `interpretHunterShot`. A missing/null target is an intentional `decided({ targetId: null })`, while a non-null target outside `legalHunterTargets` is `failed()`.

- [ ] **Step 4: Add AI prompt/provider wiring**

`buildHunterPrompt` returns null unless the viewer is the acting Hunter and at least one legal target exists. It lists only legal target IDs and makes `targetId` optional so omission means skip; when no target exists, the machine's RandomBrain deadline resolves to skip without calling a provider:

```ts
return {
  system: systemFor(view),
  user: [
    roleContext(view),
    "",
    playerLines(view),
    "",
    "Bạn vừa chết. Chọn một người còn sống để bắn, hoặc bỏ trống targetId để không bắn.",
  ].join("\n"),
  schema: {
    type: "object",
    properties: { think: THINK, targetId: { type: "string", enum: targets } },
    required: ["think"],
  },
};
```

Implement `decideHunterShot` in Gemini/OpenAI by reusing their existing transport/governor path and passing the raw output to `interpretHunterShot`. Do not duplicate HTTP logic.

- [ ] **Step 5: Schedule bot Hunter**

`scheduleHunterBot(room)` finds the pending bot, calls the configured brain immediately, and uses RandomBrain before the 15-second phase deadline if AI hangs/fails. A local `settled` flag plus phase, actor, and `resolved` checks guarantee one submission.

- [ ] **Step 6: Verify bots/server**

```powershell
npm test --workspace @masoi/server -- hunter-bot.test.ts
npm test --workspace @masoi/server
npm run lint --workspace @masoi/server
```

- [ ] **Step 7: Commit**

Stage exact bot files, `machine.ts`, Hunter bot test, and only required fake-brain fixture edits:

```powershell
git commit -m "feat: let bot hunter retaliate"
```

---

### Task 5: Frontend lobby, Hunter phase, and final timeline

**Files:**
- Modify: `apps/web/src/components/Lobby.tsx`
- Create: `apps/web/src/components/HunterShotPanel.tsx`
- Modify: `apps/web/src/components/PhaseBanner.tsx`
- Modify: `apps/web/src/components/DayViews.tsx`
- Create: `apps/web/src/components/HunterShotTimeline.tsx`
- Modify: `apps/web/src/app/room/[code]/page.tsx`
- Create: `apps/web/src/lib/hunter-shot.ts`
- Create: `apps/web/src/lib/hunter-shot.test.ts`

**Interfaces:**
- Produces: `legalHunterShotTargets(snapshot)` and complete human UI.
- Consumes: Task 1 snapshot/config/event contracts.

- [ ] **Step 1: Write RED pure web tests**

Test that the acting Hunter sees living non-self targets, while non-Hunter/resolved views return none.

```ts
test("Hunter only targets living players other than self", () => {
  assert.deepEqual(legalHunterShotTargets(hunterSnapshot).map((p) => p.id), ["wolf", "villager"]);
});
```

- [ ] **Step 2: Run RED**

```powershell
npm test --workspace @masoi/web
```

- [ ] **Step 3: Implement helper and panel**

```ts
export function legalHunterShotTargets(snapshot: RoomSnapshot): PlayerView[] {
  if (!snapshot.hunterShot?.canAct || snapshot.hunterShot.resolved || snapshot.you?.role !== "HUNTER") return [];
  return snapshot.players.filter((player) => player.alive && player.id !== snapshot.you?.id);
}
```

`HunterShotPanel` uses local `selectedId` and `submitted`. It renders `PlayerGrid`, `Bắn người này`, and `Không bắn ai`; both handlers set `submitted` before invoking `onShoot` to prevent double click. Non-actors see `Thợ Săn đang chọn người để bắn…`.

- [ ] **Step 4: Wire config, phase, route, and role name**

Add `["hunter", "Thợ Săn"]` to Lobby toggles. Add PhaseBanner metadata:

```ts
HUNTER_SHOT: {
  label: "Thợ Săn phản kích",
  cls: "bg-amber-900 text-amber-200",
},
```

In room page:

```tsx
case "HUNTER_SHOT":
  return (
    <HunterShotPanel
      snapshot={snapshot}
      onShoot={(targetId) => room.emit("game:hunter-shot", { targetId })}
    />
  );
```

Replace the GameOver nested role ternary with `ROLE_META[p.role]?.name` so Hunter and future roles render correctly.

- [ ] **Step 5: Add game-over timeline**

Create `HunterShotTimeline`. Return null for no shots; otherwise render one line per recap:

```tsx
<li key={shot.round + "-" + shot.hunter.id + "-" + index}>
  🔫 {shot.target
    ? shot.hunter.name + " đã bắn " + shot.target.name + "."
    : shot.hunter.name + " đã không bắn ai."}
</li>
```

Render it in `GameOverView` beside `NightRecapTimeline`.

- [ ] **Step 6: Verify web**

```powershell
npm test --workspace @masoi/web
npm run lint --workspace @masoi/web
npm run build:web
```

- [ ] **Step 7: Commit**

```powershell
git commit -m "feat: add hunter reaction interface"
```

---

### Task 6: Full verification and delivery

**Files:**
- Modify only Task 1–5 files when a failing command proves a correction is needed.
- Never stage unrelated skip debug files.

**Interfaces:**
- Produces: verified Hunter commits ready for push/deploy.

- [ ] **Step 1: Build in dependency order**

```powershell
npm run build:shared
npm run build:engine
npm run build:server
npm run build:web
```

Expected: every command exits 0.

- [ ] **Step 2: Run every test suite**

```powershell
npm test --workspace @masoi/game-engine
npm test --workspace @masoi/server
npm test --workspace @masoi/web
```

Expected: zero failures.

- [ ] **Step 3: Run lint and repository checks**

```powershell
npm run lint
git diff --check
git status --short
```

Expected: lint/diff exit 0. Status may show only the pre-existing unrelated files.

- [ ] **Step 4: Audit acceptance coverage**

Confirm tests cover: wolf death, poison death, vote death, manual skip, 15-second timeout, valid shot, invalid target, double submit, bot fallback, reconnect snapshot, game-over recap, village win flip, wolves win flip, old-config normalization, and existing wolf-vote/Witch-window regressions.

- [ ] **Step 5: Commit any verification-only correction**

If verification forced a correction, stage only exact Hunter files and commit:

```powershell
git commit -m "fix: harden hunter reaction flow"
```

- [ ] **Step 6: Report without pushing**

Report commit hashes, fresh test counts, lint/build output, and remaining unrelated worktree files. Push only after the user explicitly asks.
