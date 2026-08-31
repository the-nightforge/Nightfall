# File âm thanh

Thiếu file nào thì phần đó im lặng, game vẫn chạy bình thường.

| Đường dẫn | Vai trò |
| --- | --- |
| `music/night.mp3` | đêm làng quê: sáo xa, côn trùng, thưa và bất an |
| `music/day.mp3` | ban ngày: đồng quê yên, ít gây phân tâm |
| `music/vote.mp3` | bỏ phiếu: nhạc cụ truyền thống, trầm và chắc |
| `sfx/howl.mp3` | dưới 2s, sói hú |
| `sfx/turn.mp3` | dưới 1s, nhẹ, nghe nhiều lần mỗi ván |
| `sfx/death.mp3` | dưới 2s |
| `sfx/ballot.mp3` | dưới 1s |
| `sfx/win.mp3` | dưới 3s |
| `sfx/lose.mp3` | dưới 3s |

## Bộ hiện tại: kinh dị làng quê Việt Nam

Không dùng một bài nhạc dày chạy liên tục. `day` và `night` là bản thu thực
địa Việt Nam; `vote` là bản thu nhạc cụ truyền thống Việt Nam. Cách này giữ
được bản sắc địa phương mà không biến nhạc nghi lễ hay tiếng cầu khấn thành
đạo cụ kinh dị. Không file nào có giọng nói.

| Track | Nguồn | Vòng lặp | LUFS | True peak |
| --- | --- | ---: | ---: | ---: |
| `night` | BR_041_VN_FluteInNight | 37.000s | -28.00 | -7.57 dBTP |
| `day` | BR_017_VN_QuietFields | 38.000s | -28.00 | -9.35 dBTP |
| `vote` | ZOOM0005.WAV | 51.000s | -26.99 | -4.51 dBTP |

`night` và `day` thấp hơn bộ trước 1.5 LU. `vote` cao hơn đúng 1 LU để pha
phán quyết rõ hơn nhưng vẫn chìm dưới hiệu ứng. Không nén động, không limiter,
không thêm nhạc cụ. Dải ve/dế 3–6kHz và dải sáo 1–3kHz được hạ nhẹ để nghe lâu
không gắt; true peak luôn dưới -3 dBTP.

MP3 stereo 44.1kHz, CBR 256kbps. Nhạc chiếm 3.94 MiB; toàn bộ thư mục audio
4.01 MiB, dưới trần 6 MiB.

## Điểm lặp

Mỗi file có 0.5 giây đệm tuần hoàn ở đầu/cuối và mốc trong
`loop-points.json`. Engine chỉ đọc `loopStart` và `loopEnd`; các khoá còn lại
là số liệu đối chiếu.

Vì bản thu môi trường không có ô nhịp, đầu vòng được trộn equal-power trong 6
giây với phần chạy tiếp sau cuối vòng. Khi quay về đầu, mẫu kế tiếp vẫn là mẫu
tự nhiên từ nguồn. Phần đệm cũng lấy từ chính vòng lặp, không dùng im lặng.

## Dựng lại

Tải ba official HQ preview MP3 và đặt tên:

| Tên local | URL |
| --- | --- |
| `day-source.mp3` | https://cdn.freesound.org/previews/578/578503_9034501-hq.mp3 |
| `night-source.mp3` | https://cdn.freesound.org/previews/578/578505_9034501-hq.mp3 |
| `vote-source.mp3` | https://cdn.freesound.org/previews/497/497058_729547-hq.mp3 |

Script kiểm SHA-256 của cả ba nguồn trước khi ghi asset. Sau đó chạy:

```text
python tools/audio/build_music.py --src <thư mục nguồn> --out apps/web/public/audio
python tools/audio/verify_music.py --audio apps/web/public/audio
python tools/audio/test_verify_negative.py --audio apps/web/public/audio
python tools/audio/make_demo.py --audio apps/web/public/audio --out reports/audio-audition-vietnam
```

`build_music.py` dựng vào thư mục tạm và chỉ thay asset thật sau khi cả ba file
đã encode, đạt LUFS và true peak. `verify_music.py` giải mã lại MP3, kiểm
SHA-256/giấy phép, độ to, true peak, tính tuần hoàn, seam, năng lượng cao tần
và khả năng nghe qua loa điện thoại.

`test_verify_negative.py` chạy một đối chứng nguyên vẹn và sáu ca phá thử:
thiếu manifest, thiếu track, thiếu mốc lặp, lệch mốc 40ms, lệch độ to 1.2dB,
và sai SHA-256.
Mọi sửa đổi chỉ diễn ra trên bản sao trong thư mục tạm.

## Giấy phép

`day` và `night` là CC BY 4.0 nên phải giữ ghi công; `vote` là CC0 1.0.
Thông tin đầy đủ và các thay đổi nằm trong `CREDITS.md`; metadata máy đọc nằm
trong `music-sources.json`.
