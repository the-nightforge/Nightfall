# Deterministic BOT AI Phase 3 — Verification

**Ngày:** 2026-08-29
**Spec:** `docs/superpowers/specs/2026-08-29-bot-ai-phase-3-design.md`
**Plan:** `docs/superpowers/plans/2026-08-29-bot-ai-phase-3.md`
**Nhánh:** `main`
**Mốc bắt đầu:** `0e86506` — engine 420, server 263, web 78

---

## 1. Kết quả kiểm tra

| Hạng mục | Lệnh | Kết quả |
| --- | --- | --- |
| Build toàn monorepo | `npm run build` | XANH (shared → engine → server → web) |
| Test toàn monorepo | `npm test` | XANH — engine **600**, server **263**, web **98** |
| Lint toàn monorepo | `npm run lint` | XANH |
| Whitespace | `git diff --check` | SẠCH |
| Deterministic replay | `tests/selfplay.test.ts` | XANH, gồm cả khi bật sự kiện động |
| Knowledge boundary | `tests/selfplay-invariants.test.ts` | XANH — 12 bất biến, mỗi cái có test bơm lỗi cố ý |
| Self-play smoke | trong test suite | 30 ván + bộ vai mở rộng, 0 vi phạm |
| Batch lớn | `npm run selfplay -- --seed final --games 300 --verify-replay` | 0 vi phạm, 0 phân kỳ replay |
| `Math.random` trong đường quyết định BOT | grep `packages/game-engine/src/bot/**` | **0 kết quả** |
| `Date.now` trong lõi BOT | grep `packages/game-engine/src/bot/**` | chỉ trong một comment |
| Provider không quyết định gameplay | `apps/server/src/bots/types.ts:127` | `BotBrain` chỉ còn `renderDaySpeech` + `decideDefense`, cả hai là LỜI NÓI |

---

## 2. Task và commit

| # | Task | Commit |
| --- | --- | --- |
| 0 | Audit Phase 1 + Phase 2 | (không sửa code — không phát hiện lỗi) |
| — | Spec + plan | `495309f` |
| 1 | `BotWeights` tập trung | `1b84284`, sửa sau review `713a42f` |
| 2 | BOT explanation trace | `34ca83b` |
| 3 | Tất định toàn phần + nhân self-play v2 | `f98b9c0` |
| 4 | Invariant / security auditor | `c53359e` |
| 5 | Evaluation metrics | `a840e6e` |
| 6 | Strategy quality + 4 hành vi mới | `7a73b2b` |
| 7 | Report builder + CLI | `f045be0` |
| 8 | Hiệu chỉnh, `BOT_WEIGHTS_V2` | `378a3a1` |
| 9 | Verification | (commit này) |

Task 4 và 5 đã **đổi thứ tự** so với plan: metrics tiêu thụ `InvariantViolation` có cấu trúc, nên auditor phải có trước, nếu không phải viết rồi sửa lại.

---

## 3. Số liệu self-play

`npm run selfplay -- --seed final --games 300 --verify-replay` (8 người, v2, có lời nói):

| Chỉ số | v1 (mốc) | **v2 (production)** |
| --- | --- | --- |
| Dân thắng | 10.3% | **43.3%** |
| Sói thắng | 89.7% | **56.7%** |
| Dân bỏ phiếu trúng Sói | 35.0% | **47.1%** |
| Sói tố / bầu đồng bọn | 0.0% | **17.9%** |
| Tỉ lệ đổi phiếu | 29.5% | 30.4% |
| Đồng thuận | 0.481 | 0.576 |
| Gắn kết coalition | n/a | 0.028 |
| Bằng chứng hết hạn | 0.1% | 0.1% |
| Lặp lời thoại | 11.9% | **5.0%** |
| Chạm trần vòng | 0.0% | 0.0% |
| **Vi phạm ranh giới hiểu biết** | **0** | **0** |
| Nước đi bị engine từ chối | 0 | 0 |

**Kiểm chéo chống overfit** — ba seed base độc lập, 300 ván mỗi cái:

| Seed base | v1 | v2 |
| --- | --- | --- |
| `sweep` | 12.7% | 48.0% |
| `holdout-a` | 15.3% | 45.0% |
| `holdout-b` | 14.3% | 38.7% |

**Cấu hình khác** — 150 ván, 14 người, bật sự kiện động, `--verify-replay`:
Dân 43.3%, 0 vi phạm, 0 nước đi bị từ chối, 0 phân kỳ replay.

