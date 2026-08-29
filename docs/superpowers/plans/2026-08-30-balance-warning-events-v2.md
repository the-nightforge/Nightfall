# Balance Warning & Events v2 (15 Events) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Triển khai cảnh báo cân bằng lobby (BalanceScore 0–100 + blocking) và migrate hệ thống Event 9→15 với 2 state xuyên round (LAST_STAND, BLOOD_MOON) theo spec v2.

**Architecture:** Tạo `shared/balance.ts` + `game-engine/balance/analyzer.ts` làm nguồn sự thật duy nhất cho cả warning và momentum; `eventManager.ts` rewrite 15 defs + pending flags trong `GameState`; server `snapshot.ts/service.ts` expose và validate; web `RoleDeckPanel` hiển thị meter/banner.

**Tech Stack:** TypeScript, Vitest, Next.js, Tailwind, Socket.IO, Prisma (không đổi).

**Spec:** `docs/superpowers/specs/2026-08-30-balance-warning-events-v2-design.md`

## Global Constraints

- Migrate cứng SHROUDED_ECLIPSE → WOLF_SHADOW (xóa hoàn toàn, không backward compat).
- BalanceScore clamp 0..100, blocking khi <40 hoặc >60 hoặc |wolfRatio - preset| >0.15 hoặc info lệch ≥3, chỉ chặn ở mode RANKED.
- Event Ranked chỉ khi |Momentum| ≥0.35, power≥4 ≤1 lần/ván, total ≤3/ván, AMNESTY/MORNING_REPORT không liên tiếp; Chaos rng<0.6 random 1/15.
- LAST_STAND victim sống tới hết ngày sau, BLOOD_MOON 20% xuyên shield đêm sau, BLOODY_HUNT không stack với wolfCubRage, 1 lần/ván.

---

### Task 1: Balance Analyzer Shared + Engine

**Files:**
- Create: `packages/shared/src/balance.ts`
- Create: `packages/game-engine/src/balance/presets.ts`
- Create: `packages/game-engine/src/balance/analyzer.ts`
- Modify: `packages/shared/src/snapshot.ts` (thêm `BalanceWarningView`)
- Test: `packages/game-engine/tests/balance.test.ts`

**Interfaces:**
- Consumes: `ROLE_META` power table, `RoomConfig`, `GameState`.
- Produces:
  - `export const ROLE_POWER: Record<Role, number>` (WEREWOLF 5.0 ... VILLAGER 0.5)
  - `export function calculateFactionPower(players: EnginePlayer[]): number`
  - `export function calculateBalanceScore(config: RoomConfig, playerCount: number): {score: number, villagePower: number, wolfPower: number}`
  - `export function generateWarnings(config: RoomConfig, playerCount: number): {warnings: string[], blocking: boolean, score: number}`
  - `export const PRESET_DECKS: Record<number, RoomConfig>` (6–15)

- [ ] **Step 1: Write failing test**

```ts
// packages/game-engine/tests/balance.test.ts
import { describe, it, expect } from "vitest";
import { calculateBalanceScore, generateWarnings } from "../src/balance/analyzer";
import { PRESET_DECKS } from "../src/balance/presets";
describe("balance", () => {
  it("preset 6 balanced 45-55", () => {
    const r = calculateBalanceScore(PRESET_DECKS[6], 6);
    expect(r.score).toBeGreaterThanOrEqual(45); expect(r.score).toBeLessThanOrEqual(55);
  });
  it("blocking when too many wolves", () => {
    const w = generateWarnings({ ...PRESET_DECKS[8], werewolves: 4 } as any, 8);
    expect(w.blocking).toBe(true); expect(w.warnings.length).toBeGreaterThan(0);
  });
  it("warning when score out of 40-60", () => {
    const w = generateWarnings({ werewolves: 1, seer: false, guard: false, witch: false, hunter: false, cursed: false, wolfCub: false, apprenticeSeer: false, detective: false, guardianAngel: false, priest: false, mayor: false } as any, 8);
    expect(w.blocking).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/game-engine/tests/balance.test.ts`
Expected: FAIL with "cannot find module"

