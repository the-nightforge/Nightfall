# BOT AI Phase 5 — Khai vai trong chat và mô hình uy tín của làng — Verification

**Ngày:** 2026-08-30
**Spec:** `docs/superpowers/specs/2026-08-30-bot-role-claim-design.md`
**Plan:** `docs/superpowers/plans/2026-08-30-bot-role-claim.md`
**Nhánh:** `feat/bot-role-claim`
**Mốc bắt đầu:** `f9ba93b` — engine 815, server 510, web 145 = 1.470, 0 đỏ
**Mốc kết thúc:** `bb4f1e4` — engine **1.494**, server **518**, web **145** = **2.157**, 0 đỏ

---

## 1. Kết quả kiểm tra

| Hạng mục | Lệnh | Kết quả |
| --- | --- | --- |
| Test toàn monorepo | `npm test` | XANH — engine **1.499**, server **518**, web **145** |
| Test riêng engine | `npx vitest run --root packages/game-engine` | 46 file, 1.499/1.499, 5.16s |
| Test riêng server | `npx vitest run --root apps/server` | 60 file, 518/518, 1.90s |
| Lint toàn monorepo | `npm run lint` (từ gốc) | XANH — game-engine, web, server |
| Whitespace | `git diff --check f9ba93b` | SẠCH |
| Fingerprint v1 | `wolfWins === 22` trên 24 ván | XANH, không đổi |
| Fixture self-play | `docs/fixtures/selfplay-sample.json` sinh lại | chỉ thêm khoá, không đổi con số cũ |

Toàn bộ số trong tài liệu này lấy từ `task-7-report.md` (đo đạc gốc) trừ khi ghi chú khác; số test ở trên do đợt sửa cuối (review toàn nhánh) chạy lại ngày 2026-08-30. Engine 1.494 → 1.499 là năm test mới của đợt sửa đó.

**Đợt sửa cuối đã làm dịch số đo cân bằng.** Mọi con số win-rate ở §5 là số ĐO TRƯỚC đợt sửa; §5.1 có số đo lại và giải thích cơ chế của phần chênh. Đọc §4 và §5 phải đọc kèm §4 (bảng đo lại) và §5.1.

---

## 2. Task và commit

| # | Task | Commit |
| --- | --- | --- |
| 1 | Nhóm trọng số `claim`, preset `4.0.0` (tắt ở v1–v3) | `036cb37` |
| 2 | Speech kind `CLAIM_ROLE`/`COUNTER_CLAIM` + mẫu câu + sweep vòng lặp chữ | `89100ed`, `3268c39` |
| 3 | `decideChatClaim` — PROACTIVE / UNDER_FIRE / COUNTER | `56ae036`, `75134fa`, `3b83b23` |
| 4 | Nhánh claim trong `planSpeech`, `holdSeerEvidence` có điều kiện | `be1e6d0`, `0e3c388` |
| 5 | Cổng `CLAIM_INTEGRITY` ở server | `a8b8877`, `7198996`, `8adc546`, `46cca3c` |
| 6 | `claim-credibility.ts` — bốn tín hiệu S1–S4 | `0cb2fa9`, `8274772` |
| 7 | Bốn chỉ số self-play, đo cân bằng và chi phí | `22f0fda`, `a3e8688` |
| 8 | Pha bào chữa về lõi + **lật mặc định sang v4** | `699e654`, `bb4f1e4` |
| 9 | Văn bản này | — |

---

## 3. Mục tiêu G1–G6

| # | Mục tiêu | Đạt? | Bằng chứng |
| --- | --- | --- | --- |
| **G1** | BOT khai vai được, BOT khác đọc được | Đạt | `claimsPerGame` 3.363 (v4, 300 ván); cổng `CLAIM_INTEGRITY` xác nhận câu khai đọc ngược đúng vai (§7) |
| **G2** | Sói khai láo chủ động, không chỉ khi bị dồn | Đạt | Nhánh PROACTIVE của Sói (`claim-decision.ts`) là một nhánh riêng, không phụ thuộc bị dồn; `wolfBluffChance: 0.35` từ vòng 2 |
| **G3** | Làng phân xử bằng bốn tín hiệu công khai | Đạt về cấu trúc, hiệu quả có giới hạn | `claim-credibility.ts` phát cả S1–S4; hiệu quả đo được ở `claimFollowRate`/`claimAccuracy` (§4) — nhưng xem §9 C1 (Bảo Vệ bẻ gãy S3 có chủ đích) |
| **G4** | Mật độ 2–4 lời khai/ván ở bàn 12–14 người, mỗi BOT tối đa 1 vai | Đạt | `claimsPerGame = 3.363`, trong khoảng [1,6] test giữ ở batch 60 ván; `CLAIM_ONCE` 0 vi phạm trên 600 ván v4 (§8). *(Cập nhật: bằng chứng này đo ở **8 người, bộ bài runner 3 vai**, không phải bàn 12–14 mà mục tiêu nêu. Lời khai/ván đi theo số vai đặc biệt chứ không theo số người; trên `PRESET_DECKS[12]` (9 ghế đặc biệt) v31 cho 5,52/ván. Đơn vị ổn định là lời khai/ghế đặc biệt: 0,54–0,61 ở mọi bộ bài. "Mỗi BOT tối đa 1 vai" vẫn đúng — 0 lần khai lặp. Test gác mới: `bot-claim-metrics.test.ts`.)* |
| **G5** | Lời khai BOT và lời khai người thật là cùng một thứ, cùng qua parser | Đạt về kiến trúc, có giới hạn thật | Cả hai đi qua `analyzeChat`; nhưng parser bảo thủ tới mức bỏ sót cách người thật gõ (§9 C2) |
| **G6** | Nhà cung cấp không tạo ra và không xoá được lời khai | Đạt, sau hai vòng vá | `CLAIM_INTEGRITY` — nhưng shipped với hai lỗ thật ở Task 5, xem §10 |

