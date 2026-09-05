# BOT AI Phase 6 — Đo đúng, thuyết phục được, UI trong trận và ván đầu có hướng dẫn — Verification

**Ngày:** 2026-09-05
**Nhánh:** `feat/bot-human-aware`
**Mốc bắt đầu:** `43f84b4` — AI mặc định v17, engine 4.588, server 1.003, web 1.407
**Mốc kết thúc:** working tree (chưa commit) — AI mặc định **v18**, engine **4.589**, server **1.003**, web **1.416**, 0 đỏ

Bốn phần, mỗi phần có "trước / sau" và cách tái hiện. Mọi số self-play dưới đây đo bằng `--preset` (bộ bài xếp hạng thật của bàn 8 người). Bàn `--humans n` **vẫn do bot điều khiển** — nó chỉ gắn cờ `isBot: false` để các nhánh "bàn có người thật" chạy; không được đọc là playtest người thật.

---

## 1. Kết quả kiểm tra

| Hạng mục | Lệnh | Kết quả |
| --- | --- | --- |
| Test engine | `npx vitest run` (packages/game-engine) | 73 file, **4.589/4.589** |
| Test server | `npx vitest run` (apps/server) | 122 file, **1.003/1.003** |
| Test web | `npm test` (apps/web) | **1.416/1.416** |
| Lint | `npm run lint` (gốc) | XANH cả 4 workspace |
| Build | `npm run build` (gốc) | XANH, `/room/[code]` dynamic như cũ |
| Fixture self-play | `docs/fixtures/selfplay-sample.json` sinh lại | chỉ THÊM khoá, không đổi con số cũ |
| v17 tái lập sau khi thêm đo | `--seed rereview-20260905 --games 200 --preset [--humans 4]` so với báo cáo cũ | mọi khoá cũ **bằng từng con số**, chỉ thêm khoá mới |
| Replay tất định | `--verify-replay --humans 4`, 100 ván v18 | **0** REPLAY_DIVERGENCE (sau khi sửa lỗi ở §2.5) |
| Ranh giới hiểu biết | `knowledgeBoundaryViolations` trên mọi batch | **0** |

---

## 2. Phần 1 — Đo đúng chất lượng bot

### 2.1 Vì sao bot không đáp một câu hỏi

Trước đây chỉ có `directQuestionResponseRate` (≈50%) và mọi phần còn lại là "im lặng" không rõ lý do. Harness self-play nay chốt **số phận từng câu hỏi trực tiếp** ở cuối vòng (`QUESTION_OUTCOME`, xem `QuestionOutcome` trong `selfplay.ts`), bằng bằng chứng đọc từ chính state/lịch của nó, không đoán:

| Ngăn | Bằng chứng | v17 bàn bot (2.478 câu) | v17 `--humans 4` (2.455) |
| --- | --- | --- | --- |
| Đã đáp | câu đáp có `replyToMessageId` đúng | 49,6% | 50,4% |
| Parser không nhận ra | người được hỏi đã `observe` chat có câu đó mà không có memory nào trỏ tới họ | **8,6%** | 8,1% |
| Phòng chặn | lõi định đáp, `judgeChainPosition`/hạn mức chặn | 0,0% | 0,0% |
| Hết lượt / hạn mức | hiểu câu hỏi nhưng không còn `decideSpeech` nào sau đó trong vòng | **22,4%** | 21,7% |
| Né — nói việc khác | có lượt, planner chọn ý khác | 17,2% | 17,5% |
| Né — im lặng | có lượt, planner trả `null` | 2,3% | 2,4% |
| Chưa xác định | người được hỏi không còn quan sát chat (chết/ván xong) | 0,0% | 0,0% |

Kết luận đọc được từ số: phần lớn "không đáp" là **hạn mức lượt nói của vòng** (22%) và **planner ưu tiên ý khác** (17%) — đều là lựa chọn thiết kế, không phải lỗi. Parser bỏ sót 8% là chỗ duy nhất đáng sửa ở tầng code (chưa sửa trong đợt này, xem §6). Hai ngăn `ANSWERED` và `directQuestionResponseRate` đo cùng một thứ theo hai đường độc lập và khớp nhau từng con số (có test).

Thêm `SPEECH_BLOCKED` (lý do `BUDGET` / `CHAIN_DEPTH` / `REPLIES_PER_MESSAGE`): 721 câu bị chặn trong 200 ván, **tất cả** vì "đủ phản hồi" — không câu nào là trả lời cho câu hỏi nhắm vào mình.

### 2.2 `fromTemplate` vào thống kê vận hành

