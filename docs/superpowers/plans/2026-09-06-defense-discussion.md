# DEFENSE Thảo Luận Tự Do Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bật thảo luận tự do trong pha DEFENSE cho mọi người sống (phòng thật + harness đo), rồi đo lại toàn bộ vai trò.

**Architecture:** Harness trước (mở DEFENSE trong self-play để mọi task sau đo được), bot nói + bot nghe, UI/server cổng hiển thị, cuối cùng full sweep 300 ván và spec hiệu chỉnh số. Tái dùng speech-planner/triggers/chain-limits/budget có sẵn; không đổi luật vote, không đổi trọng số evidence, không đổi shape snapshot.

**Tech Stack:** TypeScript, tsx --test / vitest (theo từng workspace), PowerShell 5.1, seed ghép cặp trong `role-power.ts`.

**Spec:** `docs/superpowers/specs/2026-09-06-defense-discussion-design.md` — executor đọc cả hai.

## Global Constraints

- Mọi người CÒN SỐNG được nói trong DEFENSE tới hết `defenseSeconds`; người chết cách ly như cũ.
- KHÔNG đổi luật vote: bị cáo không bỏ phiếu, `guiltyRequired = floor(eligible/2)+1`, hòa/bỏ = Tha.
- KHÔNG đổi `defenseSeconds`.
- Mỗi bot tối đa 2 lượt/DEFENSE (0 cũng hợp lệ — bot chưa đủ tin thì im).
- GIỮ NGUYÊN trọng số evidence `DEFENSE_QUALITY` ở lần này.
- 3 vai trung lập KHÔNG chạy lúc đo — harness assert fail-fast nếu lọt.
- Không đổi shape snapshot nếu tránh được.
- TDD mọi task: failing test → implement tối thiểu → pass → commit.

---

### Task 1: Harness self-play bật DEFENSE

**Files:**
- Modify: `packages/game-engine/src/bot/evaluation/selfplay.ts` (vòng chính quanh dòng 1196-1211, `contextFor` quanh dòng 770-779, `SelfPlayInput` quanh dòng 82-96, `emitSpeech` quanh dòng 565-715)
- Modify: `packages/game-engine/src/bot/evaluation/report.ts` (`SelfPlayBatchInput` quanh dòng 23-47, `runBatch` quanh dòng 85-102)
- Test: khóa bằng test harness mới hoặc mở rộng test hiện có của selfplay (đặt cạnh `packages/game-engine/tests/`, tên `defense-harness.test.ts` nếu chưa tồn tại)

**Interfaces:**
- Consumes: không có (task đầu); đọc `engine.resolveNomination`, `engine.beginFinalVote`, `engine.submitFinalVote`, `runtime.decideFinalVote`, `runtime.decideDefense`/`observe` có sẵn.
- Produces: `SelfPlayInput.defense?: boolean` (mặc định `true` cho đo mới; `false` giữ hành vi cũ byte-for-byte); `trialDefense` window thật (không null) khi bật; `runBatch` truyền cờ xuống từng ván.

- [ ] **Step 1: Viết failing test — bật defense sinh speech phi-bị-cáo**

```ts
// packages/game-engine/tests/defense-harness.test.ts
import { describe, expect, it } from "vitest";
import { runSelfPlay } from "../src/bot/evaluation/selfplay";
// Cấu hình nhỏ nhất có phiên tòa chắc chắn: preset 8 người, seed cố định.
const config = { ...preset8Config, /* copy y nguyên preset 8 từ PRESET_DECKS[8] */ };
it("bat defense: window that co speech cua nguoi khong phai bi cao", () => {
  const game = runSelfPlay({ seed: "defense-on-1", playerCount: 8, config, defense: true, speech: true, maxRounds: 30 });
  const trials = game.nights.flatMap((n) => n.trials ?? []);
  // Nếu seed này không sinh phiên tòa nào, đổi seed khác cho tới khi có rồi chốt seed đó vào test.
  expect(trials.length).toBeGreaterThan(0);
  const windows = trials.map((t) => t.defense).filter(Boolean);
  expect(windows.length).toBeGreaterThan(0);
});
it("tat defense: giu nguyen hanh vi cu (khong speech defense)", () => {
  const game = runSelfPlay({ seed: "defense-on-1", playerCount: 8, config, defense: false, speech: true, maxRounds: 30 });
  // Mọi trial đều không có defense window / không có speech defense.
});
```

