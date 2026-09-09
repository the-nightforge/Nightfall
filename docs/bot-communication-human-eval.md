# Chấm điểm hội thoại bằng NGƯỜI — quy trình

> `NIGHTFALL_BOT_COMMUNICATION_UPGRADE.md` §27, tức PR 9 của §32.
>
> Lý do tồn tại, nguyên văn spec: **"Self-play không đủ."** Tám PR trước đo bằng
> `villageWinRate` và một tá tỉ lệ trên dữ liệu có cấu trúc. Không cái nào trả
> lời được câu hỏi mà §37 đặt ra ngay từ đầu: *bot nói nghe có giống người không.*

---

## 1. Chạy

```bash
npm run transcript -- --games 12 --seed <gốc-seed> --out reports/human-eval
```

Ghi ra ba thứ:

```text
reports/human-eval/transcripts/*.md   -> đưa người chấm
reports/human-eval/scoring-sheet.csv  -> tờ điền điểm
reports/human-eval/answer-key.json    -> MỞ SAU KHI CHẤM XONG
```

`--games 12` nằm trong khoảng 10–20 mà §27 yêu cầu. Cùng seed cho cùng bộ biên
bản, nên hai người chấm được so với nhau, và một lần đo lại sau vài PR nữa vẫn
dùng đúng bộ ván cũ.

## 2. Luật của bài chấm: người chấm KHÔNG biết vai

Đây là ràng buộc của §27 và là thứ định hình toàn bộ thiết kế. Một người chấm đã
biết ai là Sói sẽ thấy mọi lời nói dối là "vụng" — họ không còn chấm lời nói
nữa, họ đang đọc đáp án.

Ba đường rò rỉ đã bị bịt, cả ba đều có test khoá trong
`tests/bot-transcript.test.ts`:

| Đường | Cách bịt |
| --- | --- |
| Bảng vai | `buildTranscript` không đọc `game.roles`. Test: đổi TOÀN BỘ bảng vai, biên bản không đổi một ký tự. |
| Sự kiện riêng tư | Danh sách CHO PHÉP 6 loại sự kiện công khai. Test: xoá hết sự kiện riêng khỏi đầu vào, biên bản không đổi. |
| Seed | Biên bản mang nhãn ẩn danh ("Ván A"), không mang seed — có seed là chạy lại được ván. |

Thêm hai điều không hiển nhiên:

- **Kết cục ván không nằm trong biên bản.** Biết phe nào thắng là suy ngược
  được vai của người còn sống. Nó ở trong tờ đáp án.
- **Nguyên nhân chết bị gộp.** `poison` nói Phù Thuỷ còn sống, `serial_killer`
  nói bộ bài có Sát Nhân, `hunter` gọi thẳng tên một vai. Cả bốn nguyên nhân
  ban đêm chỉ còn "đã chết"; riêng `lynch` giữ nguyên "bị treo cổ" vì cả làng
  vừa bỏ phiếu. Biên bản do đó KÉM thông tin hơn phòng thật ở nhánh Thợ Săn —
  có chủ đích: thiếu một chi tiết thì mất chút ngữ cảnh, thừa một chi tiết về
  vai thì hỏng cả phép đo.
- **Quyết định nội bộ không in ra.** `speech` (loại ý định), `tone`, `targetId`,
  `claimedRole` đều là thứ lõi đã chốt. In chúng ra là mách người chấm biết BOT
  ĐỊNH làm gì, và câu hỏi "câu này đọc có tự nhiên không" mất hết nghĩa.

## 3. Bảy trục, thang 1–5

Đúng bảy trục §27 liệt kê. Chấm cho CẢ VÁN, không phải từng câu.

