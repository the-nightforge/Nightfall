# Ghi công âm thanh

## Nhạc nền

`music/night.mp3`, `music/day.mp3`, `music/vote.mp3` là **tác phẩm gốc của
chính dự án này**, không lấy từ nguồn ngoài.

- Tên bộ: *Dark Medieval Folk Ambient* cho Ma Sói Online
- Tác giả: dự án Ma Sói Online
- Giấy phép: **CC0 1.0 Universal** (phạm vi công cộng) —
  https://creativecommons.org/publicdomain/zero/1.0/
- Không bắt buộc ghi công, được dùng lại cho mục đích bất kỳ.

Ba track được tổng hợp bằng script trong `tools/audio/` chứ không thu âm và
cũng không sample từ bản ghi nào. Chạy lại `python tools/audio/make_music.py
--out apps/web/public/audio` sẽ dựng lại đúng ba file này — mọi nguồn ngẫu
nhiên đều gieo hạt cố định. Vì toàn bộ mẫu âm sinh ra từ code trong repo,
nguồn gốc kiểm chứng được và không có ràng buộc bản quyền của bên thứ ba.

Bảng nhạc cụ dùng chung cho cả ba track, nên chuyển pha không lệch tông:

| Nhạc cụ | Cách tổng hợp |
| --- | --- |
| Đàn gảy (luýt/thụ cầm) | Karplus-Strong, dây trễ nội suy tuyến tính |
| Dây kéo (viol/fiddle) | Cộng hưởng bồi âm + nhiễu vĩ + vibrato, 2-3 người kéo |
| Drone đàn quay tay | Nhiều giọng lệch nhau, hoà âm cơ bản hạ thấp, có tiếng cọ |
| Chuông | Bồi âm phi điều hoà (0.5, 1, 1.183, 1.506, 2, 2.514...) |
| Trống khung / trống trận | Mode màng tròn theo tỉ lệ Bessel + tiếng vỗ và tiếng dùi |
| Sáo gỗ | Sóng cơ bản + hơi thở dải rộng |
| Gió, không khí | Nhiễu nâu lọc dải, biên độ đưa theo LFO chậm |
| Vang | Convolution với đáp ứng xung sảnh đá tự dựng |

Cả ba đều lấy Rê làm tâm âm: đêm và bỏ phiếu ở Rê thứ, ngày ở Rê Dorian.

## Hiệu ứng

Không đổi trong lần thay nhạc này.

`sfx/turn.mp3`, `sfx/ballot.mp3`, `sfx/death.mp3`, `sfx/win.mp3`, `sfx/lose.mp3`
dựng từ bộ Interface Sounds, Impact Sounds và Jingles của Kenney
(https://kenney.nl) — giấy phép CC0 1.0, không bắt buộc ghi công.

`sfx/howl.mp3` cắt từ "Wolf howls" của U.S. Fish and Wildlife Service
(https://commons.wikimedia.org/wiki/File:Wolf_howls.ogg) — tác phẩm của chính
phủ liên bang Hoa Kỳ, thuộc phạm vi công cộng, không bắt buộc ghi công.

## Lịch sử

Bộ nhạc trước đây dùng "Dark Pad", "Anxiety" và "Chase Pulse Faster" của Kevin
MacLeod (incompetech.com) theo giấy phép CC BY 4.0. Bộ đó đã được thay hoàn
toàn và **không còn file nào của Kevin MacLeod trong repo**, nên phần ghi công
CC BY kèm theo cũng đã được gỡ. Nếu khôi phục lại bất kỳ file nào trong ba
file đó thì phải khôi phục cả phần ghi công.