- [ ] **Step 3: Write minimal implementation**

Create `packages/shared/src/balance.ts`:
```ts
export const ROLE_POWER: Record<string, number> = { WEREWOLF:5, WOLF_CUB:4, SEER:5, APPRENTICE_SEER:2.5, DETECTIVE:4, GUARD:4, GUARDIAN_ANGEL:3, PRIEST:2.5, WITCH:5, HUNTER:3, MAYOR:2, CURSED:3, VILLAGER:0.5 };
export interface BalanceWarningView { score:number; warnings:string[]; blocking:boolean; villagePower:number; wolfPower:number}
```
Create `packages/game-engine/src/balance/presets.ts` với 10 preset object đúng spec §4 (werewolves, seer, guard...).
Create `packages/game-engine/src/balance/analyzer.ts` implement công thức spec §3.1, dùng ROLE_POWER, so sánh với preset, generate warnings, clamp score.

Modify `packages/shared/src/snapshot.ts` thêm:
```ts
export interface BalanceWarningView { score:number; warnings:string[]; blocking:boolean; villagePower:number; wolfPower:number}
```
và trong `RoomSnapshot` thêm `balanceWarning?: BalanceWarningView | null`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/game-engine/tests/balance.test.ts`
Expected: PASS 3 tests

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/balance.ts packages/game-engine/src/balance/ packages/shared/src/snapshot.ts packages/game-engine/tests/balance.test.ts
git commit -m "feat(balance): add analyzer, presets and BalanceWarningView"
```

---

### Task 2: Event System Migrate 9→15 + Pending State

**Files:**
- Modify: `packages/shared/src/events.ts`
- Modify: `packages/shared/src/snapshot.ts` (activeEvent union mở rộng)
- Modify: `packages/game-engine/src/types.ts`
- Modify: `packages/game-engine/src/engine.ts`
- Modify: `packages/game-engine/src/events/eventManager.ts`
- Modify: `packages/game-engine/src/events/momentum.ts` (dùng analyzer)
- Test: `packages/game-engine/tests/events.test.ts` (mở rộng 15 cases)

**Interfaces:**
- Consumes: `RoomSnapshot`, `GameState`, `calculateBalanceScore` từ Task1.
- Produces:
  - `GameEventId` 15 giá trị (xóa SHROUDED_ECLIPSE)
  - `GameState.pendingLastStandVictim: {playerId:string, dieRound:number}|null`
  - `GameState.bloodMoonArmed: boolean, bloodMoonUsed: boolean, deadCanSpeakUsed: boolean, howlBonusDay: number|null, dayOfTruthClaims: Record<string,string|null>`

- [ ] **Step 1: Write failing test**

```ts
// events.test.ts thêm
it("LAST_STAND victim sống qua ngày sau", () => {
  const state = createTestState([...wolf, villager]);
  state.activeEvent = {id:"LAST_STAND"} as any;
  engine.submitNightAction("wolf1","KILL","villager");
  const deaths = engine.resolveNight(); // không chết ngay
  expect(deaths.length).toBe(0);
  expect(engine.state.pendingLastStandVictim?.playerId).toBe("villager");
  engine.setPhase("DAY_DISCUSSION",30000); engine.setPhase("NIGHT",30000);
  expect(engine.player("villager")?.alive).toBe(false);
});
it("WOLF_SHADOW 30% đảo phe", () => {
  const e = makeEngineWithEvent("WOLF_SHADOW");
  e.submitNightAction("seer","SEE", wolf.id);
  // mock rng 0.1 <0.3 nên đảo
  expect(e.snapshotFor("seer").nightInfo?.seerResult?.isWolf).toBe(!trueIsWolf);
});
it("BLOOD_MOON arm khi 0 death, đêm sau 20% xuyên shield", () => {...});
it("migrate cứng xóa SHROUDED", () => { expect(GAME_EVENTS["SHROUDED_ECLIPSE"]).toBeUndefined(); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/game-engine/tests/events.test.ts`
Expected: FAIL 4 new tests

- [ ] **Step 3: Write minimal implementation**

