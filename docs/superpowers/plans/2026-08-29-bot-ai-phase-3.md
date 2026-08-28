# Deterministic BOT AI Phase 3 — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-08-29-bot-ai-phase-3-design.md`
**Ledger:** `.superpowers/sdd/2026-08-29-bot-ai-phase-3/progress.md`
**Nhánh:** `main`
**Quy trình:** SDD + TDD. Mỗi task: brief → test RED → triển khai tối thiểu GREEN → focused test → test/lint/build liên quan → commit riêng → task report → tự review.

Mốc trước khi bắt đầu: engine **420**, server **263**, web **78**, lint sạch.

---

## Task 0 — Audit Phase 1 và Phase 2

**Brief.** Xác minh mười yêu cầu của Bước 1 bằng code và test đang chạy. Không sửa gì nếu không có lỗi.

- [x] `git status` / `branch` / `worktree list` / `log -30` — `main` @ `0e86506` chứa Phase 1 + Phase 2
- [x] Đọc spec + plan + ledger Phase 1, Phase 2
- [x] (1) Đổi phiếu đề cử — `submitVote` + 3 test
- [x] (2) Công khai ai vote ai sau khi chốt — `DayVoteRecap` + 2 test
- [x] (3) Vai người chết ẩn tới `GAME_OVER` — `revealAll` + 4 test
- [x] (4) Seeded RNG tất định — `bot/rng.ts` + test thay `Math.random` toàn cục
- [x] (5) Memory / belief / suspicion / social evidence
- [x] (6) Chiến thuật riêng theo role — 7 strategy + passive
- [x] (7) Provider chỉ viết lời thoại — `BotBrain` chỉ còn `decideDefense`
- [x] (8) Cùng seed + input → cùng action — 3 test
- [x] (9) Engine không I/O — test quét import
- [x] (10) engine 420 / server 263 / web 78 xanh, lint sạch
- [x] Ghi ba khoản nợ kỹ thuật N1, N2, N3 vào spec
- [x] Kết luận: **không có lỗi, không cần commit sửa**

**Acceptance:** mọi ô tick, không thay đổi code. → `.superpowers/sdd/.../task-0-report.md`

---

## Task 1 — `BotWeights` tập trung, có type và version

**Brief.** Gom ~70 hằng số rải rác thành một cấu hình đọc-chỉ, có schema. **Refactor thuần**: `DEFAULT_BOT_WEIGHTS` v1.0.0 phải cho ra đúng từng bit hành vi hôm nay (G2).

**RED**
- [ ] `bot-weights.test.ts`: `validateWeights` bắt NaN / Infinity / tỉ lệ ngoài `[0,1]` / version rỗng
- [ ] `resolveWeights(partial)` merge sâu, không mutate mặc định, giữ nguyên trường không nêu
- [ ] Golden replay: `runBotScenario` với 20 seed cho ra kết quả **giống hệt** trước và sau refactor (fixture chốt trước khi refactor)
- [ ] Không hằng số điều chỉnh nào còn nằm ngoài config: test đọc source của `decision/`, `roles/`, `belief/`, `analysis/` và fail nếu thấy số thực trần trong biểu thức chấm điểm

**GREEN**
- [ ] `bot/config/weights.ts` — interface `BotWeights`, `validateWeights`, `resolveWeights`
- [ ] `bot/config/presets.ts` — `BOT_WEIGHTS_V1` (giá trị Phase 2 nguyên trạng), `DEFAULT_BOT_WEIGHTS = BOT_WEIGHTS_V1`
- [ ] `BotRuntimeOptions.weights?`; validate trong constructor
- [ ] Luồn `weights` xuống `selectVote`, `trial-decision`, `belief-state`, `vote-analysis`, `social-analysis`, `coalition`, cả 7 role strategy
- [ ] `BotRoleStrategy.decideNight/voteBias` nhận thêm `weights`
- [ ] Gỡ nhân bản: `±3` jitter (6 chỗ → `confidence.jitterSpan`), `MOST_INFORMATIVE_SUSPICION` (2 → 1), `/100` (5 chỗ → `MAX_BELIEF_SCORE`), `0.8` late-vote (2 → 1)

**Verify:** 420 test engine cũ xanh **không sửa dòng nào**; `npm run lint`; `npm run build`
**Commit:** `refactor: centralize every bot tuning constant into one typed config`

---

## Task 2 — BOT explanation trace

**Brief.** Trace debug được, tắt mặc định, không vượt knowledge boundary (G3, G4).

**RED**
- [ ] `bot-trace.test.ts`: không sink → `decideVote` không sinh trace, kết quả không đổi
- [ ] Có sink → trace ghi đúng candidate, `terms` cộng lại **bằng** `score`
- [ ] `rngDraws` khớp đúng số lần rút; cùng seed → cùng `rngDraws`
- [ ] Ranh giới: trace của BOT phe làng chỉ chứa vai của chính nó; trace của Sói chứa đúng đồng bọn mà `knowledge.knownRoles` đã có, không hơn
- [ ] `fallbackReason` khác `null` khi không có ứng viên hợp lệ
- [ ] Trace có mặt cho cả 5 loại quyết định

