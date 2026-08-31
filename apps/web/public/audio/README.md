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

MP3 stereo 44.1kHz, CBR 160kbps. Tổng thư mục 4.97 MiB, dưới trần 6 MiB.

| Track | Vòng lặp | Nhịp | LUFS | True peak |
| --- | --- | --- | --- | --- |
| `night` | 72.000000s | không có nhịp thiết kế | -24.0 | -11.6 dBFS |
| `day` | 96.000000s | 90 BPM, 3/4, 48 ô nhịp | -24.7 | -10.5 dBFS |
| `vote` | 85.714286s | 112 BPM, 4/4, 40 ô nhịp | -23.7 | -10.4 dBFS |

Ba mức LUFS lệch nhau nhiều nhất 1.0 LU. `day` cố ý nhẹ hơn một chút vì đó là
track nghe lâu nhất, `vote` nhỉnh hơn để pha bỏ phiếu có sức ép.

## Cân bằng cho loa điện thoại

Phần lớn người chơi nghe qua loa điện thoại, thứ gần như không phát ra được gì
dưới ~200Hz. Một track dồn năng lượng xuống dải thấp sẽ *biến mất* đúng ở nơi
nó được nghe nhiều nhất, trong khi mọi phép đo khác vẫn đẹp — nên bộ kiểm chứng
đo riêng điều này bằng một dải thông 180Hz-8kHz (bậc 3) mô phỏng cái loa đó.

| Track | LUFS gốc | LUFS qua loa | Mất | Năng lượng trên 200Hz |
| --- | --- | --- | --- | --- |
| `night` | -24.00 | -25.81 | 1.81 LU | 61.2% |
| `day` | -24.70 | -26.03 | 1.33 LU | 69.7% |
| `vote` | -23.70 | -25.46 | 1.76 LU | 57.2% |

Ngưỡng chỉ áp cho `vote` (mất ≤ 2.2 LU, ≥ 50% năng lượng trên 200Hz, và qua loa
không nhỏ hơn `day` quá 0.5 LU), vì nó là track duy nhất có nhiệm vụ tạo cao
trào. `night` được phép tối và trầm — đó là công việc của nó.

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

## Môi trường dựng nhạc

Bộ công cụ chạy bằng Python và không phụ thuộc gì ngoài PyPI:

```
python -m venv .venv-audio
.venv-audio\Scripts\activate            # Windows
source .venv-audio/bin/activate         # macOS / Linux
python -m pip install -r tools/audio/requirements.txt
```

`tools/audio/requirements.txt` ghim phiên bản chính xác. `matplotlib` nằm riêng
ở cuối file và chỉ cần khi chạy `verify_music.py --plots`; bốn gói còn lại là
bắt buộc.

## Dựng lại nhạc

Ba track là tác phẩm gốc tổng hợp bằng code, không phải file tải về:

```
python tools/audio/make_music.py          --out   apps/web/public/audio
python tools/audio/verify_music.py        --audio apps/web/public/audio
python tools/audio/test_verify_negative.py --audio apps/web/public/audio
python tools/audio/make_demo.py           --audio apps/web/public/audio --out /tmp/audition
```

`make_music.py` dựng và encode, tự hiệu chỉnh độ to trên chính file mp3 đã
encode. `make_demo.py` xuất file nghe thử ba vòng liên tiếp và chuỗi chuyển pha
có crossfade 600ms giống engine.

`verify_music.py` giải mã lại mp3 rồi đo tính tuần hoàn, chỗ nối, độ to và mô
phỏng loa điện thoại. Mặc định nó chạy **nghiêm ngặt**: mỗi ngưỡng là một điều
kiện phải đạt, báo cáo in rõ điều kiện nào hỏng và trượt bao xa, và script trả
exit code 1 nếu có bất kỳ điều kiện nào không đạt. `--no-strict` chỉ in báo cáo.
`test_verify_negative.py` chứng minh bộ kiểm chứng đó không phải hình thức: nó
làm hỏng một bản **sao** trong thư mục tạm theo bốn cách (thiếu track, thiếu mốc
lặp, mốc lặp lệch 40ms, mức âm lệch 1.2 dB) và đòi mỗi ca phải trả exit 1, kèm
một đối chứng dương trên bản sao nguyên vẹn. Asset thật trong repo chỉ được đọc.

### Lời hứa "dựng lại ra đúng cùng file" có phạm vi

Mọi nguồn ngẫu nhiên trong `tools/audio/` đều gieo hạt cố định, nên bản dựng là
tất định — nhưng chỉ **trong cùng một môi trường**. Chạy lại hai lần bằng đúng
bộ phiên bản đã ghim ở `requirements.txt` cho ra file mp3 trùng nhau đến từng
byte; điều này đã được kiểm bằng cách dựng vào thư mục tạm rồi so SHA-256.

Điều **chưa** được kiểm chứng, và vì vậy không được hứa: cùng một byte trên máy
khác, hệ điều hành khác, hay bộ phiên bản khác. Cả `numpy` (thứ tự cộng dồn dấu
phẩy động, thư viện BLAS bên dưới) lẫn `lame` (bản dựng bánh xe của `lameenc`)
đều có thể cho kết quả lệch vài bit mà không ai coi đó là lỗi. Môi trường đã
dùng để dựng bộ nhạc hiện tại:

| | |
| --- | --- |
| Hệ điều hành | Windows 11 (10.0.26200), x86-64 |
| Python | 3.14.4 (MSC v.1944, 64-bit) |
| numpy / scipy | 2.5.2 / 1.18.1 |
| pyloudnorm / miniaudio / lameenc | 0.2.0 / 1.71 / 1.8.4 |

Nếu bản dựng lại lệch byte nhưng `verify_music.py` vẫn trả exit 0 thì file đó
dùng được: hợp đồng thật nằm ở bộ ngưỡng của verifier, không ở giá trị băm.

## Giấy phép

Xem `CREDITS.md`. Ba file nhạc là tác phẩm gốc của dự án, giấy phép CC0 1.0,
**không bắt buộc ghi công**. Hiệu ứng là CC0 và phạm vi công cộng.
