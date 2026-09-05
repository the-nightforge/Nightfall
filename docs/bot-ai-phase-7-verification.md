# BOT AI Phase 7 — Sửa phần còn lại của đợt cải thiện: bộ bài ván hướng dẫn, Thợ Săn, vòng đời hướng dẫn, parser câu hỏi — Verification

**Ngày:** 2026-09-05
**Nhánh:** `feat/bot-human-aware` (working tree, tiếp nối Phase 6, chưa commit)
**Mốc:** AI mặc định **v18** (không đổi trọng số), engine **4.602** (+13), server **1.010** (+7), web **1.450** (+34), 0 đỏ

Bốn vấn đề, mỗi vấn đề có "xác nhận → sửa → kiểm". Mọi số self-play dưới đây đo bằng `--preset` (bộ bài xếp hạng thật của bàn 8). Bàn `--humans 4` **vẫn do bot điều khiển** — chỉ gắn cờ `isBot: false` để các nhánh "bàn có người thật" chạy; không được đọc là playtest người thật.

---

## 1. Kết quả kiểm tra

| Hạng mục | Lệnh | Kết quả |
| --- | --- | --- |
| Test engine | `npx vitest run` (packages/game-engine) | 73 file, **4.602/4.602** |
| Test server | `npx vitest run` (apps/server) | 123 file, **1.010/1.010** |
| Test web | `npm test` (apps/web) | **1.450/1.450** |
| Lint | `npm run lint` (gốc) | XANH cả 4 workspace |
| Build | `npm run build` (gốc) | XANH, `/room/[code]` dynamic như cũ |
| Fixture self-play | `docs/fixtures/selfplay-sample.json` sinh lại (`--seed sample --games 12 --weights 2.0.0`) | chỉ THÊM 2 khoá (`humanQuestionSeenRate`, `humanAddressTrapIgnoredRate`), không đổi con số cũ |
| Replay tất định | `--seed replay-20260905 --games 100 --preset --humans 4 --verify-replay` | **0** REPLAY_DIVERGENCE, 0 vi phạm bất biến |
| Ranh giới hiểu biết | `knowledgeBoundaryViolations` trên mọi batch | **0** |

Ảnh kiểm trực quan: `reports/room-ui/p7-*.png` (reports/ nằm trong .gitignore). Báo cáo self-play: `reports/p7/`.

---

## 2. Vấn đề 1 — Bộ bài của ván hướng dẫn

### 2.1 Xác nhận

- Phòng mới do server tạo dùng `DEFAULT_ROOM_CONFIG` (`packages/shared/src/phases.ts`): 2 Sói, Tiên Tri, Bảo Vệ, Phù Thuỷ — **không** Thợ Săn, **không** Thám Tử.
- `PRESET_DECKS[8]` (`packages/shared/src/balance.ts`): thêm Thợ Săn và Thám Tử.
- Luồng hướng dẫn cũ ở `app/room/[code]/page.tsx` chỉ gửi `room:add-bot`; thẻ hướng dẫn lại nói "Bộ bài dùng đúng preset xếp hạng của bàn 8 người". Sai.
- Test tích hợp `apps/server/tests/guide-prep-integration.test.ts` ghi nhận lệch này ở ca đầu (`DEFAULT_ROOM_CONFIG.hunter === false`, `PRESET_DECKS[8].hunter === true`).

### 2.2 Sửa

`apps/web/src/lib/guide-prep.ts` — một máy trạng thái THUẦN (`stepGuidePrep`): nhận trạng thái cũ + snapshot + đồng hồ, trả về trạng thái mới, **tối đa một sự kiện** cần gửi, và giờ hẹn gọi lại. `apps/web/src/lib/useGuidePrep.ts` là vỏ React (ref + timer). Luật:

1. **Cấu hình trước, bot sau.** `room:update-config` với `PRESET_DECKS[8]` khi bàn còn 1 người (server chỉ chấm cân bằng khi ≥6 người), rồi `room:add-bot` từng con cho tới 8. Đúng hai sự kiện mà nút trong phòng chờ gửi; payload đi qua schema strict của `ws.ts` (test tích hợp parse bằng `updateConfigPayload` thật).
2. **Chỉ tin snapshot.** Gửi xong là "đang chờ"; bước xong khi snapshot mang `isPresetDeck(config, 8)` hoặc sĩ số đã tăng. `update-config` idempotent (server bỏ qua cấu hình y hệt) nên không xác nhận sau 3 giây thì gửi lại, tối đa 3 lần, rồi `failed`. **`add-bot` KHÔNG idempotent** — hai gói là hai bot, bàn 9 người với bộ bài 8 không bắt đầu được — nên **không bao giờ gửi lại theo đồng hồ**: chỉ gửi lại khi server đã phát một snapshot *mới hơn* lần gửi (`serverNow` lớn hơn) mà sĩ số chưa tăng; không có snapshot mới nào sau 9 giây thì `failed` với đúng một gói đã gửi. (Lỗi phát hiện sau vòng review: bản đầu gửi lại `add-bot` theo hẹn giờ, server chậm hơn 3 giây là bàn 9 người. Test tái hiện: `guide-prep.test.ts › "add-bot KHÔNG được gửi lại theo hẹn giờ"` và `GuidePrepHook.test.tsx › "add-bot chưa được xác nhận"`.)
3. **`failed` có lời.** Thẻ hướng dẫn chỉ hai nút để tự làm ("Áp dụng đội hình chuẩn", "+ Thêm bot") kèm số đếm từ snapshot. Tải lại trang thử lại từ đầu.
4. **Làm một lần.** Tới `done` thì ghi `masoi:guide:prep:CODE` vào sessionStorage; tải lại sau khi host tự chỉnh bộ bài hay đuổi bot thì không sửa lại.
5. **Không lặp.** Cùng snapshot đọc lại (re-render, StrictMode, reconnect phát lại) rơi vào "đang chờ, chưa tới giờ" → không gửi.
6. Chỉ chạy khi hướng dẫn đã được **xin** cho phòng này (`active` hoặc `hidden`), người xem là host, phòng ở LOBBY, socket đang nối. Phòng thường không chạm.
7. Thẻ phòng chờ nói đúng bước đang ở: "Đang thiết lập bộ bài" → "Đang gọi bot (n/8)" → "Sẵn sàng bắt đầu". "Sẵn sàng" chỉ khi đủ 8 **và** máy đã `done`; lời "đội hình chuẩn" chỉ khi cấu hình hiện tại đúng là preset, host đã chỉnh thì nói "do bạn tự chỉnh".

### 2.3 Kiểm

| Tầng | File | Nội dung |
| --- | --- | --- |
| Luật thuần | `apps/web/src/lib/guide-prep.test.ts` (15) | đường vui 1+7 sự kiện; cùng snapshot ×10 → 1 sự kiện; không xác nhận → 3 lần rồi failed; rớt mạng; chậm nhưng không mất (server coi gói lặp là "y hệt"); không host; đã done → không sửa bàn host chỉnh; ván đang chạy → im; bàn đủ sẵn → không đụng; một bot bị nuốt → gửi lại đúng bước |
| Server thật | `apps/server/tests/guide-prep-integration.test.ts` (7) | `roomService.updateConfig/addBot` thật, `store` thật, `broadcastRoom` + `buildSnapshot` thật bắn vào socket giả; 1 update-config + 7 add-bot; snapshot cuối đúng preset 8, 8 người, `balanceWarning` không chặn; `room:start` được nhận; reconnect phát lại snapshot cũ → không thừa bot; đã chuẩn bị + host chỉnh → không sửa; không host → im |
| React StrictMode | `apps/web/src/components/GuidePrepHook.test.tsx` (7) | hook mount thật trong `<StrictMode>`: đúng 1 update-config qua mount đôi + 3 render lại; xác nhận từng bước → done + cờ sessionStorage; mất kết nối; tải lại sau done; phòng thường; hẹn giờ thật → failed |
| Trình duyệt | `reports/room-ui/p7-lobby-*.png` | bấm "Chơi thử có hướng dẫn" 3 lần liên tiếp → 1 POST, 1 phòng; phòng lên 8 người, "Đội hình chuẩn cho 8 người", Thợ Săn ×1 / Thám Tử ×1 trong "Chỉnh sửa vai trò"; Redis lưu `hunter: true, detective: true`, 8 members; F5 giữ 8 người, không thêm bot; ván bắt đầu được |

