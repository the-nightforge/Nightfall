# Ghi công hình ảnh đại diện

20 chân dung trong `avatar-art.ts` lấy từ **game-icons.net**, giấy phép
**CC BY 3.0** — **bắt buộc ghi công**. Không được xoá phần này, và nếu thay bộ
hình thì phải cập nhật lại cho khớp nguồn mới.

https://creativecommons.org/licenses/by/3.0/

## Tác giả

| Hình trong game | Tên gốc trên game-icons.net | Tác giả |
| --- | --- | --- |
| `farmer` | farmer | Delapouite |
| `cook` | cook | Delapouite |
| `blacksmith` | blacksmith | Delapouite |
| `miner` | miner | Delapouite |
| `monk` | monk-face | Delapouite |
| `mustache` | mustache | Delapouite |
| `jester` | jester-hat | Delapouite |
| `ranger` | robin-hood-hat | Delapouite |
| `captain` | pirate-captain | Delapouite |
| `viking` | viking-head | Delapouite |
| `pilgrim` | pilgrim-hat | Delapouite |
| `turban` | turban | Delapouite |
| `sombrero` | sombrero | Delapouite |
| `cowled` | cowled | Lorc |
| `hood` | hood | Lorc |
| `beard` | beard | Lorc |
| `wizard` | wizard-face | Delapouite |
| `cultist` | cultist | Lorc |
| `spy` | spy | Delapouite |
| `bandit` | bandit | Delapouite |
| biểu tượng vai `TRAITOR` | duality | Lorc |

## Đã xử lý những gì

Tải bản `ffffff/000000`, bỏ ô nền đen `M0 0h512v512H0z` của bản gốc rồi nhúng
thẳng path vào `avatar-art.ts` để tô màu bằng `fill` của Tailwind. Không đổi
hình dạng.

Nhúng vào bundle chứ không để trong `public/`: một phòng hiển thị tới 20 ô, tách
thành file rời là 20 lượt round-trip trên 4G để đổi lấy khoảng 12KB đã nén.

## Chưa làm

Ghi công hiện chỉ nằm trong mã nguồn, giống cách đang làm với `public/audio/CREDITS.md`.
Đọc CC BY chặt hơn thì cần một dòng ghi công người chơi nhìn thấy được trong
game — nếu làm, thêm cho cả nhạc lẫn hình cùng lúc.
