# File âm thanh

Thiếu file nào thì phần đó im lặng, game vẫn chạy bình thường.

| Đường dẫn | Yêu cầu |
| --- | --- |
| `music/night.mp3` | loop, u ám, không nhịp rõ, không giai điệu nổi |
| `music/day.mp3` | loop, căng thẳng vừa, dùng cho cả phòng chờ |
| `music/vote.mp3` | loop, nặng và chắc, cảm giác phán quyết |
| `sfx/howl.mp3` | dưới 2s, sói hú |
| `sfx/turn.mp3` | dưới 1s, nhẹ, nghe nhiều lần mỗi ván |
| `sfx/death.mp3` | dưới 2s |
| `sfx/ballot.mp3` | dưới 1s |
| `sfx/win.mp3` | dưới 3s |
| `sfx/lose.mp3` | dưới 3s |

## Thông số bộ nhạc hiện tại

MP3 stereo 44.1kHz, CBR 160kbps. Tổng thư mục 4.97MB, dưới trần 6MB.

| Track | Vòng lặp | Nhịp | LUFS | True peak |
| --- | --- | --- | --- | --- |
| `night` | 72.000000s | không có nhịp thiết kế | -24.0 | -11.6 dBFS |
| `day` | 96.000000s | 90 BPM, 3/4, 48 ô nhịp | -24.7 | -10.5 dBFS |
| `vote` | 85.714286s | 112 BPM, 4/4, 40 ô nhịp | -23.7 | -10.3 dBFS |

Ba mức LUFS lệch nhau nhiều nhất 1.0 LU. `day` cố ý nhẹ hơn một chút vì đó là
track nghe lâu nhất, `vote` nhỉnh hơn để pha bỏ phiếu có sức ép.

## Điểm lặp

Mỗi file nhạc có đệm 0.5 giây ở đầu và cuối, và một mục trong `loop-points.json`:

```json
{ "night": { "loopStart": 0.5, "loopEnd": 72.5 } }
```

Engine chỉ đọc `loopStart` và `loopEnd`; các khoá còn lại (`loopLen`,
`fileLen`, `loopSamples`, `kb`) là số liệu để đối chiếu khi dựng lại nhạc.
Engine đọc file này lúc chạy, nên thay nhạc thì phải cập nhật cả mốc. Thiếu
mục thì engine lặp trọn file, tức là nghe cả phần đệm.

Vùng đệm **không phải im lặng** mà là phần nối tiếp tuần hoàn của chính đoạn
lặp: đoạn đệm đầu là 0.5s cuối vòng, đoạn đệm cuối là 0.5s đầu vòng. Nhờ vậy
cả file là một tín hiệu liên tục, bộ mã hoá mp3 không thấy điểm gãy nào, và
độ trễ mã hoá có dịch file đi vài chục mili giây cũng không phá vòng lặp — bất
kỳ cửa sổ nào dài đúng `loopLen` cũng lặp liền mạch.

## Dựng lại nhạc

Ba track là tác phẩm gốc tổng hợp bằng code, không phải file tải về:

```
python tools/audio/make_music.py   --out apps/web/public/audio
python tools/audio/verify_music.py --audio apps/web/public/audio
python tools/audio/make_demo.py    --audio apps/web/public/audio --out /tmp/audition
```

`make_music.py` dựng và encode, tự hiệu chỉnh độ to trên chính file mp3 đã
encode. `verify_music.py` giải mã lại mp3 rồi đo tính tuần hoàn, chỗ nối và độ
to. `make_demo.py` xuất file nghe thử ba vòng liên tiếp và chuỗi chuyển pha có
crossfade 600ms giống engine.

## Giấy phép

Xem `CREDITS.md`. Ba file nhạc là tác phẩm gốc của dự án, giấy phép CC0 1.0,
**không bắt buộc ghi công**. Hiệu ứng là CC0 và phạm vi công cộng.