---

## 3. Vấn đề 2 — Hướng dẫn Thợ Săn

### 3.1 Xác nhận

`guideStepFor` trả "Bạn đã chết" trước `switch` cho mọi người chết (trừ ROLE_REVEAL/GAME_OVER). Thợ Săn ở `HUNTER_SHOT` đã chết theo định nghĩa, nên với `hunterShot.canAct = true` vẫn nhận "không còn bỏ phiếu hay hành động đêm". Test tái hiện: `guide-steps.test.ts › "Thợ Săn vừa chết, server cho bắn"` đỏ trước khi sửa.

### 3.2 Sửa (`apps/web/src/lib/guide-steps.ts`)

Hành động đặc biệt mà **server đã cho phép** đi trước lời nhắc chung:

- `HUNTER_SHOT` + `hunterShot.canAct` + `!resolved` → "Thợ Săn: lượt bắn của bạn" (chọn mục tiêu hoặc "Không bắn ai"; hết giờ = không bắn).
- `canAct` + `resolved` → "Đã ghi nhận" (đã bắn X / không bắn ai).
- Người chết + `deadCanSpeak.canAct` → "Tiếng Vọng Người Chết" (một lời nhắn ẩn danh).
- Người chết khác ở `HUNTER_SHOT` → vẫn "Bạn đã chết", kèm tên Thợ Săn đang chọn; người sống → "Thợ Săn X đang chọn người để bắn theo".

Chỉ đọc cờ đã lọc (`canAct`, `resolved`, `deadCanSpeak.canAct`), không suy từ vai, không lộ vai. Rà lại nhánh đêm: `canAct=false`/`night=null` → "vai không có việc ban đêm"; `canAct && !acted` → "lượt của bạn"; `acted` → "đã ghi nhận" (có test phân biệt).

---

## 4. Vấn đề 3 — Vòng đời hướng dẫn

### 4.1 Xác nhận

Bản trước: một cờ `masoi:guide:room:CODE = "1"` vừa điều khiển hiển thị vừa điều khiển thêm bot; "Ẩn" xoá cờ → ngừng luôn chuẩn bị; GAME_OVER chỉ ghi `completed` nhưng cờ phòng còn nguyên → "Về phòng chờ" hay tải lại là hướng dẫn bật lại; `hasCompletedGuide` không ai đọc.

### 4.2 Sửa (`apps/web/src/lib/guide-session.ts`, `app/room/[code]/page.tsx`, `app/page.tsx`)

Ba trạng thái theo mã phòng (sessionStorage), tách khỏi cờ chuẩn bị:

| Trạng thái | Thẻ | Chuẩn bị bàn | Khi nào |
| --- | --- | --- | --- |
| `active` | hiện | chạy | `?guide=1` (gỡ khỏi URL ngay) |
| `hidden` | ẩn | **vẫn chạy** | bấm "Ẩn" |
| `finished` | chỉ lời tổng kết ở GAME_OVER | không | tới GAME_OVER (từ `active` hoặc `hidden`); đồng thời ghi `masoi:guide:completed` (localStorage) |

- Ván sau trong cùng phòng ("Về phòng chờ") hay tải lại sau khi xong: `finished` → không thẻ, không chuẩn bị lại.
- Trang chủ đọc `hasCompletedGuide()` sau hydrate: nút đổi thành "Xem lại ván hướng dẫn", lời mời hạ giọng; nút không bị xoá.
- Kho bị chặn: mọi thao tác bọc try/catch, đọc ra `none`/`false`; hướng dẫn chỉ sống trong bộ nhớ trang, vẫn chuẩn bị bàn được.
- Giá trị `"1"` của bản cũ đọc như `active`.

### 4.3 Kiểm

