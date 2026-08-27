# Bot AI bằng Gemini

Ngày: 2026-08-27

## Mục tiêu

Thay bot hành động ngẫu nhiên bằng bot dùng Gemini để vừa chọn mục tiêu vừa tham gia thảo luận tiếng Việt, mà không làm ván đấu phụ thuộc vào một dịch vụ bên ngoài.

Hiện tại bot nằm trong `apps/server/src/game/machine.ts` (dòng 133-213). Sói cắn bừa người không phải Sói, Tiên Tri soi bừa, Bảo Vệ chỉ tránh trùng mục tiêu đêm trước, Phù Thuỷ cứu cứng ở đêm 1, bỏ phiếu ngẫu nhiên. Bot không chat.

## Ràng buộc

- Gemini free tier của Google AI Studio, không gắn thẻ thanh toán.
- Google không còn công bố số RPM/RPD của free tier trong tài liệu; giới hạn chỉ xem được trong AI Studio của từng tài khoản. Thiết kế coi quota là ẩn số lúc chạy và tự xuống thang, thay vì bám vào một con số cố định.
- Model đặt qua biến `GEMINI_MODEL`, mặc định `gemini-3.5-flash-lite`. Đổi model là đổi biến môi trường, không có cơ chế tự động nhảy sang model khác lúc chạy — thêm nhánh đó chỉ làm khó suy luận khi có sự cố.
- Bot chỉ được biết đúng những gì người thật ngồi ghế đó biết.
- Không lời gọi API nào được phép làm chậm hay treo timer game.

## Quyết định nền tảng

Đầu vào duy nhất của bot là `buildSnapshot(room, botId)` — chính hàm phục vụ client người thật (`apps/server/src/rooms/snapshot.ts:97`). Hàm này đã lọc vai trò qua `engine.snapshotFor(viewerId)` và lọc `chatLog` theo kênh người xem được phép đọc.

Hệ quả: "bot không biết nhiều hơn người thật" là tính chất do cấu trúc, không phải do prompt dặn dò. Muốn phá vỡ phải sửa chữ ký hàm.

## Kiến trúc

Thư mục mới `apps/server/src/bots/`:

| File | Trách nhiệm |
|---|---|
| `types.ts` | Interface `BotBrain`: `decideNight(view)`, `decideDay(view)` |
| `random-brain.ts` | Logic ngẫu nhiên hiện tại, chuyển từ `machine.ts` sang |
| `gemini-brain.ts` | Gọi Gemini, ép JSON, validate bằng Zod |
| `prompt.ts` | Chuyển `RoomSnapshot` thành prompt tiếng Việt và dựng responseSchema |
| `governor.ts` | Timeout, đếm quota, ngắt mạch |
| `index.ts` | Chọn brain theo config và trạng thái governor |

`machine.ts` chỉ còn lo hẹn giờ; phần quyết định giao cho `BotBrain`. File giảm từ 213 xuống khoảng 130 dòng, tách luật game khỏi trí tuệ bot.

Hai brain cùng interface nên chỗ gọi không cần biết đang dùng cái nào; fallback lúc chạy chỉ là gọi sang object khác.

### Biến môi trường

- `GEMINI_API_KEY` — đặt trong Render secret. Thiếu key thì server vẫn khởi động bình thường và dùng `RandomBrain`.
- `BOT_AI_ENABLED` — tắt nhanh không cần deploy lại. Mặc định bật khi có key.
- `BOT_AI_MAX_CALLS_PER_GAME` — mặc định 60.

## Luồng dữ liệu

### Lượt đêm, một request mỗi bot

1. `t=0` — dựng `view = buildSnapshot(room, botId)`. Nếu `view.night.canAct` là false thì bỏ qua, không gọi API. Gọi Gemini, không chờ.
2. `t=2-5s` ngẫu nhiên — thời điểm sớm nhất được nộp. Nếu kết quả về sau mốc này thì nộp ngay khi về, tức thời điểm nộp là `max(độ trễ giả, lúc kết quả về)`.
3. `deadline = min(8s, nightSeconds × 0.4)` — chưa có kết quả thì `RandomBrain` quyết ngay.

`nightSeconds` hợp lệ trong khoảng 15-120 (`packages/shared/src/schemas.ts:21`), mặc định 30. Ở cấu hình ngắn nhất deadline là 6 giây, vẫn nằm trước mốc kết thúc pha.

Gọi API sớm nhưng nộp hành động muộn: bot không trả lời tức thì một cách phi lý, và có sẵn vài giây đệm cho độ trễ mạng. Deadline luôn ngắn hơn thời lượng pha nên `endNight()` không bao giờ chờ Gemini.

### Lượt ngày, một request mỗi bot

Một request trả về cả tin chat lẫn phiếu bầu, vì hai thứ cùng dựa trên một trạng thái thông tin.