Không mục tiêu nào trong G1–G6 là "không đạt" tuyệt đối, nhưng G3 và G5 đạt được **có giới hạn đã biết và cố ý để nguyên** (§6.3 của spec: "Ba chỗ cố ý để làng sai"), không phải giới hạn tạm thời sẽ vá sau.

---

## 4. Bốn chỉ số claim — con số thật

Đo trên `BOT_WEIGHTS_V4`, 300 ván, seed set A (`measure-claim-0..299`), từ `task-7-report.md` §3:

| Chỉ số | Giá trị | n |
| --- | --- | --- |
| `claimsPerGame` | 3.363 | 300 ván |
| `counterClaimRate` | 0.56 (168/300) | 300 ván |
| `claimFollowRate` | 0.477 (218/457) | 457 lời khai có chỉ tên |
| `claimAccuracy` | 0.8875 (71/80) | 80 lần làng tin một lời khai Tiên Tri |

**`claimAccuracy` phải đọc kèm khoảng tin cậy, không phải điểm ước lượng trần.** Với 71/80, khoảng Wilson 95% là **[80%, 94%]** (tính trực tiếp, không phải quy tắc ước lượng thô). Ở n=80 khoảng này rộng gần 14 điểm — **"88.75%" không được trích như thể chữ số thập phân thứ hai có nghĩa.** Batch B độc lập (seed set thứ hai, §5) đo được 54/67 = 80.6%, nằm sát cận dưới của chính khoảng Wilson này — đúng dạng dao động lấy mẫu ở cỡ mẫu này, không phải một tín hiệu xấu đi.

Cả bốn chỉ số vượt ngưỡng thiết kế: `claimsPerGame` trong dải 2–4 của G4, `counterClaimRate` nằm chặt trong (0,1), `claimFollowRate` rõ ràng khác 0 (đối chứng v3 = 0 tuyệt đối, vì v3 không có claim), `claimAccuracy` vượt xa sàn 50%.

**Đo lại sau đợt sửa cuối (review toàn nhánh).** Đợt sửa đó cho mô hình uy tín đọc CẢ `COUNTER_CLAIM`, không chỉ `ROLE_CLAIM` (xem §10.7). Hành vi đổi, nên bốn con số đổi theo. Cùng seed, cùng preset:

| Chỉ số | Bộ A trước | Bộ A sau | Bộ B trước | Bộ B sau |
| --- | --- | --- | --- | --- |
| `claimsPerGame` | 3.363 | **3.360** | 3.363 | **3.343** |
| `counterClaimRate` | 0.560 | **0.573** | 0.560 | **0.563** |
| `claimFollowRate` | 0.477 (218/457) | **0.454 (214/471)** | 0.476 (207/435) | **0.462 (210/455)** |
| `claimAccuracy` | 0.888 (71/80) | **0.857 (66/77)** | 0.806 (54/67) | **0.786 (55/70)** |

`claimAccuracy` vẫn cách xa sàn 50% ở cả hai bộ. Ba chỉ số còn lại gần như đứng yên — mật độ và tỉ lệ phản bác không đổi, vì đợt sửa chạm vào cách ĐỌC lời khai chứ không chạm vào cách quyết định khai.

### 4.1 Ba lựa chọn định nghĩa đằng sau `claimFollowRate`/`claimAccuracy` — không lệch cùng hướng

Ba lựa chọn khi định nghĩa "làng đã tin/đi theo một lời khai" (`task-7-report.md`, Finding 5 vòng review):

1. **Đòi phiếu ĐỔI**, không tính phiếu đã sẵn đặt vào đúng người trước khi có lời khai — **bảo thủ, đếm thiếu**. Đúng để tách "làng bị thuyết phục" khỏi "làng vốn đã nghĩ vậy", nhưng cũng bỏ sót trường hợp người bỏ phiếu đã nghiêng sẵn và chỉ ở lại chỗ đó sau lời khai (đồng tình thật, chỉ không phải một cú đổi).
2. **Chỉ tính phiếu của phe làng**, loại phiếu Sói dù nó cũng rơi trúng mục tiêu (bussing, hoặc chính Sói khai láo đang tự chỉ) — **bảo thủ, đếm thiếu**. Đúng để cô lập "làng bị thuyết phục", nhưng cũng làm hẹp mẫu số.
3. **Cho phép phiếu đổi rơi vào TRỌN một vòng SAU lời khai**, không chỉ đúng vòng đó — **PHỒNG, không phải bảo thủ**. Đây là lựa chọn duy nhất kéo dài cửa sổ thay vì thu hẹp nó: nó không phân biệt được "hiệu ứng của lời khai lan sang vòng sau" với "đồng thuận cuối ván hình thành độc lập, đằng nào cũng tới". Nới cửa sổ này kéo cả tin đồng thuận muộn không-do-claim vào tử số `claimFollowRate` và vào dân số `claimAccuracy`.

