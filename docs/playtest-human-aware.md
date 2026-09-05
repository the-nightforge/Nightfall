# Kịch bản playtest ngắn — bot có nghe người thật không?

Mọi số self-play, kể cả `--humans n`, đều là bot điều khiển. Bốn câu hỏi dưới đây
**chỉ** trả lời được bằng người thật ngồi chơi. Mỗi buổi 25–35 phút, 1–2 người
thật + bot cho đủ 8, phòng cục bộ hoặc bản deploy, AI lời thoại bật hay tắt đều
được (ghi rõ vào mẫu).

## Chuẩn bị

1. Người chơi mới (chưa từng chơi) dùng nút **"Chơi thử có hướng dẫn"** (bàn
   8 với bộ bài chuẩn của bàn 8 — có Thợ Săn và Thám Tử — được thiết lập tự
   động); người đã chơi dùng "Tạo phòng mới" và tự thêm bot.
2. Người quan sát ngồi cạnh, KHÔNG nhắc. Ghi theo mẫu ở cuối, đúng lúc xảy ra.
3. Điện thoại dọc là mặc định; một buổi trong số các buổi dùng máy tính.

## Bốn tình huống cần tạo ra (người chơi làm, không cần biết đang test)

| # | Tình huống | Cách tạo | Điều cần quan sát |
| --- | --- | --- | --- |
| T1 | Bị bot bầu, bào chữa CÓ căn cứ | Khi thấy ≥2 bot bầu mình: khai vai thật (nếu là vai chức năng) và nói một sự kiện kiểm được ("đêm qua tôi bảo vệ Chi"), 2–3 câu | Có bot nào đổi phiếu trong vòng đó? Sau bao lâu? Vòng sau còn bầu mình không? |
| T2 | Bị bầu, chỉ phủ nhận | Cùng tình huống, nhưng chỉ nói "tôi không phải sói" 2–3 lần | Bot có giữ phiếu không? (kỳ vọng: giữ) |
| T3 | Hỏi đích danh | Gọi tên một bot với dấu hỏi, ba lần trong một pha thảo luận, cách nhau ≥10s ("An nghi ai?", "An oi sao vote t?") | Bot đó đáp mấy lần trong ba? Câu đáp có nhắc tới câu hỏi không? |
| T4 | Gõ không dấu / viết tắt | Toàn buổi gõ không dấu, dùng "tt", "bv", "vote", "treo" | Bot có phản ứng khác so với gõ có dấu không (theo cảm nhận người chơi)? |

## Mẫu ghi nhận (một dòng cho mỗi sự kiện)

```
buổi: ____  ngày: ____  máy: điện thoại/PC  AI lời thoại: bật/tắt  người chơi: mới/đã chơi
vòng | pha | tình huống (T1–T4) | người chơi nói gì (tóm 1 dòng) | bot làm gì trong 30s sau | ghi chú
-----|-----|--------------------|-------------------------------|---------------------------|--------
```

Cuối buổi hỏi người chơi ba câu, ghi nguyên văn:

1. "Có lúc nào bạn không biết phải bấm gì tiếp không? Lúc nào?"
2. "Bot có nghe bạn không? Kể một lần nó nghe và một lần nó không."
3. (người mới) "Thẻ hướng dẫn có làm phiền không? Bạn ẩn nó lúc nào?"

## Đọc kết quả

- T1 so với T2 là câu hỏi chính của v18: bào chữa có căn cứ phải **dễ** thoát
  phiếu hơn phủ nhận thuần. Nếu ngược lại ở ≥2 buổi, ghi lại vòng và chat để
  dựng lại thành kịch bản trong `tests/bot-persuasion.test.ts`.
- T3 đối chiếu với ngăn "parser không nhận ra" (0% sau Phase 7, trước đó ~8%)
  và "hết lượt/hạn mức" (~24%) trong báo cáo self-play: nếu người thật thấy bot
  "điếc" nhiều hơn hẳn, chép nguyên văn câu hỏi vào `HUMAN_QUESTIONS` trong
  `human-chat-corpus.ts` để đo lại parser (`humanQuestionSeenRate` trong báo
  cáo). Ba câu đã biết parser chưa hiểu: tên người đụng "đúng"/"hả" khi so
  không dấu (Dũng, Hà).
- Không kết luận từ một buổi. Ba buổi với ba người khác nhau là mức tối thiểu.
