# Xóa Sói Alpha, đưa Kẻ Phản Bội vào nhóm Sói ở phòng chờ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xóa cứng vai `ALPHA_WOLF` khỏi toàn repo, giữ ván đang chạy an toàn khi deploy, và cho host bật Kẻ Phản Bội từ nhóm Sói ở phòng chờ.

**Architecture:** Cùng khuôn xóa cứng Bà Đồng/Linh Mục (2026-09-05): gỡ enum + meta + config key + state, dữ liệu lưu cũ được đỡ ở tầng persistence schema. Luật Kẻ Phản Bội không đổi; chỉ đổi danh sách hiển thị ở web và ghế Alpha của preset 19-20.

**Tech Stack:** TypeScript monorepo (npm workspaces), zod, vitest (shared/engine/server), `tsx --test` (web), Next.js.

**Spec:** `docs/superpowers/specs/2026-09-11-remove-alpha-wolf-design.md`

## Global Constraints

- Luật Kẻ Phản Bội KHÔNG đổi (không thuộc bầy, không hành động đêm, Tiên Tri soi ra Dân, hóa Ma Sói khi Sói cuối chết).
- `validateRoomConfig` / `deckWolfCount`: Kẻ Phản Bội chiếm ghế, KHÔNG vào `wolfCount`.
- Vai lạ khác (PRIEST, MEDIUM, …) vẫn rơi về `VILLAGER` khi đọc snapshot; chỉ `ALPHA_WOLF` -> `WEREWOLF`.
- Comment lịch sử / bảng số đo cũ trong `balance.ts` và spec 2026-09-05 giữ nguyên.
- Comment code viết tiếng Việt, cùng giọng file xung quanh.
- Không tự chỉnh bộ bài preset 19-20 ngoài `alphaWolf -> traitor`; lệch cân bằng thì báo số liệu.

---

### Task 1: Ván đang chạy có ALPHA_WOLF đọc lại thành WEREWOLF

**Files:**
- Modify: `apps/server/src/persistence/schema.ts:73-80`
- Test: `apps/server/tests/persistence-schema.test.ts` (thêm case sau case "vai đã xóa cứng (PRIEST/MEDIUM)…", ~dòng 96)

**Interfaces:**
- Produces: `roleSchema` (nội bộ file) — mọi chỗ đang dùng (`enginePlayerSchema.role`, `personalWins[].role`, `knownRoles`, `myClaim.role`) tự nhận ánh xạ.

- [ ] **Step 1: Viết test fail**

Thêm vào `describe("schema snapshot phòng", …)`:

```ts
  it("Sói Alpha (xóa cứng) đọc lại thành WEREWOLF, không rơi về VILLAGER", () => {
    const input = validEnvelope();
    input.room.engineState.players[0]!.role = "ALPHA_WOLF" as never;
    const parsed = roomEnvelopeSchema.parse(input);
    expect(parsed.room.engineState!.players[0]!.role).toBe("WEREWOLF");
  });
```

- [ ] **Step 2: Chạy, xác nhận FAIL**

Run: `npm run build:deps && npx vitest run tests/persistence-schema.test.ts --root apps/server`
Expected: FAIL — `expected 'ALPHA_WOLF' to be 'WEREWOLF'` (vai vẫn còn trong `ROLES`).

- [ ] **Step 3: Cài ánh xạ**

Thay dòng `const roleSchema = oneOf<Role>(ROLES).catch("VILLAGER");` (giữ nguyên block comment phía trên, thêm đoạn cuối) thành:

```ts
/*
 * ...(giữ comment cũ)...
 *
 * Sói Alpha (xóa cứng 2026-09-11) là ngoại lệ: rơi về VILLAGER là đổi phe một
 * con Sói giữa ván. Nó cắn cùng bầy nên WEREWOLF là lá còn lại đúng nghĩa -
 * người cầm chỉ mất khiên soi.
 */
const roleSchema = z.preprocess(
  (value) => (value === "ALPHA_WOLF" ? "WEREWOLF" : value),
  oneOf<Role>(ROLES).catch("VILLAGER"),
) as z.ZodType<Role>;
```

- [ ] **Step 4: Chạy lại, xác nhận PASS**

