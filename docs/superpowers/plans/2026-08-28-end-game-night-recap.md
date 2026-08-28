# End-game Night Recap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hiển thị đầy đủ diễn biến từng đêm của ván hiện tại tại màn hình `GAME_OVER`, đồng thời không để lộ dữ liệu này trước khi ván kết thúc hoặc mang nó sang ván mới.

**Architecture:** Định nghĩa `NightRecap` trong package shared, để game engine chụp một bản ghi bất biến khi `resolveNight()` hoàn tất và lưu trong `GameState.nightHistory`. Snapshot chỉ xuất mảng này khi phase là `GAME_OVER`; web render mảng thành timeline thuần dữ liệu, không dùng AI hay persistence riêng.

**Tech Stack:** TypeScript 5.5, Vitest, Node.js 20.19+, React 19, Next.js 16, Socket.IO monorepo npm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-28-end-game-night-recap-design.md`

## Global Constraints

- Chỉ lưu và hiển thị lịch sử của ván hiện tại; game engine mới phải bắt đầu bằng mảng rỗng.
- Chỉ `GAME_OVER` được nhận `nightHistory`; mọi phase khác, kể cả viewer đã chết, phải nhận `[]`.
- Không thay đổi luật hành động ban đêm, thứ tự xử lý tử vong, điều kiện thắng hoặc thời gian phase.
- Không thêm Prisma migration, dependency, API AI, nút kết thúc thủ công hoặc kho lịch sử nhiều ván.
- Recap hiển thị theo thứ tự đêm cũ đến mới và dùng dữ liệu thật từ engine.
- Mọi thay đổi hành vi engine/server phải được viết test thất bại trước khi viết implementation.

---

## File Structure

- `packages/shared/src/snapshot.ts`: sở hữu public DTO `RecapPlayer`, `NightRecap` và field `RoomSnapshot.nightHistory`.
- `packages/game-engine/src/types.ts`: thêm `GameState.nightHistory`, dùng kiểu `NightRecap` từ shared.
- `packages/game-engine/src/engine.ts`: khởi tạo, ghi và lọc lịch sử theo phase.
- `packages/game-engine/tests/engine.test.ts`: kiểm thử nội dung recap, nhiều đêm, reset theo engine mới và chống lộ dữ liệu.
- `apps/server/src/rooms/snapshot.ts`: chuyển `nightHistory` đã được engine lọc sang `RoomSnapshot`, có mặc định lobby rỗng.
- `apps/server/tests/night-recap-snapshot.test.ts`: kiểm thử ranh giới server snapshot cho game over, phase đang chơi và lobby.
- `apps/web/src/components/NightRecapTimeline.tsx`: component chỉ chịu trách nhiệm trình bày timeline đêm.
- `apps/web/src/components/DayViews.tsx`: gắn timeline vào `GameOverView`.
- Các fixture `RoomSnapshot`/`GameState` hiện có: thêm `nightHistory: []` để giữ hợp đồng kiểu bắt buộc.

---

### Task 1: Public recap contract and empty snapshot defaults

**Files:**
- Modify: `packages/shared/src/snapshot.ts`
- Modify: `apps/server/src/rooms/snapshot.ts`
- Modify fixtures containing `lastNightDeaths:` in:
  - `apps/server/scripts/bot-probe.ts`
  - `apps/server/tests/bot-prompt.test.ts`
  - `apps/server/tests/bot-targets.test.ts`
  - `apps/server/tests/bot-vote.test.ts`
  - `apps/server/tests/fallback-brain.test.ts`
  - `apps/server/tests/gemini-brain.test.ts`
  - `apps/server/tests/openai-compat-brain.test.ts`
  - `apps/server/tests/random-brain.test.ts`

**Interfaces:**
- Consumes: existing `RoomSnapshot` and `Role` definitions.
- Produces: `RecapPlayer`, `NightRecap`, and required `RoomSnapshot.nightHistory: NightRecap[]`.

- [ ] **Step 1: Add the shared DTOs**

Add before `RoomSnapshot` in `packages/shared/src/snapshot.ts`:

```ts
export interface RecapPlayer {
  id: string;
  name: string;
}