`RenderedSpeech.source` mới nói vì sao câu chữ đến từ đâu: `provider` / `provider_retry` / `provider_failed` / `gate_rejected` / `template_silent`. `apps/server/src/bots/speech-stats.ts` cộng dồn trong bộ nhớ với **kích thước cố định** (vài số đếm + histogram 7 ngăn thời gian), không ghi phòng, không ghi nội dung chat, không ghi khoá. Đọc qua `GET /api/health` → trường `botSpeech`. `renderBotSpeech` đo trọn lượt (cả hai lượt hỏi và cổng) và ghi đúng một dòng ở lối ra.

### 2.3 Chỉ số kỹ năng tách ngăn

**Phù Thuỷ giữ bình độc** (60% ván) nay tách ba ngăn rời nhau, cộng đúng bằng mẫu số, kèm đêm giữ bình (`WITCH_HOLD`: người nghi nhất, điểm, ngưỡng, có bị veto tin tưởng):

| Ngăn (v17, bàn bot, 120 ván giữ bình) | |
| --- | --- |
| chết sớm, chưa đêm nào nghi nhất là Sói | 20,8% |
| sống tới cuối, chưa đêm nào nghi nhất là Sói (giữ là đúng) | 13,3% |
| có đêm nghi nhất đúng Sói nhưng dưới ngưỡng | 65,8% |
| đêm giữ bình mà nghi nhất là Sói / mọi đêm giữ bình | 31,9%, cách ngưỡng TB **2,9** điểm |
| đêm giữ bình vì veto tin tưởng | 0,2% |

Ngăn thứ ba **không** được gọi là "quyết định sai": điểm nghi nhất ở những đêm đó đều dưới 10 trên thang 100 (ngưỡng độc là 5), tức một linh cảm mờ. Nó được tách riêng vì đó là ngăn duy nhất mà đổi ngưỡng có thể đổi kết quả.

**Tiên Tri chết sau khai vai** nay phân nhóm đã/chưa khai, mẫu số là Tiên Tri **còn sống bước vào đêm 2**:

| v17 | bàn bot | `--humans 4` |
| --- | --- | --- |
| Đã khai R1, chết đêm 2 | **27,5%** (25/91) | 32,8% (20/61) |
| Chưa khai R1, chết đêm 2 | 6,3% (5/80) | 10,0% (11/110) |
| Chết đêm ngay sau lời khai đầu (mọi vòng) | 33,8% (48/142) | 40,8% (53/130) |

Khai sớm làm nguy cơ chết đêm sau tăng ~4 lần — đây là giá thật của lời khai, không phải "hô sớm là sai": người khai đúng lúc vẫn đổi được một kết quả soi lấy niềm tin của làng (`claimAccuracy` 74–82%).

Test: `packages/game-engine/tests/selfplay-question-outcomes.test.ts` (28 test) — mẫu số, ngăn rời nhau/phủ kín, mẫu 0 → `null`, harness không đổi một sự kiện nào của ván.

### 2.4 Tái hiện

```bash
npm run selfplay -- --seed rereview-20260905 --games 200 --players 8 --preset --weights 17.0.0
npm run selfplay -- --seed rereview-20260905 --games 200 --players 8 --preset --weights 17.0.0 --humans 4
```

### 2.5 Lỗi phát hiện kèm theo

`runBatch(verifyReplay)` không truyền `humanSeats` cho lần chạy đối chứng, nên `--verify-replay --humans n` báo REPLAY_DIVERGENCE giả ở ~15% ván (cả v17). Đã sửa trong `report.ts`, có test 30 ván.

---

## 3. Phần 2 — Khả năng bị thuyết phục (v17 → v18)

### 3.1 Tình huống có kiểm soát

`packages/game-engine/tests/bot-persuasion.test.ts` đi qua `BotRuntime.observe` + `decideVote` THẬT với chat tiếng Việt thật. Bàn 6 người, bot bầu An; bốn người khác đẩy Bình lên đúng khoảng giữa hysteresis thường (3,5) và hysteresis có bonus (5,5), nên chỉ riêng chuyện bonus có áp hay không quyết định lá phiếu.

| Kịch bản | v16 | v17 | v18 |
| --- | --- | --- | --- |
| E. An im lặng, Chi bênh An | đổi sang Bình | đổi | đổi |
| A. An nói 3 câu **có bằng chứng** (khai Bảo Vệ, hỏi Dũng, tin Chi) + Chi bênh | đổi | **giữ An** | đổi |
| D. Cùng A nhưng không dấu, viết tắt, gọi đích danh (`t la bv`, `Dung oi sao vote t?`) | đổi | **giữ An** | đổi |
| B1. Chỉ phủ nhận ×3 (`tôi không phải sói`) → parser bỏ qua, 0 câu | đổi | đổi | đổi |
| B2. `tôi là dân` ×3 (parser hiểu, không gỡ tội) | đổi | giữ | giữ |
| B3. Phản công vô căn cứ ×3 | đổi | giữ | giữ |
| C. Sói (Bình) nói nhiều, bot đang bầu An | đổi | đổi | đổi |
| Áp lực lên Bình chưa đủ (2 câu tố) + bằng chứng tốt | — | — | giữ An |