Win rate theo vai bằng đúng win rate theo phe (43.3% cho mọi vai phe làng, 56.7% cho Sói) — đúng như thiết kế, vì thắng thua tính theo phe.

---

## 4. Vì sao v1 hỏng: một phát hiện đo được

v1 để Sói thắng **89.7%**. Nguyên nhân gốc **không phải** chiến thuật kém mà là một sai lệch đơn vị:

> **Thang belief mà mọi ngưỡng dựa vào không bao giờ được chạm tới.**

Đo trên 40 ván (27.559 mẫu belief):

| | p50 | p90 | p99 | ≥40 | ≥58 | ≥85 |
| --- | --- | --- | --- | --- | --- | --- |
| suspicion | 0.0 | 1.8 | 8.6 | 0.55% | 0.55% | 0.55% |
| trust | 0.0 | 0.0 | 100.0 | 6.12% | 6.12% | 6.12% |

Trong khi đó `voteThreshold` = 58, bình độc = 85, Nước thánh = 90. **Mọi ngưỡng đó là chữ chết**, và 0.55% duy nhất vượt qua là các giá trị bị GHIM bằng 100 từ kết quả soi.

Hệ quả: lá phiếu của cả làng thực chất là `argmax` trên một bảng toàn số 0 cộng jitter ±3 — tức một phép tung đồng xu. Độ chính xác đo được 35% khớp gần đúng với ngẫu nhiên (2/7 ≈ 28.6%).

Đã thử **khuếch đại bằng chứng x2 … x8**: độ chính xác đi từ 34.4% xuống 33.6%. Bằng chứng hành vi công khai không mang tín hiệu về việc ai là Sói, nên khuếch đại nó chỉ khuếch đại nhiễu. Đây là dữ liệu bác bỏ giả thuyết đầu tiên, và nó dẫn tới chẩn đoán đúng.

---

## 5. Trọng số đã điều chỉnh và lý do

| Thay đổi | v1 → v2 | Lý do (có số đo) |
| --- | --- | --- |
| `aggression.thresholdBase` | 58 → 6 | Khớp thang belief thật; nếu không, nhánh "đủ căn cứ để đề cử" không bao giờ chạy |
| `confidence.spareTrustMargin` | 15 → 3 | Cùng lý do, cho phiên toà |
| `confidence.hysteresis*` | 5/8 → 2/3 | Cùng lý do, cho quán tính đổi phiếu |
| `confidence.hunterMargin` | 20 → 80 | Ngược lại, GIỮ CAO: chỉ Sói do Tiên Tri xác nhận (=100) mới đáng một phát bắn không ai kiểm lại |
| `roleThresholds.witchPoisonSuspicion` | 85 → 95 | Cùng logic: hai bình dùng một lần cả ván, chỉ tiêu vào mục tiêu đã xác nhận |
| `roleThresholds.priestSuspicion` | 90 → 95 | Nước thánh có phản đòn; ngưỡng phải là "chắc chắn" |
| `deceptionRisk.bussingVoteShare` | (tắt) → 0.2 | Bussing hoạt động: **10% → 20%** win-rate làng |
| `deceptionRisk.bussingJoinBonus` | 0 → 120 | Gỡ phạt là chưa đủ; đồng đội có suspicion ghim 0 nên cần một số hạng dương |
| `deceptionRisk.bussingDeceptionScale` | 0 → 3 | Giữ `deceptionSkill` có ý nghĩa: Sói vụng không dám bán. Scale 4 cho thêm 2 điểm nhưng vô hiệu hoá trait |
| **`deceptionRisk.abstainPressureCeiling`** | **0.3 → 0** | **Đòn bẩy lớn nhất: 27% → 48%.** Xem ghi chú bên dưới |
| `deceptionRisk.allyLostThresholdBonus` | 0 → 6 | Không đo được thay đổi (xem Hạn chế H3) nhưng đúng về hành vi |
| `suspicion.hostilityBonus` | 6 → 20 | +2.6 điểm; các bằng chứng khác gần như không phân biệt được Sói |
| `social.minCohesion` | 0.15 → 0.02 | 0.15 là ngưỡng KHÔNG BAO GIỜ với tới (điểm ghép cặp thật tối đa ~0.03) |
| `selfPreservation.guardRepeatPenalty` | 0 → 20 | Không đo được lợi ích, nhưng bịt một mẫu hành vi người chơi đọc ra sau hai vòng |
| `deceptionRisk.seerRevealRound` | 0 → **giữ 0** | Trực giác nói nên giấu; **số liệu bác bỏ**: hoãn tới vòng 2 mất 4 điểm, vòng 3 mất 9 điểm |

