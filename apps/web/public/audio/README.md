# File âm thanh

Thiếu file nào thì phần đó im lặng, game vẫn chạy bình thường.

| Đường dẫn | Vai trò |
| --- | --- |
| `music/werewolf-theme.mp3` | nhạc nền duy nhất, chạy suốt ván |
| `sfx/howl.mp3` | dưới 2s, sói hú |
| `sfx/turn.mp3` | dưới 1s, nhẹ, nghe nhiều lần mỗi ván |
| `sfx/death.mp3` | dưới 2s |
| `sfx/ballot.mp3` | dưới 1s |
| `sfx/win.mp3` | dưới 3s |
| `sfx/lose.mp3` | dưới 3s |

## Một track cho cả ván

`audio-track.ts` ánh xạ **mọi** pha từ `LOBBY` tới `CHECK_WIN` về cùng một
track `theme`, và `GAME_OVER` về `null`.

Đó không phải chuyện tiết kiệm file. `audioEngine.setTrack` bỏ qua lời gọi
trùng với track đang phát, nên cùng một tên track ở mọi pha nghĩa là **nguồn
nhạc không bị đụng tới khi chuyển pha**: bài hát chạy tiếp từ đúng chỗ nó đang
ở, không fade, không phát lại từ đầu. Ở `GAME_OVER` engine fade-out 600ms để
tiếng `win`/`lose` vang một mình.

Bộ trước có ba track đổi theo pha. Một ván có hàng chục lần đổi pha, nên nhạc
bị crossfade cắt ngang liên tục, và ba file là 3.94 MiB người chơi phải tải.

| Track | Nguồn | Vòng lặp | LUFS | True peak | Dung lượng |
| --- | --- | ---: | ---: | ---: | ---: |
| `theme` | NHẠC NỀN MA SÓI ONLINE — Nguyễn Hữu Hiếu | 48.475s | -27.00 | -12.97 dBTP | 1.13 MiB |

Mức -27 LUFS nằm giữa cửa sổ thiết kế -28..-26 LUFS (`targets.LUFS_WINDOW`):
nhạc phải chìm dưới voice chat và hiệu ứng. Mặc định trong `audio-settings.ts`
còn hạ tiếp bằng bus gain (`musicVolume` 0.4 so với `sfxVolume` 0.8). Không nén
động, không limiter. True peak bỏ rất xa trần -3 dBTP.

MP3 stereo 44.1kHz, CBR 192kbps. Toàn bộ thư mục audio 1.20 MiB (nhạc 1.13 MiB
+ hiệu ứng 0.07 MiB), dưới trần 3 MiB.

## Điểm lặp

File có 0.5 giây đệm tuần hoàn ở đầu/cuối và mốc trong `loop-points.json`.
Engine chỉ đọc `loopStart` và `loopEnd`; các khoá còn lại là số liệu đối chiếu.

`loopStart` 0.5s, `loopEnd` 48.975011s, tức vòng lặp dài 48.475s.

Vòng lặp lấy từ đoạn 189.15s của bản gốc. Độ dài 48.475s = 28.05 + 2×10.21, là
một chu kỳ lớn cộng hai chu kỳ nhỏ của chính bản nhạc (đo bằng tự tương quan
phổ), nên hai đầu vòng rơi vào cùng một chỗ trong câu nhạc. Đầu vòng còn được
trộn equal-power trong 6 giây với phần chạy tiếp sau cuối vòng, nên khi quay
về đầu, mẫu kế tiếp vẫn là mẫu tự nhiên từ nguồn. Phần đệm cũng lấy từ chính
vòng lặp, không dùng im lặng.

Đo trên file mp3 đã encode: bước nhảy ở chỗ nối -68.0 dBFS, sai số tuần hoàn
-41.3 dB, tương quan tuần hoàn 1.0000, năng lượng cao tần chỗ nối z=1.61. Không
có tiếng click.

## Dựng lại

Chép file nguồn (xem `music-sources.json`) vào một thư mục và đặt tên
`theme-source.mp3`. Script kiểm SHA-256 của nguồn trước khi ghi asset.

```text
python tools/audio/build_music.py --src <thư mục nguồn> --out apps/web/public/audio
python tools/audio/verify_music.py --audio apps/web/public/audio
python tools/audio/test_verify_negative.py --audio apps/web/public/audio
python tools/audio/make_demo.py --audio apps/web/public/audio --out reports/audio-audition
```

`build_music.py` dựng vào thư mục tạm và chỉ thay asset thật sau khi file đã
encode, đạt LUFS và true peak. `verify_music.py` giải mã lại MP3, kiểm
SHA-256/giấy phép, độ to, true peak, tính tuần hoàn, seam, năng lượng cao tần
và khả năng nghe qua loa điện thoại — và từ chối cả manifest còn mô tả track
đã bỏ lẫn file nhạc thừa nằm lại trong `music/`.

`test_verify_negative.py` chạy một đối chứng nguyên vẹn và chín ca phá thử.
Mọi sửa đổi chỉ diễn ra trên bản sao trong thư mục tạm.

## Giấy phép

> **Chưa xác minh được quyền sử dụng.** File nguồn là bản tải về từ YouTube và
> chưa có văn bản cấp quyền của tác giả (Nguyễn Hữu Hiếu). Bộ asset hiện tại
> chỉ dùng cho chạy nội bộ và thử nghiệm.
>
> Trước khi phát hành công khai: xin phép tác giả, rồi cập nhật `license`,
> `licenseUrl` và `sourceFileUrl` trong `music-sources.json`. Quy trình phát
> hành chạy `verify_music.py --require-cleared-rights`, và lệnh đó trả exit 1
> chừng nào `license` còn là `UNVERIFIED`.

Thông tin đầy đủ và các thay đổi nằm trong `CREDITS.md`; metadata máy đọc nằm
trong `music-sources.json`.