Hai lựa chọn đầu che chắn khỏi việc thổi phồng chỉ số; lựa chọn thứ ba làm ngược lại. Chúng **không** trung hoà lẫn nhau theo cấu trúc — báo cáo gốc không đo được chiều nào thắng thế — nên đọc `claimFollowRate`/`claimAccuracy` như hai con số có thể lệch về phía cao hơn thực tế một phần, và lệch về phía thấp hơn thực tế ở phần khác, cùng lúc.

---

## 5. Cân bằng — hai bộ seed, không trung bình hoá

Ngưỡng chấp nhận là dải 28–68% Dân thắng (spec §12); dịch quá ~5 điểm phải quy được cơ chế, không đổ cho nhiễu.

| | Bộ seed A (`measure-claim-…`) | Bộ seed B (`measure-claim-b-…`, độc lập) |
| --- | --- | --- |
| v3 Dân thắng | **41.0%** (123/300) | **39.67%** (119/300) |
| v4 Dân thắng | **51.0%** (153/300) | **51.67%** (155/300) |
| Chênh lệch | +10.0 điểm | +12.0 điểm |
| z (two-proportion) | 2.457 (p ≈ 0.014) | 2.950 (p ≈ 0.0032) |
| `villageVoteAccuracy` v3 → v4 | 46.2% → 50.5% | 47.2% → 51.3% |
| `claimAccuracy` (v4) | 88.75% (71/80) | 80.60% (54/67) |

Cả hai bộ nằm trong dải 28–68%. Cả hai chênh lệch vượt ngưỡng ~5 điểm của spec, và cả hai có ý nghĩa thống kê riêng biệt (p < 0.05) — bộ B thậm chí rõ ràng hơn bộ A, không kém hơn. Đây là kết quả tái lập trên hai mẫu độc lập, không phải một lần đo may mắn.

**Cơ chế được đặt tên:** lời khai chủ động của Tiên Tri thật (nhánh PROACTIVE của `decideChatClaim`) cho thông tin của nó một kênh đến cả bàn; `claim-credibility` (`accusationWeight: 12`, gấp ba một `ACCUSE` thường) khiến mô hình niềm tin của làng nặng đủ để thật sự đổi phiếu. `claimFollowRate` (47.7%, n=457) cho thấy làng đi theo khoảng một nửa số lời khai chỉ đích danh; `claimAccuracy` (80–89%, n=80 và n=67) cho thấy khi làng tin một lời khai Tiên Tri, gần như luôn là Tiên Tri thật. Độ chính xác phiếu bầu tăng ở cả hai bộ (`villageVoteAccuracy`) là xác nhận độc lập cho cùng cơ chế, không phải trùng hợp riêng của một chỉ số claim.

**Nhưng một cơ chế khớp với dữ liệu không phải là một bằng chứng có kiểm soát.** Không có thí nghiệm nào ở đây cô lập biến — không batch nào tắt riêng `claim-credibility` mà giữ `decideChatClaim` bật để đo phần đóng góp của từng nửa cơ chế; không ai đo mức nhiễu nền của chênh lệch win-rate giữa hai bộ trọng số bất kỳ trên n=300. Câu chuyện cơ chế ở trên là lời giải thích hợp lý nhất cho những gì quan sát được, được hai bộ seed độc lập củng cố — không hơn.

### 5.1 Đo lại sau đợt sửa cuối — lợi thế Dân thắng CO LẠI khoảng một nửa

Đợt sửa cuối (§10.7) cho `claim-credibility` đọc cả `COUNTER_CLAIM`. Cùng seed, cùng preset, v3 không đổi một ván nào:

| | Bộ seed A | Bộ seed B |
| --- | --- | --- |
| v3 Dân thắng (không đổi) | 41.00% (123/300) | 39.67% (119/300) |
| v4 Dân thắng **trước** | 51.00% (153/300) | 51.67% (155/300) |
| v4 Dân thắng **sau** | **45.00%** (135/300) | **46.00%** (138/300) |
| Chênh lệch v4−v3 trước → sau | +10.0 → **+4.0** điểm | +12.0 → **+6.3** điểm |
| `villageVoteAccuracy` v4 trước → sau | 50.5% → **47.5%** | 51.3% → **49.2%** |

v4 vẫn thắng v3 ở cả hai bộ, và mọi tỉ lệ vẫn nằm trong dải 28–68% của spec. Nhưng chênh lệch không còn vượt ngưỡng ~5 điểm ở bộ A, nên **không được tiếp tục trích "+10/+12 điểm"**.

**Cơ chế của phần mất, đã cô lập bằng batch riêng** (bốn biến thể, cùng seed):

- Tắt riêng FIX 2 (`underFire` = "đang dẫn phiếu" thay vì "có ≥1 phiếu"): 41.67%/47.67% — FIX 2 tốn ~2 điểm.
- Tắt riêng FIX 3 (tập vai quyền lực dùng chung): 39.67%/46.00% — **không đổi một ván nào**. Bàn 8 người của harness không chia `PRIEST`/`GUARDIAN_ANGEL`/`MAYOR`/`CURSED`, nên FIX 3 chưa được đo ở đây.
- Giữ nguyên toàn bộ đợt sửa nhưng LOẠI `COUNTER_CLAIM` khỏi danh sách tín hiệu: 50.33%/50.00% — tức về gần đúng mốc cũ. **Toàn bộ phần mất đến từ việc tính `COUNTER_CLAIM`**, không phải từ việc sắp lại thứ tự hay từ FIX 2/FIX 3.
- Loại `COUNTER_CLAIM` khỏi riêng S2: 44.67%/47.00%. Khỏi riêng S3: 42.33%/49.67%. Hai tín hiệu chia nhau phần mất, không tín hiệu nào một mình gây ra nó.

