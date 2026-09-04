# Clip chuyển cảnh

Mười cảnh, mỗi cảnh một `.webm` và một `.mp4`, **tự dựng bằng script trong
repo** - xem `apps/web/scripts/build-cinematics.mjs`. Không có khung hình nào
tải về từ đâu, nên câu hỏi giấy phép của cả thư mục chỉ có một câu trả lời, và
bất kỳ ai cũng dựng lại được y hệt.

Dựng lại:

```bash
cd apps/web
node scripts/build-cinematics.mjs            # cả mười cảnh
node scripts/build-cinematics.mjs nightfall  # chỉ một cảnh
FFMPEG=/duong/dan/toi/ffmpeg node scripts/build-cinematics.mjs
```

ffmpeg là công cụ dựng, **không phải dependency của web**: thiếu nó thì `npm ci`
và `next build` vẫn chạy bình thường - chỉ là không dựng lại được clip.

Nếu thư mục này trống, game vẫn chạy đủ chuyển cảnh bằng bản dựng CSS trong
`src/app/cinematics.css`. Đó là đường mặc định, không phải đường hỏng: thiếu
file, hỏng mạng, hay codec lạ đều cho ra đúng kết quả ấy, không có màn hình đen
và không chặn ván nào.

## Cần những file nào

Mỗi cảnh cần **một file `.webm` và một file `.mp4`** trùng tên. Trình duyệt lấy
`.webm` trước; `.mp4` (H.264 + baseline/main profile) là đường lui cho Safari cũ.

| Tên file | Cảnh | Khi nào phát | Thời lượng đích |
| --- | --- | --- | --- |
| `nightfall` | Màn đêm buông xuống | Bước vào pha `NIGHT` | 1,2s |
| `dawn` | Trời sáng trên ngôi làng | `NIGHT` → `NIGHT_RESULT` | 1,2s |
| `trial` | Phiên toà bắt đầu | `VOTING` → `DEFENSE` / `FINAL_VOTE` | 1,0s |
| `verdict` | Làng đã có phán quyết | `FINAL_VOTE` → `ELIMINATION` | 1,1s |
| `village-win` | Dân Làng chiến thắng | vào `GAME_OVER`, phe Dân thắng | 2,0s |
| `wolves-win` | Ma Sói chiến thắng | vào `GAME_OVER`, phe Sói thắng | 2,0s |
| `event-wolf-threat` | Bầy Sói trỗi dậy | sự kiện họ WOLF_THREAT | 0,9s |
| `event-village-boon` | Vận may đến với làng | sự kiện họ VILLAGE_BOON | 0,9s |
| `event-rule-change` | Luật làng thay đổi | sự kiện họ RULE_CHANGE | 0,9s |
| `event-spirit` | Linh hồn lên tiếng | sự kiện họ SPIRIT | 0,9s |
| `killer-win` | Sát Nhân chiến thắng | vào `GAME_OVER`, Sát Nhân thắng | 2,0s |
| `draw` | Không ai còn sống | vào `GAME_OVER`, ván hoà | 2,0s |

**Hai dòng cuối CHƯA có file**, và đó là một trạng thái hợp lệ chứ không phải
một việc đang bỏ dở: hai cảnh đó chạy bằng bản dựng CSS trong
`src/app/cinematics.css`, đúng đường mặc định đã mô tả ở trên. Chúng cũng không
nằm trong `nextClips`, nên không ai phải tải trước một file không tồn tại. Dựng
clip cho chúng cần thêm hai cảnh vào `scripts/cinematic-scenes.mjs`.

## Hai cảnh KHÔNG có file, và không bao giờ có

`NIGHT_KILL` (đêm có người chết) và `EXECUTION` (làng treo cổ) không nằm trong
bảng trên, và đó không phải một thiếu sót đang chờ ai dựng nốt. Hai cảnh đó mang
**khuôn mặt thật của nạn nhân đêm nay**, thứ mà không đoạn phim dựng sẵn nào kể
được. Chúng dựng bằng chân dung người chơi cộng CSS - xem
`src/components/KillScene.tsx` và mục "Cảnh kill" trong `src/app/cinematics.css`.