(Kiểm tra tên trường trả về thật của `runSelfPlay` trong selfplay.ts trước khi chốt assert — đọc kiểu trả về, không đoán. Nếu shape khác, viết assert theo shape thật: "có speech của actor khác bị cáo trong cửa sổ DEFENSE" vs "không có".)

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run packages/game-engine/tests/defense-harness.test.ts` từ repo root.
Expected: FAIL (chưa có cờ `defense`, chưa có vòng speech — `trialDefense` null).

- [ ] **Step 3: Implement tối thiểu**

```ts
// selfplay.ts — SelfPlayInput thêm:
defense?: boolean; // true = chạy vòng speech DEFENSE thật; false/undefined = hành vi cũ
// contextFor: chỉ null trialDefense khi defense !== true.
// Vòng chính, thay đoạn resolveNomination -> beginFinalVote thẳng:
const outcome = engine.resolveNomination(config.defenseSeconds * 1000, tick(1000));
if (outcome.kind === "TRIAL" && input.defense === true) {
  // Vòng speech DEFENSE: mỗi bot sống (kể cả bị cáo) được lên tiếng qua
  // runtime.decideDefense/observe + emitSpeech, tối đa 2 lượt/bot (Task 2
  // lập lịch chi tiết; ở đây chỉ cần khung vòng lặp + observe để trialDefense
  // window có nội dung). Thứ tự ngẫu nhiên theo seed của ván.
  runDefenseDiscussion(engine, runtimes, input); // đặt hàm cạnh emitSpeech
  engine.beginFinalVote(...);
} else if (outcome.kind === "TRIAL") {
  engine.beginFinalVote(...); // nhánh cũ giữ nguyên
}
// Cuối mỗi ván đo: assert không vai trung lập —
for (const p of engine.state.players) {
  if (p.role === "JESTER" || p.role === "SERIAL_KILLER" || p.role === "EXECUTIONER") {
    throw new Error(`neutral leak trong van do: ${p.role}`);
  }
}
// report.ts: SelfPlayBatchInput thêm defense?: boolean, runBatch truyền xuống.
```

- [ ] **Step 4: Chạy test + suite liên quan**

Run: `npx vitest run packages/game-engine/tests/defense-harness.test.ts` (Expected: PASS), rồi `npx vitest run packages/game-engine/tests/bot-night-strategies.test.ts packages/game-engine/tests/selfplay-invariants.test.ts` (Expected: PASS, không vỡ hành vi cũ vì mặc định giữ nhánh cũ — nếu test cũ nào gọi runSelfPlay không truyền `defense`, hành vi phải y nguyên).

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/bot/evaluation/selfplay.ts packages/game-engine/src/bot/evaluation/report.ts packages/game-engine/tests/defense-harness.test.ts
git commit -m "feat(selfplay): vong speech DEFENSE that + co defense + assert neutral off"
```

---

### Task 2: Bot nói — scheduler đa người trong DEFENSE

**Files:**
- Modify: `apps/server/src/game/machine.ts` (`scheduleDefenseBot` quanh dòng 964-1029 — thay accused-only bằng vòng đa bot)
- Test: `apps/server/tests/` — mở rộng `defense-chat.test.ts` hoặc file mới `defense-discussion.test.ts`: bot phi-bị-cáo được lập lịch nói; cap 2 lượt; bot im khi chưa đủ tin.