**Vì sao tính phản bác lại làm Dân yếu đi.** Đếm trên 300 ván bộ A: **212/212 câu `COUNTER_CLAIM` là do người phe LÀNG nói, và tất cả đều khai đúng vai thật của mình.** Không một con Sói nào phản bác (nhánh COUNTER Case B của `decideChatClaim` gần như không nổ trong cấu hình này). Nói cách khác, người phản bác gần như luôn là Tiên Tri thật đứng lên đè lại một lời khai láo — và về cấu trúc, họ LUÔN là người nói THỨ HAI, vì con Sói khai trước.

S2 phạt người đến sau nặng hơn (`collisionLatePenaltyScale: 1.6`), nên với `collisionPenalty: 7`, Tiên Tri thật ăn +11.2 nghi ngờ còn con Sói khai trước chỉ ăn +7. Cộng `claimantTrustWeight: 6` (cả hai cùng được) và `nightSurvivedPenalty: 8` (cả hai cùng chịu, vì Sói không cắn ai đêm đó cũng chẳng cắn chính mình), cán cân ròng là **người nói thật nghi ngờ cao hơn kẻ nói dối**. Trước đợt sửa, câu phản bác vô hình — không lợi cho ai, nhưng cũng không hại người nói thật.

Đây là một tương tác thiết kế chưa được giải quyết, **không** phải một lỗi cài đặt: ruling của review là đúng (một câu phản bác *là* một lời khai, và bỏ qua nó khiến kẻ nói dối được thưởng còn người nói thật trắng tay), nhưng nó phơi ra rằng quy tắc "người đến sau đáng tin ít hơn" — hợp lý khi hai lời khai cùng loại — trở thành một hình phạt dành riêng cho người nói thật khi phản bác về cấu trúc luôn đến sau. Cân lại `collisionLatePenaltyScale` (hoặc cho nó chỉ áp giữa hai `ROLE_CLAIM`) là việc của một đợt hiệu chỉnh có chủ đích, có đo, chứ không phải một cú chỉnh số kèm theo đợt sửa này.

---

## 6. Chi phí

| | Bộ A | Bộ B |
| --- | --- | --- |
| v3 | 8.93 ms/ván | 8.50 ms/ván |
| v4 | 9.57 ms/ván | 9.45 ms/ván |
| Chênh lệch | +7.2% | +11.2% |

So với cú nhảy 2,6ms → 8,5ms (v1 → v3, Phase 4 §C8) — gấp 3,3 lần — mức tăng của Phase 5 nhỏ hơn nhiều và không cần tới hai biện pháp Phase 4 đã dùng (ghi nhớ batch theo phiên bản trọng số, hạn giờ tường minh). Không có timeout nào bị nới; suite engine đầy đủ vẫn dưới ngân sách ~5,67s (đo được 4,32–4,75s qua nhiều lần chạy).

---

## 7. Tái lập

- **v1 tái lập từng bit.** `wolfWins === 22` trên 24 ván vẫn xanh sau toàn bộ 8 task, xác nhận lại ở mốc kết thúc `bb4f1e4`.
- **v3 tái lập từng bit.** Đối chứng v3 dùng lại đúng seed của v4 và cho kết quả nhất quán với các báo cáo Phase 4 trước đó (khác biệt duy nhất là seed set khác nhau giữa các lần đo, không phải hành vi đổi).
- **`docs/fixtures/selfplay-sample.json`** sinh lại từ `weightsVersion: "2.0.0"` (claim tắt): diff chỉ **thêm** bốn khoá chỉ số mới (`claimsPerGame: 0`, `counterClaimRate: {0,0,12}`, `claimFollowRate`/`claimAccuracy: null`), không đổi một con số cũ nào.
- **Cạm bẫy đã nêu trong spec (§5.5) đã được tránh đúng cách:** đổi thẳng điều kiện `holdSeerEvidence` từ "vòng < `seerRevealRound`" sang "chưa khai vai" sẽ đảo ngược hành vi v3 (nơi `seerRevealRound = 0` nên bằng chứng soi luôn được nói ra ngay). Điều kiện thật sự triển khai tách theo việc nhóm `claim` có bật hay không, giữ v3 nguyên bit.

---

## 8. Bất biến