| Trục | Câu hỏi | 1 | 5 |
| --- | --- | --- | --- |
| `naturalness` | Đọc có giống người Việt chat trong game không? | Như máy đọc mẫu câu | Không phân biệt được với người |
| `responsiveness` | Có thật sự đáp lại nhau không? | Ai nói nấy nghe | Đối đáp bám nhau, có mạch |
| `consistency` | Lập trường có nhất quán, và đổi ý có nói ra không? | Quay xe im lặng, tự mâu thuẫn | Nhất quán, đổi ý thì giải thích |
| `persuasiveness` | Lời nói có sức nặng không? | Nói cho có | Đủ sức làm người khác đổi phiếu |
| `strategic_quality` | Nói có phục vụ mục tiêu không? | Nói vu vơ, sai thời điểm | Đúng lúc, đúng người, đúng việc |
| `deception` | Lời nói dối có tin được không? | Lộ liễu hoặc không ai nói dối | Dối trơn tru, có mục đích |
| `personality` | Mỗi ghế có giọng riêng không? | Cả bàn nghe như một người | Phân biệt được ai đang nói |

`deception` chấm được mà không biết vai: người chấm đọc "câu này nếu là nói dối
thì có trót lọt không", chứ không cần biết ai thật sự nói dối. Nếu cả ván không
có gì đáng ngờ thì đó cũng là một thông tin — chấm thấp.

## 4. Đọc kết quả

§27 nói thẳng: **"Dùng như một chỉ báo, không coi là ground truth tuyệt đối."**

Cụ thể với repo này:

- Điểm người chấm KHÔNG được dùng để nâng một preset lên `DEFAULT_BOT_WEIGHTS`.
  Tiêu chí đó vẫn là §40 (protocol 5×1.000 ván paired seeds).
- Nó dùng để trả lời câu hỏi mà self-play mù: 8 PR vừa rồi có làm bot nghe
  giống người hơn không, và trục nào đang tệ nhất.
- Cỡ mẫu 12 ván × vài người chấm là quá nhỏ cho một phép kiểm thống kê. Đọc nó
  như một bảng xếp hạng trục nào yếu, không như một con số có sai số.

## 5. Lần chạy đầu đã bắt được một lỗi thật

Chạy `--games 12 --seed pr9` lần đầu, hai biên bản chứa nguyên văn:

```text
Người 2: tôi nghi Người 6 nhất. có người khác cũng nhận là GUARD, nên ít nhất
         một trong hai đang nói dối.
```

`claim-credibility.ts` nội suy **mã vai** thô vào câu tóm tắt bằng chứng, và câu
đó đi thẳng vào chỗ trống `{evidence}` của bảng mẫu rồi ra khung chat. Người
chơi thật sẽ thấy một con BOT nói "cũng nhận là GUARD" giữa phòng.

Lỗi sống trong repo tới tận PR 9 và **không chỉ số nào trong 40+ chỉ số bắt
được**, vì tất cả đều chạy trên dữ liệu có cấu trúc — không cái nào ĐỌC câu chữ.
Đã sửa (`roleLabel`, dùng `ROLE_META[role].name`), và có test hồi quy quét mọi
lời thoại của 6 ván tìm mã vai thô. Test đó đỏ trên code trước khi sửa.

Đây là bằng chứng cụ thể nhất cho câu mở đầu của §27.

## 6. Hạn chế

1. **Bộ biên bản chạy bằng BẢNG MẪU, không phải LLM.** Self-play không gọi nhà
   cung cấp. Nên bài chấm này đo trần dưới của chất lượng câu chữ — phòng thật
   với provider bật sẽ khác. Muốn chấm đúng đường production thì cần một harness
   ghi lại ván thật; chưa có.
2. Không có công cụ tổng hợp điểm. `scoring-sheet.csv` là tờ điền tay; ai gom
   thì tự gom.
3. Chưa đo được độ đồng thuận giữa những người chấm.
4. Người chấm vẫn biết đây là bot. §27 không đòi bài kiểm mù đôi, nhưng nó là
   một thiên lệch có thật.
5. Chưa có bộ biên bản của một ván NGƯỜI THẬT làm mốc so. Không có mốc thì thang
   1–5 chỉ so các phiên bản bot với nhau.