Số đo gốc (trước sửa): bằng chứng tốt làm điểm An giảm 9,68 → 8,32, nhưng bonus +2 làm Bình phải đạt **13,82** để bot đổi, so với **12,06** nếu An **im lặng**. Nói có căn cứ khó thoát phiếu hơn im lặng — xác nhận hành vi bất hợp lý.

### 3.2 Sửa tối thiểu — preset `18.0.0`

MỘT ô: `confidence.talkerHysteresisExculpatedScale` 1 → 0. Bonus "nói nhiều" nhân với hệ số này khi `suspicion[target]` có một `reason` weight âm sinh trong vòng hiện tại (`hasFreshExculpation`): khai vai quyền lực, được người khác bênh. Ba câu rỗng không sinh reason âm nên vẫn dính như v17 — chống spam giữ nguyên; cá tính, lừa dối, ngưỡng đề cử không đổi. v1..v17 giữ hệ số 1 (có test). `DEFAULT_BOT_WEIGHTS` = v18.

### 3.3 Self-play cùng seed, 3 × 300 ván

Không có chênh lệch nào vượt ±0,3 điểm phần trăm ở cả bàn bot lẫn `--humans 4`; 0 vi phạm bất biến (bảng đầy đủ: `reports/p2-v17-vs-v18.txt`, tái hiện: `--seed p2-{a,b,c} --games 300 --preset --weights {17,18}.0.0 [--humans 4]`). Đúng như kỳ vọng: tình huống "người bị bầu vừa khai vai quyền lực vừa được bênh trong cùng vòng" hiếm giữa bot với bot; bằng chứng của bản sửa là §3.1, self-play chỉ xác nhận không hồi quy.

---

## 4. Phần 3 — UI trong trận (điện thoại)

### 4.1 Vấn đề xác nhận (ảnh `reports/room-ui/p3-before-*.png`)

Mở chat trên điện thoại: tấm trượt 72dvh che khu chơi và đặt phần trang còn lại thành `inert`. Khi trang đang cuộn xuống lưới bỏ phiếu, hoặc khi bàn phím ảo co viewport còn ~500px, **không thấy tên pha lẫn đồng hồ**; sang pha bỏ phiếu không có dấu hiệu gì trong tấm trượt; lối duy nhất tới nút Bỏ phiếu/Treo/Tha là "Đóng" rồi tự cuộn.

### 4.2 Sửa (ảnh `reports/room-ui/p3-after-*.png`)

- **Dải pha trong tấm trượt** (`MobileChatDock`): tên pha + ngày/đêm (cùng `PHASE_META` với thanh pha) + đồng hồ dạng gọn (`Timer compact` — cùng nhịp đếm và hai nấc màu với đồng hồ chính).
- **Pha đổi khi đang gõ**: dải nhấn màu 4 giây và vùng `role="status"` đọc "Đã chuyển sang …". Không tự đóng, không đụng bản nháp.
- **Nút dẫn tới việc đang chờ** (`lib/phase-action.ts`, có test): "Bỏ phiếu ngay" / "Xem hoặc đổi phiếu" / "Treo hay Tha" / "Chọn mục tiêu bắn" / "Hành động đêm" — chỉ hiện khi chính người xem còn thao tác được, theo đúng cờ server (`alive`, `trial.canVote`, `canAct`). Bấm: đóng tấm trượt, cuộn tới và focus khu thao tác (`data-phase-action` trên 4 panel), sau nhịp trả focus của `useModalFocus`.
- Lịch sử phiếu: đã nằm dưới nút chính và tự cuộn trong vùng cao vừa phải — không đổi.

Đã kiểm trực quan (Chrome emulation, không phải thiết bị thật): 390×844 dọc, 390×500 (mô phỏng bàn phím), 844×390 ngang, desktop 1280×720 (dock ẩn, bố cục không đổi). Bản nháp giữ nguyên qua đóng/mở, qua đổi pha và qua nút nhảy. Bỏ qua thảo luận + ván thật với bot chạy trên server cục bộ, `BOT_AI_ENABLED=false`.

---

## 5. Phần 4 — Ván đầu có hướng dẫn

