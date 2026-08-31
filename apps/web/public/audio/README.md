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

## Bộ nhạc hiện tại

Nhạc của **Ragnar Random**, bộ *Orchestral and World Music for Games*, giấy
phép CC0 1.0, tải từ trang chính thức và **không do AI tạo ra** — xem
`CREDITS.md` cho nguồn, giấy phép và trích dẫn nguyên văn.

MP3 stereo 44.1kHz, CBR 160kbps. Tổng thư mục 3.51 MiB, dưới trần 6 MiB.

| Track | Bài gốc | Vòng lặp | LUFS | True peak |
| --- | --- | --- | --- | --- |
| `night` | 05 - tower of the vampire | 67.200000s | -26.50 | -13.07 dBTP |
| `day` | 02 - the town where i got the magic bottle | 52.363900s | -26.50 | -12.16 dBTP |
| `vote` | 01 - it is dangerous to be lonely without a sword | 57.600000s | -25.50 | -12.64 dBTP |

Cả ba nằm trong khoảng -27..-25 LUFS: nhạc nền phải chìm dưới hiệu ứng chứ
không tranh chỗ với nó. `vote` cao hơn hai track kia đúng 1.0 LU để pha bỏ
phiếu có thêm sức ép. True peak cách trần -3 dBTP ít nhất 9 dB, nên không có
chỗ nào chạm điểm cắt kể cả sau khi thiết bị resample.

Không nén động, không limiter. Ở mức -26 LUFS thì không có gì để limiter phải
xử lý, và nhạc nền bị nén mạnh đúng là thứ nghe mười phút thì mệt tai.

## Cân bằng cho loa điện thoại

Phần lớn người chơi nghe qua loa điện thoại, thứ gần như không phát ra được gì
dưới ~200Hz. Một track dồn năng lượng xuống dải thấp sẽ *biến mất* đúng ở nơi
nó được nghe nhiều nhất, trong khi mọi phép đo khác vẫn đẹp — nên bộ kiểm chứng
đo riêng điều này bằng một dải thông 180Hz-8kHz (bậc 3) mô phỏng cái loa đó.

| Track | LUFS gốc | LUFS qua loa | Mất | Năng lượng trên 200Hz |
| --- | --- | --- | --- | --- |
| `night` | -26.50 | -28.80 | 2.30 LU | 33.8% |
| `day` | -26.50 | -26.72 | 0.22 LU | 95.5% |
| `vote` | -25.50 | -25.83 | 0.33 LU | 83.2% |

Ngưỡng chỉ áp cho `vote` (mất ≤ 2.2 LU, ≥ 50% năng lượng trên 200Hz, và qua loa
không nhỏ hơn `day` quá 0.5 LU), vì nó là track duy nhất có nhiệm vụ tạo cao
trào. `night` được phép tối và trầm — đó là công việc của nó.

### Vì sao phải cắt hạ âm

Hai trong ba bài gốc dồn rất nhiều năng lượng xuống vùng **dưới ngưỡng nghe**
của thiết bị phổ thông. Đo trên file OGG gốc:

| Bài gốc | Dưới 30Hz | 30-45Hz | Tổng dưới 45Hz |
| --- | --- | --- | --- |
| 05 - tower of the vampire | 33.5% | 27.5% | **61.0%** |
| 01 - it is dangerous to be lonely without a sword | 0.2% | 0.3% | 0.5% |
| 02 - the town where i got the magic bottle | 0.2% | 0.0% | 0.2% |

61% tổng năng lượng của `night` nằm ở dải mà không loa điện thoại, loa laptop
hay tai nghe phổ thông nào tái tạo được. Để nguyên thì lúc chuẩn hoá về -26.5
LUFS, phần rác đó kéo tụt phần thực sự nghe được xuống theo. Lọc thông cao
70Hz (bậc 2.5) đưa phần dưới 45Hz của `night` từ 31.9% xuống 7.2% và nâng năng
lượng trên 200Hz từ 17.6% lên 33.8%, tức là **track nghe rõ hơn trên điện thoại
mà không phải tăng âm lượng**. `day` và `vote` gần như không có hạ âm nên chỉ
đặt bộ lọc 40Hz làm lưới an toàn.

Đây là toàn bộ phần EQ. Không có kệ, không có dip 2-5kHz — cả ba bài đều đã có
sẵn dải 2-5kHz rất thấp (1.7-2.0% tổng năng lượng) nên không có gì để gọt.

## Điểm lặp

Mỗi file nhạc có đệm 0.5 giây ở đầu và cuối, và một mục trong `loop-points.json`:

```json
{ "night": { "loopStart": 0.5, "loopEnd": 67.7 } }
```

Engine chỉ đọc `loopStart` và `loopEnd`; các khoá còn lại (`loopLen`,
`fileLen`, `loopSamples`, `kb`, `source`) là số liệu để đối chiếu khi dựng lại
nhạc. Engine đọc file này lúc chạy, nên thay nhạc thì phải cập nhật cả mốc.
Thiếu mục thì engine lặp trọn file, tức là nghe cả phần đệm.

Vùng đệm **không phải im lặng** mà là phần nối tiếp tuần hoàn của chính đoạn
lặp: đoạn đệm đầu là 0.5s cuối vòng, đoạn đệm cuối là 0.5s đầu vòng. Nhờ vậy
cả file là một tín hiệu liên tục, bộ mã hoá mp3 không thấy điểm gãy nào, và
độ trễ mã hoá có dịch file đi vài chục mili giây cũng không phá vòng lặp — bất
kỳ cửa sổ nào dài đúng `loopLen` cũng lặp liền mạch.

