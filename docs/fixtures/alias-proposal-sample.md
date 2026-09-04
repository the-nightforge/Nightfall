# Đề xuất alias vai - vòng 1

Sinh bởi `npm run mine-aliases -- --limit 500`.
Quét 24 tin nhắn đã lưu; 26 ứng viên; hiện top 30.

> **Dữ liệu MỒI.** Bảng chat trống nên script đã tự nạp 24 câu slang để có gì mà chạy. Những con số dưới đây KHÔNG phải tần suất thật - chạy lại sau khi đã có ván thật rồi hãy duyệt.

## Đây là ĐỀ XUẤT, không phải thay đổi

Script này KHÔNG đụng vào `ROLE_PHRASES`. Một alias sai không chỉ làm bot bỏ sót - nó DỰNG RA một lời tự nhận vai chưa từng có và ghim vĩnh viễn vào belief. Thêm alias là việc của người duyệt, từng dòng một.

## Quy tắc an toàn khi duyệt

1. **Alias ≤2 ký tự (`tt`, `pt`, `bv`, `sw`, `ts`, `lm`...) chỉ được khớp NGAY SAU một neo tự nhận vai** (`tôi là`, `mình là`, `X là`, `nhận`). CẤM khớp tự do giữa câu: `ts` nằm trong `ts nào cũng được`, và `bv` là hai chữ cái người ta gõ nhầm hằng ngày.
2. Cụm dài đứng TRƯỚC cụm ngắn trong `ROLE_PHRASES` - bảng khớp theo thứ tự. Thêm `tt` mà đặt trên `tiên tri tập sự` là giết luôn cụm dài đó.
3. Alias trùng với một từ thường gặp thì bỏ, kể cả khi tần suất cao: tờ này đếm chỗ token ĐỨNG, nó không đọc được ý người nói.
4. Alias chỉ thấy trong dữ liệu mồi thì chưa đủ căn cứ - đợi nó xuất hiện trong chat người thật.

## Top ứng viên

### 1. `tt` — 3 lần ⚠️ ≤2 ký tự

- Dạng đã gặp: `tt`
- Neo: t là (1), mình là (1), tôi là (1)
- ⚠️ Chỉ được khớp ngay sau neo tự nhận vai. Xem quy tắc 1.
- Ví dụ:
  - [day v1] t là tt, đêm qua soi ra p2
  - [day v1] mình là tt luôn, ai counter thì lên
  - [day v1] tôi là tt nhé, soi ra thằng 3 là sói rồi

### 2. `bv` — 2 lần ⚠️ ≤2 ký tự

- Dạng đã gặp: `bv`
- Neo: nhận (1), tôi là (1)
- ⚠️ Chỉ được khớp ngay sau neo tự nhận vai. Xem quy tắc 1.
- Ví dụ:
  - [day v1] nhận bv, tối qua đỡ cho p1
  - [day v1] tôi là bv, đêm nay che cho tt

### 3. `lm` — 2 lần ⚠️ ≤2 ký tự

- Dạng đã gặp: `lm`
- Neo: nhận (1), mình là (1)
- ⚠️ Chỉ được khớp ngay sau neo tự nhận vai. Xem quy tắc 1.
- Ví dụ:
  - [day v2] nhận lm, đêm qua rảy nước thánh
  - [day v2] mình là lm nha, mọi người tin đi

### 4. `pt` — 2 lần ⚠️ ≤2 ký tự

- Dạng đã gặp: `pt`
- Neo: mình là (1), nhận (1)
- ⚠️ Chỉ được khớp ngay sau neo tự nhận vai. Xem quy tắc 1.
- Ví dụ:
  - [day v1] mình là pt nè, hết bình cứu rồi
  - [day v1] nhận pt đây, tối qua cứu p5

### 5. `sw` — 2 lần ⚠️ ≤2 ký tự

- Dạng đã gặp: `sw`
- Neo: X là (1), tôi là (1)
- ⚠️ Chỉ được khớp ngay sau neo tự nhận vai. Xem quy tắc 1.
- Ví dụ:
  - [day v2] p4 là sw đó, nó tự nhận rồi
  - [day v1] tôi là sw, đừng treo tôi

### 6. `ts` — 2 lần ⚠️ ≤2 ký tự

- Dạng đã gặp: `ts`
- Neo: tôi là (1), mình là (1)
- ⚠️ Chỉ được khớp ngay sau neo tự nhận vai. Xem quy tắc 1.
- Ví dụ:
  - [day v2] tôi là ts nhé, cẩn thận
  - [day v2] mình là ts, treo tôi là chết theo một mạng

### 7. `chet theo` — 1 lần

- Dạng đã gặp: `chết theo`
- Neo: X là (1)
- Ví dụ:
  - [day v2] mình là ts, treo tôi là chết theo một mạng

### 8. `thay boi` — 1 lần

- Dạng đã gặp: `thầy bói`
- Neo: tôi là (1)
- Ví dụ:
  - [day v3] tôi là thầy bói, soi p8 ra dân

### 9. `ba dong` — 1 lần

- Dạng đã gặp: `bà đồng`
- Neo: tôi là (1)
- Ví dụ:
  - [day v2] tôi là bà đồng, tối qua hỏi p3

