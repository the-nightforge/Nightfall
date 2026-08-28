# Deterministic BOT AI Phase 2 — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-08-29-bot-ai-phase-2-design.md`
**Ledger:** `.superpowers/sdd/2026-08-29-bot-ai-phase-2/progress.md`

**Goal:** Gỡ hết quyết định game action khỏi provider, và nâng lõi BOT từ "chạy đúng" lên "biết dùng thông tin của vai mình".

**Baseline trước Phase 2** (đo thật trên `4f16983`):

| | |
| --- | --- |
| game-engine | 250 pass / 9 file |
| server | 302 pass / 45 file |
| web | 73 pass / 16 suite |
| lint / build | xanh |

## Ràng buộc xuyên suốt

- TDD nghiêm: RED trước, GREEN sau, mỗi task một commit.
- Không phá behavior Phase 1: đổi phiếu, lịch sử phiếu công khai, bí mật vai tới `GAME_OVER`.
- `packages/game-engine` không import Redis/Prisma/Socket.IO/Express/fs.
- Không `Math.random()` trong `packages/game-engine/src/bot`.
- Mọi evidence phải có `sourceId` tồn tại — `validateEvidence` đã ép, không được nới.
- Strategy và decision chỉ nhận `BotDecisionContext` + `BotBrainState` + `BotRng`.
- Mỗi task cập nhật `progress.md` và ghi `task-N-report.md`.
- `packages/game-engine/tests/phase-1-invariants.test.ts` phải xanh sau **mọi** task.

---

## Task 1 — Belief decay và thông tin riêng vào belief

**Files:** `bot/types.ts`, `bot/belief/belief-state.ts`, `bot/belief/private-info.ts` (new), `bot/BotRuntime.ts`, `tests/bot-belief-decay.test.ts` (new)

**Produces:** `decayBeliefs(state, round)`, `applyPrivateInformation(state, knowledge)`, `EvidenceKind` thêm `SEER_RESULT_WOLF` / `SEER_RESULT_CLEAR`.

RED:
- Suspicion tạo ở vòng 1 phải nhỏ đi sau khi observe ở vòng 4.
- Entry có reason `SEER_RESULT_WOLF` **không** giảm.
- Tiên Tri soi trúng Sói → `suspicion[target].score === 100`.
- Soi ra không phải Sói → trust tăng, suspicion về 0.
- Decay chạy đúng một lần mỗi vòng dù `observe` nhiều lần.

GREEN: `decayBeliefs` dùng `lastUpdatedRound`; `applyPrivateInformation` gọi trong `observe` **trước** decay để evidence mới không bị nguội ngay.

---

## Task 2 — Knowledge boundary cho ban đêm

**Files:** `bot/types.ts`, `bot/knowledge.ts`, `src/engine.ts`, `tests/bot-night-knowledge.test.ts` (new)

**Produces:** `NightKnowledge`, `BotKnowledgeView.night`.

RED (bảo mật trước, tính năng sau):
- Dân Làng ở pha `NIGHT` → `night === null`.
- Sói thấy `legalTargets.KILL` không chứa Sói nào.
- `guardPrevious` chỉ khác `null` với Bảo Vệ.
- `wolfTarget` `null` với Phù Thuỷ khi `wolvesLocked === false`, khác `null` sau khi khoá.
- Serialize `night` của mọi vai → không chứa mã vai nào.
- BOT đã chết → `night === null`.

GREEN: engine dựng `NightKnowledge` từ state đã lọc; `knowledge.ts` vẫn không thấy `GameState`.

---

## Task 3 — Role strategy interface và chiến lược Sói

**Files:** `bot/roles/strategy.ts` (new), `bot/roles/villager.ts`, `bot/roles/werewolf.ts`, `bot/decision/night-decision.ts` (new), `tests/bot-role-strategy.test.ts` (new)

**Produces:** `BotRoleStrategy`, `strategyFor(role)`, `BotNightIntention`.

RED:
- `strategyFor` trả strategy cho **mọi** `Role`, không `undefined`.
- Sói không bao giờ chọn đồng bọn làm mục tiêu cắn.
- Sói ưu tiên người đã claim vai quyền lực.
- Không có mục tiêu hợp lệ → trả `null`, không ném.
- Cùng seed → cùng mục tiêu.

---