`guide-session.test.ts` (7): active→hidden→finished; "Ẩn" không hồi sinh phòng đã xong; bật lại từ trang chủ xoá cờ prep; giá trị cũ; kho ném. Trình duyệt: Ẩn → F5 → không thẻ, vẫn 8 người; ván tới GAME_OVER → thẻ "Hết ván" + `finished` + `completed=1`; F5 ở GAME_OVER giữ lời tổng kết; "Về phòng chờ" → không thẻ, không thêm bot, 8 người; trang chủ hiện "Xem lại ván hướng dẫn"; bấm lại vẫn vào được ván hướng dẫn.

---

## 5. Vấn đề 4 — Câu hỏi bot đích không nhận diện

### 5.1 Đo lại (trước khi sửa)

`--seed rereview-20260905 --games 200 --preset` trên working tree trước sửa: `NOT_PARSED` **8,6% (213/2482)**; `--humans 4`: **8,0% (197/2459)**. Khớp báo cáo Phase 6.

Nhãn đo: `recognized` = người được hỏi đã `observe` chat có câu đó **và** có ít nhất một memory `sourceId === messageId, targetId === mình`. Mọi memory như vậy (kể cả `ACCUSE`) đều sinh trigger đáp (`ACCUSED_ME` 100, `QUESTIONED_ME` 95), nên nhãn đúng với câu hỏi "bot có biết mình bị hỏi không".

Toàn bộ 213 câu, gom theo mẫu (script tạm, đã xoá):

| Mẫu | Số câu | Nguyên nhân |
| --- | --- | --- |
| `hóng ý kiến X.` (+ biến thể typo `hóng ý kien`, `hong ý kiến`, `hóngý kiến`) | 155 | không dấu `?`, không từ để hỏi, không tiểu từ gọi |
| `X nói rõ hơn được không.` (+ `hơnđược`, `nóirõ`, `duoc không`) | 58 | đuôi hỏi có/không "được không" không nằm trong dấu hiệu hỏi |

Vì sao chỉ hai mẫu: planner luôn dùng giọng `CURIOUS` cho `QUESTION`/`ASK_EVIDENCE` (`toneFor` trong `speech-planner.ts`), và trong hai bể CURIOUS đó đúng hai mẫu này thiếu dấu hiệu parser nhận. Cả hai là cách người thật cũng gõ → sửa ở **parser**, không đổi mẫu lời thoại cho vừa parser.

### 5.2 Sửa tối thiểu

`packages/game-engine/src/bot/analysis/chat-analysis.ts` — `parseDirectAddress` thêm hai dấu hiệu hỏi, danh sách đóng (không regex mở):

- `YES_NO_TAILS` ở **cuối một mệnh đề**: `được không/ko/k`, `đc ko/k`, `dc ko/k`, `phải không/ko/k`, `đúng không/ko/k`, `hả/hở/hử`; dạng không dấu chỉ nhận cụm hai tiếng (`duoc khong`, `phai ko`, `dung khong`…) vì một tiếng rời bỏ dấu đụng tên người (`hả` → `ha` = Hà).
- `OPINION_REQUESTS`: `hóng ý kiến`, `xin ý kiến`, `hóng ý` (+ ascii `hong y kien`, `xin y kien`).

Vẫn cần một tên khớp **duy nhất** và không phải tên người gửi; hai tên trong câu → im như cũ. Không sinh bằng chứng: "An là sói đúng không" chỉ ra `DIRECT_QUESTION`, không `ACCUSE`.

Hai dấu hiệu mới không có dấu "?" chống lưng, nên chúng chỉ được tin khi phần mệnh đề đứng TRƯỚC dấu hiệu (a) không phủ định (`hasNegation`), (b) không mở đầu bằng giả định (`nếu`, `giả sử`, `lỡ`, `nhỡ`, `ví dụ`, `kể cả`, `dù`, `cứ cho là`), và (c) không nằm trong ngoặc kép (đoạn trích bị bỏ trước khi tìm). "tôi không hóng ý kiến An", "nếu An trả lời được không thì tính sau", "An bảo “nói rõ hơn được không”" → im; "nếu An là dân, An nói rõ hơn được không" (giả định ở mệnh đề trước) → vẫn hỏi. Bảo thủ có chủ ý: "An không phải sói đúng không" không có "?" → im; có "?" thì luật cũ vẫn nhận. Kèm theo, "đâu" cuối câu đã có phủ định ("tôi ko tin An đâu") không còn bị luật cũ đọc là từ để hỏi — "An đâu rồi" vẫn là hỏi. (Lỗi phát hiện sau vòng review; test: `bot-direct-address.test.ts` ba ca "phủ định / giả định / trích dẫn", đỏ trước khi sửa.)