| Tên | Nội dung | Trạng thái |
| --- | --- | --- |
| **`CLAIM_INTEGRITY`** | Nhà cung cấp LLM không tạo ra và không xoá được một lời khai; kiểm hai chiều tại điểm phát | Đạt, sau hai vòng vá (§10) |
| **`CLAIM_BLINDNESS`** | `claim-credibility.ts` không import và không chạm `knownRoles`; đảo vai thật không đổi uy tín tính ra | Đạt, kiểm bằng test chuyên dụng |
| **`CLAIM_ONCE`** | Không BOT nào để lại hai `ROLE_CLAIM`/`COUNTER_CLAIM` khác vai trong một ván | Đạt; mở rộng phủ cả `COUNTER_CLAIM` ở Task 7 sau khi phát hiện code hẹp hơn doc-comment của chính nó; 0 vi phạm trên 600 ván v4 |
| `ROLE_LEAK`, `SPEECH_SCOPE`, `DEAD_ROLE_REVEALED`, `WOLF_ALLY_SCOPE`, `SEER_RESULT_SCOPE` | Toàn bộ bất biến Phase 4 | Giữ nguyên, chạy nguyên, không đỏ ở bất kỳ task nào |

---

## 9. Concern còn lại

**C1 — Bảo Vệ bẻ gãy S3, và đó là cố ý không vá.** Tiên Tri khai vai, Bảo Vệ che đúng nó, đêm đó người khác chết → làng đọc S3 thành "khai láo" giống hệt trường hợp thật sự nói dối. Cùng một quan sát công khai (Tiên Tri sống, người khác chết đêm đó) sinh ra từ hai nguyên nhân đối lập nhau — một lời khai thật được bảo vệ, và một lời khai láo — và làng không có cách phân biệt. Spec (§6.3) từ chối vá: vá đòi hé cho làng biết đêm qua ai được Bảo Vệ che, tức rò rỉ thông tin không nguồn công khai nào có. Đây là suy luận sai mà người chơi thật cũng mắc, để nguyên đúng cách.

**C2 — Parser vẫn bảo thủ tới mức bỏ sót cách người thật gõ.** `analyzeChat` chỉ nhận `"tôi là "` ở đầu mệnh đề cho `ROLE_CLAIM`. Câu như *"tui tiên tri nè"* hay *"seer đây"* — cách người Việt thật hay gõ trong chat — không sinh ra lời khai nào cả, dù ý nghĩa rõ ràng với người đọc. Đây là đánh đổi có chủ đích (spec N4: không đoán ngữ nghĩa, nới từng mẫu một, mỗi mẫu một test), không phải một lỗ hổng chưa kịp vá — nhưng nó có nghĩa là cơ chế này hoạt động tốt hơn cho BOT (câu luôn đúng khuôn mẫu) so với cho người chơi thật gõ tự nhiên.

**C3 — Luật `playerId` nhỏ nhất khiến cùng một ghế luôn là con nói dối trong bầy.** Sói khai láo chọn "con Sói còn sống có `playerId` nhỏ nhất" để mọi thành viên bầy tự tính ra cùng đáp án mà không cần kênh đồng bộ. Hệ quả: ở cùng một ván, luôn là **cùng một ghế** trong bầy đứng ra nói dối, không phải một lựa chọn ngẫu nhiên hay xoay vòng giữa các thành viên. Một người quan sát nhiều ván (hoặc một BOT khác nếu nó "học" được quy luật này, dù hiện chưa có cơ chế nào làm vậy) có thể suy ra luật cục bộ này theo thời gian.

**C4 — Game không bao giờ lật vai người chết, nên làng vĩnh viễn mù hơn một bậc so với bàn thật.** Treo trúng Sói không xác nhận được lời khai của ai (spec §0.2, §6.3 "Không có phong thánh"). Ở một ván ma sói thật, cái chết của một người thường tiết lộ vai của họ và cho cả bàn một điểm neo chắc chắn để đối chiếu claim. Ở đây, không có điểm neo đó — làng chỉ có bốn tín hiệu gián tiếp (S1–S4) và không bao giờ có xác nhận trực tiếp. Đây là quyết định thiết kế trò chơi có từ trước Phase 5 (spec N2: không đổi luật lật vai), không phải lỗi của cơ chế claim, nhưng cơ chế claim vận hành vĩnh viễn trong điều kiện thông tin nghèo hơn một bàn thật.

**C5 — Định nghĩa `claimFollowRate`/`claimAccuracy` không lệch cùng hướng.** Xem §4.1.

**C6 — `claimAccuracy` mỏng ở cỡ mẫu thực tế.** 80 lần "làng tin một lời khai Tiên Tri" trên 300 ván (khoảng 27 ở batch test 120 ván đã commit). Một seed set khác, hoặc một thay đổi trọng số `wolfBluffFromRound`/`wolfBluffChance`, có thể xê dịch tỉ lệ này vài điểm chỉ vì nhiễu lấy mẫu ở cỡ này.

### Các concern nhỏ, đã hoãn (đánh dấu `minor (deferred)` trong ledger)

