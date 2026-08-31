# Ghi công âm thanh

## Nhạc nền

Cả ván dùng đúng một file. Đây là nội dung của bên thứ ba; dự án chỉ cắt vòng
lặp, crossfade, EQ nhẹ, hạ mức âm và chuyển mã. Không dùng Claude hay mô hình
sinh nhạc để tạo thêm tiếng, nốt hoặc nhạc cụ.

### `music/werewolf-theme.mp3`

- Tác phẩm: **NHẠC NỀN MA SÓI ONLINE**
- Tác giả/người đăng: **Nguyễn Hữu Hiếu**
- Nguồn: YouTube
- Bản dùng để dựng: file MP3 tải về máy, SHA-256
  `9654dafdbd1e660e4ad574b6e77a984387773892c649b6ff813fa5e3fe18bbb2`
  (409.2s, 15.61 MiB). File này KHÔNG nằm trong repo.
- Giấy phép: **chưa xác định** — xem cảnh báo bên dưới.
- Thay đổi: lấy vòng 48.475 giây từ mốc 189.15s của bản gốc; crossfade
  equal-power 6 giây giữa đầu vòng và phần chạy tiếp sau cuối vòng; lọc dưới
  80Hz (bậc 2.5) và trên 14kHz; không shelf, không dip, không nén động, không
  limiter; chuẩn hoá -27.0 LUFS với trần -3 dBTP (đo được -12.97 dBTP); encode
  MP3 CBR 192kbps.

### ⚠️ Cảnh báo quyền sử dụng

**Chưa xin được phép của tác giả.** File nguồn là bản tải về từ YouTube, không
kèm giấy phép mở nào và chưa có văn bản cấp quyền. Asset này chỉ dùng cho chạy
nội bộ và thử nghiệm.

Trước khi phát hành công khai, cần một trong hai:

1. Xin phép tác giả bằng văn bản, rồi cập nhật `license`, `licenseUrl` và
   `sourceFileUrl` trong `music-sources.json` cho khớp; hoặc
2. Thay bằng nhạc có giấy phép mở (CC0 hoặc CC BY) và dựng lại.

`music-sources.json` khai `"license": "UNVERIFIED"` kèm `rightsNote`, và
`verify_music.py --require-cleared-rights` trả exit 1 chừng nào trạng thái đó
còn nguyên. Đó là chốt chặn: đừng gỡ nó để cho build phát hành đi qua.

## Hiệu ứng

Không đổi trong lần thay nhạc này.

`sfx/turn.mp3`, `sfx/ballot.mp3`, `sfx/death.mp3`, `sfx/win.mp3`, `sfx/lose.mp3`
dựng từ bộ Interface Sounds, Impact Sounds và Jingles của Kenney
(https://kenney.nl) — giấy phép CC0 1.0.

`sfx/howl.mp3` cắt từ "Wolf howls" của U.S. Fish and Wildlife Service
(https://commons.wikimedia.org/wiki/File:Wolf_howls.ogg) — tác phẩm của chính
phủ liên bang Hoa Kỳ, thuộc phạm vi công cộng.

## Lịch sử

- Bộ đầu tiên: ba bài CC0 của Ragnar Random. Đã gỡ hoàn toàn.
- Bộ thứ hai ("kinh dị làng quê Việt Nam"): `day` và `night` là bản thu thực
  địa của Kevin Luce (kevp888) trên Freesound theo CC BY 4.0, `vote` là bản thu
  của molinsky theo CC0 1.0. Ba file `music/day.mp3`, `music/night.mp3`,
  `music/vote.mp3` đã bị xoá khỏi repo; không còn asset nào của bộ đó, nên
  nghĩa vụ ghi công CC BY của bộ đó cũng đã chấm dứt.
- Bộ hiện tại: một track duy nhất, xem trên.