`templates.ts` — `TYPO_PROTECTED` thêm `được, đc, phải, đúng, hả, hở, hử, hóng, ý, kiến, xin` để bộ tạo typo không dính "hơnđược". Sau sửa parser đơn lẻ còn 2/2483 NOT_PARSED (đều là `hơnđược`); sau bảo vệ typo: 0.

### 5.3 Corpus và test

- `human-chat-corpus.ts`: thêm `HUMAN_QUESTIONS` (29: dấu hỏi, từ để hỏi, đuôi có/không, xin ý kiến, không dấu, viết tắt, gọi đích danh) và `HUMAN_ADDRESS_TRAPS` (22: phủ định trước dấu hiệu, người thứ ba, giả định mở đầu, trích dẫn, hai tên, chỉ nêu tên).
- `measureHumanChat` đo thêm `questionSeen`, `addressTrapIgnored`; metrics `humanQuestionSeenRate`, `humanAddressTrapIgnoredRate`; report in "Thấy câu hỏi đích danh" / "Bỏ qua tên chỉ nhắc tới".
- `tests/bot-direct-address.test.ts` +11 (đỏ trước sửa ở 4 + 3 ca); `tests/bot-human-chat.test.ts` +2.

| Corpus | Trước | Sau |
| --- | --- | --- |
| Thấy câu hỏi đích danh | 44,8% (13/29) | **89,7% (26/29)** |
| Bỏ qua tên chỉ nhắc tới | 100% (13/13) | 100% (22/22) |
| Thấy lời buộc tội / bênh vực / khai vai, bỏ qua bẫy | không đổi (87,9% / 88,5% / 100% / 100%) | không đổi |

Ba câu **chưa hiểu**, giữ trong corpus để con số nói thật: `An là tt đúng không`, `An la tt dung khong`, `An đổi phiếu hả` — tên người so ở dạng không dấu nên `đúng`→`dung` đụng **Dũng**, `hả`→`ha` đụng **Hà**, hai tên → parser cố ý không đoán. Sửa cần đổi cách so tên (ưu tiên dạng có dấu), tức đụng mọi mẫu buộc tội/bênh vực — ngoài phạm vi, không sửa.

### 5.4 Self-play trước/sau, cùng seed và cấu hình

Bản "trước" = working tree hiện tại trừ đúng hai sửa (parser, bảo vệ typo): `reports/p7/make-engine-before.py` chép `packages/game-engine/src` sang `reports/_engine-before/` (gitignored) rồi hoàn nguyên hai chỗ đó; chạy bằng `npx tsx reports/_engine-before/run.ts --seed … --games … [--humans 4]`. Bản "sau" = CLI thật (`npm run selfplay`). Lệnh đầy đủ: `reports/p7/run-all.sh`, `reports/p7/run-wr.sh`.

`--seed rereview-20260905 --games 200 --preset [--humans 4]`:

| | bàn bot trước | sau | `--humans 4` trước | sau |
| --- | --- | --- | --- | --- |
| Đáp câu hỏi trực tiếp | 49,7% | **52,7%** | 50,5% | **52,5%** |
| parser không nhận ra | 8,6% | **0,0%** | 8,0% | **0,0%** |
| Dân thắng | 46,0% | 47,0% | 45,0% | 46,0% |
| Vi phạm bất biến | 0 | 0 | 0 | 0 |

(Báo cáo đầy đủ: `reports/p7/before-*.txt`, `reports/p7/after2-*.txt`; `after-*.txt` là bản trước khi thêm ba bộ lọc phủ định/giả định/trích dẫn, cùng 0,0% NOT_PARSED.)