- `appliedClaimEvidenceIds` dùng chung trần `weights.limits.seenEvents` (2000) với `seenEventIds`/`repliedMessageIds`. Đủ dùng ở quy mô thực tế (vài trăm mục), nhưng chế độ hỏng khi tràn **nặng hơn** hai danh sách anh em: tràn ở hai danh sách kia chỉ gây phân tích lại vô hại, còn tràn ở đây tái sinh đúng lỗi Critical đã bịt ở Task 6 (bằng chứng bị áp lại nhiều lần, kịch trần điểm belief). Chưa xảy ra hôm nay, đáng một chú thích nêu rõ bất đối xứng.
- Test "v3 không bao giờ khai" ở Task 4 chỉ assert `kind !== "CLAIM_ROLE"`, nên cũng xanh nếu `planSpeech` trả `null` vì một lý do hoàn toàn khác. Được bù bởi test khác và suite vân tay, nhưng bản thân nó không chứng minh được điều nó quảng cáo.
- ~~`bot-weights.test.ts` có một test tên "v2 không thắng bằng cách nới ranh giới hiểu biết" nhưng gọi `runSelfPlay({ weights: DEFAULT_BOT_WEIGHTS })`~~ — **đã sửa ở đợt sửa cuối**: ghim `BOT_WEIGHTS_V2` tường minh, và sửa luôn docstring `V1_FINGERPRINT` ("Task 8 sẽ đổi sang v2" → đã đổi sang v4). Độ phủ v4 không mất, xem §10.6.
- Task 6 phát hiện thêm: `enforcePinnedBudget` (`memory-store.ts`) **có** evict memory pinned (bao gồm `ROLE_CLAIM`) khi vượt `limits.pinned` (60), và `ROLE_CLAIM` sinh được theo từng tin chat chứ không chỉ một lần. Điều này quan trọng vì `task-6-report.md` lập luận sai ở đúng điểm này (xem §10).

---

## 10. Chuyện đã sai trong quá trình triển khai

Một văn bản kiểm chứng đọc như mọi thứ trôi chảy thì không phải một văn bản kiểm chứng. Dưới đây là những khiếm khuyết thật mà quy trình review từng-task đã bắt được, không phải danh sách đã được làm sạch.

### 10.1 Hai mẫu câu trong chính spec không thể phân tích ngược được bởi chính parser chúng phải thoả

Task 2 cài `CLAIM_ROLE` (biến thể SOFT[2]) và `PLAYFUL[2]` đúng theo văn bản spec, rồi chạy sweep cấu trúc quét toàn bộ `SPEECH_TEMPLATES` qua `analyzeChat`. Hai mẫu đó thiếu dấu câu trước cụm `"tôi là "`, nên cụm này rơi giữa mệnh đề thay vì đứng đầu — đúng vị trí parser bỏ qua theo thiết kế (§7.2 của spec: "Parser chỉ nhận vai **ở đầu mệnh đề**"). Người viết implement sửa bằng đúng một dấu phẩy mỗi mẫu, không đổi chữ nào khác. Đây chính xác là thứ bài sweep cấu trúc sinh ra để bắt, và nó bắt được ngay từ lần chạy đầu.

### 10.2 Sweep test ban đầu chỉ phủ một phần nhỏ số mẫu câu

Vòng review đầu của Task 2 phát hiện hàm băm chọn mẫu **không phụ thuộc tone**, nên mọi vòng lặp test rơi trúng cùng một chỉ số mẫu mỗi lần — 15/24 mẫu `CLAIM_ROLE` và 23/24 mẫu `COUNTER_CLAIM` không có test nào từng chạm tới. Sửa bằng một sweep cấu trúc đọc thẳng `SPEECH_TEMPLATES` (624 tổ hợp), không phụ thuộc đường sinh RNG nữa.

### 10.3 Loại claim `COUNTER` được khai báo, ánh xạ, và cho một chỉ số đo — nhưng kế hoạch quên cài nó

`ClaimKind` khai `COUNTER` từ đầu; `types.ts` ánh xạ nó sang speech act `COUNTER_CLAIM`; spec §11.1 mô tả `counterClaimRate` như một chỉ số cổng. Nhưng không nhánh nào trong kế hoạch gốc thực sự sinh ra một claim kiểu `COUNTER`. Phát hiện ở Task 3 khi implementer đối chiếu `decideChatClaim` với các chỗ tiêu thụ nó (Task 4 ánh xạ, Task 7 assert `counterClaimRate > 0`, spec mô tả nó như "thứ đáng giá nhất của tính năng" — cảnh cãi vai). Cài bổ sung ngay trong Task 3, xét trước nhánh PROACTIVE (phản bác mang nhiều thông tin hơn: nêu cả kẻ nói dối lẫn vai bị tranh), hai case tất định không rút số ngẫu nhiên, và Case A (làng gặp kẻ mạo vai mình) giới hạn ở vai chức năng để Ngày Sự Thật không biến thành cả làng phản bác nhau.

### 10.4 Cổng `CLAIM_INTEGRITY` có hai lỗ, phát hiện ở hai vòng review liên tiếp

**Lỗ 1 (Critical, vòng review 1 của Task 5):** cổng ban đầu chỉ so `role` được khai với ý định đã chốt ở lõi, không so `targetId`. Với `COUNTER_CLAIM`, một câu phản bác mang cả vai lẫn người bị phản bác (`targetId`) mà lõi cũng đã quyết. Nhà cung cấp đổi tên người bị phản bác trong câu — dựng lên một cáo buộc công khai mà lõi chưa từng quyết — vẫn lọt qua cổng vì cổng chỉ nhìn `role`. Đây là lỗ của chính bản spec ("so vai được khai"), không phải lỗi người cài. Sửa bằng cách so cả `targetId` cho `COUNTER_CLAIM`.