`packages/shared/src/events.ts`:
```ts
export type GameEventId = "CURFEW"|"SILENT_NIGHT"|"AMNESTY_DAY"|"CLEARING_MIST"|"PEACEFUL_NIGHT"|"JUDGMENT_DAY"|"LAST_STAND"|"DAY_OF_TRUTH"|"MOONLESS_NIGHT"|"BLOODY_HUNT"|"HOWL_OF_THE_PACK"|"BLOOD_MOON"|"WOLF_SHADOW"|"MORNING_REPORT"|"DEAD_CAN_SPEAK";
```

`packages/game-engine/src/types.ts` thêm 5 field trong `GameState`.

`packages/game-engine/src/engine.ts`:
- `emptyNight`: giữ `pendingLastStandVictim` qua round
- `resolveNight`: nếu `LAST_STAND` active và có victim sói cắn → không `addDeath` mà set `pendingLastStandVictim`; ở `setPhase NIGHT` kế tiếp check `pendingLastStandVictim.dieRound <= currentRound` thì kill
- `BLOOD_MOON`: nếu đêm hiện tại `wolfDeaths===0` arm flag; đêm sau trong shield check `if (bloodMoonArmed && rng<0.2) guardedIds.delete(firstShield)`
- `WOLF_SHADOW`: trong `submitNightAction SEE` nếu active `WOLF_SHADOW` và `rng()<0.3` thì đảo `isWolf`
- `HOWL_OF_THE_PACK`: trong `voteTally` nếu `howlBonusDay===round` thì `+1` hidden vào phe sói (cộng vào max wolf target count)
- `MORNING_REPORT`/`DEAD_CAN_SPEAK` set announcement vào `activeEvent`

`eventManager.ts` rewrite 15 defs, xóa SHROUDED, thêm logic `AMNESTY` không liên tiếp, `BLOOD_MOON` chỉ khi chưa used.