export interface NightRecap {
  round: number;
  wolfTarget: RecapPlayer | null;
  guardTarget: RecapPlayer | null;
  seerChecks: Array<{
    seer: RecapPlayer;
    target: RecapPlayer;
    isWolf: boolean;
  }>;
  witch: {
    usedHeal: boolean;
    healedTarget: RecapPlayer | null;
    poisonTarget: RecapPlayer | null;
  };
  deaths: Array<{
    player: RecapPlayer;
    cause: "wolf" | "poison";
  }>;
}
```

Add to `RoomSnapshot` beside `lastNightDeaths`:

```ts
/** Toàn bộ diễn biến đêm; chỉ có dữ liệu ở GAME_OVER. */
nightHistory: NightRecap[];
```

- [ ] **Step 2: Add the server's safe empty default**

In `buildSnapshot()`, return an empty array until the engine contract is implemented in Task 2:

```ts
nightHistory: [],
lastNightDeaths: gameView?.lastNightDeaths ?? [],
```

- [ ] **Step 3: Update typed fixtures mechanically**

In every listed fixture, add the following beside `lastNightDeaths` without changing its test behavior:

```ts
nightHistory: [],
```

- [ ] **Step 4: Run type checks to verify the contract is complete**

Run:

```bash
npm run build:shared
npm run lint --workspace @masoi/server
```

Expected: both commands exit 0; no object literal is missing `nightHistory`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/snapshot.ts apps/server/src/rooms/snapshot.ts apps/server/scripts/bot-probe.ts apps/server/tests/bot-prompt.test.ts apps/server/tests/bot-targets.test.ts apps/server/tests/bot-vote.test.ts apps/server/tests/fallback-brain.test.ts apps/server/tests/gemini-brain.test.ts apps/server/tests/openai-compat-brain.test.ts apps/server/tests/random-brain.test.ts
git commit -m "feat: define end-game night recap contract"
```

---

### Task 2: Record complete night history in the game engine

**Files:**
- Modify: `packages/game-engine/src/types.ts`
- Modify: `packages/game-engine/src/engine.ts`
- Modify: `packages/game-engine/tests/engine.test.ts`
- Modify GameState fixtures in:
  - `apps/server/tests/day-bot-scheduling.test.ts`
  - `apps/server/tests/chat-visibility.test.ts`
  - `apps/server/tests/discussion-skip-flow.test.ts`
  - `apps/server/tests/discussion-skip-leave.test.ts`
  - `apps/server/tests/discussion-skip-state.test.ts`
  - `apps/server/tests/guard-previous-view.test.ts`
  - `apps/server/tests/night-bot-scheduling.test.ts`
  - `apps/server/tests/no-elimination-vote-snapshot.test.ts`

**Interfaces:**
- Consumes: `NightRecap` and `RecapPlayer` from `@masoi/shared`; existing `NightState`, `DeathInfo`, `GameEngine.resolveNight()`.
- Produces: required `GameState.nightHistory: NightRecap[]` and `PlayerGameView.nightHistory: NightRecap[]` filtered by phase.

- [ ] **Step 1: Write failing engine tests for recording a complete night**

Append a `describe("Lịch sử diễn biến ban đêm", ...)` block to `packages/game-engine/tests/engine.test.ts`. Build the expectations from players found by role so random role assignment cannot make the test flaky:

```ts
it("ghi đầy đủ hành động và kết quả của một đêm", () => {
  const e = makeEngine(7);
  const wolf = findPlayersByRole(e, "WEREWOLF")[0];
  const guard = findPlayersByRole(e, "GUARD")[0];
  const seer = findPlayersByRole(e, "SEER")[0];
  const witch = findPlayersByRole(e, "WITCH")[0];
  const wolfTarget = e.state.players.find((p) => p.role === "VILLAGER")!;
  const poisonTarget = e.state.players.find(
    (p) => p.alive && p.id !== wolfTarget.id && p.id !== witch.id && p.role !== "WEREWOLF",
  )!;

  e.submitNightAction(wolf.id, "KILL", wolfTarget.id);
  e.submitNightAction(guard.id, "GUARD", wolfTarget.id);
  e.submitNightAction(seer.id, "SEE", wolf.id);
  e.submitNightAction(witch.id, "HEAL", null);
  e.submitNightAction(witch.id, "POISON", poisonTarget.id);
  e.resolveNight();

  expect(e.state.nightHistory).toEqual([
    {
      round: 1,
      wolfTarget: { id: wolfTarget.id, name: wolfTarget.name },
      guardTarget: { id: wolfTarget.id, name: wolfTarget.name },
      seerChecks: [{
        seer: { id: seer.id, name: seer.name },
        target: { id: wolf.id, name: wolf.name },
        isWolf: true,
      }],
      witch: {
        usedHeal: true,
        healedTarget: { id: wolfTarget.id, name: wolfTarget.name },
        poisonTarget: { id: poisonTarget.id, name: poisonTarget.name },
      },
      deaths: [{
        player: { id: poisonTarget.id, name: poisonTarget.name },
        cause: "poison",
      }],
    },
  ]);
});
```