Điều đó được khoá ở tầng dữ liệu chứ không phải bằng một lời dặn: `KIND_META`
khai báo `clip: null` cho cả hai, nên chúng không lọt vào `CINEMATIC_CLIPS`,
không lọt vào `nextClips`, và `CinematicOverlay` không dựng thẻ `<video>` cho
chúng kể cả khi có ai thả một file trùng tên vào thư mục này.

Danh sách trên là bản chép tay của `CINEMATIC_CLIPS` trong
`src/lib/cinematic-transition.ts` - file đó mới là nguồn sự thật, và test
`nextClips` giữ cho hai bên không trôi khỏi nhau.

Mười lăm sự kiện trong game **không cần mười lăm clip**. Chúng gộp về bốn họ
hình ảnh; tên, icon và mô tả sự kiện vẫn lấy nguyên từ snapshot và hiện đè lên
trên, nên clip của một họ chỉ cần nói đúng một câu: chuyện vừa xảy ra nghiêng
về phía ai. Bảng gộp nằm ở `EVENT_FAMILY` trong file nói trên.

Poster (`nightfall.jpg`, ...) là **tuỳ chọn** và hiện chưa được dùng: khung hình
đầu tiên đã có bản CSS đứng sẵn phía dưới, nên không có khoảng trống nào cần
poster lấp.

## Yêu cầu kỹ thuật

- **Định dạng:** WebM (VP9 hoặc AV1) là chính, MP4 (H.264, yuv420p) là bản lui.
- **Độ phân giải:** 1280×720. Lớp phủ dùng `object-cover`, và trên màn dọc
  390×844 khung 16:9 bị phóng theo CHIỀU CAO rồi cắt hai bên - phần còn nhìn
  thấy chỉ khoảng **26% bề rộng ở giữa**. Đó là con số thật, không phải "đừng
  đặt sát mép": một tiêu điểm ở 78% bề rộng sẽ không bao giờ xuất hiện trên điện
  thoại. Hằng số `SAFE_X` trong `scripts/cinematic-render.mjs` ghi lại dải này,
  và mọi cảnh hiện có đều đặt tiêu điểm trong đó. Dãy nhà là ngoại lệ duy nhất -
  nó là đường chân trời, cắt mất vài mái ở rìa không mất nghĩa gì.
- **Dung lượng:** trần cứng khoảng **1,2MB mỗi file**. Clip phát ngay giữa lúc
  người chơi đang phải bấm, tải lâu hơn thời lượng của chính nó thì bản CSS chạy
  hết trước khi clip kịp xuất hiện. Bộ hiện tại nằm rất xa dưới trần đó - 10-35KB
  mỗi file `.webm` và 33-102KB mỗi file `.mp4`, tổng cộng khoảng 0,72MB cho cả 20
  file - vì các cảnh toàn dải chuyển màu lớn và VP9 nén chúng gần như miễn phí.
- **Không có audio.** Track tiếng phải bị gỡ hẳn, không phải chỉ hạ về 0. Mọi âm
  thanh trong game đi qua audio engine (`src/lib/audio-engine.ts`) để còn tuân
  theo thanh trượt âm lượng và nút tắt tiếng; tiếng nhúng trong clip đi vòng qua
  hết những thứ đó. Lớp phủ luôn phát ở chế độ `muted` nên tiếng nhúng cũng sẽ
  không ai nghe thấy - nó chỉ tổ nặng file.
- **Không vòng lặp, không alpha.** Clip chạy một lần rồi lớp phủ tự tháo.
- **Nhịp:** hình phải rõ nghĩa ngay từ 3-4 khung đầu. Người chơi có nút "Bỏ qua"
  và một cảnh mở màn chậm rãi thì chỉ tổ bị bỏ qua.