**Lỗ 2 (Critical, vòng review 2 của Task 5, qua cửa ngược lại):** `parseCounterClaim` chạy trên toàn bộ tin nhắn *trước khi* tách mệnh đề, và được ưu tiên bất kể ý định gốc là gì. Nên một ý định `CLAIM_ROLE` mà nhà cung cấp diễn đạt thành một câu có hình dạng phản bác sẽ bị parse ra `COUNTER_CLAIM` — cổng khi đó bỏ qua phép so `targetId` (vì đang nghĩ kind là `CLAIM_ROLE`), thấy `role` khớp, và **cho qua**. Cùng hạng Critical, cửa ngược lại của lỗ 1. Sửa bằng cách kiểm loại memory parse ra khớp đúng kind của ý định *trước*, rồi mới so trường — fail closed theo kiểu trước, theo trường sau.

Cả hai lỗ đều bị lộ ra vì cùng một nguyên nhân gốc: câu do LLM viết ra có thể có hình dạng khác với ý định lõi đã chốt, và một cổng chỉ so một phần cấu trúc câu (role, hoặc chỉ kind) sẽ luôn có một chiều để trượt qua.

### 10.5 Bằng chứng uy tín bị áp lại nhiều lần mỗi vòng, kịch trần điểm belief

Vòng review đầu của Task 6 phát hiện `observe()` chạy nhiều lần mỗi vòng (vào đêm, vào ngày, vào lúc bỏ phiếu, mỗi lượt thảo luận, khi xét lại, ở phiên toà), và `updateBelief` không dedupe theo id ở điểm tính điểm — nó chỉ dedupe danh sách lý do hiển thị cho người đọc. Kết quả: một lời khai duy nhất được cộng điểm 5–10 lần trong một vòng, đẩy điểm belief kịch trần [0,100] ngay lập tức, xoá sạch mọi tỉ lệ trọng số đã hiệu chỉnh ở Task 1. Đây là lỗ của chính kế hoạch ban đầu — hai đường ingest khác (`ingestChat` dùng cờ "fresh", `ingestRecaps` dùng marker `seenEventIds`) đã có chốt chống-áp-lại từ trước, brief viết cho Task 6 quên nói điều tương tự cần cho `claim-credibility`. Sửa bằng cách giữ `claimEvidence` thuần và chạy lại được (không có trạng thái nội bộ), rồi theo dõi id đã áp trong `BotBrainState` ở đúng chỗ **áp dụng**, theo khuôn `repliedMessageIds` đã có sẵn.

### 10.6 Tính năng được ship ở trạng thái tắt

Đây là lỗ nặng nhất của cả kế hoạch. Kế hoạch gốc có 8 bước triển khai, không bước nào nói "cho production dùng preset v4". `session-registry.ts` (nơi dựng `BotRuntime` cho phòng thật) không truyền `weights` khi khởi tạo, nên nó rơi về `DEFAULT_BOT_WEIGHTS` — mà cho tới hết Task 7, hằng số đó vẫn trỏ tới `BOT_WEIGHTS_V3`, tức `claim.accusationWeight = 0`. **Toàn bộ cơ chế claim đứng im trong mọi phòng thật** suốt bảy task đầu; con số +10/+12 điểm win-rate ở §5 chỉ tồn tại trong harness self-play, nơi trọng số được truyền tường minh vào `runSelfPlay`.

Phát hiện ở Task 8, khi implementer đọc `session-registry.ts` để tìm chỗ nối pha bào chữa và nhận ra `decideChatClaim` không có đường nào tới được production. Sửa bằng cách nâng `DEFAULT_BOT_WEIGHTS` lên `BOT_WEIGHTS_V4`, không phải bằng cách ghim `weights` tường minh ở chỗ dựng `BotRuntime` — vì `weights.ts` tự viết rằng "mọi API nhận weights đều mặc định về hằng số này, nên không call site nào phải thay đổi chỉ vì cấu hình tồn tại"; nâng mặc định chính là cơ chế phát hành đã thiết kế sẵn, và cũng là cách v3 từng lên trước đó. Cú lật này chỉ làm đỏ đúng một test (`"mặc định trỏ tới v3"`, một khẳng định cơ học về giá trị cũ, không phải hành vi).

**Đính chính (đợt sửa cuối, review toàn nhánh).** Bản đầu của mục này viết rằng mọi test dùng mặc định ngầm vẫn xanh *vì* chúng "hoặc ghim preset tường minh, hoặc chạy qua `simulateGame()` nơi speech bị tắt cứng". Câu đó **không đúng**. Bốn tệp gọi `runSelfPlay({ seed })` với speech BẬT và không ghim preset — `selfplay.test.ts`, `selfplay-invariants.test.ts` (batch 30 ván `audit-*`), `selfplay-conversation.test.ts`, `selfplay-conversation-metrics.test.ts` (batch 12 ván `metric-real-*`) — nên kể từ Task 8 chúng chạy trên v4 với cơ chế claim BẬT. Chúng xanh, và đó là tin tốt đáng nói ra: toàn bộ bộ bất biến self-play (gồm `CLAIM_ONCE`, ranh giới hiểu biết, và các chỉ số hội thoại của Phase 3) nay phủ v4 mà không phải viết thêm một batch nào. Lý do đúng là "chúng xanh vì hành vi mới không phá bất biến nào", không phải "chúng không chạm tới v4".

Một test thì đúng là đang nói dối về preset nó chạy: `bot-weights.test.ts` `"v2 không thắng bằng cách nới ranh giới hiểu biết"` gọi `runSelfPlay({ weights: DEFAULT_BOT_WEIGHTS })` nên đo v4 trong khi tên, docstring và `describe` bọc ngoài đều nói v2. Đợt sửa cuối ghim `BOT_WEIGHTS_V2` tường minh ở đó; độ phủ v4 không mất vì batch `audit-*` ở trên đã có.