Run: `npx vitest run tests/persistence-schema.test.ts --root apps/server`
Expected: PASS toàn file.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/persistence/schema.ts apps/server/tests/persistence-schema.test.ts
git commit -m "feat(persistence): doc lai ALPHA_WOLF thanh WEREWOLF cho van cu"
```

---

### Task 2: Xóa cứng ALPHA_WOLF (shared, engine, server, web, scripts, tests)

Một lượt duy nhất vì gỡ một thành viên khỏi union `Role` làm hỏng `tsc` ở mọi consumer cùng lúc.

**Files (source):**
- `packages/shared/src/roles.ts` — xóa `"ALPHA_WOLF"` khỏi `ROLES` (dòng 6), xóa entry `ALPHA_WOLF` ở `ROLE_META` (dòng 90-96), `isWolfPack` thành:
  ```ts
  return role === "WEREWOLF" || role === "WOLF_CUB" || role === "SORCERER";
  ```
- `packages/shared/src/phases.ts:346-347` — xóa `alphaWolf?: boolean;` và comment của nó.
- `packages/shared/src/schemas.ts` — xóa `alphaWolf: bool.optional(),` (dòng 39); `deckWolfCount` thành `return config.werewolves + (config.wolfCub ? 1 : 0);`, bỏ câu "Sói Alpha cắn cùng bầy nên vào đây." ở comment.
- `packages/shared/src/deck.ts:43` — xóa `"alphaWolf",` khỏi `DECK_KEYS`.
- `packages/shared/src/balance.ts`:
  - `ROLE_POWER`: xóa `ALPHA_WOLF: 4,` và block comment ngay trên nó (comment bắt đầu bằng đoạn "Cùng lượt đo với Sói Pháp Sư…" kết thúc ở dòng 189). Bảng đo 2026-09-11 (dòng 200-216) giữ nguyên - là lịch sử.
  - dòng ~435: xóa `alphaWolf: false,`.
  - dòng 188: `Kẻ Phản Bội 11/12/18, Sói Alpha 19/20.` -> `Kẻ Phản Bội 11/12/18/19/20 (19-20 thế ghế Sói Alpha, xóa cứng 2026-09-11).`
  - dòng 214: `ELDER, ALPHA_WOLF, VILLAGER x4` -> `ELDER, TRAITOR, VILLAGER x4`.
  - preset 19 và 20 (dòng 875, 889): `alphaWolf: true,` -> `traitor: true,`.
  - `specialRoleList` (dòng ~979): xóa `if (config.alphaWolf) roles.push("ALPHA_WOLF");`, comment dòng trên đổi "Hai sói mới" -> "Sói Pháp Sư".
  - `generateWarnings` (dòng ~1120-1124): `const wolfCount = config.werewolves + (config.wolfCub ? 1 : 0);`; comment trên nó chỉ giữ ý Sói Pháp Sư không cắn nên vắng mặt.
  - dòng ~1213-1215: comment đổi thành `// Cùng phép đếm với \`wolfCount\` ngay trên.`; `presetWolfCount = presetDeck.werewolves + (presetDeck.wolfCub ? 1 : 0);`