- [ ] **Step 2: Write failing tests for multiple nights and an empty-result night**

```ts
it("giữ các đêm theo thứ tự và ghi cả đêm không có người chết", () => {
  const e = makeEngine(7);
  e.resolveNight();
  e.setPhase("NIGHT", 30_000);
  e.resolveNight();

  expect(e.state.nightHistory.map((night) => night.round)).toEqual([1, 2]);
  expect(e.state.nightHistory[0].deaths).toEqual([]);
  expect(e.state.nightHistory[1].deaths).toEqual([]);
});

it("engine của ván mới không mang lịch sử ván trước", () => {
  const first = makeEngine(7);
  first.resolveNight();
  const next = makeEngine(7);

  expect(first.state.nightHistory).toHaveLength(1);
  expect(next.state.nightHistory).toEqual([]);
});

it("ghi việc dùng bình cứu dù đêm đó không có mục tiêu của Sói", () => {
  const e = makeEngine(7);
  const witch = findPlayersByRole(e, "WITCH")[0];
  e.submitNightAction(witch.id, "HEAL", null);
  e.resolveNight();

  expect(e.state.nightHistory[0].witch).toMatchObject({
    usedHeal: true,
    healedTarget: null,
  });
});
```

Extend the existing `không tính một người chết hai lần khi vừa bị Sói cắn vừa trúng độc` test with:

```ts
expect(e.state.nightHistory[0].deaths).toEqual([
  {
    player: { id: target.id, name: target.name },
    cause: "wolf",
  },
]);
```

- [ ] **Step 3: Write failing privacy tests for the engine view**

```ts
it("ẩn toàn bộ lịch sử đêm trước GAME_OVER kể cả với người đã chết", () => {
  const e = makeEngine(7);
  e.resolveNight();
  const deadViewer = e.state.players[0];
  deadViewer.alive = false;

  expect(e.snapshotFor(e.state.players[1].id).nightHistory).toEqual([]);
  expect(e.snapshotFor(deadViewer.id).nightHistory).toEqual([]);
});

it("công khai toàn bộ lịch sử khi GAME_OVER", () => {
  const e = makeEngine(7);
  e.resolveNight();
  e.finishGame("village");

  expect(e.snapshotFor(e.state.players[0].id).nightHistory).toEqual(e.state.nightHistory);
});

it("chuẩn hóa state cũ chưa có nightHistory thành mảng rỗng", () => {
  const source = GameEngine.create(ids(7), CONFIG).getState();
  const legacy = { ...source, nightHistory: undefined } as unknown as GameState;

  expect(new GameEngine(legacy).state.nightHistory).toEqual([]);
});
```

- [ ] **Step 4: Run the focused tests and confirm RED**

Run:

```bash
npm test --workspace @masoi/game-engine -- -t "Lịch sử diễn biến ban đêm"
```

Expected: FAIL because `nightHistory` does not exist yet.

- [ ] **Step 5: Add engine state and view interfaces**

In `packages/game-engine/src/types.ts`, import `NightRecap` and add:

```ts
nightHistory: NightRecap[];
```

to `GameState`. In `PlayerGameView` in `engine.ts`, add:

```ts
nightHistory: NightRecap[];
```

Initialize it in `GameEngine.create()`:

```ts
nightHistory: [],
```

Normalize deserialized legacy state in the constructor before exposing it:

```ts
constructor(state: GameState) {
  this.state = state;
  this.state.nightHistory ??= [];
}
```

- [ ] **Step 6: Implement deterministic recap capture**

Import `NightRecap`/`RecapPlayer` from shared and `EnginePlayer` from `./types`, then add a private/local mapper that never returns stale player objects:

```ts
const recapPlayer = (player: EnginePlayer | undefined): RecapPlayer | null =>
  player ? { id: player.id, name: player.name } : null;
```

Near the end of `resolveNight()`, after `deaths` is final and before phase changes, construct and append:

```ts
const wolfTarget = recapPlayer(st.night.killTarget ? this.player(st.night.killTarget) : undefined);
const usedHeal = st.night.healTonight;
const recap: NightRecap = {
  round: st.round,
  wolfTarget,
  guardTarget: recapPlayer(st.night.guardTarget ? this.player(st.night.guardTarget) : undefined),
  seerChecks: Object.entries(st.night.seerResults).flatMap(([seerId, result]) => {
    const seer = recapPlayer(this.player(seerId));
    const target = recapPlayer(this.player(result.targetId));
    return seer && target ? [{ seer, target, isWolf: result.isWolf }] : [];
  }),
  witch: {
    usedHeal,
    healedTarget: usedHeal ? wolfTarget : null,
    poisonTarget: recapPlayer(st.night.poisonTarget ? this.player(st.night.poisonTarget) : undefined),
  },
  deaths: deaths.map((death) => ({
    player: { id: death.playerId, name: death.name },
    cause: death.cause,
  })),
};
st.nightHistory.push(recap);
```