**Interfaces:**
- Consumes: Task 1 (khung vòng DEFENSE trong harness gọi cùng scheduler hoặc logic tương đương — nếu harness không đi qua machine.ts, tách lõi lập lịch ra hàm thuần `planDefenseSpeakers(aliveIds, accusedId, rng, maxPerBot)` đặt cạnh `scheduleDefenseBot` để cả hai đường dùng chung).
- Produces: mọi bot sống (gồm bị cáo) đều có thể được gọi nói, tối đa 2 lượt/bot/DEFENSE.

- [ ] **Step 1: Viết failing test**

```ts
// apps/server/tests/defense-discussion.test.ts (đọc defense-chat.test.ts trước để dùng đúng helper dựng phòng/engineresolveChat)
it("bot khong phai bi cao duoc lich noi trong DEFENSE", () => {
  // Dựng ván có bị cáo + ≥2 bot sống khác, chạy scheduler defense mới.
  // Expect: có lệnh speech được xếp cho ít nhất một bot phi-bị-cáo.
});
it("moi bot toi da 2 luot, bot chua du tin thi im", () => {
  // Bot với belief rỗng/trung tính không bị ép nói.
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run test file mới. Expected: FAIL (scheduler cũ chỉ gọi bị cáo).

- [ ] **Step 3: Implement tối thiểu**

```ts
// Tách lõi thuần (để harness Task 1 dùng chung nếu cần):
export function planDefenseSpeakers(
  aliveIds: string[], accusedId: string, rng: () => number, maxPerBot = 2,
): string[] {
  // Thứ tự ngẫu nhiên (seeded) của aliveIds; bị cáo luôn có suất nhưng KHÔNG
  // nhất thiết đầu tiên; mỗi id xuất hiện tối đa maxPerBot lần.
  // JESTER vẫn đi qua decideDefenseSpeech cũ (INDIFFERENT/HUMOR, không claim).
}
// machine.ts: scheduleDefenseBot cũ (accused-only một phát) -> vòng lặp gọi
// từng bot theo planDefenseSpeakers, mỗi lượt dùng renderBotSpeech + decideDefense
// như cũ (giữ nguyên tính cách từng vai, chỉ mở rộng AI ĐƯỢC nói).
```

- [ ] **Step 4: Chạy test**

Run file mới + `defense-chat.test.ts` + `jester-defense.test.ts`. Expected: PASS (giữ nguyên tính cách Hề, giữ cách ly người chết).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/game/machine.ts apps/server/tests/defense-discussion.test.ts
git commit -m "feat(defense): lich noi da bot trong DEFENSE, cap 2 luot"
```

---

### Task 3: Bot nghe — mở rộng `ingestDefenseReview`

**Files:**
- Modify: `packages/game-engine/src/bot/BotRuntime.ts` (`ingestDefenseReview` quanh dòng 959-1008 — nới bộ lọc actor)
- Test: `packages/game-engine/tests/` — file mới `defense-listen.test.ts`: evidence từ lời người khác trong window DEFENSE đi vào quyết định final vote.

**Interfaces:**
- Consumes: Task 1 (window DEFENSE thật trong harness để test có nội dung nghe).
- Produces: evidence `DEFENSE_QUALITY` từ mọi actor trong window (trọng số giữ nguyên).

- [ ] **Step 1: Viết failing test**

```ts
// packages/game-engine/tests/defense-listen.test.ts
it("loi cua nguoi khac (khong phai bi cao) trong window DEFENSE thanh evidence", () => {
  // Dựng trực tiếp BotRuntime + context có trialDefense window + visibleChat
  // gồm 1 câu của bị cáo và 1 câu buộc tội của người khác.
  // Expect: evidence thu được chứa cả hai nguồn (đọc ingestDefenseReview qua
  // observe với defense window — theo đúng chữ ký hiện tại của observe).
});
```

(Đọc `ingestDefenseReview` + `observe` trước để dựng context đúng shape — không đoán field.)

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run file mới. Expected: FAIL (bộ lọc cũ bỏ lời người khác).

- [ ] **Step 3: Implement tối thiểu**

