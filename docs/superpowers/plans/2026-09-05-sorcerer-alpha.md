# Sorcerer + Alpha (xóa cứng Medium + Priest) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xóa cứng MEDIUM + PRIEST khỏi codebase, thêm SORCERER + ALPHA_WOLF phe Sói, đổi preset 17–20, toàn repo test + build xanh.

**Architecture:** Shared trước (roles → config/schema → snapshot/balance), engine sau (xóa rồi thêm), bot + web + server cuối, đo số ROLE_POWER chốt hạ. Mỗi task ra phần mềm chạy được và test được độc lập.

**Tech Stack:** TypeScript, Vitest, Zod, Next.js (web), game-engine thuần.

**Spec:** `docs/superpowers/specs/2026-09-05-sorcerer-alpha-design.md` — executor đọc cả hai.

## Global Constraints

- Xóa cứng theo yêu cầu user: không giữ deprecated, không migrate DB; ván cũ đọc qua `isRole` fallback + guard VILLAGER.
- Giữ enum `cause` `"priest" | "priest_backfire"` cho lịch sử cũ.
- Đo số bằng `role-power.ts`, speech BẬT, ≥600 ván/ô trước khi chốt `ROLE_POWER`.
- Mỗi preset lớn thêm đúng 1 sói mới (17–18: medium→sorcerer + priest trả về Dân; 19–20: priest→alpha + medium trả về Dân).
- TDD mọi task: failing test → implement tối thiểu → pass → commit.

---

### Task 1: shared `roles.ts` — đổi danh mục vai

**Files:**
- Modify: `packages/shared/src/roles.ts`
- Test: `packages/shared/tests/roles.test.ts`

**Interfaces:**
- Consumes: không có (task đầu).
- Produces: `Role` mới gồm `"SORCERER" | "ALPHA_WOLF"`, không còn `"MEDIUM" | "PRIEST"`; `isWolfPack(r)` true với `WEREWOLF | WOLF_CUB | SORCERER | ALPHA_WOLF`; `ROLE_ORDER_FOR_NIGHT` chứa SORCERER (nightOrder 1) và ALPHA_WOLF (nightOrder 2).

- [ ] **Step 1: Cập nhật test vai trò (đỏ trước)**

```ts
// packages/shared/tests/roles.test.ts — sửa danh sách expected: bỏ "PRIEST",
// thay "MEDIUM" bằng "SORCERER" và "ALPHA_WOLF"; sửa team asserts:
// expect(roleTeam("SORCERER")).toBe("wolves");
// expect(roleTeam("ALPHA_WOLF")).toBe("wolves");
// expect(ROLE_META.SORCERER.nightOrder).toBe(1);
// ROLE_ORDER_FOR_NIGHT mới: ["GUARD","GUARDIAN_ANGEL","SEER","APPRENTICE_SEER",
//  "SORCERER","DETECTIVE","WEREWOLF","WOLF_CUB","ALPHA_WOLF","SERIAL_KILLER","WITCH"]
// (WITCH 3; SORCERER 1 chen trước DETECTIVE 1.5; ALPHA_WOLF 2 cùng nhóm bầy,
//  đứng sau WOLF_CUB theo thứ tự đọc đêm).
```

Run: `npx vitest run packages/shared/tests/roles.test.ts` từ repo root. Expected: FAIL (roles mới chưa tồn tại).

- [ ] **Step 2: Sửa `roles.ts`**

```ts
// ROLES: xóa "PRIEST" và "MEDIUM", thêm "SORCERER" và "ALPHA_WOLF".
// ROLE_META: xóa khối PRIEST + MEDIUM; thêm:
SORCERER: {
  id: "SORCERER",
  name: "Sói Pháp Sư",
  description: "Mỗi đêm soi một người còn sống để biết họ có thuộc dòng Tiên Tri (Tiên Tri, Tiên Tri Tập Sự) không.",
  team: "wolves",
  nightOrder: 1,
},
ALPHA_WOLF: {
  id: "ALPHA_WOLF",
  name: "Sói Alpha",
  description: "Cắn cùng bầy mỗi đêm. Lần bị Tiên Tri soi đầu tiên hiện ra là Dân, từ lần sau hiện nguyên hình.",
  team: "wolves",
  nightOrder: 2,
},
// isWolfPack:
export function isWolfPack(role: Role): boolean {
  return role === "WEREWOLF" || role === "WOLF_CUB" || role === "SORCERER" || role === "ALPHA_WOLF";
}
```

- [ ] **Step 3: Chạy test**