- `packages/game-engine/src/types.ts:262-268` — xóa `alphaShieldUsed` và comment.
- `packages/game-engine/src/engine.ts` — xóa `this.state.alphaShieldUsed ??= {};` (dòng 308), `alphaShieldUsed: {},` (dòng 422), và khối khiên trong case SEE (dòng 873-880: 3 dòng comment + `const targetPlayer…` + `if (…ALPHA_WOLF…) {…}`). Nếu `let team` không còn bị gán lại thì đổi thành `const team`.
- `packages/game-engine/src/bot/roles/registry.ts:51-53` — xóa 2 dòng comment + `ALPHA_WOLF: werewolfStrategy,`.
- `packages/game-engine/src/bot/analysis/chat-analysis.ts` — xóa `["sói alpha", "ALPHA_WOLF"],` và 2 dòng comment trên nó (dòng 85-87). Dòng 403: xóa `"sói alpha", ` khỏi danh sách ACCUSATION.
- `packages/game-engine/src/bot/learning/speech-dataset.ts:238` — `const wolf = role === "WEREWOLF" || role === "WOLF_CUB";`
- `packages/game-engine/src/bot/evaluation/invariants.ts` — xóa trường `alphaShieldedSeerResults` + comment (dòng 101-117) và vế `(truth.alphaShieldedSeerResults?.has(…) ?? false) ||` + 2 dòng comment (dòng ~388-390).
- `packages/game-engine/src/bot/evaluation/selfplay.ts` — xóa `const alphaShieldedSeerResults` + comment (dòng ~906-914), dòng `alphaShieldedSeerResults,` trong `groundTruth()`, khối `seeConsumesAlphaShield` + comment (dòng ~1152-1161), và khối `if (seeConsumesAlphaShield && decision.targetId) {…}` + comment (dòng ~1192-1198).
- `apps/server/src/persistence/schema.ts:~204-207` — xóa `alphaShieldUsed: …default({}),` + 2 dòng comment (snapshot cũ còn trường này thì `z.object` strip).
- `apps/server/src/rooms/snapshot.ts:83` — comment: `(Sói, Sói Con, Sói Pháp Sư)`.
- `apps/server/scripts/role-power.ts` — xóa `["ALPHA_WOLF", "alphaWolf"],` (dòng 44); dòng 156: `role === "WOLF_CUB" || role === "SORCERER" ? -delta : delta`; dòng 200: bỏ `&& role !== "ALPHA_WOLF"`; comment dòng 153 và 194: bỏ "và Sói Alpha"/", Sói Alpha".
- `apps/server/scripts/preset-balance.ts:73` — xóa `["ALPHA_WOLF", "alphaWolf"],`.
- `apps/server/scripts/role-power-sweep.ts` — xóa `"--role", "ALPHA_WOLF", ` ở các dòng id 06, 08, 11, 15.
- `apps/web/src/components/NightPanel.tsx:146` — xóa `role !== "ALPHA_WOLF" &&`; comment dòng ~157-159: "Ma Sói, Sói Con và Sói Pháp Sư".
- `apps/web/src/lib/role-art.ts` — xóa entry `ALPHA_WOLF:` trong `ROLE_ICON_PATHS` và 3 dòng `- ALPHA_WOLF: …` ở comment đầu file.
- `apps/web/src/lib/lobby-summary.ts` — `WOLF_SPECIAL_ROLES = ["WOLF_CUB", "SORCERER"]` (TRAITOR thêm ở Task 3), xóa `ALPHA_WOLF: "alphaWolf",` khỏi `CONFIG_KEY`.

**Files (tests):**
- Delete: `packages/game-engine/tests/alpha-wolf.test.ts`
- Mọi fixture: xóa dòng `alphaShieldUsed: {},` (lệnh ở Step 2).
- `packages/shared/tests/roles.test.ts` — xóa `"ALPHA_WOLF",` trong mảng expected (dòng 15), `expect(roleTeam("ALPHA_WOLF"))…` (dòng 49), `expect(isWolfPack("ALPHA_WOLF"))…` (dòng 69), dòng comment `// Alpha Wolf: 2` và `expect(ROLE_META.ALPHA_WOLF.nightOrder)…`, và 2 dòng (comment + `"ALPHA_WOLF",`) trong `ROLE_ORDER_FOR_NIGHT`.
- `packages/shared/tests/room-config.test.ts` — describe `"RoomConfig SORCERER+ALPHA_WOLF"` đổi tên `"RoomConfig SORCERER"`; case `"accepts sorcerer/alphaWolf keys"` chỉ parse `sorcerer: true`; thay case `"counts alphaWolf in wolfCount but not sorcerer"` bằng:
  ```ts
  it("rejects the removed alphaWolf key", () => {
    expect(roomConfigSchema.safeParse({ ...DEFAULT_ROOM_CONFIG, alphaWolf: true }).success).toBe(false);
  });
  ```