### 10.7 Mô hình uy tín mù đúng nửa sau của mọi cuộc cãi vai (review toàn nhánh)

Chỉ nhìn thấy được khi đọc cả nhánh cùng lúc, nên không vòng review theo task nào bắt được. Ba khái niệm bị định nghĩa hai lần ở hai file, và cả ba đã lệch:

1. **`claim-credibility.ts` lọc `type === "ROLE_CLAIM"`, nhưng `chat-analysis.ts` phát ra `COUNTER_CLAIM` rồi `continue` — một câu phản bác không bao giờ sinh kèm một `ROLE_CLAIM`.** Cộng thêm việc `decideChatClaim` xét COUNTER TRƯỚC PROACTIVE, người nói THỨ HAI trong mọi cuộc cãi vai rơi đúng vào loại mà mô hình uy tín bỏ qua. Đo trên 60 ván: 183 `CLAIM_ROLE` so với 49 `COUNTER_CLAIM`. Hệ quả cụ thể: Sói khai láo Tiên Tri ăn trọn thưởng tin cậy S1, Tiên Tri thật phản bác thì không sinh ra một mảnh bằng chứng nào. Sửa bằng cách chuẩn hoá CẢ HAI loại về một hình dạng chung rồi chạy tín hiệu trên đó — S1 nửa tin cậy, S2, S3 áp cho cả hai; S1 nửa buộc tội và S4 vẫn chỉ áp cho `ROLE_CLAIM`, vì `targetId` của một câu phản bác nghĩa là "người này khai láo vai", không phải "người này là Sói".
2. **`underFire` mang hai nghĩa ở hai file.** `BotRuntime` đóng dấu khi người khai có ≥1 phiếu; `decideChatClaim` mở nhánh UNDER_FIRE khi bot đang DẪN phiếu; cả hai docstring đều viết "đang dẫn phiếu". Từ vòng 3 trở đi hầu như ai cũng cõng một phiếu lạc, nên `underFireFactor` (0.25) cắt thưởng tin cậy của gần như mọi lời khai xuống một phần tư. Thống nhất về "dẫn phiếu", và tách `voteLeader` ra một hàm dùng chung để hai chỗ không lệch lại được.
3. **"Vai quyền lực" mang hai nghĩa ở hai file.** `claim-decision.ts` dùng `role !== "VILLAGER"` và cho Sói nấp sau `PRIEST`; `POWER_ROLES` của `claim-credibility.ts` chép tay và thiếu `PRIEST`, `GUARDIAN_ANGEL`, `MAYOR` — nên chỗ nấp AN TOÀN NHẤT của một con Sói bị dồn lại là chỗ mô hình uy tín mù hoàn toàn. Thay bằng một hàm duy nhất ở `@masoi/shared` (`isPowerRole`), suy ra từ `ROLE_META` chứ không chép tay: vai phe làng, không phải `VILLAGER`, không phải `CURSED`.

Điểm 1 đổi hành vi và làm dịch số đo — xem §4 và §5.1. Điểm 3 không đổi một ván nào trong harness 8 người (những vai nó thêm không được chia ở cỡ bàn đó), nên nó chưa được đo, chỉ được lập luận.

---

## 11. Cổng cuối — chưa qua

Mục tiêu chính của Phase 5 là **chất lượng trải nghiệm chat**, không phải win-rate (spec §2: "Người chơi đọc khung chat phải thấy một ván ma sói"). Không chỉ số máy nào ở trên đo được điều đó — `claimsPerGame`, `claimAccuracy`, hay `villageVoteAccuracy` đều là proxy hành vi, không phải phán đoán "đọc lên có ra một cuộc cãi nhau không".

Cổng cuối của kế hoạch (Task 9, Step 4) là một người thật mở một phòng nhiều BOT, chạy một ván trọn vẹn, đọc khung chat, và trả lời có/không cho bốn câu hỏi: có ai hô lên mình là Tiên Tri đúng lúc không, có cảnh cãi vai đọc ra như cãi nhau thật không, sau một lời khai đáng tin lá phiếu làng có nhúc nhích không, và có bị thành chợ không.

**Việc đó chưa xảy ra.** Văn bản này không thay thế được cổng đó, và không kết luận nào ở trên nên bị đọc như thể đã xác nhận chất lượng trải nghiệm. Toàn bộ số liệu ở §4–§6 đo được hành vi thống kê của cơ chế qua self-play; không phép đo nào ở đây trả lời được câu hỏi mà Phase 5 thực sự đặt ra.

---

## 12. Ghi chú vận hành

- Ledger tiến độ đầy đủ, bao gồm mọi ruling và defect được liệt kê ở §10: `.superpowers/sdd/2026-08-30-bot-role-claim/progress.md` (thư mục nằm trong `.gitignore`, không commit).
- Worktree có việc dở của một phiên khác (`apps/web/next-env.d.ts`, sửa nhưng không thuộc kế hoạch này) — không đụng, không stage.
- `task-7-report.md` (`.superpowers/sdd/2026-08-30-bot-role-claim/`) là nguồn số liệu chính của §4–§6; mọi con số self-play trong tài liệu này lấy nguyên từ đó, không đo lại độc lập trong phiên viết văn bản này.