Run: `npx vitest run packages/shared/tests/roles.test.ts`. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/roles.ts packages/shared/tests/roles.test.ts
git commit -m "feat(roles): xoa MEDIUM+PRIEST, them SORCERER+ALPHA_WOLF"
```

---

### Task 2: shared config + schema — RoomConfig và zod

**Files:**
- Modify: `packages/shared/src/phases.ts`
- Modify: `packages/shared/src/schemas.ts`

**Interfaces:**
- Consumes: `Role` từ Task 1.
- Produces: `RoomConfig` có `sorcerer?: boolean; alphaWolf?: boolean`, không còn `priest?/medium?`; `nightActionTypeSchema` có `"SORCERER_CHECK"`, không còn `"HOLY_WATER"`; `validateRoomConfig` đếm `wolfCount = werewolves + wolfCub + alphaWolf`.

- [ ] **Step 1: Viết test schema (đỏ trước)**

```ts
// Thêm vào packages/shared/tests/roles.test.ts (describe mới) hoặc file
// packages/shared/tests/room-config.test.ts:
import { roomConfigSchema, validateRoomConfig } from "../src/schemas";
import { DEFAULT_ROOM_CONFIG } from "../src/phases";
// parseThrows với { ...DEFAULT_ROOM_CONFIG, priest: true } (strict object còn
// field lạ? .strict() ném với key không khai báo) và { medium: true };
// parse OK với { ...DEFAULT_ROOM_CONFIG, sorcerer: true, alphaWolf: true };
// gameActionPayload.parse({ type: "SORCERER_CHECK", targetId: "p1" }) OK;
// gameActionPayload.parse({ type: "HOLY_WATER", targetId: "p1" }) THROW.
```

Run: `npx vitest run packages/shared/tests/room-config.test.ts`. Expected: FAIL.

- [ ] **Step 2: Sửa `phases.ts` và `schemas.ts`**

```ts
// phases.ts: xóa `priest?: boolean;` và `medium?: boolean;`, thêm:
// /** Sói Pháp Sư. Optional như mọi vai thêm sau. */
// sorcerer?: boolean;
// /** Sói Alpha. Cắn được nên vào wolfCount (xem validateRoomConfig). */
// alphaWolf?: boolean;
// schemas.ts roomConfigSchema: xóa `priest: bool.optional(),` và
// `medium: bool.optional(),`, thêm `sorcerer: bool.optional(),` và
// `alphaWolf: bool.optional(),`.
// nightActionTypeSchema: xóa "HOLY_WATER", thêm "SORCERER_CHECK".
// validateRoomConfig: xóa `(config.priest ? 1 : 0) + (config.medium ? 1 : 0)`,
// thêm `(config.sorcerer ? 1 : 0) +` vào specials? KHÔNG — sorcerer/alpha là
// SÓI: alphaWolf vào wolfCount, sorcerer vào wolfCount? Sorcerer không cắn
// nhưng thắng cùng bầy và biết mặt bầy: theo luật "Sói ít hơn làng" của
// validate (mô hình sát thương đêm) thì sorcerer KHÔNG cắn → theo cặp với
// TRAITOR: chiếm ghế (traitorSeats pattern) nhưng không vào wolfCount.
// Cụ thể:
// const wolfCount = config.werewolves + (config.wolfCub ? 1 : 0) + (config.alphaWolf ? 1 : 0);
// const sorcererSeats = config.sorcerer ? 1 : 0;
// const seats = wolfCount + specials + traitorSeats + sorcererSeats;
```

- [ ] **Step 3: Chạy test**

Run: `npx vitest run packages/shared/tests/`. Expected: PASS (trừ preset-coverage — xử lý ở Task 3).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/phases.ts packages/shared/src/schemas.ts packages/shared/tests/room-config.test.ts
git commit -m "feat(config): RoomConfig+schema doi MEDIUM+PRIEST sang SORCERER+ALPHA"
```

---

### Task 3: shared balance + snapshot — điểm số, preset, view

**Files:**
- Modify: `packages/shared/src/balance.ts`
- Modify: `packages/shared/src/snapshot.ts`
- Modify: `apps/server/scripts/role-power.ts` (`TOGGLES`: xóa `["PRIEST","priest"]`, thêm `["SORCERER","sorcerer"]`, `["ALPHA_WOLF","alphaWolf"]`)
- Test: `packages/shared/tests/preset-coverage.test.ts`

**Interfaces:**
- Consumes: Task 1–2.
- Produces: `ROLE_POWER` có `SORCERER: 2, ALPHA_WOLF: 6` (tạm, đo lại Task 9), không còn MEDIUM/PRIEST; `specialRoleList` đẩy SORCERER/ALPHA_WOLF; preset 17–18 `sorcerer: true` (bỏ medium+priest, villagers +1 so với công thức cũ), 19–20 `alphaWolf: true` (bỏ medium+priest, villagers +1); `NightActionView` có `sorcererResult`, không còn `mediumResult/priestResult/priestHolyWaterUsed`.