```ts
// BotRuntime.ts ingestDefenseReview: đổi bộ lọc
//   actorId === accusedId  ->  mọi actorId CÒN SỐNG trong window
// (người chết đã bị visibleChat loại từ trước — xác nhận bằng test cách ly cũ).
// Giữ nguyên: đòi trialAccusedId + trialDefense + endedAt, analyzeChat phase
// DEFENSE, evidence DEFENSE_QUALITY, trọng số V11 y nguyên.
```

- [ ] **Step 4: Chạy test**

Run file mới + `bot-belief-decay.test.ts` + `bot-claim-credibility.test.ts` (vì chạm belief/evidence). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/bot/BotRuntime.ts packages/game-engine/tests/defense-listen.test.ts
git commit -m "feat(defense): ingestDefenseReview nghe moi actor trong window"
```

---

### Task 4: UI/server mở cổng nói + full gate kỹ thuật

**Files:**
- Modify: `apps/web/src/components/` — chỗ đọc `view.trial?.canSpeak` (tìm bằng grep `canSpeak` trong `apps/web/src`): mở từ bị-cáo-only → mọi người sống trong DEFENSE (đổi đúng cổng hiển thị).
- Modify: `apps/server/src/game/machine.ts` dòng 979 quanh cổng `canSpeak` (nếu server cũng gác) — mở tương ứng.
- Test: mở rộng test UI/server gần nhất với cổng đó (đọc test hiện có trước, thêm case "người sống phi-bị-cáo canSpeak=true trong DEFENSE; người chết false").

**Interfaces:**
- Consumes: Task 2 (scheduler đa bot).
- Produces: cổng hiển thị/voice cho mọi người sống; full gate kỹ thuật xanh.

- [ ] **Step 1: Grep cổng + viết failing test**

```bash
# Tìm mọi chỗ dùng canSpeak:
Select-String -Recurse apps/web/src apps/server/src -Pattern "canSpeak"
```

Viết test theo file test gần cổng nhất tìm được (đọc file đó trước).

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Expected: FAIL (phi-bị-cáo canSpeak=false).

- [ ] **Step 3: Implement tối thiểu** (đổi điều kiện đúng chỗ cổng, không đụng luật vote/chat-core).

- [ ] **Step 4: Full gate kỹ thuật**

Run: `npm test` từ repo root (Expected: exit 0 toàn bộ 4 workspace), rồi `npm run build` (Expected: exit 0). Ghi lại số test pass từng workspace vào report.

- [ ] **Step 5: Commit**

```bash
git add <các file UI/server + test đã đổi>
git commit -m "feat(defense): mo cong noi DEFENSE cho moi nguoi song"
```

---

### Task 5: Full sweep 300 ván + số liệu

**Files:** Không sửa source (đo thuần). Output: `C:\Users\Hienq\AppData\Local\Temp\opencode\defense-sweep-YYYY-MM-DD.md` + 3 raw log `$env:TEMP\defense-{A,B,C}.log`.

**Interfaces:**
- Consumes: Task 1 (cờ `defense: true` trong harness — xác nhận `role-power.ts` truyền cờ này; nếu script chưa có, thêm đúng 1 dòng truyền `defense: true` cho self-play và test bằng dry-run `--games 5 --only 8` thấy trialDefense window có nội dung — đó là một phần của task này, commit riêng).
- Produces: bảng baseline preset 8–20 + bảng Δ/bậc của 14 TOGGLES roles dưới luật mới.

- [ ] **Step 1: Dry-run xác nhận defense chạy trong đo**

Run: `npx tsx apps/server/scripts/role-power.ts --games 5 --only 8` và kiểm tra output/log có trial DEFENSE thật (không còn "đi thẳng"). Nếu không: thêm cờ defense vào đường gọi self-play của script, commit `feat(measure): role-power chay DEFENSE that`.

- [ ] **Step 2: Chạy 3 luồng song song (tối đa 3, máy share với user)**

```powershell
Start-Job { npx tsx apps/server/scripts/role-power.ts --games 300 --only 8 --only 9 --only 10 --only 11 --only 12 > $env:TEMP\defense-A.log 2>&1 }
Start-Job { npx tsx apps/server/scripts/role-power.ts --games 300 --only 13 --only 14 --only 15 --only 16 > $env:TEMP\defense-B.log 2>&1 }
Start-Job { npx tsx apps/server/scripts/role-power.ts --games 300 --only 17 --only 18 --only 19 --only 20 > $env:TEMP\defense-C.log 2>&1 }
```

speech GIỮ BẬT (mặc định, cấm tắt). Tổng hợp như sweep trước: mean Δ gia quyền theo mẫu, implied = 0.5 + mean/6 (thước ~6đ/bậc), gap > 1.0 so với ROLE_POWER hiện hành thì SUSPECT. Ghi baseline preset + bảng vai + caveat (1 seed family, bot-vs-bot, không pha nào khác đổi) vào file md.

- [ ] **Step 3: Commit file số liệu nếu repo có chỗ chứa (không thì để ngoài repo quốc TEMP và báo đường dẫn)**

Không commit log thô vào repo. Nếu có `docs/` đo lường, chỉ commit file md tổng hợp.

---

### Task 6: Viết spec hiệu chỉnh từ số mới

**Files:**
- Create: `docs/superpowers/specs/YYYY-MM-DD-rebalance-defense-design.md` (ngày viết thực tế)

**Interfaces:**
- Consumes: Task 5 (file số liệu).
- Produces: spec hiệu chỉnh duyệt được: hạ GUARD/DETECTIVE/MAYOR/SEER/WITCH, giảm phạt CURSED, vá preset 13–16 và 18–20 — mọi con số từ Task 5.

- [ ] **Step 1: Tính số chốt từ bảng Task 5**

Quy trình cố định (không chế số): với mỗi vai trong diện — implied = 0.5 + meanΔ/6, làm tròn 0.5; chỉ đổi số khi |gap| > 1.0 so với ROLE_POWER hiện hành (như sweep trước đã làm với SORCERER/ALPHA); CURSED giảm phạt theo cùng công thức. Preset 13–16/18–20: đề xuất thêm/bớt đúng 1 ghế dựa trên baseline mới + vai trò của ghế đó (không đổi 2 ghế/preset khi chưa có số đo cặp riêng).

- [ ] **Step 2: Viết spec theo template spec cũ** (bối cảnh + bảng số đo verbatim + bảng chốt + preset mới + rủi ro), không placeholder, không TBD.

- [ ] **Step 3: Tự review spec** (placeholder scan, nhất quán nội-ngoại, scope, mơ hồ) rồi sửa inline.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/YYYY-MM-DD-rebalance-defense-design.md
git commit -m "docs(spec): hieu chinh can bang sau DEFENSE thao luan tu do"
```