### 10. `sat thu` — 1 lần

- Dạng đã gặp: `sát thủ`
- Neo: tôi là (1)
- Ví dụ:
  - [day v3] tôi là sát thủ, mục tiêu của tôi là p5

### 11. `bao ke` — 1 lần

- Dạng đã gặp: `bảo kê`
- Neo: tôi là (1)
- Ví dụ:
  - [day v3] tôi là bảo kê của làng, tin tôi đi

### 12. `lm nha` — 1 lần

- Dạng đã gặp: `lm nha`
- Neo: mình là (1)
- Ví dụ:
  - [day v2] mình là lm nha, mọi người tin đi

### 13. `pt day` — 1 lần

- Dạng đã gặp: `pt đây`
- Neo: nhận (1)
- Ví dụ:
  - [day v1] nhận pt đây, tối qua cứu p5

### 14. `ts nhe` — 1 lần

- Dạng đã gặp: `ts nhé`
- Neo: tôi là (1)
- Ví dụ:
  - [day v2] tôi là ts nhé, cẩn thận

### 15. `tt nhe` — 1 lần

- Dạng đã gặp: `tt nhé`
- Neo: tôi là (1)
- Ví dụ:
  - [day v1] tôi là tt nhé, soi ra thằng 3 là sói rồi

### 16. `cupid` — 1 lần

- Dạng đã gặp: `cupid`
- Neo: nhận (1)
- Ví dụ:
  - [day v2] nhận cupid, tôi ghép p2 với p6

### 17. `ho ve` — 1 lần

- Dạng đã gặp: `hộ vệ`
- Neo: X là (1)
- Ví dụ:
  - [day v3] p7 là hộ vệ, đừng nghi nó

### 18. `pt ne` — 1 lần

- Dạng đã gặp: `pt nè`
- Neo: mình là (1)
- Ví dụ:
  - [day v1] mình là pt nè, hết bình cứu rồi

### 19. `chet` — 1 lần

- Dạng đã gặp: `chết`
- Neo: X là (1)
- Ví dụ:
  - [day v2] mình là ts, treo tôi là chết theo một mạng

### 20. `thay` — 1 lần

- Dạng đã gặp: `thầy`
- Neo: tôi là (1)
- Ví dụ:
  - [day v3] tôi là thầy bói, soi p8 ra dân

### 21. `bao` — 1 lần

- Dạng đã gặp: `bảo`
- Neo: tôi là (1)
- Ví dụ:
  - [day v3] tôi là bảo kê của làng, tin tôi đi

### 22. `sat` — 1 lần

- Dạng đã gặp: `sát`
- Neo: tôi là (1)
- Ví dụ:
  - [day v3] tôi là sát thủ, mục tiêu của tôi là p5

### 23. `ba` — 1 lần ⚠️ ≤2 ký tự

- Dạng đã gặp: `bà`
- Neo: tôi là (1)
- ⚠️ Chỉ được khớp ngay sau neo tự nhận vai. Xem quy tắc 1.
- Ví dụ:
  - [day v2] tôi là bà đồng, tối qua hỏi p3

### 24. `bd` — 1 lần ⚠️ ≤2 ký tự

- Dạng đã gặp: `bd`
- Neo: mình là (1)
- ⚠️ Chỉ được khớp ngay sau neo tự nhận vai. Xem quy tắc 1.
- Ví dụ:
  - [day v3] mình là bd, ban đêm không dậy

### 25. `dl` — 1 lần ⚠️ ≤2 ký tự

- Dạng đã gặp: `dl`
- Neo: nhận (1)
- ⚠️ Chỉ được khớp ngay sau neo tự nhận vai. Xem quy tắc 1.
- Ví dụ:
  - [day v3] nhận dl, tôi chỉ là dân đen thôi

### 26. `ho` — 1 lần ⚠️ ≤2 ký tự

- Dạng đã gặp: `hộ`
- Neo: X là (1)
- ⚠️ Chỉ được khớp ngay sau neo tự nhận vai. Xem quy tắc 1.
- Ví dụ:
  - [day v3] p7 là hộ vệ, đừng nghi nó

## Bảng hiện tại (để đối chiếu)

`ROLE_PHRASES` đang có 22 cụm, theo đúng thứ tự khớp:

`kẻ nguyền rủa` → CURSED, `tiên tri tập sự` → APPRENTICE_SEER, `thiên thần hộ mệnh` → GUARDIAN_ANGEL, `thiên thần` → GUARDIAN_ANGEL, `thằng hề` → JESTER, `kẻ báo thù` → EXECUTIONER, `sát nhân` → SERIAL_KILLER, `thám tử` → DETECTIVE, `linh mục` → PRIEST, `thị trưởng` → MAYOR, `sói con` → WOLF_CUB, `dân thường` → VILLAGER, `dân làng` → VILLAGER, `tiên tri` → SEER, `phù thuỷ` → WITCH, `phù thủy` → WITCH, `thợ săn` → HUNTER, `bảo vệ` → GUARD, `ma sói` → WEREWOLF, `sói` → WEREWOLF, `hề` → JESTER, `dân` → VILLAGER