- Trang chủ: nút phụ **"Chơi thử có hướng dẫn"** dưới "Tạo phòng mới" — cùng `beginEntry` (cùng POST `/api/players`, cùng socket), chỉ khác đích `/room/CODE?guide=1`. Bấm liên tiếp không tạo trùng: `pendingRef` khoá và `onEntered` không hạ cờ bận (kiểm bằng 3 lần bấm → 1 phòng, 1 POST).
- Trang phòng: `?guide=1` được cất vào `sessionStorage` theo mã phòng rồi gỡ khỏi URL; chủ phòng tự gọi bot cho đủ 8 bằng đúng sự kiện `room:add-bot`, mỗi snapshot một lượt (không đếm hộ, không vượt 8); bắt đầu ván vẫn là việc của người chơi. **Đính chính (Phase 7):** bản này CHƯA áp bộ bài — phòng vẫn dùng `DEFAULT_ROOM_CONFIG` (không Thợ Săn/Thám Tử) trong khi thẻ nói là preset 8. Phase 7 thêm bước `room:update-config` với `PRESET_DECKS[8]` trước khi gọi bot, có snapshot xác nhận; xem `bot-ai-phase-7-verification.md` §2.
- `GuideBanner`: tấm thẻ nhỏ dưới thanh pha (ở phòng chờ: trên sân người chơi, để nút Bắt đầu dính đáy không che). Không modal, không chặn. Nội dung `lib/guide-steps.ts` (có test): mỗi pha ≤ 2 câu; mục tiêu phe từ `roleGoal`, tên vai từ `ROLE_META`; đề cử và phán quyết nói rõ điểm khác nhau; người chết có bước riêng và không lộ vai.
- Bỏ qua: nút "Ẩn" xoá cờ phiên → không hiện lại cho hết ván lẫn khi tải lại. Đi hết ván hướng dẫn ghi `masoi:guide:completed` vào localStorage (hiện chỉ để đó; trang chủ chưa đổi lời mời theo cờ này). **Phase 7** tách ba trạng thái `active`/`hidden`/`finished`, "Ẩn" không còn ngắt việc chuẩn bị bàn, ván sau trong cùng phòng không tự bật lại, trang chủ đọc cờ hoàn thành — xem `bot-ai-phase-7-verification.md` §4.

Ảnh: `reports/room-ui/p4-*.png`.

---

## 6. Chưa kết luận / chưa kiểm chứng

- **Người thật**: mọi số "humans" đều là bot đội cờ. Kết luận về khả năng bị thuyết phục trước người thật cần playtest — kịch bản và mẫu ghi nhận ở `docs/playtest-human-aware.md`. Chưa thực hiện.
- **Parser bỏ sót 8% câu hỏi do chính bot sinh ra**: đã đo, chưa sửa trong Phase 6. Phase 7 xác định đúng hai mẫu ("hóng ý kiến X.", "X nói rõ hơn được không.") và sửa parser tối thiểu → 0,0%; xem `bot-ai-phase-7-verification.md` §5.
- **Thiết bị thật**: bàn phím ảo, zoom hệ thống, `prefers-reduced-motion` chỉ được suy từ emulation và code (dải pha chỉ dùng đổi màu, không animation). Chưa chạy trên iOS/Android thật.
- **Thống kê `botSpeech` ở production**: cơ chế có, nhưng chưa có số thật vì đợt này không gọi nhà cung cấp trả phí.
- **Cân bằng v18 chỉ đo trên preset 8 người**; bàn 12–16 chưa đo.

---

## 7. Files chính

| Phần | File |
| --- | --- |
| 1 | `packages/game-engine/src/bot/evaluation/selfplay.ts` (QUESTION_OUTCOME, SPEECH_BLOCKED, WITCH_HOLD), `metrics.ts`, `report.ts`, `roles/witch.ts` (`witchPoisonThreshold`), `tests/selfplay-question-outcomes.test.ts`; `apps/server/src/bots/speech-stats.ts`, `speech-renderer.ts`, `types.ts`, `http.ts`, `tests/bot-speech-stats.test.ts` |
| 2 | `packages/game-engine/src/bot/config/weights.ts` (v18), `presets.ts`, `decision/vote-decision.ts` (`hasFreshExculpation`), `tests/bot-persuasion.test.ts`, `tests/bot-weights.test.ts` |
| 3 | `apps/web/src/components/MobileChatDock.tsx`, `Timer.tsx`, `lib/phase-action.ts` (+test), `DayViews.tsx`, `TrialPanel.tsx`, `HunterShotPanel.tsx`, `NightPanel.tsx`, `app/room/[code]/page.tsx` |
| 4 | `apps/web/src/lib/guide-steps.ts` (+test), `lib/guide-session.ts` (+test), `components/GuideBanner.tsx`, `app/page.tsx`, `app/globals.css`, `app/room/[code]/page.tsx` |