- `packages/shared/tests/balance-warnings.test.ts` — xóa hai case Alpha ("ngân sách sai lầm tính cả Alpha…", "tỉ lệ Sói so preset tính cả Alpha…"); giữ case "preset 19 … không tự tố tỉ lệ của chính nó", đổi tên thành `"preset 19 không tự tố tỉ lệ của chính nó"` và sửa comment đầu file cho khớp (file giờ chỉ gác preset 19). Nếu còn helper `eightPlayers` không dùng thì xóa.
- `packages/shared/tests/preset-coverage.test.ts` — nếu có danh sách vai bắt buộc chứa `ALPHA_WOLF` thì xóa phần tử đó; comment dòng ~70 bỏ "Sói Alpha".
- `packages/game-engine/tests/selfplay-invariants.test.ts` — xóa `alphaShieldedSeerResults: over.alphaShieldedSeerResults,` (dòng 48) và hai case `"Sói Alpha: …"` (dòng ~347-395, gồm cả comment trên case đầu).
- `packages/game-engine/tests/bot-sorcerer.test.ts` — xóa case `"ALPHA_WOLF cắn cùng bầy như Sói"` (dòng ~105-125).
- `packages/game-engine/tests/bot-trace.test.ts:401`, `bot-transcript.test.ts:144` — xóa phần tử `"ALPHA_WOLF"`.
- `apps/server/tests/extended-roles-flow.test.ts` — xóa case `"handles Alpha Wolf seer shield…"` (dòng ~194-220).
- `apps/server/tests/chat-permission-guard.test.ts` — describe dòng 243 đổi tên `"kênh phe Sói mở cho Sói Pháp Sư"`; xóa player `alpha` khỏi `packRoom`, bỏ `"alpha"` khỏi hai vòng `for (const id of [...])`, xóa `expect(roles.alpha)…` và case `"Sói Alpha đọc kênh Sói…"`; comment dòng 240 bỏ "và Sói Alpha".
- `apps/server/tests/night-role.test.ts` — xóa `expect(canActAtNight("ALPHA_WOLF"))…`, tên case bỏ ", Alpha Wolf".
- `apps/server/tests/persistence-schema.test.ts:261-265` — case đổi tên `"thiếu sorcererResults (ảnh bản cũ) vẫn đọc được"`, xóa dòng `delete … .alphaShieldUsed;` và mọi assert về `alphaShieldUsed` trong case đó.
- `apps/web/src/lib/night-role.test.ts:16`, `role-art.test.ts:28` — bỏ `ALPHA_WOLF` (role-art: `["SORCERER"] as Role[]`).
- `apps/web/src/lib/lobby-summary.test.ts` — dòng 41 xóa `alphaWolf: false,`; case dòng 60: tên `"Sói Pháp Sư tính vào phe Sói…"`, config bỏ `alphaWolf: true`, sửa số `wolves` kỳ vọng giảm 1; case dòng 97: tên `"Sói Pháp Sư là sói đặc biệt có công tắc sảnh chờ"`, xóa 2 assert ALPHA_WOLF.
- `apps/web/src/components/RoleDeckPanel.test.tsx:27,36` — `alphaWolf: true,` -> `traitor: true,`; comment: `(2 Sói + Sói Con + Kẻ Phản Bội + Sói Pháp Sư) = 19 ghế.` (Kẻ Phản Bội chiếm ghế nên tổng không đổi.)

- [ ] **Step 1: Sửa toàn bộ source theo danh sách trên.**

- [ ] **Step 2: Gỡ fixture và test Alpha**

```bash
git rm packages/game-engine/tests/alpha-wolf.test.ts
grep -rlE "^\s*alphaShieldUsed: \{\},\s*$" packages/*/tests apps/*/tests | xargs sed -i -E '/^\s*alphaShieldUsed: \{\},\s*$/d'
```
Rồi sửa các file test còn lại theo danh sách.

- [ ] **Step 3: Không còn dấu vết**

Run: `grep -rnE "ALPHA_WOLF|alphaWolf|alphaShield" packages/*/src packages/*/tests apps/*/src apps/*/tests apps/server/scripts`
Expected: chỉ còn (a) ánh xạ + comment ở `apps/server/src/persistence/schema.ts`, (b) test Task 1, (c) `room-config.test.ts` case "rejects the removed alphaWolf key", (d) comment bảng đo lịch sử trong `balance.ts`. Còn gì khác thì sửa.

- [ ] **Step 4: Build + test toàn repo**

Run: `npm run build && npm test`
Expected: tất cả xanh. Nếu một test cân bằng của preset 19/20 (vd. `balance.test.ts`, `preset-coverage.test.ts`) fail vì con số kỳ vọng dựa trên Alpha: KHÔNG sửa bộ bài - ghi lại tên test + giá trị cũ/mới, sửa kỳ vọng chỉ khi test đang chụp đúng một con số suy ra từ `ROLE_POWER` (tính lại tay và ghi phép tính vào comment), còn lại dừng và báo.

- [ ] **Step 5: Commit**

```bash
git add -A packages apps
git commit -m "feat(roles): xoa cung Soi Alpha, preset 19-20 doi sang Ke Phan Boi"
```

