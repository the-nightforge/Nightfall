# Implementation Plan: Extended Roles & Dynamic Balance Events

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mở rộng hệ thống game Ma Sói Online với 5 role mới (`WOLF_CUB`, `APPRENTICE_SEER`, `DETECTIVE`, `GUARDIAN_ANGEL`, `PRIEST`, `MAYOR`) và Hệ thống Sự Kiện Cân Bằng Động (Dynamic Balance Events & Momentum Engine) hỗ trợ 2 chế độ Ranked / Chaos từ 6–15 người chơi.

**Architecture:** Mở rộng schema chia sẻ trong `@masoi/shared` (roles, events, snapshot views), cài đặt state machine, night deterministic resolution pipeline và Momentum engine trong `@masoi/game-engine`, cập nhật bot logic / sockets trong `apps/server`, và tích hợp Deck builder, Night actions UI, Event Banners trong `apps/web`.

**Tech Stack:** TypeScript, Node.js, Vitest, React, Next.js, Tailwind CSS, Socket.IO.

**Spec:** `docs/superpowers/specs/2026-08-29-roles-and-events-balance-design.md`

## Global Constraints
- Preserve exact TypeScript type safety across `@masoi/shared`, `@masoi/game-engine`, `apps/server`, and `apps/web`.
- Night resolution must remain strictly deterministic according to the spec order (Shields -> Info -> Offensive -> Witch -> Impact/Conversion -> Post-Night Triggers).
- Maintain backwards compatibility for existing unit tests in `packages/game-engine` and `apps/server`.
- Event system must support both `Ranked` mode (anti-snowball threshold $|\text{Momentum}| \ge 0.35$) and `Chaos` mode (per-round random selection).

---

### Task 1: Extend Shared Models & Types (`@masoi/shared`)

**Files:**
- Modify: `packages/shared/src/roles.ts`
- Modify: `packages/shared/src/phases.ts`
- Modify: `packages/shared/src/events.ts`
- Modify: `packages/shared/src/snapshot.ts`
- Modify: `packages/shared/src/schemas.ts`

**Interfaces:**
- Consumes: Existing role and snapshot types.
- Produces:
  - `ROLES`: Extended with `WOLF_CUB`, `APPRENTICE_SEER`, `DETECTIVE`, `GUARDIAN_ANGEL`, `PRIEST`, `MAYOR`.
  - `ROLE_META`: Extended with nightOrder, descriptions, and teams.
  - `GameEventId`, `GameEventView`, `RoomMode` ("ranked" | "chaos").
  - Extended `NightActionView` (detectiveResult, guardianCharges, holyWaterUsed, activeEvent, etc.).

- [ ] **Step 1: Write test for shared definitions**

```typescript
// packages/shared/tests/roles.test.ts
import { describe, it, expect } from "vitest";
import { ROLES, ROLE_META, roleTeam } from "../src/roles";

describe("Shared Roles", () => {
  it("includes all 12 roles with valid meta", () => {
    const expected = [
      "WEREWOLF", "WOLF_CUB", "SEER", "APPRENTICE_SEER", "DETECTIVE",
      "GUARD", "GUARDIAN_ANGEL", "PRIEST", "WITCH", "HUNTER", "MAYOR", "CURSED", "VILLAGER"
    ];
    for (const r of expected) {
      expect(ROLES).toContain(r);
      expect(ROLE_META[r as any]).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --prefix packages/shared` or `npx vitest packages/shared`
Expected: FAIL

- [ ] **Step 3: Update shared types and constants**

Update `packages/shared/src/roles.ts`, `events.ts`, `snapshot.ts`, `phases.ts`, `schemas.ts` with new roles and event models.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest packages/shared`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/
git commit -m "feat(shared): add extended roles and dynamic event schemas"
```

---

### Task 2: Core Game Engine State & Night Actions (`@masoi/game-engine`)

**Files:**
- Modify: `packages/game-engine/src/types.ts`
- Modify: `packages/game-engine/src/assignRoles.ts`
- Modify: `packages/game-engine/src/engine.ts`
- Test: `packages/game-engine/tests/roles-actions.test.ts`

**Interfaces:**
- Consumes: `@masoi/shared` roles and night actions.
- Produces:
  - `submitNightAction` handling for `DETECTIVE` (2 targets), `GUARDIAN_ANGEL` (shield), `PRIEST` (holy water).
  - Apprentice Seer awakening mechanics upon Seer death.
  - Wolf Cub double-kill target queuing upon death.
  - Mayor x2 day vote multiplier.

- [ ] **Step 1: Write failing unit tests for new roles actions and triggers**

Test `Detective` matching, `Priest` holy water kill/backfire, `Guardian Angel` 2-use charge constraint, `Wolf Cub` rage double kill, `Apprentice Seer` awakening, and `Mayor` x2 vote weight.

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest packages/game-engine/tests/roles-actions.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement new roles logic in `engine.ts` & `assignRoles.ts`**

