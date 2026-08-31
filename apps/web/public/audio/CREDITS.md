# Ghi công âm thanh

## Nhạc nền / không gian âm thanh

Ba asset mới dùng các bản thu thực địa và nhạc cụ truyền thống được đăng trên
Freesound. Đây là nội dung của bên thứ ba; dự án chỉ cắt vòng lặp, crossfade,
EQ nhẹ, hạ mức âm và chuyển mã. Không dùng Claude hay mô hình sinh nhạc để tạo
thêm tiếng, nốt hoặc nhạc cụ.

### `music/day.mp3`

- Tác phẩm: **BR_017_VN_QuietFields.mp3**
- Người thu: **Kevin Luce (kevp888)**
- Nguồn: https://freesound.org/people/kevp888/sounds/578503/
- Bản dùng để dựng: official HQ preview MP3 từ máy chủ Freesound
- Giấy phép: **CC BY 4.0** — https://creativecommons.org/licenses/by/4.0/
- Mô tả nguồn: cánh đồng yên tĩnh ở miền Bắc Việt Nam, thu tháng 10/2008;
  có côn trùng và chim trong một buổi chiều nóng ẩm.
- Thay đổi: lấy vùng ổn định 38 giây; crossfade 6 giây; lọc dưới 55Hz và trên
  9kHz; hạ nhẹ dải 2.8–6kHz; chuẩn hoá -28 LUFS; encode MP3 256kbps.

### `music/night.mp3`

- Tác phẩm: **BR_041_VN_FluteInNight.mp3**
- Người thu: **Kevin Luce (kevp888)**
- Nguồn: https://freesound.org/people/kevp888/sounds/578505/
- Bản dùng để dựng: official HQ preview MP3 từ máy chủ Freesound
- Giấy phép: **CC BY 4.0** — https://creativecommons.org/licenses/by/4.0/
- Mô tả nguồn: tiếng sáo truyền thống vọng từ nhà hàng xóm trong một ngôi làng
  Việt Nam vào ban đêm, kèm côn trùng; thu tháng 10/2008.
- Thay đổi: lấy 37 giây; crossfade 6 giây; lọc dưới 50Hz và trên 10kHz; hạ
  nhẹ vùng sáo 1–3kHz; chuẩn hoá -28 LUFS; encode MP3 256kbps.

### `music/vote.mp3`

- Tác phẩm: **ZOOM0005.WAV**
- Người đăng/thu: **molinsky**
- Nguồn: https://freesound.org/people/molinsky/sounds/497058/
- Bản dùng để dựng: official HQ preview MP3 từ máy chủ Freesound
- Giấy phép: **CC0 1.0** —
  https://creativecommons.org/publicdomain/zero/1.0/
- Mô tả nguồn: bản thu một số nhạc cụ truyền thống Việt Nam.
- Thay đổi: bỏ giây mở đầu, lấy 51 giây; crossfade 6 giây; lọc dưới 45Hz và
  trên 11kHz; hạ rất nhẹ vùng 3–6kHz; chuẩn hoá -27 LUFS; encode MP3 256kbps.

`music-sources.json` giữ URL, giấy phép và SHA-256 của cả file nguồn lẫn asset
đã dựng. `verify_music.py` từ chối asset bị thay mà manifest chưa cập nhật.

## Hiệu ứng

Không đổi trong lần thay nhạc này.

`sfx/turn.mp3`, `sfx/ballot.mp3`, `sfx/death.mp3`, `sfx/win.mp3`, `sfx/lose.mp3`
dựng từ bộ Interface Sounds, Impact Sounds và Jingles của Kenney
(https://kenney.nl) — giấy phép CC0 1.0.

`sfx/howl.mp3` cắt từ "Wolf howls" của U.S. Fish and Wildlife Service
(https://commons.wikimedia.org/wiki/File:Wolf_howls.ogg) — tác phẩm của chính
phủ liên bang Hoa Kỳ, thuộc phạm vi công cộng.

## Lịch sử

Bộ trước đó dùng ba bài CC0 của Ragnar Random. Các file Ragnar đã được thay
hoàn toàn; không còn asset nào của bộ đó trong thư mục `music/`.