Do not change existing death resolution. Return this field from `snapshotFor()` only at game over:

```ts
nightHistory: st.phase === "GAME_OVER" ? st.nightHistory : [],
```

- [ ] **Step 7: Update required GameState fixtures**

Add `nightHistory: []` beside `lastNightDeaths: []` in every listed `GameState` fixture. Do not make the production field optional just to avoid fixture changes.

- [ ] **Step 8: Run engine tests and workspace type checks**

Run:

```bash
npm test --workspace @masoi/game-engine
npm run build:shared
npm run build:engine
npm run lint --workspace @masoi/server
```

Expected: all commands exit 0.

- [ ] **Step 9: Commit**

```bash
git add packages/game-engine/src/types.ts packages/game-engine/src/engine.ts packages/game-engine/tests/engine.test.ts apps/server/tests/day-bot-scheduling.test.ts apps/server/tests/chat-visibility.test.ts apps/server/tests/discussion-skip-flow.test.ts apps/server/tests/discussion-skip-leave.test.ts apps/server/tests/discussion-skip-state.test.ts apps/server/tests/guard-previous-view.test.ts apps/server/tests/night-bot-scheduling.test.ts apps/server/tests/no-elimination-vote-snapshot.test.ts
git commit -m "feat: record complete night recap"
```

---

### Task 3: Expose recap through the server snapshot boundary

**Files:**
- Create: `apps/server/tests/night-recap-snapshot.test.ts`
- Modify: `apps/server/src/rooms/snapshot.ts`

**Interfaces:**
- Consumes: `PlayerGameView.nightHistory` already filtered by engine phase.
- Produces: `buildSnapshot(room, viewerId).nightHistory`, with `[]` for lobby/no engine.

- [ ] **Step 1: Write the failing server boundary tests**

Create a room helper whose engine state contains one known `NightRecap`. Test all three boundaries:

```ts
it("không gửi recap trong khi ván đang diễn ra", () => {
  const room = recapRoom("DAY_DISCUSSION");
  expect(buildSnapshot(room, "a").nightHistory).toEqual([]);
});

it("gửi toàn bộ recap khi ván kết thúc", () => {
  const room = recapRoom("GAME_OVER");
  expect(buildSnapshot(room, "a").nightHistory).toEqual([
    expect.objectContaining({ round: 1 }),
  ]);
});

it("snapshot phòng chờ có recap rỗng", () => {
  const room = recapRoom("GAME_OVER");
  room.status = "LOBBY";
  room.engine = null;
  expect(buildSnapshot(room, "a").nightHistory).toEqual([]);
});
```

The helper must include a complete valid `GameState` and this exact recap shape:

```ts
nightHistory: [{
  round: 1,
  wolfTarget: { id: "b", name: "Bình" },
  guardTarget: null,
  seerChecks: [],
  witch: { usedHeal: false, healedTarget: null, poisonTarget: null },
  deaths: [{ player: { id: "b", name: "Bình" }, cause: "wolf" }],
}],
```

- [ ] **Step 2: Run the focused server test and confirm RED**

Run:

```bash
npm test --workspace @masoi/server -- night-recap-snapshot.test.ts
```

Expected: the `GAME_OVER` assertion fails because `buildSnapshot()` still returns `[]` unconditionally.

- [ ] **Step 3: Pass the filtered engine value through**

Replace the temporary empty value in `buildSnapshot()` with:

```ts
nightHistory: gameView?.nightHistory ?? [],
```

Do not inspect `room.engine.state.nightHistory` directly; the engine view is the privacy boundary.

- [ ] **Step 4: Run server and engine regression tests**

Run:

```bash
npm test --workspace @masoi/server
npm test --workspace @masoi/game-engine
```

Expected: both suites pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/rooms/snapshot.ts apps/server/tests/night-recap-snapshot.test.ts
git commit -m "feat: expose night recap at game over"
```

---

### Task 4: Render the end-game night timeline

**Files:**
- Create: `apps/web/src/components/NightRecapTimeline.tsx`
- Modify: `apps/web/src/components/DayViews.tsx`

**Interfaces:**
- Consumes: `NightRecap[]` from `@masoi/shared`.
- Produces: `NightRecapTimeline({ nights }: { nights: NightRecap[] })` React component.

- [ ] **Step 1: Create the focused presentation component**

Implement `NightRecapTimeline.tsx` as a server-safe/pure component with no state and no socket calls:

```tsx
import type { NightRecap } from "@masoi/shared";