## Task 4 — Tiên Tri, Bảo Vệ, Phù Thuỷ

**Files:** `bot/roles/seer.ts`, `guard.ts`, `witch.ts`, `tests/bot-night-strategies.test.ts` (new)

RED:
- Tiên Tri không soi lại người đã soi.
- Bảo Vệ không đỡ `guardPrevious`.
- Bảo Vệ tự đỡ khi bị nhắm nhiều nhất.
- Phù Thuỷ cứu người trust cao; không cứu khi hết bình.
- Phù Thuỷ SKIP khi không có lý do dùng bình.
- Mọi mục tiêu nằm trong `legalTargets` tương ứng.

---

## Task 5 — Phiên toà và Thợ Săn deterministic

**Files:** `bot/decision/trial-decision.ts` (new), `bot/BotRuntime.ts`, `tests/bot-trial-decision.test.ts` (new)

**Produces:** `BotRuntime.decideFinalVote`, `BotRuntime.decideHunterShot`.

RED:
- Sói không Treo đồng bọn.
- Treo khi suspicion vượt ngưỡng; Tha khi dưới.
- Thợ Săn không bắn khi không ai vượt ngưỡng.
- Thợ Săn không tự bắn mình.
- Cùng seed → cùng phán quyết.

---

## Task 6 — Coalition, influence, isolation

**Files:** `bot/analysis/coalition.ts` (new), `bot/decision/vote-decision.ts`, `tests/bot-coalition.test.ts` (new)

RED:
- Ba người luôn bỏ phiếu cùng nhau → một coalition ba thành viên.
- Người không liên kết ai không nằm trong coalition nào.
- `detectCoalitions` deterministic, không phụ thuộc thứ tự khoá object.
- Người bị cả làng nhắm mà không ai bênh → `isolationScore` cao nhất.
- Người được nhiều người bỏ phiếu theo **sau** mình → `influenceScore` cao.

---

## Task 7 — Thích nghi và round summary

**Files:** `bot/types.ts`, `bot/BotRuntime.ts`, `tests/bot-adaptation.test.ts` (new)

**Produces:** `BotRoundSummary`, `adaptToDeaths`, `summarizeRound`, writer đầu tiên cho `currentTheory`.

RED:
- Sau khi đồng bọn Sói chết, BOT Sói nâng ngưỡng vote.
- Người tin tưởng bị giết → người từng công kích nạn nhân bị tăng suspicion.
- `currentTheory` khác `null` sau vòng đầu có bằng chứng.
- Round summary được pin và không bị prune khi memory đầy.

---

## Task 8 — Gỡ provider khỏi mọi quyết định action

**Files:** `apps/server/src/game/machine.ts`, `apps/server/src/bots/types.ts`, `night-context.ts` (new), `apps/server/tests/deterministic-night-scheduling.test.ts` (new)

RED:
- `scheduleNightBots` nộp hành động mà **không** gọi provider.
- `scheduleFinalVoteBots` không gọi provider.
- `scheduleHunterBot` không gọi provider.
- `BotBrain` không còn method nào trả về mục tiêu/nước đi.
- Không còn `Math.random()` trong đường bot của `machine.ts`.

GREEN: gỡ `decideNight`/`decideHunterShot`/`decideFinalVote` khỏi `BotBrain`; giữ `renderDaySpeech` và `decideDefense`.

---

## Task 9 — Evaluation harness

**Files:** `bot/evaluation/simulate.ts`, `metrics.ts` (new), `tests/bot-evaluation.test.ts` (new)

RED:
- Ván mô phỏng kết thúc với winner khác `null` trong `MAX_ROUNDS`.
- Cùng seed → `SimulationResult` bằng nhau từng bit.
- Không nước đi bất hợp lệ nào bị engine từ chối.
- Không BOT nào "biết" vai ngoài phần được phép.
- Chạy 30 seed, cả hai phe đều từng thắng (không có phe thắng 100%).

---

## Task 10 — Tài liệu và verification

**Files:** `README.md`, `docs/bot-ai-phase-2-verification.md` (new), plan Phase 1 (tick checkbox)

- Chạy toàn bộ test/lint/build, ghi số thật.
- Chạy các lệnh invariant (`Math.random`, provider call site, role secrecy).
- Viết report evaluation với số liệu từ harness.
- Liệt kê commit, file đổi, concern còn lại.