- [ ] **Step 1: Sửa test phủ preset (đỏ trước)**

```ts
// preset-coverage.test.ts: NON_NEUTRAL tự suy từ ROLES nên SORCERER/ALPHA_WOLF
// phải có mặt ≥1 preset (đỏ cho tới khi sửa PRESET_DECKS); MEDIUM/PRIEST không
// còn trong ROLES nên vòng lặp tự hết hiệu lực — không cần xóa tay.
```

Run: `npx vitest run packages/shared/tests/preset-coverage.test.ts`. Expected: FAIL (SORCERER/ALPHA_WOLF vắng mặt).

- [ ] **Step 2: Sửa `balance.ts`**

```ts
// ROLE_POWER: xóa khối MEDIUM + PRIEST; thêm SORCERER: 2, ALPHA_WOLF: 6
// (comment ghi "tạm, chờ đo Task 9").
// preset(): khai `sorcerer: false, alphaWolf: false` cạnh wolfCub/traitor;
// XÓA `priest: false, medium: false`.
// specialRoleList(): thêm `if (config.sorcerer) roles.push("SORCERER");`
// và `if (config.alphaWolf) roles.push("ALPHA_WOLF");`; xóa 2 dòng medium/priest.
// RAW_PRESET_DECKS 17: bỏ `priest: true, medium: true`, thêm `sorcerer: true`.
// 18: bỏ `priest: true, medium: true`, thêm `sorcerer: true`.
// 19: bỏ `priest: true, medium: true`, thêm `alphaWolf: true`.
// 20: bỏ `priest: true, medium: true`, thêm `alphaWolf: true`.
// (villagers suy tự động từ cỡ phòng - số lá đặc biệt; mỗi preset tăng đúng
// 1 Dân Làng so với trước vì mất 2 lá đặc biệt, thêm 1.)
// Sửa comment deck-details các dòng 17–20 tương ứng.
```

- [ ] **Step 3: Sửa `snapshot.ts`**

```ts
// NightActionView: xóa khối mediumResult + priestHolyWaterUsed + priestResult;
// thêm sau detectiveResult:
/** Với Sói Pháp Sư: mục tiêu có thuộc dòng Tiên Tri không */
sorcererResult?: { target: { id: string; name: string }; isSeerLine: boolean } | null;
// GIỮ nguyên cause "priest" | "priest_backfire" mọi nơi (lịch sử cũ).
```

- [ ] **Step 4: Chạy test**

Run: `npx vitest run packages/shared/tests/ apps/server/tests/balance.test.ts`. Expected: PASS (cập nhật `balance.test.ts` dòng `priest: false` nếu schema strict ném — xóa key đó).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/balance.ts packages/shared/src/snapshot.ts apps/server/scripts/role-power.ts packages/shared/tests/preset-coverage.test.ts
git commit -m "feat(balance): preset 17-20 doi medium+priest sang sorcerer+alpha"
```

---

### Task 4: engine — xóa Medium/Priest

**Files:**
- Modify: `packages/game-engine/src/types.ts`
- Modify: `packages/game-engine/src/engine.ts` (dòng tham khảo từ main: NightInfoView ~72–97, emptyNight ~213–236, constructor ??= ~256–321, submitNightAction ~655–1021, priest resolution ~1206–1227, recap ~1441–1490, snapshotFor/nightInfoFor/legalActions ~2425–3135)

**Interfaces:**
- Consumes: Task 1–3.
- Produces: engine không còn biết `MEDIUM_CHECK`/`HOLY_WATER`; ván cũ có role lạ load được (guard VILLAGER).

- [ ] **Step 1: Xóa test Bà Đồng, sửa roster Traitor (đỏ trước)**

```ts
// tests/new-roles.test.ts: xóa toàn bộ describe("Bà Đồng") + helper
// emptyNight/stateWith bỏ mediumResults. Giữ describe Trưởng Lão + Song Trùng.
// tests/traitor.test.ts: roster gồm PRIEST → đổi "priest" thành VILLAGER thứ hai
// (đổi tên id "priest"→"extra", role "PRIEST"→"VILLAGER"); test "Nước thánh ném
// vào nó thì PHẢN VỆ" XÓA (luật không còn tồn tại).
```

Run: `npx vitest run packages/game-engine/tests/new-roles.test.ts packages/game-engine/tests/traitor.test.ts`. Expected: FAIL (engine vẫn còn code nhưng test đã đổi — hoặc ngược lại; mục tiêu là khóa hành vi mới).

- [ ] **Step 2: Xóa trong `types.ts`**

```ts
// NightState: xóa `priestTarget`, `priestSkipped`, `priestResults`,
// `mediumResults?`. GameState: xóa `priestHolyWaterUsed`.
// GIỮ `cause: "wolf" | "poison" | "priest" | "priest_backfire" | "serial_killer"`.
```

- [ ] **Step 3: Xóa trong `engine.ts`**

```ts
// - submitNightAction union type: xóa "HOLY_WATER" (giữ "MEDIUM_CHECK"? XÓA cả hai).
// - Hàng rào target-chết: `if (target && !target.alive && type !== "MEDIUM_CHECK")`
//   → thành `if (target && !target.alive)` (không còn ngoại lệ nào).
// - Xóa case "MEDIUM_CHECK" (~872–883) và case "HOLY_WATER" (~965–978).
// - Nhánh SKIP: xóa nhánh `p.role === "PRIEST"`; error message cuối bỏ "Linh Mục".
// - resolveNight: xóa khối "3. Priest Holy Water" (~1206–1227) + recap priest
//   (~1483–1490) — nhưng GIỮ render recap cho cause priest cũ nếu nightHistory
//   cũ chứa nó (đọc từ death.cause, không từ priestResults).
// - NightInfoView: xóa priestHolyWaterUsed/priestResult/mediumResult.
// - nightInfoFor/snapshotFor/legalActions/botKnowledgeFor/nightActionPending:
//   xóa mọi nhánh viewer.role === "MEDIUM"/"PRIEST".
// - Constructor: xóa các dòng ??= priest*/medium*; THÊM guard role lạ:
//   for (const player of this.state.players) {
//     if (!isRole(player.role)) {
//       this.state.log.push(`Vai ${String(player.role)} không còn tồn tại - chuyển thành Dân Làng.`);
//       (player as { role: Role }).role = "VILLAGER";
//     }
//   }
//   (cần import isRole + Role từ @masoi/shared).
```

- [ ] **Step 4: Chạy test**

Run: `npx vitest run packages/game-engine/tests/new-roles.test.ts packages/game-engine/tests/traitor.test.ts packages/game-engine/tests/roles-actions.test.ts`. Expected: PASS (sửa tiếp file nào đỏ do import type đã xóa).

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/types.ts packages/game-engine/src/engine.ts packages/game-engine/tests/new-roles.test.ts packages/game-engine/tests/traitor.test.ts
git commit -m "feat(engine): xoa cung MEDIUM+PRIEST, guard role la ve VILLAGER"
```