DỪNG ở đây — user review spec hiệu chỉnh trước khi implement số mới (plan khác).

---

## Self-Review

1. **Spec coverage:** §2 luật+time-box → Task 2+4 (luật vote giữ nguyên: không task nào đụng `finalVoters`/`guiltyRequired` ✓); cap 2 lượt → Task 2 (+ test); JESTER tính cách → Task 2 giữ `defense-decision`; §4 nghe+mở rộng + giữ trọng số → Task 3; harness + cờ + assert neutral → Task 1; canSpeak/UI → Task 4; §7 đo + spec hiệu chỉnh → Task 5+6; §8 rủi ro nhiễu → Task 5 ngưỡng |Δ|>>SE + budget Task 2. Đủ.
2. **Placeholder scan:** không TBD/TODO; mọi step có lệnh chạy + expected cụ thể; không "tương tự Task N" thiếu code (Task 2/3/4 đều chỉ rõ file test + assert mẫu).
3. **Type consistency:** `defense?: boolean` Task 1 ↔ Task 5 dùng cờ; `planDefenseSpeakers(aliveIds, accusedId, rng, maxPerBot)` Task 2 dùng nội bộ; `DEFENSE_QUALITY` Task 3 giữ tên; Task 6 đọc đúng file Task 5 ghi. Khớp.