`momentum.ts` import `calculateBalanceScore` để đồng bộ.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/game-engine/tests/events.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/events.ts packages/shared/src/snapshot.ts packages/game-engine/src/types.ts packages/game-engine/src/engine.ts packages/game-engine/src/events/ packages/game-engine/tests/events.test.ts
git commit -m "feat(events): migrate 9->15, add LAST_STAND/BLOOD_MOON/WOLF_SHADOW state"
```

---

### Task 3: Server Snapshot & Validation

**Files:**
- Modify: `apps/server/src/rooms/snapshot.ts`
- Modify: `apps/server/src/rooms/service.ts`
- Modify: `apps/server/src/bots/context.ts` (expose activeEvent)
- Test: `apps/server/tests/balance-warning.test.ts` (new)

**Interfaces:**
- Consumes: `generateWarnings`, `GameState.pending*` từ Task1/2
- Produces:
  - `buildSnapshot(room, viewerId)` include `snapshot.balanceWarning`
  - `roomService.start` throws `BALANCE_UNSTABLE` if blocking && mode===RANKED

- [ ] **Step 1: Write failing test**

```ts
// apps/server/tests/balance-warning.test.ts
import { generateWarnings } from "@masoi/game-engine/src/balance/analyzer";
it("block start khi unbalanced RANKED", async () => {
  const room = createTestRoom({mode:"ranked", werewolves:4, playerCount:6});
  await expect(roomService.start(room.code)).rejects.toThrow(/BALANCE_UNSTABLE/);
});
it("cho start khi CHAOS dù unbalanced", async () => {
  const room = createTestRoom({mode:"chaos", werewolves:4, playerCount:6});
  await expect(roomService.start(room.code)).resolves.not.toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/server/tests/balance-warning.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

`snapshot.ts`: sau khi `engine.snapshotFor`, gán `snap.balanceWarning = generateWarnings(room.config, room.members.length)`.

`service.ts`: trong `updateConfig` và `start`, gọi `generateWarnings`; nếu `blocking && config.mode==="ranked"` throw `new GameError("BALANCE_UNSTABLE: "+warnings.join("; "))`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/server/tests/balance-warning.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/rooms/snapshot.ts apps/server/src/rooms/service.ts apps/server/tests/balance-warning.test.ts
git commit -m "feat(server): expose balanceWarning and block unbalanced Ranked start"
```

---

### Task 4: Web Balance Meter & Warning Banner

**Files:**
- Modify: `apps/web/src/components/RoleDeckPanel.tsx`
- Create: `apps/web/src/components/BalanceMeter.tsx`
- Modify: `apps/web/src/lib/balance.ts` (preview wrapper)
- Test: `apps/web/src/components/BalanceMeter.test.tsx` (optional vitest)

**Interfaces:**
- Consumes: `BalanceWarningView` từ snapshot, `PRESET_DECKS`
- Produces:
  - `<BalanceMeter score={number} />` thanh gradient đỏ-xanh, needle
  - `<WarningBanner warnings, blocking, onApplyPreset>` 

- [ ] **Step 1: Write failing test (manual)**

Render `RoleDeckPanel` với config unbalanced → expect banner đỏ và button "Áp dụng preset" hiển thị.

- [ ] **Step 2: Run test (vitest web)**

Run: `npx vitest run apps/web/tests/balance-meter.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

`RoleDeckPanel.tsx`: computed `balance = snapshot.balanceWarning ?? clientPreview`; render `<BalanceMeter score={balance.score}/>` trên đầu, `<WarningBanner warnings={balance.warnings} blocking={balance.blocking} onApply={()=> emit("room:update-config", PRESET_DECKS[count])}>`. Disable nút Bắt đầu khi `blocking && mode==="ranked"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/web/tests/balance-meter.test.ts` + `npm run build --workspace @masoi/web`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/RoleDeckPanel.tsx apps/web/src/components/BalanceMeter.tsx apps/web/src/lib/balance.ts
git commit -m "feat(web): add BalanceMeter and blocking warning banner"
```

---

### Task 5: Web Event UI for 6 New Events

**Files:**
- Modify: `apps/web/src/components/EventBanner.tsx`
- Modify: `apps/web/src/components/NightPanel.tsx`
- Modify: `apps/web/src/components/DayViews.tsx`
- Create: `apps/web/src/components/DayOfTruthModal.tsx`

**Interfaces:**
- Consumes: `activeEvent` 15 ids, `pendingLastStandVictim`, `dayOfTruthClaims`

- [ ] **Step 1: Write failing test**

Vẽ `EventBanner` với `LAST_STAND` → expect badge "Tử Thủ", `DAY_OF_TRUTH` modal render.

- [ ] **Step 2: Run test**

Run: `npx vitest run apps/web/src/components/EventBanner.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

`EventBanner.tsx`: mở rộng `ICON_MAP` 15, render `announcement` cho `MORNING_REPORT`/`DEAD_CAN_SPEAK`.

`NightPanel.tsx`: badge `LAST_STAND` trên victim, `WOLF_SHADOW` note 30% đảo.

`DayViews.tsx`: nếu `activeEvent.id==="LAST_STAND"` hiện countdown; nếu `DAY_OF_TRUTH` hiện `DayOfTruthModal` cho mỗi player chọn claim; `MORNING_REPORT` auto-append chat; `DEAD_CAN_SPEAK` input 120 char ẩn danh.

- [ ] **Step 4: Run test**

Run: `npm run build --workspace @masoi/web`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/EventBanner.tsx apps/web/src/components/DayViews.tsx apps/web/src/components/NightPanel.tsx apps/web/src/components/DayOfTruthModal.tsx
git commit -m "feat(web): handle 6 new events UI (LAST_STAND, BLOOD_MOON, etc)"
```

---

### Task 6: Verification & Fixtures

**Files:**
- Modify: `docs/fixtures/selfplay-sample.json` (regenerate)
- Test: full suite

- [ ] **Step 1: Regenerate fixture**

Run: `npx tsx -e "import {buildReport, runBatch} from './packages/game-engine/src/bot/evaluation/report.ts'; ..."`
Expected: file updated

- [ ] **Step 2: Run full suite**

Run: `npm test` + `npm run build`
Expected: PASS all 601+263+98

- [ ] **Step 3: Commit**

```bash
git add docs/fixtures/selfplay-sample.json
git commit -m "chore: regenerate selfplay fixture after balance/events v2"
```