- `chat` đi qua `pushChat` sẵn có; kênh do `resolveChat(room, botId)` quyết định nên rơi vào kênh `day`. Bot không được chọn kênh, giống người thật.
- `voteTargetId` cất vào map `pendingVote` theo vòng. Sang pha `VOTING`, `scheduleVoteBots` lấy ra, kiểm tra mục tiêu còn sống; nếu không thì `RandomBrain` quyết.

Tin chat các bot rải đều trong khung `discussionSeconds`.

`resolveChat` lọc người nhận bằng `!m.isBot`, nhưng bot ở đây là người gửi và vẫn nằm trong `room.members` nên qua được kiểm tra đầu hàm. Bot đọc `chatLog` trong snapshot của mình, không cần nhận qua socket. Rate limit 5 tin/5 giây không vướng vì mỗi bot nói 1 lần mỗi vòng.

### Chi phí

Ván 6 người, 3 bot, 4 vòng: 3 request đêm (chỉ vai có hành động mới gọi) cộng 3 request ngày, tức 6 mỗi vòng, khoảng 24 mỗi ván.

## Xử lý lỗi

Mọi nhánh thất bại dẫn về `RandomBrain`. Trường hợp xấu nhất của tính năng mới bằng đúng trạng thái tốt nhất hiện nay. Người chơi không thấy thông báo lỗi.

| Tình huống | Xử lý |
|---|---|
| Quá deadline | Huỷ bằng `AbortController`, `RandomBrain` quyết |
| Lỗi mạng hoặc 5xx | Không retry, rơi về `RandomBrain` |
| 429 hết quota | Ngắt mạch, tắt Gemini tới hết ván, không thử lại |
| JSON hỏng hoặc sai schema | Zod chặn, rơi về `RandomBrain` |
| Bị safety filter chặn | Coi như không có kết quả |
| Mục tiêu sai luật | Loại bỏ, rơi về `RandomBrain` |

Trần cứng `BOT_AI_MAX_CALLS_PER_GAME` là van an toàn cho ván kéo dài bất thường. Vì free tier không công bố giới hạn nên ta tự đặt giới hạn thay vì dò bằng cách đâm vào tường.

### Ba tầng kiểm chứng đầu ra

1. Zod kiểm tra hình dạng JSON.
2. Kiểm tra luật: `targetId` nằm trong `view.players`, còn sống, hành động hợp vai.
3. Engine kiểm tra lần cuối như với người thật; `submitNightAction` ném lỗi thì bắt và bỏ lượt.

Engine giữ nguyên vai trò trọng tài. Bot chỉ là một nguồn input, không có đặc quyền.

### Prompt injection

Chat người chơi nằm trong prompt, nên có thể bị chèn chỉ thị. Không chặn được triệt để. Thiệt hại bị chặn trên bởi kiến trúc: bot chỉ thấy snapshot của chính nó, nên injection thành công hoàn toàn cũng chỉ lộ vai trò của đúng bot đó, điều mà người chơi thật cũng có quyền tự khai. Vai trò người khác không nằm trong prompt nên không có gì để lộ.

Giảm nhẹ thêm: structured output khiến `chat` là chuỗi bị cắt còn 300 ký tự chứ không phải kênh tự do; phần chat người chơi được bọc rõ là dữ liệu, không phải chỉ thị.

### Log

Không log prompt, không log API key. Chỉ log model, độ trễ, kết quả, mã lỗi. Khớp với `isProd` trong `apps/server/src/index.ts:18`.

## Prompt và output

### Ép đúng bằng schema

`responseSchema` của Gemini hỗ trợ `enum`. `targetId` khai báo là enum chứa đúng danh sách id hợp lệ, dựng lúc gọi từ `view.players`. Model không có cách trả về mục tiêu sai luật vì nó không tồn tại trong không gian output.

Danh sách enum theo vai, khớp đúng các điều kiện engine kiểm tra trong `submitNightAction` (`packages/game-engine/src/engine.ts:144`):

| Vai | Enum mục tiêu |
|---|---|
| Sói (`KILL`) | Người còn sống, không thuộc phe Sói |
| Tiên Tri (`SEE`) | Người còn sống, **trừ chính mình** |
| Bảo Vệ (`GUARD`) | Người còn sống, trừ mục tiêu đêm trước (`guardPrevious`); được phép chọn chính mình |
| Phù Thuỷ (`POISON`) | Người còn sống |

Loại hành động do server quyết theo vai, không hỏi model. Riêng Phù Thuỷ có trường `action` vì vai này thật sự có lựa chọn.

### Schema

Đêm, các vai có đúng một loại hành động (Sói, Tiên Tri, Bảo Vệ):

```json
{ "think": "string <=200", "targetId": "<enum>" }
```

Đêm, riêng Phù Thuỷ. Lưu ý `HEAL` trong engine **không nhận mục tiêu** — nó chỉ đặt cờ cứu nạn nhân của đêm đó (`engine.ts:179-185`), nên `targetId` chỉ có nghĩa khi `action` là `POISON`:

```json
{ "think": "string <=200", "action": "HEAL | POISON | SKIP", "targetId": "<enum> | null" }
```

Các giá trị `action` đã dùng hết bình tương ứng (`healUsed`, `poisonUsed`) bị loại khỏi enum ngay khi dựng schema, nên model không chọn được hành động đã hết lượt.

Ngày:

```json
{ "think": "string <=200", "chat": "string <=300", "voteTargetId": "<enum> | null" }
```

`think` là chỗ model lập luận trước khi chốt, tốn thêm khoảng 60 token, đổi lại chất lượng quyết định tốt hơn. Không hiển thị cho người chơi, không log ở production, vì chứa suy đoán dựa trên vai trò bí mật. `voteTargetId` bằng `null` nghĩa là chưa quyết, khi đó `RandomBrain` chốt hộ.

### Nội dung prompt

Toàn bộ lấy từ `buildSnapshot(room, botId)`, không nguồn nào khác:

- Tên, vai trò, còn sống hay không, vòng thứ mấy.
- Danh sách người chơi kèm trạng thái sống chết; Sói thấy đồng đội đúng như snapshot đã lọc.
- Thông tin riêng theo vai: kết quả soi của Tiên Tri, bình cứu và bình độc đã dùng chưa, mục tiêu cả bọn Sói đang nhắm.
- Diễn biến công khai: ai chết đêm qua, ai bị treo cổ.
- `chatLog` phần bot được phép xem.

Ước lượng 600-900 token input, 100 token output mỗi lượt.

### Persona

Mỗi bot nhận một persona cố định suốt ván, gieo từ id: ít nói và cộc lốc, hay nghi ngờ và chất vấn, hoà giải và xuê xoa, bông đùa. Persona chỉ ảnh hưởng giọng văn, không ảnh hưởng chiến thuật.

System instruction ràng buộc: viết tiếng Việt đời thường như đang chat game, một hai câu, không bao giờ tự nhận là AI hay bot, không dùng markdown.

## Kiểm thử

Không test nào chạm mạng. `GeminiBrain` nhận client HTTP qua tham số nên test truyền stub; không thêm thư viện mock, khớp với cách `apps/server` đang test bằng Vitest.

### Test bảo mật

Khẳng định prompt dựng cho bot không chứa vai trò của người mà bot không có quyền biết. Dựng ván có Sói, Tiên Tri, Dân Làng, Phù Thuỷ; build prompt cho bot Dân Làng và assert chuỗi không chứa `WEREWOLF`, `SEER`, `WITCH` gắn với tên người khác; lặp lại cho bot Sói, assert thấy đồng đội Sói nhưng không thấy vai Tiên Tri.

Test này bắt lỗi tương lai: nếu ai đó sửa `prompt.ts` cho nhận thẳng `room.engine.state` thay vì snapshot đã lọc, test đỏ ngay.

### Các nhóm còn lại

| Nhóm | Kiểm cái gì |
|---|---|
| Enum mục tiêu | Sói không có mình và đồng đội; Tiên Tri không có chính mình; Bảo Vệ không có mục tiêu đêm trước nhưng vẫn có chính mình; người chết không xuất hiện ở bất kỳ vai nào |
| Enum hành động Phù Thuỷ | `HEAL` biến mất khỏi enum khi `healUsed`; `POISON` biến mất khi `poisonUsed`; hết cả hai thì chỉ còn `SKIP` |
| Validate output | JSON hỏng, thiếu trường, mục tiêu vừa chết, Phù Thuỷ đòi `HEAL` khi đã dùng bình, đều rơi về `RandomBrain` và không ném lỗi ra ngoài |
| Governor | 429 làm ngắt mạch và không gọi lại trong ván; chạm trần thì dừng; timeout huỷ được request |
| Luồng ngày | `pendingVote` được dùng ở pha `VOTING`; mục tiêu đã chết thì fallback |
| `RandomBrain` | Code chuyển từ `machine.ts` giữ nguyên hành vi cũ |

### Ngoài unit test

Thêm biến thể của `apps/server/scripts/e2e.ts` chạy với bot dùng `FakeBrain` để xác nhận ván vẫn kết thúc bình thường qua đường mới, vẫn không cần mạng.

Gọi Gemini thật để trong một script thủ công chạy tay ở local, không đưa vào `npm test`, vì CI không có API key và không nên đốt quota.

Viết test trước rồi mới viết code.

## Ngoài phạm vi

- Không đổi luật chơi, không thêm vai trò mới.
- Không cho chủ phòng chọn độ khó bot; nếu cần sẽ là việc riêng sau này.
- Không lưu lịch sử hội thoại của bot vào database.
- Không dùng Gemini cho bất cứ thứ gì ngoài bot.