**GREEN**
- [ ] `bot/trace/trace.ts` — `BotDecisionTrace`, `BotTraceSink`, `createTraceCollector`, `wrapRngForTrace`
- [ ] `BotRuntimeOptions.trace?: BotTraceSink`
- [ ] Ghi trace trong `selectVote`, `trial-decision` (×2), night strategy, `decideSpeech`
- [ ] Đường tắt sớm khi không có sink

**Verify:** focused + engine + lint + build
**Commit:** `feat: explain every bot decision with an optional trace`

---

## Task 3 — Tất định toàn phần + nhân self-play v2

**Brief.** Đóng N1, N2. Mở rộng harness thành nhân self-play có turn limit, events, speech, trace, replay độc lập.

**RED**
- [ ] `GameEngine.create(players, config, now, rng)` — cùng rng → cùng phân vai; không truyền rng → hành vi cũ
- [ ] `selfplay.test.ts`: cùng seed → `SelfPlayGame` giống hệt từng bit, kể cả khi `events: true`
- [ ] Thay `Math.random` toàn cục không đổi kết quả mô phỏng (kể cả `events: true`)
- [ ] `maxRounds: 1` → ghi vi phạm `ROUND_LIMIT`, không ném
- [ ] `replayGame(record)` chạy độc lập cho ra đúng kết quả cũ
- [ ] `speech: true` → có `BotChatObservation` lưu thông, `chat-analysis` thật sự sinh memory
- [ ] Nhân không đọc `Date.now`, không `fs`

**GREEN**
- [ ] `engine.ts`: thêm tham số `rng` tuỳ chọn cho `create`
- [ ] `evaluation/simulate.ts` → nhân v2: rng gieo cho `startNight`/`startDay`/`lockWolves`/`resolveNight`, stream rng tách riêng engine vs bot
- [ ] Bỏ hack `sort()` + reshuffle
- [ ] `SelfPlayInput` / `SelfPlayGame` / `replayGame`
- [ ] `renderIntentionText` — template thuần, tất định, không thêm thông tin
- [ ] Giữ `simulateGame`/`summarize` cũ như adapter mỏng để test Phase 2 không đổi

**Verify:** focused + engine + lint + build
**Commit:** `feat: make self-play fully seeded and replayable`

---

## Task 4 — Evaluation metrics

**Brief.** Mười ba chỉ số của mục 6 spec, tất định, mẫu số hiện rõ.

**RED**
- [ ] `selfplay-metrics.test.ts`: mỗi chỉ số có một fixture nhỏ với giá trị tính tay
- [ ] Mẫu số 0 → `null`, không phải `0`, không phải `NaN`
- [ ] Cùng batch → metrics giống hệt từng bit
- [ ] `villageVoteAccuracy` dùng sự thật CHỈ ở tầng đo, không bao giờ lọt vào context của BOT
- [ ] `staleEvidenceRate` miễn trừ `PERMANENT_KINDS` (G9)

**GREEN**
- [ ] `evaluation/metrics.ts` — `SelfPlayMetrics`, `TeamMetrics`, `RoleMetrics`, `collectMetrics`
- [ ] Nhân self-play phát `MetricEvent` trong lúc chạy (phiếu, ACCUSE, mutation, speech, evidence, fallback)

**Verify:** focused + engine + lint + build
**Commit:** `feat: measure bot play quality across a batch of games`

---

## Task 5 — Invariant / security auditor

**Brief.** Mười một kiểm tra của mục 7 spec, chạy trong lúc mô phỏng, gom chứ không ném.

**RED**
- [ ] `selfplay-invariants.test.ts`: mỗi `InvariantId` có một test bơm lỗi cố ý và khẳng định nó bị bắt
- [ ] `InvariantViolation` chứa đủ `seed` + `config` để replay; test dựng lại ván từ đúng record đó
- [ ] Vi phạm không ném: batch chạy hết dù ván đầu hỏng
- [ ] Batch 30 ván sạch → `violations.length === 0`
- [ ] `--verify-replay` bắt được `REPLAY_DIVERGENCE` khi bơm một nguồn không tất định

**GREEN**
- [ ] `evaluation/invariants.ts` — `InvariantId`, `InvariantViolation`, `createInvariantAuditor`
- [ ] Cắm checkpoint vào nhân self-play ở từng chuyển pha
- [ ] `SPEECH_CHANGED_ACTION`: chụp intention trước/sau render
- [ ] `NUMERIC_SANITY`: quét score, confidence, belief

**Verify:** focused + engine + lint + build
**Commit:** `feat: audit every simulated game against the knowledge boundary`

---

## Task 6 — Strategy quality scenario tests

**Brief.** Mười scenario của mục 9 spec. Scenario 3 (bussing) là hành vi mới và cần code.