### Vòng lặp được cắt ở đâu

Nhạc gốc là bài có mở đầu và kết, không phải loop sẵn. Ba bước để cắt ra vòng:

1. **Dò vùng lặp bằng tự tương quan.** So đặc trưng phổ tại `t0` với tại
   `t0+L` trên cửa sổ 6 giây, quét mọi `t0` và `L` trong vùng dùng được. Vùng
   thắng là chỗ bản nhạc thực sự quay lại cùng một ý — nên chỗ nối rơi vào
   ranh giới câu nhạc chứ không cắt giữa câu.
2. **Căn pha đến từng mẫu.** `L` được tinh chỉnh trong ±150ms để tương quan
   chéo dạng sóng giữa hai đoạn sắp trộn đạt cực đại. Không có bước này thì
   crossfade hai đoạn lệch pha sẽ *triệt tiêu* dải thấp thay vì hoà vào nhau.
3. **Crossfade equal-power.** Đầu vòng lặp được trộn với phần nhạc chạy tiếp
   SAU cuối vòng, trọng số `cos`/`sin` nên `cos²+sin²=1`, năng lượng giữ nguyên
   suốt vùng trộn thay vì hõm ở giữa như crossfade tuyến tính.

| Track | `t0` trong bài gốc | Độ dài vòng | Cấu trúc | Crossfade | Khớp pha |
| --- | --- | --- | --- | --- | --- |
| `night` | 55.10s | 67.200000s | 7 câu × 9.6s | 3.0s | 0.9970 |
| `day` | 24.70s | 52.363900s | 32 phách | 2.5s | 0.7668 |
| `vote` | 19.15s | 57.600000s | 36 phách | 2.5s | 0.9719 |

"Khớp pha" là hệ số tương quan đạt được ở bước 2. `day` thấp hơn hai track kia
vì đoạn nối lại của nó là biến tấu chứ không phải lặp nguyên văn; chỗ nối vẫn
liền (bước nhảy -56.5 dBFS, `hf_z` -0.44) nhưng nghe kỹ có thể thấy hoà âm đổi
màu ngay tại điểm nối. Đây là chỗ đáng nghe lại bằng tai.

## Môi trường dựng nhạc

Bộ công cụ chạy bằng Python và không phụ thuộc gì ngoài PyPI — **không cần
ffmpeg**, `miniaudio` giải mã OGG/MP3 và `lameenc` mã hoá MP3:

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

File OGG gốc **không nằm trong repo** (khoảng 15 MiB cho ba bài, và CC0 nên
tải lại lúc nào cũng được). Tải ba bài dưới đây từ trang chính thức
https://ragnarrandom.itch.io/orchestral-and-world-music-for-games vào một thư
mục, giữ nguyên tên file:

```
01 - it is dangerous to be lonely without a sword.ogg
02 - the town where i got the magic bottle.ogg
05 - tower of the vampire.ogg
```

Rồi chạy:

```
python tools/audio/build_music.py          --src <thư mục ogg> --out apps/web/public/audio
python tools/audio/verify_music.py         --audio apps/web/public/audio
python tools/audio/test_verify_negative.py --audio apps/web/public/audio
python tools/audio/make_demo.py            --audio apps/web/public/audio --out reports/audio-audition
```

`build_music.py` cắt vòng, EQ, chuẩn hoá và encode. Nó **hiệu chỉnh độ to trên
chính file mp3 đã encode**: mã hoá 160kbps làm hụt khoảng 0.45 dB năng lượng
băng rộng trên bộ nhạc này, nên chuẩn hoá trước khi encode rồi tin vào con số
đó sẽ lệch đúng 0.45 LU — vừa đủ để `verify_music.py` bắt lỗi. Vòng hiệu chỉnh
hội tụ sau 2 lần encode.

`make_demo.py` xuất file nghe thử ba vòng liên tiếp và chuỗi chuyển pha
đêm→ngày→bỏ phiếu→đêm có crossfade 600ms giống engine. `reports/` nằm trong
`.gitignore` nên file nghe thử không lọt vào repo.

`verify_music.py` giải mã lại mp3 rồi đo tính tuần hoàn, chỗ nối, độ to và mô
phỏng loa điện thoại. Mặc định nó chạy **nghiêm ngặt**: mỗi ngưỡng là một điều
kiện phải đạt, báo cáo in rõ điều kiện nào hỏng và trượt bao xa, và script trả
exit code 1 nếu có bất kỳ điều kiện nào không đạt. `--no-strict` chỉ in báo cáo.
`test_verify_negative.py` chứng minh bộ kiểm chứng đó không phải hình thức: nó
làm hỏng một bản **sao** trong thư mục tạm theo bốn cách (thiếu track, thiếu mốc
lặp, mốc lặp lệch 40ms, mức âm lệch 1.2 dB) và đòi mỗi ca phải trả exit 1, kèm
một đối chứng dương trên bản sao nguyên vẹn. Asset thật trong repo chỉ được đọc.

Bản dựng là tất định: cùng file OGG vào, cùng bộ phiên bản ở
`requirements.txt`, thì ra cùng file mp3. Không còn nguồn ngẫu nhiên nào trong
đường dựng ngoài dither TPDF lúc chuyển sang int16, và nó gieo hạt cố định.

## Giấy phép

Xem `CREDITS.md`. Ba file nhạc là nhạc CC0 1.0 của Ragnar Random — bên thứ ba,
người sáng tác, không phải AI, **không bắt buộc ghi công**. Hiệu ứng là CC0 và
phạm vi công cộng.
