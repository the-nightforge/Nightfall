# File âm thanh

Thiếu file nào thì phần đó im lặng, game vẫn chạy bình thường.

| Đường dẫn | Yêu cầu |
| --- | --- |
| `music/night.mp3` | loop, u ám, chậm |
| `music/day.mp3` | loop, căng thẳng vừa, dùng cho cả phòng chờ |
| `music/vote.mp3` | loop, dồn dập |
| `sfx/howl.mp3` | dưới 2s, sói hú |
| `sfx/turn.mp3` | dưới 1s, nhẹ, nghe nhiều lần mỗi ván |
| `sfx/death.mp3` | dưới 2s |
| `sfx/ballot.mp3` | dưới 1s |
| `sfx/win.mp3` | dưới 3s |
| `sfx/lose.mp3` | dưới 3s |

## Điểm lặp

Mỗi file nhạc có đệm 0.5 giây ở đầu và cuối, và một mục trong `loop-points.json`:

```json
{ "night": { "loopStart": 0.5, "loopEnd": 61.6224 } }
```

Vùng đệm chứa artefact biên của bộ mã hoá mp3; đoạn giữa hai mốc mới là phần
được lặp. Engine đọc file này lúc chạy, nên thay nhạc thì phải cập nhật cả mốc.
Thiếu mục thì engine lặp trọn file, tức là nghe cả phần đệm.

## Giấy phép

Xem `CREDITS.md`. Ba file nhạc là CC BY 4.0 nên **bắt buộc giữ phần ghi công**.