**RED**
- [ ] `bot-strategy-quality.test.ts` — 10 scenario, mỗi cái tất định, tiêu chí đo được
- [ ] Scenario 3 và 4 đỏ trước khi triển khai (bussing chưa có; Tiên Tri hiện chưa giữ kín)

**GREEN**
- [ ] Bussing: Sói bỏ teammate penalty khi `suspicion(ally) ≥ deceptionRisk.bussingSuspicionFloor`, tỉ lệ với `deceptionSkill` — kết thúc trait chết ở N3
- [ ] Tiên Tri: `decideSpeech` không đính evidence `SEER_RESULT_WOLF` ở vòng 1
- [ ] Bảo Vệ: chống lặp mục tiêu bằng lịch sử guard trong brain state
- [ ] Sau `ALLY_LOST`: ngưỡng vote hiệu dụng tăng

**Verify:** focused + engine + lint + build; smoke batch không hồi quy
**Commit:** `feat: hold each role to a measurable standard of play`

---

## Task 7 — Report builder + CLI

**Brief.** Builder thuần trong engine; I/O, timing, commit SHA ở `apps/server/scripts` (G1).

**RED**
- [ ] `selfplay-report.test.ts`: builder thuần — không `Date`, không `fs`; `timing`/`commit` là `null`
- [ ] Cùng batch → report giống hệt trừ `timing`/`commit` (G10)
- [ ] `failedSeeds[].replay` là lệnh chạy được và tái hiện đúng lỗi
- [ ] Test phủ import: `packages/game-engine` không có `fs`/`process`/`child_process`/`net`
- [ ] Fixture mẫu khớp `schemaVersion: 1` và ≤ 20 KB

**GREEN**
- [ ] `evaluation/report.ts` — `SelfPlayReport`, `buildReport`, `formatReportText`
- [ ] `apps/server/scripts/selfplay.ts` — `--seed --games --players --config --out --weights --trace --events --verify-replay`
- [ ] `npm run selfplay` trong `package.json` gốc
- [ ] `reports/` vào `.gitignore`; commit `docs/fixtures/selfplay-sample.json` (12 ván)

**Verify:** focused + engine + server + lint + build; chạy thử CLI
**Commit:** `feat: report self-play results as machine and human readable output`

---

## Task 8 — Hiệu chỉnh và cân bằng

**Brief.** Chạy batch 300 ván trên `BOT_WEIGHTS_V1`, đọc metrics, chỉnh **offline**, chốt `BOT_WEIGHTS_V2`. Không học online.

- [ ] Batch cơ sở 300 ván trên v1; lưu số liệu vào task report
- [ ] Xác định lệch: win-rate theo phe, `villageVoteAccuracy`, `wolfSelfSabotage`, `speechRepetitionRate`, `staleEvidenceRate`
- [ ] Chỉnh có mục tiêu, **mỗi lần một nhóm trọng số**, ghi lý do cho từng thay đổi
- [ ] `BOT_WEIGHTS_V2` trong `presets.ts`; `BOT_WEIGHTS_V1` **đóng băng** làm mốc so sánh
- [ ] Test: v1 vẫn tái lập được đúng số liệu cơ sở (chống trôi ngầm)
- [ ] Test: `DEFAULT_BOT_WEIGHTS.version === "2.x.y"`; win-rate mỗi phe nằm trong `[0.30, 0.70]`
- [ ] Không phe nào thắng bằng cách dùng thông tin bí mật — invariant vẫn 0 vi phạm

**Verify:** focused + toàn bộ engine + server + web + lint + build
**Commit:** `fix: rebalance bot weights from three hundred games of evidence`

---

## Task 9 — Verification cuối và tài liệu

- [ ] `npm run build` (shared → engine → server → web)
- [ ] `npm test` toàn monorepo
- [ ] `npm run lint` toàn monorepo
- [ ] Deterministic replay test
- [ ] Knowledge-boundary / invariant test
- [ ] Self-play smoke batch trong suite
- [ ] Batch 300 ván qua CLI, số liệu thật
- [ ] `git diff --check`
- [ ] Kiểm không còn `Math.random` trong đường quyết định BOT
- [ ] Kiểm provider không có API quyết định gameplay
- [ ] `docs/bot-ai-phase-3-verification.md`
- [ ] Cập nhật ledger

**Commit:** `docs: record bot AI phase three verification`

---

## Thứ tự phụ thuộc

```
0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9
        └──────────┘  Task 3 cần Task 1 (weightsVersion) và Task 2 (trace tuỳ chọn)
                4,5 cần 3 (nhân phát sự kiện)
                6 cần 1 (bussing đọc deceptionRisk từ config)
                7 cần 4,5 (report gói metrics + violations)
                8 cần 7 (CLI để chạy batch lớn)
```

Không bắt đầu task sau khi task hiện tại chưa review sạch.

## Review sau mỗi task

Reviewer là subagent **read-only, độc lập**, nhận diff và spec, không nhận lý lẽ của người viết. Kiểm ba trục: spec compliance, chất lượng, bảo mật. Findings vào task report. Nếu không có subagent, tự review diff nghiêm ngặt và ghi findings.