Phần 8% chuyển sang ba ngăn "đã đáp" (+3,5) / "hết lượt" (+2) / "né" (+3): bot nay **biết** mình bị hỏi, và số phận còn lại là lựa chọn của planner/hạn mức như mọi câu hỏi khác.

3 × 300 ván (`--seed p7-{a,b,c}`, đo ở bản trước khi thêm ba bộ lọc), Dân thắng: bàn bot 51,2% → 53,3%, `--humans 4` 51,9% → 53,2% (từng seed: +2,0 / +4,3 / 0,0 và +0,7 / +3,4 / 0,0). Lệch trung bình +1–2 điểm, trong nhiễu ±3 của 300 ván, không seed nào giảm; không đổi trọng số nào. Hướng lệch có thể giải thích: bot đáp nhiều hơn → làng có nhiều lời khai/bênh vực hơn. Chưa đo lại 3 × 300 sau ba bộ lọc; batch 200 ván ở trên cho thấy cùng bức tranh.

---

## 6. Chưa kiểm chứng

- **Người thật**: mọi số "humans" là bot đội cờ; T3 trong `docs/playtest-human-aware.md` vẫn cần chạy với người.
- **Bot đáp trong phòng thật**: trong ván thử (AI tắt, bot template), gửi "hong y kien Dang Khoa" ở pha thảo luận không thấy Đăng Khoa đáp trong 25 giây. Không đủ để kết luận (đáp là xác suất: hạn mức lượt, `responseProbability`), và không lặp lại được nhiều lần trong một buổi. Bằng chứng của sửa parser là self-play + corpus, không phải ván này.
- **Ba câu corpus đụng tên Dũng/Hà** (xem §5.3): chưa sửa.
- **Bộ lọc phủ định là bảo thủ**: "An không phải sói đúng không" (không "?") bị bỏ qua có chủ ý; người gõ "?" thì vẫn được nhận. Chưa có log phòng thật để biết tỉ lệ thật của dạng này.
- **Cuộc đua còn lại của `add-bot`**: một snapshot do việc khác (host bấm Sẵn sàng) phát ra giữa lúc server đã nhận nhưng chưa xử lý `add-bot`, VÀ server chậm hơn 3 giây, vẫn có thể dẫn tới gửi lại. Trong phòng hướng dẫn chỉ có host là tác nhân, nên coi là hiếm; chặn tuyệt đối cần một khoá idempotent phía server (đổi schema `room:add-bot`), ngoài phạm vi đợt này.
- **Thiết bị thật**: chỉ emulation Chrome (390×844 dọc, 844×390 ngang, 1280×720). Thẻ ở `HUNTER_SHOT`/Tiếng Vọng chỉ kiểm bằng test đơn vị — trong ván thử người chơi không rơi vào hai vai đó.
- **Bước "Đang thiết lập bộ bài"** nhanh hơn một khung hình cả trên Slow 3G (socket đã mở) nên chỉ thấy trong test; bước "Đang gọi bot (n/8)" thấy được trên trình duyệt.


---

## 7. Files chính

| Phần | File |
| --- | --- |
| 1 | `apps/web/src/lib/guide-prep.ts` (+test), `lib/useGuidePrep.ts`, `components/GuidePrepHook.test.tsx`, `apps/server/tests/guide-prep-integration.test.ts`, `app/room/[code]/page.tsx`, `components/GuideBanner.tsx` |
| 2 | `apps/web/src/lib/guide-steps.ts` (+test) |
| 3 | `apps/web/src/lib/guide-session.ts` (+test), `app/room/[code]/page.tsx`, `app/page.tsx` |
| 4 | `packages/game-engine/src/bot/analysis/chat-analysis.ts`, `conversation/templates.ts` (TYPO_PROTECTED), `evaluation/human-chat-corpus.ts`, `human-chat.ts`, `metrics.ts`, `report.ts`, `tests/bot-direct-address.test.ts`, `tests/bot-human-chat.test.ts`, `docs/fixtures/selfplay-sample.json` |