### Ghi chú về `abstainPressureCeiling = 0`

Đây là thay đổi cần nói thẳng nhất. Bỏ phiếu "không treo ai" là một nước **mạnh quá mức** trong hệ thống hiện tại — không phải vì nó hay, mà vì **đòn đối trọng tự nhiên của nó chưa được mô hình hoá**. Ngoài đời, người luôn bỏ phiếu trắng sẽ bị để ý ngay; ở đây `vote-analysis` không sinh ra bằng chứng nào từ hành vi né tránh, nên Sói tiêu được một ngày của làng mà không trả giá gì.

Tắt nó là sửa một **lỗ hổng trong nhận thức của làng**, không phải làm yếu Sói một cách tuỳ tiện. Khi có evidence kind cho hành vi né tránh, nên bật lại và hiệu chỉnh lại.

---

## 6. Bug do test và harness bắt được

| Task | Bug | Nếu không có test |
| --- | --- | --- |
| 1 | `Object.freeze` nông: 9 ô của bảng `evidence` ghi đè được | Một dòng bất kỳ trong process làm hỏng vĩnh viễn cấu hình dùng chung; bug không tái lập được |
| 1 | `nightConfidence` không bị kiểm `[0,1]` | Intention mang xác suất > 1 |
| 1 | `validateWeights` ném `TypeError` khi thiếu nhóm | CLI nạp JSON hỏng nhận stack trace thay vì danh sách lỗi |
| 1 | `resolveWeights` giữ nguyên version sau khi đổi giá trị | Report gán số liệu bản chỉnh tay cho v1 |
| 2 | `sum === score` **không có răng** (score được tính TỪ terms) | Trace nói dối mà test vẫn xanh |
| 3 | `buildRoleDeck` xáo bộ bài bằng `Math.random` dù `assignRoles` đã gieo hạt | "Cùng seed cho cùng ván" **chưa bao giờ đúng trọn vẹn** |
| 3 | Harness bỏ quên `secondaryTargetId` | **Thám Tử bị engine từ chối MỌI đêm** kể từ Phase 2 |
| 4 | Phép kiểm rò rỉ vai bị mất khi viết lại `simulate.ts`; bản cũ còn so `role !== "WEREWOLF"` | Báo động giả với Sói Con và Kẻ Nguyền Rủa đã hoá Sói |
| 5 | `winRateByRole` đếm tử số theo người, mẫu số theo ván | Vai Sói có "tỉ lệ thắng" 200% |
| 5 | `voteChangeRate` = 0 vì **cấu trúc** | `myVote`, `voteHysteresis` và nhánh "giữ mục tiêu cũ" **chưa từng chạy** trong mô phỏng |
| 7 | `fallbackActions` đếm cả Dân Làng không có hành động đêm | Báo ~13 lượt hỏng mỗi ván; con số thật là 0 |
| 8 | Bussing gate trên belief riêng, mà belief đó bị **ghim về 0** | Hành vi tồn tại trên giấy, không lần nào chạy (`bus = 0.0%` trên 200 ván) |

Hai dòng đáng chú ý nhất — `voteChangeRate` và bussing — là những bug mà **không test đơn lẻ nào bắt được**, vì mỗi test tự dựng state của nó. Chỉ một batch đo đạc mới lộ ra rằng một đường code không bao giờ chạy trong ván thật.

---

## 7. Xác nhận bảo mật

- **Bí mật vai tới `GAME_OVER`:** `engine.ts:1211` (`revealAll = phase === "GAME_OVER"`); `botKnowledgeFor` chặt hơn — **không bao giờ** reveal, kể cả ở `GAME_OVER`. Bất biến `ROLE_LEAK` + `DEAD_ROLE_REVEALED` kiểm ở **mọi mốc chuyển pha** của **mọi ván mô phỏng**: **0 vi phạm trên 300 ván + 150 ván cấu hình khác**.
- **Trace ⊆ knowledge view:** `snapshotKnowledge` chỉ sao chép từ `BotKnowledgeView`. 5 test ranh giới, gồm một test quét toàn bộ JSON của trace tìm mã vai.
- **Sói chỉ biết đồng bọn theo luật:** kiểm theo PHE (`roleTeam`), nên Sói Con và Kẻ Nguyền Rủa đã hoá Sói được xử lý đúng. Sói đã chết mất liên lạc — có test.
- **Tiên Tri chỉ biết kết quả của chính mình:** `SEER_RESULT_SCOPE` kiểm cả chủ sở hữu lẫn tính đúng đắn của kết quả.
- **Không hành động bởi/cho người chết:** `ACTION_BY_DEAD` + `DEAD_TARGET`.
- **Lời nói không đổi được nước đi:** `SPEECH_CHANGED_ACTION` chụp nước đi trước khi render rồi so lại — bằng **so sánh**, không bằng tin vào chữ ký hàm.
- **Runner không đưa sự thật cho BOT:** `groundTruth()` chỉ được `invariants.ts` đọc. Độ chính xác phiếu của Dân là 47.1%, không phải ~100% — bằng chứng gián tiếp nhưng chắc chắn.
- **Cùng seed / cùng input → cùng chuỗi action:** `--verify-replay` chạy lại **toàn bộ 300 ván** và so từng sự kiện: **0 phân kỳ**. Thêm test thay `Math.random` toàn cục mà kết quả không đổi, kể cả khi bật sự kiện động.