---

### Task 5: engine — thêm Sorcerer + Alpha (+ test mới)

**Files:**
- Modify: `packages/game-engine/src/types.ts`
- Modify: `packages/game-engine/src/engine.ts`
- Create: `packages/game-engine/tests/sorcerer.test.ts`
- Create: `packages/game-engine/tests/alpha-wolf.test.ts`

**Interfaces:**
- Consumes: Task 4.
- Produces: action `SORCERER_CHECK`; `NightState.sorcererResults: Record<string, { targetId: string; isSeerLine: boolean }>`; `GameState.alphaShieldUsed: Record<string, boolean>`; Alpha miễn soi lần đầu trong case `SEE`.

- [ ] **Step 1: Viết failing test Sorcerer**

```ts
// packages/game-engine/tests/sorcerer.test.ts
import { describe, expect, it } from "vitest";
import { GameEngine } from "../src/engine";
// Dùng lại mẫu stateWith tối thiểu (phase NIGHT, round 1):
// roster: sorcerer SORCERER, seer SEER, wolf WEREWOLF, v1 VILLAGER.
it("soi trúng dòng Tiên Tri trả isSeerLine true", () => {
  // e.submitNightAction("sorc", "SORCERER_CHECK", "seer");
  // expect(e.state.night.sorcererResults["sorc"]).toEqual({ targetId: "seer", isSeerLine: true });
});
it("soi dân trả false; tự soi và soi người chết bị từ chối", () => {
  // expect(() => e.submitNightAction("sorc", "SORCERER_CHECK", "sorc")).toThrow();
});
it("một lượt mỗi đêm, chốt ngay lần nộp đầu", () => {
  // nộp lần 2 cùng đêm → throw /đã kiểm tra/.
});
it("vai khác gọi SORCERER_CHECK bị từ chối", () => {
  // seer gọi → throw /Sói Pháp Sư/.
});
```

Run: `npx vitest run packages/game-engine/tests/sorcerer.test.ts`. Expected: FAIL.

- [ ] **Step 2: Viết failing test Alpha**

```ts
// packages/game-engine/tests/alpha-wolf.test.ts
it("SEE lần đầu lên Alpha trả làng + bật khiên", () => {
  // e.submitNightAction("seer", "SEE", "alpha");
  // expect(e.state.night.seerResults["seer"]).toMatchObject({ targetId: "alpha", isWolf: false, team: "village" });
  // expect(e.state.alphaShieldUsed["alpha"]).toBe(true);
});
it("SEE lần hai hiện nguyên hình sói", () => {
  // đêm 2 (setPhase NIGHT mới): SEE lại → isWolf true, team "wolves".
});
it("Alpha cắn cùng bầy và bị treo như sói thường", () => {
  // submitNightAction("alpha", "KILL", "v1") không ném (isWolfPack).
});
```