Update `resolveNight()`, `submitNightAction()`, `tallyVotes()`, and deck builder presets.

- [ ] **Step 4: Run tests to verify PASS**

Run: `npx vitest packages/game-engine/tests/roles-actions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/
git commit -m "feat(game-engine): implement extended roles mechanics and deck presets"
```

---

### Task 3: Momentum Calculation & Dynamic Event Resolver (`@masoi/game-engine`)

**Files:**
- Create: `packages/game-engine/src/events/momentum.ts`
- Create: `packages/game-engine/src/events/eventManager.ts`
- Modify: `packages/game-engine/src/engine.ts`
- Test: `packages/game-engine/tests/events.test.ts`

**Interfaces:**
- Consumes: `GameState` from `packages/game-engine/src/types.ts`.
- Produces:
  - `calculateMomentum(state: GameState): number`
  - `selectEvent(state: GameState, mode: RoomMode): GameEvent | null`
  - Event modifiers applied to `DAY_DISCUSSION` duration, `NIGHT` chat silencing, `SEER`/`DETECTIVE` result modifiers, and kill count modifiers.

- [ ] **Step 1: Write unit tests for Momentum Score & Event triggers**

Test calculations for village-favored / wolf-favored states and verification of event modifiers (Curfew, Silent Night, Amnesty Day, Peaceful Night, etc.).

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest packages/game-engine/tests/events.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `momentum.ts`, `eventManager.ts` and integrate into `engine.ts`**

Calculate momentum score at phase transitions (`startDay`, `startNight`) and activate appropriate events based on room mode.

- [ ] **Step 4: Run tests to verify PASS**

Run: `npx vitest packages/game-engine/tests/events.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/
git commit -m "feat(game-engine): implement momentum analyzer and event resolver"
```

---

### Task 4: Server State Machine & Bot AI Upgrades (`apps/server`)

**Files:**
- Modify: `apps/server/src/game/machine.ts`
- Modify: `apps/server/src/ws.ts`
- Modify: `apps/server/src/bots/decide.ts`
- Modify: `apps/server/src/bots/targets.ts`
- Modify: `apps/server/src/bots/prompt.ts`
- Test: `apps/server/tests/extended-roles-flow.test.ts`

**Interfaces:**
- Consumes: Updated engine methods and snapshots.
- Produces:
  - WebSocket event handlers for new night actions.
  - Timer overrides for `CURFEW` and phase skipping for `AMNESTY_DAY`.
  - Bot AI intelligence for Detective, Guardian Angel, Priest, Mayor, and Wolf Cub.

- [ ] **Step 1: Write integration tests for server room flow with extended roles and events**

- [ ] **Step 2: Run integration tests to verify failure**

Run: `npx vitest apps/server/tests/extended-roles-flow.test.ts`
Expected: FAIL

- [ ] **Step 3: Update server state machine, socket handlers, and bot decision engine**

- [ ] **Step 4: Run tests to verify PASS**

Run: `npx vitest apps/server/tests/extended-roles-flow.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/
git commit -m "feat(server): update state machine, websockets, and bot AI for extended roles"
```

---

### Task 5: Web UI Integration (Deck Builder, Role Views & Event Banners) (`apps/web`)

**Files:**
- Modify: `apps/web/src/lib/role-art.ts`
- Modify: `apps/web/src/components/RoleViews.tsx`
- Modify: `apps/web/src/components/RoleDeckPanel.tsx`
- Modify: `apps/web/src/components/NightPanel.tsx`
- Create: `apps/web/src/components/EventBanner.tsx`
- Modify: `apps/web/src/components/GameRoom.tsx`

**Interfaces:**
- Consumes: Extended `RoomSnapshot` and `NightActionView`.
- Produces:
  - SVGs & Artwork for all new roles.
  - Toggle selectors & Balance indicator in Lobby.
  - Night UI for Detective (2-target select), Guardian Angel (charges display), Priest (holy water bottle).
  - Prominent Event Announcement Banners at Day/Night transitions.

- [ ] **Step 1: Write unit tests for Web role view helpers and deck config**

- [ ] **Step 2: Implement UI components and integrate into `GameRoom.tsx` & `NightPanel.tsx`**

- [ ] **Step 3: Run web tests and verify clean build**

Run: `npm run build --prefix apps/web`
Expected: Build successfully without TypeScript/Lint errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/
git commit -m "feat(web): add UI for extended roles, deck builder presets, and event banners"
```

---

### Task 6: Full System Verification & End-to-End Testing

**Files:**
- Test all test suites across `packages/game-engine`, `apps/server`, and `apps/web`.

- [ ] **Step 1: Run complete repo test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 2: Run complete repo build**

Run: `npm run build`
Expected: Clean compilation across all packages.

- [ ] **Step 3: Commit final integration updates**

```bash
git add .
git commit -m "chore: complete extended roles and dynamic events balance implementation"
```