---

### Task 3: Kẻ Phản Bội có công tắc trong nhóm Sói ở phòng chờ

**Files:**
- Modify: `apps/web/src/lib/lobby-summary.ts:33,46-64`
- Test: `apps/web/src/lib/lobby-summary.test.ts`

**Interfaces:**
- Consumes: `WOLF_SPECIAL_ROLES`, `CONFIG_KEY` sau Task 2.
- Produces: `WOLF_SPECIAL_ROLES = ["WOLF_CUB", "SORCERER", "TRAITOR"]`, `CONFIG_KEY.TRAITOR === "traitor"`. `Lobby.tsx` và `RoleDeckPanel.tsx` đọc hai hằng này nên tự hiện công tắc (icon TRAITOR đã có trong `role-art.ts`).

- [ ] **Step 1: Viết test fail** (thêm vào `lobby-summary.test.ts`, dùng helper `config` sẵn có của file)

```ts
  it("Kẻ Phản Bội là lá sói đặc biệt có công tắc sảnh chờ", () => {
    assert.ok(WOLF_SPECIAL_ROLES.includes("TRAITOR"));
    assert.equal(CONFIG_KEY["TRAITOR"], "traitor");
  });

  it("Kẻ Phản Bội tính vào cột Sói chứ không vào chức năng của làng", () => {
    const counts = deckCounts(config({ werewolves: 1, traitor: true }), 8);
    assert.equal(counts.wolves, 2);
    assert.equal(counts.specials, deckCounts(config({ werewolves: 1 }), 8).specials);
  });
```

- [ ] **Step 2: Chạy, xác nhận FAIL**

Run: `npm run test --workspace @masoi/web`
Expected: FAIL ở hai case mới (`WOLF_SPECIAL_ROLES` chưa có TRAITOR; `wolves` = 1).

- [ ] **Step 3: Cài đặt**

```ts
/**
 * Lá phe Sói bật/tắt được. Kẻ Phản Bội đứng đây dù KHÔNG thuộc bầy: host đọc
 * nhóm này để biết phe Sói có những lá gì, và nó thắng cùng Sói. Luật đếm sức
 * cắn (`deckWolfCount`) vẫn không tính nó - đây chỉ là chỗ hiển thị.
 */
export const WOLF_SPECIAL_ROLES: Role[] = ["WOLF_CUB", "SORCERER", "TRAITOR"];
```
và thêm `TRAITOR: "traitor",` vào `CONFIG_KEY` ngay sau `SORCERER: "sorcerer",`.

- [ ] **Step 4: Chạy lại, xác nhận PASS**

Run: `npm run test --workspace @masoi/web && npm run build:web`
Expected: PASS, build xanh.

- [ ] **Step 5: Kiểm tra trên trình duyệt**

Chạy dev web + server, mở phòng chờ, xác nhận nhóm Sói có công tắc "Kẻ Phản Bội"; bật nó thì cột Sói +1 và `validateRoomConfig` không báo lỗi số Sói. Chụp màn hình làm bằng chứng.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/lobby-summary.ts apps/web/src/lib/lobby-summary.test.ts
git commit -m "feat(lobby): Ke Phan Boi co cong tac trong nhom Soi"
```

---

### Task 4: Đo lại preset 19-20

**Files:** không sửa code. Kết quả ghi vào báo cáo cho người dùng.

- [ ] **Step 1: Chạy đo**

```bash
npm run build:deps
npx tsx apps/server/scripts/preset-balance.ts run --n 19 --label preset-19 --games 500 --shard 0 --out reports/preset-balance-2026-09-11-traitor
npx tsx apps/server/scripts/preset-balance.ts run --n 20 --label preset-20 --games 500 --shard 0 --out reports/preset-balance-2026-09-11-traitor
npx tsx apps/server/scripts/preset-balance.ts merge reports/preset-balance-2026-09-11-traitor
```

- [ ] **Step 2: Báo cáo**

Lấy số cũ bằng cách chạy đúng hai lệnh `run` trên ở commit TRƯỚC Task 2 (`git stash`/worktree tại `9feb840`), cùng `--games` và `--shard` - không tin số chép trong comment. Báo bảng cũ/mới cho người dùng. Không tự đổi preset: lệch khỏi ngưỡng thì người dùng chọn cách chỉnh.