- **Nội dung:** tượng trưng, không bạo lực trực diện. `verdict` là lúc dễ sai
  nhất - hãy dựng nó thành một cánh cửa khép lại, đừng dựng thành một vụ hành
  quyết.

Bộ tham số mã hoá nằm ở `ENCODERS` trong `scripts/build-cinematics.mjs`; sửa ở
đó rồi dựng lại, đừng ép tay từng file. `-an` trong cả hai bản là chỗ gỡ track
tiếng.

Kiểm tra lại sau khi dựng:

```bash
# Phải KHÔNG in ra dòng nào: có dòng nghĩa là track tiếng vẫn còn.
ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv nightfall.webm

# Phải in ra 1280,720 và đúng thời lượng của cảnh.
ffprobe -v error -select_streams v:0 -show_entries stream=width,height   -show_entries format=duration -of csv=p=0 nightfall.webm
```

## Nguồn và giấy phép — bắt buộc

Mỗi clip thêm vào **phải** kèm một dòng trong bảng dưới đây, trong cùng commit
với chính file đó. Không có dòng thì không merge. Đây là điều kiện đủ, không
phải thủ tục: một clip không rõ nguồn gốc là một yêu cầu gỡ bài chờ sẵn, và tới
lúc đó sẽ không ai còn nhớ nó từ đâu ra.

Ghi rõ giấy phép cụ thể (CC0, CC-BY-4.0, đã mua license thương mại, tự dựng...).
"Tìm trên mạng" và "chắc là free" không phải giấy phép. Với CC-BY thì dòng ghi
công cũng phải xuất hiện trong UI hoặc trong `src/lib/AVATAR-CREDITS.md` - xem
file đó để biết dự án này đang ghi công theo kiểu gì.

| File | Nguồn | Giấy phép | Người thêm |
| --- | --- | --- | --- |
| `nightfall.webm` / `.mp4` | Tự dựng cho dự án - `scripts/build-cinematics.mjs` | Thuộc repo này | kangha23 |
| `dawn.webm` / `.mp4` | Tự dựng cho dự án - `scripts/build-cinematics.mjs` | Thuộc repo này | kangha23 |
| `trial.webm` / `.mp4` | Tự dựng cho dự án - `scripts/build-cinematics.mjs` | Thuộc repo này | kangha23 |
| `verdict.webm` / `.mp4` | Tự dựng cho dự án - `scripts/build-cinematics.mjs` | Thuộc repo này | kangha23 |
| `village-win.webm` / `.mp4` | Tự dựng cho dự án - `scripts/build-cinematics.mjs` | Thuộc repo này | kangha23 |
| `wolves-win.webm` / `.mp4` | Tự dựng cho dự án - `scripts/build-cinematics.mjs` | Thuộc repo này | kangha23 |
| `event-wolf-threat.webm` / `.mp4` | Tự dựng cho dự án - `scripts/build-cinematics.mjs` | Thuộc repo này | kangha23 |
| `event-village-boon.webm` / `.mp4` | Tự dựng cho dự án - `scripts/build-cinematics.mjs` | Thuộc repo này | kangha23 |
| `event-rule-change.webm` / `.mp4` | Tự dựng cho dự án - `scripts/build-cinematics.mjs` | Thuộc repo này | kangha23 |
| `event-spirit.webm` / `.mp4` | Tự dựng cho dự án - `scripts/build-cinematics.mjs` | Thuộc repo này | kangha23 |

Hai hình khối duy nhất không sinh ra từ công thức - dãy nhà và dấu đầu sói - là
đường path SVG chép nguyên từ `src/components/VillageSilhouette.tsx` và
`src/components/WolfMark.tsx`, cũng do dự án tự vẽ. Không có font, ảnh, hay đoạn
phim nào từ bên ngoài đi vào đây.
