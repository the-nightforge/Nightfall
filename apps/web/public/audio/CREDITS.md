# Ghi công âm thanh

## Nhạc nền

Ba file `music/night.mp3`, `music/day.mp3`, `music/vote.mp3` là **nhạc của bên
thứ ba**, không phải tác phẩm của dự án này và **không do AI tạo ra**.

- Tác giả: **Ragnar Random**
- Bộ nhạc: *Orchestral and World Music for Games*
- Nguồn chính thức (nơi đã tải):
  https://ragnarrandom.itch.io/orchestral-and-world-music-for-games
- Giấy phép: **CC0 1.0 Universal** (phạm vi công cộng) —
  https://creativecommons.org/publicdomain/zero/1.0/
  Trang nguồn ghi ở mục *Asset license*: "Creative Commons Zero v1.0 Universal".
- Không dùng AI: trang nguồn ghi ở mục *Content*: **"No generative AI was used"**.

CC0 **không bắt buộc ghi công**. Phần ghi công ở đây là tự nguyện, và giữ lại
vì nó trả lời được câu hỏi quan trọng hơn giấy phép: ba file này ở đâu ra.

| File trong repo | Bài gốc |
| --- | --- |
| `music/day.mp3` | `02 - the town where i got the magic bottle.ogg` |
| `music/night.mp3` | `05 - tower of the vampire.ogg` |
| `music/vote.mp3` | `01 - it is dangerous to be lonely without a sword.ogg` |

File gốc tải trực tiếp từ trang itch.io ở trên, định dạng OGG Vorbis. Không
lấy từ YouTube, Spotify, Apple Music hay bất kỳ trang tải lại nào.

### Dự án đã làm gì với chúng

Chỉ ba việc, không việc nào tạo ra nội dung âm nhạc mới:

1. **Cắt vòng lặp.** Mỗi track lấy một đoạn rơi đúng vào bội số nguyên của ô
   nhịp, nối thành vòng bằng crossfade equal-power.
2. **Cắt hạ âm.** Lọc thông cao 40-70Hz tuỳ track, bỏ phần năng lượng nằm dưới
   ngưỡng nghe của loa điện thoại.
3. **Chuẩn hoá độ to** về -26.5 / -25.5 LUFS và chuyển sang MP3 160kbps.

Không nén động, không limiter, không thêm nhạc cụ, không sinh thêm nốt nào.
Toàn bộ nằm trong `tools/audio/build_music.py`; xem `README.md` để chạy lại.

## Hiệu ứng

Không đổi trong lần thay nhạc này.

`sfx/turn.mp3`, `sfx/ballot.mp3`, `sfx/death.mp3`, `sfx/win.mp3`, `sfx/lose.mp3`
dựng từ bộ Interface Sounds, Impact Sounds và Jingles của Kenney
(https://kenney.nl) — giấy phép CC0 1.0, không bắt buộc ghi công.

`sfx/howl.mp3` cắt từ "Wolf howls" của U.S. Fish and Wildlife Service
(https://commons.wikimedia.org/wiki/File:Wolf_howls.ogg) — tác phẩm của chính
phủ liên bang Hoa Kỳ, thuộc phạm vi công cộng, không bắt buộc ghi công.

## Lịch sử

Bộ nhạc **trước đó** là tác phẩm tổng hợp bằng code của chính dự án
("Dark Medieval Folk Ambient", dựng bằng `tools/audio/make_music.py`). Bộ đó
đã được thay hoàn toàn bằng nhạc người sáng tác ở trên; script dựng nhạc
procedural cùng các khối tổng hợp âm chỉ nó dùng đã bị xoá khỏi repo để không
ghi đè lại asset mới.

Trước đó nữa là "Dark Pad", "Anxiety" và "Chase Pulse Faster" của Kevin MacLeod
(incompetech.com) theo CC BY 4.0. **Không còn file nào của Kevin MacLeod trong
repo**, nên phần ghi công CC BY kèm theo cũng đã được gỡ. Nếu khôi phục lại bất
kỳ file nào trong ba file đó thì phải khôi phục cả phần ghi công.