const causeLabel = (cause: "wolf" | "poison") =>
  cause === "wolf" ? "bị Sói cắn" : "trúng độc của Phù Thủy";

export function NightRecapTimeline({ nights }: { nights: NightRecap[] }) {
  return (
    <div className="card">
      <h3 className="mb-3 font-semibold text-white">Diễn biến các đêm</h3>
      {nights.length === 0 ? (
        <p className="text-sm text-mist/60">
          Ván đấu kết thúc trước khi có diễn biến ban đêm.
        </p>
      ) : (
        <div className="space-y-3">
          {nights.map((night) => (
            <section key={night.round} className="rounded-lg bg-night-800 px-3 py-3 text-sm">
              <h4 className="mb-2 font-bold text-moon-300">Đêm {night.round}</h4>
              <ul className="space-y-1 text-mist/80">
                <li>🐺 {night.wolfTarget ? `Sói chọn cắn ${night.wolfTarget.name}.` : "Sói không chọn được mục tiêu."}</li>
                <li>🛡️ {night.guardTarget ? `Bảo Vệ bảo vệ ${night.guardTarget.name}.` : "Bảo Vệ không hành động."}</li>
                {night.seerChecks.length > 0 ? night.seerChecks.map((check) => (
                  <li key={`${check.seer.id}-${check.target.id}`}>
                    🔮 Tiên Tri {check.seer.name} soi {check.target.name}: {check.isWolf ? "Ma Sói" : "Không phải Ma Sói"}.
                  </li>
                )) : <li>🔮 Tiên Tri không hành động.</li>}
                <li>🧪 {night.witch.usedHeal
                  ? night.witch.healedTarget
                    ? `Phù Thủy dùng bình cứu cho ${night.witch.healedTarget.name}.`
                    : "Phù Thủy đã dùng bình cứu nhưng không có nạn nhân để cứu."
                  : "Phù Thủy không dùng bình cứu."}</li>
                <li>☠️ {night.witch.poisonTarget
                  ? `Phù Thủy đầu độc ${night.witch.poisonTarget.name}.`
                  : "Phù Thủy không dùng bình độc."}</li>
              </ul>
              <p className={`mt-2 font-semibold ${night.deaths.length > 0 ? "text-blood-400" : "text-emerald-300"}`}>
                {night.deaths.length > 0
                  ? `Kết quả: ${night.deaths.map(({ player, cause }) => `${player.name} (${causeLabel(cause)})`).join(", ")}.`
                  : "Kết quả: Không ai chết trong đêm này."}
              </p>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Attach it only to GameOverView**

Import the component in `DayViews.tsx`:

```ts
import { NightRecapTimeline } from "./NightRecapTimeline";
```

Render it after the role-reveal card and before the action buttons:

```tsx
<NightRecapTimeline nights={snapshot.nightHistory} />
```

Do not add it to `DayView`, `EliminationView`, or any non-game-over phase.

- [ ] **Step 3: Run web type checking and production build**

Run:

```bash
npm run lint --workspace @masoi/web
npm run build:web
```

Expected: TypeScript and Next.js production build both exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/NightRecapTimeline.tsx apps/web/src/components/DayViews.tsx
git commit -m "feat: show night timeline at game over"
```

---

### Task 5: Full regression verification

**Files:**
- Verify only; modify a file only if a failing check identifies a defect within this feature's scope.

**Interfaces:**
- Consumes: completed shared, engine, server, and web changes.
- Produces: verified release candidate with no uncommitted changes.

- [ ] **Step 1: Run all automated tests**

```bash
npm test --workspace @masoi/game-engine
npm test --workspace @masoi/server
```

Expected: all Vitest suites pass with zero failures.

- [ ] **Step 2: Run monorepo lint/type checks**

```bash
npm run lint
```

Expected: web and server TypeScript checks exit 0.

- [ ] **Step 3: Run the full production build**

```bash
npm run build
```

Expected: shared, game engine, server and Next.js web builds all exit 0.

- [ ] **Step 4: Inspect the final diff and repository state**

```bash
git diff --check
git status --short --branch
git log -5 --oneline
```

Expected: `git diff --check` prints nothing; branch is `main`; all feature files are committed. Do not push until the user has authorized publishing the completed commits.
