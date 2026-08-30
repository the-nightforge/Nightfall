# Clip chuyển cảnh

Thư mục này **cố ý đang trống**. Repo không chứa file video: một bộ mười clip là
khoảng 10MB đi vào lịch sử git vĩnh viễn, và video mẫu giả thì tệ hơn nữa - nó
qua được vòng review rồi lên production.

Chừng nào chưa có clip thật, game vẫn chạy đủ chuyển cảnh bằng bản dựng CSS
trong `src/app/cinematics.css`. Đó là đường mặc định, không phải đường hỏng:
thiếu file, hỏng mạng, hay codec lạ đều cho ra đúng kết quả ấy, không có màn
hình đen và không chặn ván nào. Thả clip vào đây là chúng tự được dùng, không
phải sửa code.

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

Danh sách này là bản chép tay của `CINEMATIC_CLIPS` trong
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
- **Độ phân giải:** 1280×720. Lớp phủ dùng `object-cover` nên clip bị cắt hai
  bên trên màn dọc của điện thoại - **giữ mọi thứ quan trọng trong khung an toàn
  ở giữa**, đừng đặt gì sát mép.
- **Dung lượng:** khoảng **0,8-1,2MB mỗi file**. Đây là trần cứng: clip phát
  ngay giữa lúc người chơi đang phải bấm, tải lâu hơn thời lượng của chính nó
  thì bản CSS chạy hết trước khi clip kịp xuất hiện.
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

Lệnh mẫu để ép về đúng chuẩn trên (`in.mov` là bản dựng gốc):

```bash
# WebM - bản chính. -an là chỗ gỡ track tiếng.
ffmpeg -i in.mov -an -vf scale=1280:720 -c:v libvpx-vp9 -b:v 900k -crf 34 nightfall.webm

# MP4 - bản lui cho Safari cũ.
ffmpeg -i in.mov -an -vf scale=1280:720 -c:v libx264 -profile:v main -pix_fmt yuv420p -b:v 950k nightfall.mp4
```

Kiểm tra lại trước khi commit:

```bash
# Phải KHÔNG in ra dòng nào: có dòng nghĩa là track tiếng vẫn còn.
ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv nightfall.webm
ls -l nightfall.webm   # phải dưới ~1,2MB
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
| _(chưa có clip nào)_ | | | |