Run: `npx vitest run packages/game-engine/tests/alpha-wolf.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement tối thiểu trong engine**

```ts
// types.ts NightState: thêm
sorcererResults: Record<string, { targetId: string; isSeerLine: boolean }>;
// GameState: thêm `alphaShieldUsed: Record<string, boolean>;`
// (constructor ??= {}, create() khởi tạo {}).
// submitNightAction union: thêm "SORCERER_CHECK".
// case "SORCERER_CHECK": chỉ role SORCERER; target sống, không phải mình;
//   1 lượt/đêm (đã có result thì throw); isSeerLine = target.role === "SEER" ||
//   target.role === "APPRENTICE_SEER"; ghi st.night.sorcererResults[playerId].
//   (TRAITOR soi bởi sorcerer? Sorcerer tìm dòng Tiên Tri nên TRAITOR → false,
//   không cần ngoại lệ.)
// case "SEE": sau khi tính seenTeam, chèn khiên Alpha:
//   const targetPlayer = this.player(targetId)!;
//   if (targetPlayer.role === "ALPHA_WOLF" && !st.alphaShieldUsed[targetId]) {
//     st.alphaShieldUsed[targetId] = true;
//     team = "village"; // + secondaryTeam nếu có? Alpha chỉ lừa lượt soi chính;
//     // để đơn giản: secondary giữ nguyên (CLEARING_MIST hiếm + Alpha là 1 trong 2).
//   }
//   Lưu ý: đặt TRƯỚC khi dựng seerResult; WOLF_SHADOW flip giữ nguyên thứ tự cũ
//   (flip trước hay sau khiên? Chọn: khiên sau flip — flip lật team thật rồi khiên
//   ép về village; ghi comment 3 dòng giải thích).
// emptyNight(): thêm sorcererResults: {}.
// legalActions/botKnowledgeFor/nightActionPending/snapshotFor: thêm nhánh
// SORCERER (gương Detective: legalTargets.SORCERER_CHECK = người sống trừ mình;
// acted = đã có result).
```

- [ ] **Step 4: Chạy test**

Run: `npx vitest run packages/game-engine/tests/sorcerer.test.ts packages/game-engine/tests/alpha-wolf.test.ts packages/game-engine/tests/roles-actions.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/types.ts packages/game-engine/src/engine.ts packages/game-engine/tests/sorcerer.test.ts packages/game-engine/tests/alpha-wolf.test.ts
git commit -m "feat(engine): SORCERER_CHECK + khien soi Alpha"
```

---

### Task 6: bot — xóa chiến thuật cũ, thêm Sorcerer

**Files:**
- Delete: `packages/game-engine/src/bot/roles/medium.ts`, `packages/game-engine/src/bot/roles/priest.ts`
- Create: `packages/game-engine/src/bot/roles/sorcerer.ts`
- Modify: `packages/game-engine/src/bot/roles/registry.ts`, `packages/game-engine/src/bot/types.ts`, `packages/game-engine/src/bot/knowledge.ts`, `packages/game-engine/src/bot/belief/private-info.ts`, `packages/game-engine/src/bot/analysis/chat-analysis.ts`, `packages/game-engine/src/bot/config/weights.ts` (xóa `priestSuspicion/priestTrustVeto/nightConfidence.priest` NẾU không dùng chỗ khác — grep trước), templates/claim dùng "PRIEST"/"MEDIUM" (grep `bot/conversation/templates.ts`, `decision/claim-decision.ts`, `analysis/*`: xóa entry 2 role, thêm SORCERER chew? Sói KHÔNG claim Sorcerer công khai — chỉ thêm vào từ điển nghe-hiểu nếu có)
- Tests: mọi `bot-*.test.ts` có `mediumResult: null` trong fixture (khoảng 20 file) + `MEDIUM_CHECK: []` / `"HOLY_WATER"` trong legalActions expects + `bot-extended-roles-night.test.ts` (bỏ PRIEST khỏi LIMITED_CHARGE + roster `priest: true`)

**Interfaces:**
- Consumes: Task 5 (`SORCERER_CHECK`, `sorcererResult`).
- Produces: `sorcererStrategy` trong registry; `BotKnowledgeView.sorcererResult`; bot Sói Pháp Sư mỗi đêm check 1 người.

- [ ] **Step 1: Xóa file + sửa registry (đỏ trước)**

```bash
git rm packages/game-engine/src/bot/roles/medium.ts packages/game-engine/src/bot/roles/priest.ts
```

```ts
// registry.ts: xóa 2 import + 2 entry MEDIUM/PRIEST; thêm:
// import { sorcererStrategy } from "./sorcerer";
// SORCERER: sorcererStrategy,
// ALPHA_WOLF: werewolfStrategy, // cắn cùng bầy như WOLF_CUB — comment 2 dòng.
```

Run: `npx vitest run packages/game-engine/tests/bot-role-strategy.test.ts`. Expected: FAIL (thiếu sorcerer.ts).

- [ ] **Step 2: Viết `sorcerer.ts` (gương `detective.ts`, ngưỡng riêng)**

```ts
import type { Role } from "@masoi/shared";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { nightEvidence, type BotRoleStrategy } from "./strategy";

export function sorcererStrategy(
  _role: Role = "SORCERER",
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotRoleStrategy {
  return {
    role: "SORCERER",
    decideNight(context, state, _rng, probe) {
      const night = context.knowledge.night;
      if (!night || !night.legalActions.includes("SORCERER_CHECK")) {
        probe?.fallback("không có lượt soi Pháp Sư nào đang mở");
        return null;
      }
      // Ưu tiên: người claim Seer (belief.claims) > người được Guard che
      // (bị che = quan trọng) > suspicion cao nhất; bỏ qua đồng bọn đã biết.
      // ...chọn 1 targetId...
      return { kind: "NIGHT_ACTION", action: "SORCERER_CHECK", targetId,
        confidence: 0.7, evidence: [nightEvidence("ACCUSE", context.knowledge.round,
          targetId, "cần xác định có phải dòng Tiên Tri không", 0, weights)] };
    },
    voteBias: () => ({}),
  };
}
```

- [ ] **Step 3: Cập nhật types/knowledge/belief/chat**

```ts
// bot/types.ts: NightActionKind thêm "SORCERER_CHECK" (xóa "MEDIUM_CHECK"? enum
// đó là của bot — xóa MEDIUM_CHECK, HOLY_WATER giữ hay xóa? Engine không còn
// chào nên xóa cả hai); BotKnowledgeView: xóa mediumResult, thêm
// sorcererResult: { targetId: string; targetName: string; isSeerLine: boolean } | null.
// knowledge.ts: buildBotKnowledgeView copy sorcererResult như mediumResult cũ.
// belief/private-info.ts: xóa nhánh medium (ghi vai thật người chết); thêm:
//   nếu knowledge.sorcererResult?.isSeerLine → gắn tag seer-line cho target.
// chat-analysis.ts: xóa ["bà đồng","MEDIUM"], ["bd","MEDIUM"]; thêm
//   ["pháp sư","SORCERER"], ["sói pháp sư","SORCERER"] cho nghe-hiểu.
// claim-decision/templates: xóa claim mẫu PRIEST/MEDIUM; Sói bị dồn không còn
//   chỗ nấp PRIEST (test bot-claim-credibility.test.ts dòng ~196 "FIX: PRIEST..."
//   sửa thành GUARDIAN_ANGEL/MAYOR).
```

- [ ] **Step 4: Quét và sửa toàn bộ fixture bot-*.test.ts**

Run: `npx vitest run packages/game-engine/tests/bot-night-strategies.test.ts` rồi sửa lan ra: `mediumResult: null` → xóa key; `MEDIUM_CHECK: []` → `"SORCERER_CHECK": []` nếu roster có sorcerer else xóa; `"HOLY_WATER"` expects → xóa. Lặp tới khi `npx vitest run packages/game-engine/tests/` xanh hết.

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/bot packages/game-engine/tests/
git commit -m "feat(bot): xoa medium+priest strategy, them sorcerer"
```

---

### Task 7: web — art, panel đêm, sảnh chờ

**Files:**
- Modify: `apps/web/src/lib/role-art.ts` (+ `role-art.test.ts`), `apps/web/src/components/NightPanel.tsx`, `apps/web/src/lib/lobby-summary.ts` (+ test), `apps/web/src/lib/night-recap-roles.ts` (+ test), `apps/web/src/components/DayOfTruthModal.tsx` (xóa "PRIEST" khỏi mảng roles), `apps/web/src/components/PlayerGrid.tsx` (comment Bà Đồng → sửa thành vai duy nhất còn lại cần cờ đó hoặc xóa), `apps/web/src/components/NightRecapTimeline.tsx` (2 dòng Linh Mục → giữ render cause cũ? timeline đọc death.cause nên giữ nguyên — chỉ sửa nếu import type đã xóa), `apps/web/src/lib/night-role.test.ts` (`expectAct("PRIEST", true)` → `expectAct("SORCERER", true)` + Alpha), `apps/web/src/lib/balance.ts` + `balance-copy.ts` (KIỂM TRA trước: nếu là bản sao của shared/balance.ts thì mirror Task 3 — xóa priest/medium, thêm sorcerer/alpha, sửa preset 17–20 y hệt; `balance-copy.test.ts` chạy kèm)

**Interfaces:**
- Consumes: Task 1–5.
- Produces: sảnh chờ toggle SORCERER/ALPHA_WOLF; NightPanel form SORCERER_CHECK; art 2 sói mới.

- [ ] **Step 1: `lobby-summary.ts` (xương sống sảnh chờ)**

```ts
// VILLAGE_ROLES: xóa "PRIEST", "MEDIUM".
// WOLF_SPECIAL_ROLES: ["WOLF_CUB"] → ["WOLF_CUB", "SORCERER", "ALPHA_WOLF"]
//   (deckCounts cộng sói đặc biệt vào wolves — đúng vì cả 3 đều phe sói).
// CONFIG_KEY: xóa PRIEST/MEDIUM, thêm SORCERER: "sorcerer", ALPHA_WOLF: "alphaWolf".
// isPresetDeck tự đúng (so mọi key).
```

Run: `npx vitest run apps/web/src/lib/lobby-summary` (tên file test tương ứng). Expected: đỏ trước, xanh sau.

- [ ] **Step 2: `role-art.ts` + NightPanel + night-recap-roles + DayOfTruthModal**

```ts
// role-art.ts: xóa khối PRIEST + MEDIUM; thêm SORCERER (mắt sói trong quả cầu
// pha lê — VẼ TAY bằng path, không emoji) và ALPHA_WOLF (đầu sói có sẹo/vương
// miện tối giản). Giữ đúng Record<Role, ...> — TypeScript tự đỏ nếu thiếu.
// NightPanel.tsx: xóa khối {role === "PRIEST"...} (~563) và {role === "MEDIUM"...}
//   (~687–720); thêm khối {role === "SORCERER"...} chọn 1 người sống →
//   onAction("SORCERER_CHECK", selected). ALPHA_WOLF không có form đêm
//   (cắn qua form bầy như WOLF_CUB — kiểm tra form bầy dùng isWolfPack thì tự có).
// night-recap-roles.ts: xóa logic dòng Linh Mục (đọc priest flag); thêm dòng
//   Sói Pháp Sư hiện khi đêm đó có sorcererResult.
// DayOfTruthModal.tsx: mảng roles bỏ "PRIEST" (giữ 9 role còn lại).
```

- [ ] **Step 3: balance.ts web (nếu là bản sao)**

```bash
# So sánh với shared trước khi sửa:
diff <(sed 's/[[:space:]]//g' apps/web/src/lib/balance.ts) <(sed 's/[[:space:]]//g' packages/shared/src/balance.ts) | head -20
```

Mirror đúng diff của Task 3 nếu hai file trùng nội dung; nếu web balance chỉ re-export từ shared thì bỏ qua bước này.

- [ ] **Step 4: Chạy test web liên quan**

Run: `npx vitest run apps/web/src/lib/role-art.test.ts apps/web/src/lib/night-role.test.ts apps/web/src/lib/night-recap-roles.test.ts apps/web/src/lib/lobby-summary` . Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/
git commit -m "feat(web): sảnh+panel đêm cho SORCERER+ALPHA, xoa MEDIUM+PRIEST"
```

---

### Task 8: server — service, socket, test luồng

**Files:** grep trước trong `apps/server/src` với `priest|medium|PRIEST|MEDIUM|HOLY_WATER|MEDIUM_CHECK`; nghi phạm: `rooms/service.ts` (validate/start), socket handlers night action, `tests/extended-roles-flow.test.ts`, `tests/night-role.test.ts`.

- [ ] **Step 1: Grep + liệt kê**

Run: `rg -l "PRIEST|MEDIUM|HOLY_WATER|MEDIUM_CHECK|priest|medium" apps/server/src apps/server/tests`. Expected: danh sách file.

- [ ] **Step 2: Sửa từng file theo danh sách** (xóa nhánh priest/medium; night action type union thêm SORCERER_CHECK nếu server khai riêng; test flow đổi roster priest/medium → sorcerer/alpha).

- [ ] **Step 3: Chạy test server**

Run: `npx vitest run apps/server/tests/extended-roles-flow.test.ts apps/server/tests/night-role.test.ts`. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/server/
git commit -m "feat(server): flow đêm cho SORCERER+ALPHA, xoa MEDIUM+PRIEST"
```

---

### Task 9: Đo lường, chốt số, full gate

**Files:**
- Modify: `packages/shared/src/balance.ts` (chốt `ROLE_POWER` sau đo)
- Docs: ghi số đo vào comment `ROLE_POWER` (giống format các dòng đã đo)

- [ ] **Step 1: Đo Sorcerer/Alpha so cặp**

Run: `npx tsx apps/server/scripts/role-power.ts --games 600 --role SORCERER --role ALPHA_WOLF` (chia `--only` ra nhiều tiến trình nếu chậm). Expected: bảng Δ thắng cho 2 role.

- [ ] **Step 2: Đo preset 17–20 mới**

Run: batch self-play preset 17,18,19,20 speech BẬT (dùng script batch hiện có, 3 seed family). Expected: tỉ lệ làng về gần dải 35–55 (ghi số thật vào comment preset).

- [ ] **Step 3: Chốt số + full gate**

```bash
npx tsc --noEmit -p tsconfig.base.json  # hoặc lệnh typecheck của repo
npm run test
npm run build
```

Expected: xanh hết. Sửa số ROLE_POWER theo số đo (quy ước bảng: không chép thẳng số đo, làm tròn 0.5).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/balance.ts
git commit -m "feat(balance): chot ROLE_POWER SORCERER+ALPHA sau do self-play"
```

---

## Self-Review (tự kiểm trước khi giao)

1. **Spec coverage:** §2 xóa cứng → Task 1,2,4,6,7,8; guard VILLAGER → Task 4 Step 3; giữ cause → Task 3–4 (ghi rõ); §3 Sorcerer → Task 5–6; §4 Alpha → Task 5 (khiên trong SEE, wolfCount trong validate Task 2); §5 preset 1-sói/preset → Task 3 (+ fix ghế Dân tự động qua công thức villagers); đo lường → Task 9. Đủ.
2. **Placeholder scan:** không TBD/TODO; mọi step có lệnh chạy + expected cụ thể; không có "tương tự Task N" mà thiếu code.
3. **Type consistency:** `sorcererResults: Record<string, { targetId: string; isSeerLine: boolean }>` dùng nhất quán Task 5–6; `alphaShieldUsed: Record<string, boolean>` Task 5; `SORCERER_CHECK` trong zod enum (Task 2) = engine union (Task 5) = bot NightActionKind (Task 6) = NightPanel onAction (Task 7).

---

## Deploy notes (fix wave sau final review, 2026-09-06)

(a) Ván đang chạy (in-flight) lúc deploy: đọc an toàn, KHÔNG cần chờ drain.
- Vai đã xóa (PRIEST/MEDIUM) trong snapshot: `roleSchema`
  (`apps/server/src/persistence/schema.ts:78`) rơi về `"VILLAGER"` (`.catch`),
  phủ `players`, `personalWins`, `knownRoles`, `myClaim`. Guard VILLAGER của
  engine giữ nguyên làm lớp dự phòng. Đính chính spec §6 ("guard VILLAGER
  gánh"): guard một mình KHÔNG đủ — schema parse chạy trước constructor, nên
  không có `.catch` thì phòng vào `quarantine` trước cả khi guard kịp chạy.
- Lượt đêm cũ của bot (`HOLY_WATER`, `PRIEST_BLESS`): giữ làm dead literal
  trong `previousNightActions` (cùng tiền lệ enum `cause` giữ
  `"priest" / "priest_backfire"` cho lịch sử cũ); engine mới không bao giờ
  sinh chúng nữa.
- Key đêm cũ (`priestTarget`, `priestResults`, `mediumResults`,
  `priestHolyWaterUsed`): tự lược vì `nightStateSchema` là `z.object` thường
  (strip); key mới (`sorcererResults`, `alphaShieldUsed`) có `.default({})`
  nên ảnh cũ vẫn đọc được.

(b) Client cũ còn cache: gửi `HOLY_WATER` bị `nightActionTypeSchema`
(`packages/shared/src/schemas.ts`, strict enum) từ chối — ĐÚNG như spec §6 đã
chấp nhận (xóa cứng). Bảo user refresh; không migrate gì thêm.

(c) Phòng custom cũ bật priest/medium trong DB: load KHÔNG còn chết — config
đọc qua `storedRoomConfigSchema` (`roomConfigSchema.strip()`,
`apps/server/src/persistence/schema.ts:95`) nên key lạ bị lược, phòng OPEN
bình thường. Đính chính spec §6 ("`validateRoomConfig` vẫn pass"): phòng chưa
từng tới được `validateRoomConfig`, vì strict parse ở tầng load đã ném trước.
Sau load: config không `villagers` (đường tương thích) mở ván tiếp bình
thường, ghế Linh Mục/Bà Đồng cũ tan vào Dân Làng; config CÓ `villagers` chốt
số ghế theo bộ bài cũ có thể lệch số người lúc start ("Bộ bài cần N
người...") — host chỉnh lại bộ bài một lần là xong. `updateConfigPayload`
vẫn strict nên lần đổi config tiếp theo key lạ cũng không quay lại được.