---

## 8. Hạn chế còn lại

**H1 — Làng thiếu cơ chế tổng hợp thông tin.** Đây là trần thật sự. Tiên Tri tìm ra Sói, nhưng phát hiện đó **không lan** sang phần còn lại của làng: một cáo buộc chỉ tạo ra evidence `ACCUSE` weight 4, ngang một lời nói suông. Không có khái niệm "nguồn đáng tin", không có claim vai được nối vào trust (`evidence.ROLE_CLAIM` weight 5 được khai báo nhưng **không nơi nào phát ra**). Đã đo: mọi đòn bẩy hạ nguồn đều bị chặn bởi đúng nút thắt này. Đây là hạng mục Phase 4 lớn nhất.

**H2 — Bằng chứng hành vi công khai gần như vô dụng.** LATE_SWITCH / BANDWAGON / TIE_BREAK / SAVE_VOTE được rút ra từ hành vi bỏ phiếu, mà hành vi đó lại gần ngẫu nhiên — một hệ thống tự quy chiếu không có neo. Khuếch đại x8 không cải thiện gì.

**H3 — `ALLY_LOST` chỉ bắt cái chết ban đêm.** `adaptToDeaths` chỉ đọc `lastNightDeaths`, nhưng Sói phần lớn chết vì bị treo. Vì vậy `allyLostThresholdBonus` gần như không bao giờ kích hoạt (đo được: 0 thay đổi ở mọi giá trị).

**H4 — CLI không mở cờ cho bộ bài vai.** `--players` dùng deck mặc định. Cấu hình vai mở rộng chỉ được phủ trong test (`selfplay.test.ts`, `selfplay-invariants.test.ts`), không chạy được từ dòng lệnh.

**H5 — `coalitionCohesion` sống nhưng yếu.** 0.028 với ngưỡng 0.02: nhóm được phát hiện nhưng gắn kết rất thấp. `detectCoalitions` cũng **không** tham gia chấm điểm phiếu — nó chỉ là chỉ số.

**H6 — Vân tay v1 đã ghim lại hai lần.** Cả hai đều ở tầng harness (`create` nhận rng; thêm lượt cân nhắc lại), không lần nào chạm `bot/decision`, `bot/roles` hay `bot/belief`, và mỗi lần đều có ~500 test khác xanh xuyên qua. Đã ghi lý do vào chính comment của test.

**H7 — Bussing dùng `deceptionSkill` như một cổng nhị phân**, không phải một đại lượng liên tục. Ở `scale = 3`, Sói có `deceptionSkill < 1/3` không bao giờ bán đồng đội; phần còn lại luôn bán.

---

## 9. Ghi chú vận hành

- **Một tiến trình khác đã sửa cùng working tree** trong suốt Phase 3 (tính năng "event announcement": `engine.ts`, `types.ts`, `shared/snapshot.ts`, nhiều component web). Không thay đổi nào của họ bị đụng tới. Từ Task 2 trở đi không dùng `git add -A`; riêng hunk `GameEngine.create` trong `engine.ts` được đưa vào index bằng `git apply --cached` với patch đúng 9 dòng.
- `npm run lint --workspace @masoi/game-engine` chạy **trực tiếp** sẽ bỏ qua `prelint` (build:deps) và báo lỗi giả do `packages/shared/dist` cũ. **Luôn lint từ gốc.**
- Report lớn không được commit: `reports/` nằm trong `.gitignore`. Fixture mẫu `docs/fixtures/selfplay-sample.json` là 3.2 KB, `timing`/`commit` đặt `null` để nó tất định.
