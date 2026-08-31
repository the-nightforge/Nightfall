"""Dựng ba track nhạc nền từ file OGG gốc của Ragnar Random.

Nguồn duy nhất: https://ragnarrandom.itch.io/orchestral-and-world-music-for-games
(CC0 1.0, trang chính thức ghi rõ "No generative AI was used"). Script này
KHÔNG sinh ra nốt nhạc nào — nó chỉ cắt vòng lặp, chỉnh EQ nhẹ, chuẩn hoá độ
to và encode. Mọi nội dung âm nhạc là của tác giả gốc.

Bốn bước cho mỗi track:

1. Chọn vùng lặp. `t0`/`loop` lấy từ phép dò tự tương quan (xem README), rơi
   đúng vào bội số nguyên của ô nhịp nên không cắt giữa câu nhạc.
2. Căn pha đến từng mẫu. Độ dài vòng lặp được tinh chỉnh trong ±150ms quanh
   giá trị danh nghĩa để tương quan chéo giữa đoạn đầu vòng và đoạn nối tiếp
   sau cuối vòng đạt cực đại. Không có bước này thì crossfade hai đoạn lệch
   pha sẽ triệt tiêu dải thấp thay vì hoà vào nhau.
3. Crossfade equal-power. Đầu vòng lặp được trộn với phần nhạc chạy tiếp SAU
   cuối vòng, nên khi vòng lặp quay lại, thứ tai nghe được ở chỗ nối chính là
   đoạn nối tiếp tự nhiên của bản nhạc. Bộ đệm thu được tuần hoàn theo đúng
   nghĩa toán học: lặp nó chính là lặp lại cùng một mảng.
4. EQ nhẹ + chuẩn hoá + đệm + encode. Toàn bộ EQ chạy bằng FFT vòng
   (`fft_shape`) nên không phá tính tuần hoàn ở bước 3.

Chạy:
  python tools/audio/build_music.py --src <thư mục ogg> --out apps/web/public/audio
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except Exception:
        pass

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dsp import SR, chain, fft_shape, hp_curve, peak_curve, shelf_curve
from studio import PAD_SEC, loudness, normalise, true_peak_db, with_padding, write_mp3
from targets import BITRATE_KBPS, TARGET_LUFS, TRUE_PEAK_CEILING

# --------------------------------------------------------------------------
# Nguồn và tham số từng track
# --------------------------------------------------------------------------
#
# `hp` — cắt hạ âm. Không phải gu thẩm mỹ mà là dọn rác: "tower of the
# vampire" có 61% tổng năng lượng nằm DƯỚI 45Hz, dải mà không loa điện thoại,
# laptop hay tai nghe phổ thông nào tái tạo được. Để nguyên thì lúc chuẩn hoá
# về -26.5 LUFS, phần rác đó kéo tụt phần thực sự nghe được xuống theo.
#
# `shelf_db` — kệ thấp quanh 200Hz, chỉ dùng cho `vote`. Xem README.
#
# `dip_db` — hạ nhẹ dải 2-5kHz nếu track có chỗ chói. 0.0 nghĩa là không đụng.

SOURCES = {
    "night": dict(
        file="05 - tower of the vampire.ogg",
        title="05 - tower of the vampire",
        t0=55.10, loop=67.20, xfade=3.0,
        hp=70.0, shelf_db=0.0, dip_db=0.0,
    ),
    "day": dict(
        file="02 - the town where i got the magic bottle.ogg",
        title="02 - the town where i got the magic bottle",
        t0=24.70, loop=52.35, xfade=2.5,
        hp=40.0, shelf_db=0.0, dip_db=0.0,
    ),
    "vote": dict(
        file="01 - it is dangerous to be lonely without a sword.ogg",
        title="01 - it is dangerous to be lonely without a sword",
        t0=19.15, loop=57.60, xfade=2.5,
        hp=40.0, shelf_db=0.0, dip_db=0.0,
    ),
}

HP_ORDER = 2.5
SHELF_HZ = 200.0
DIP_HZ, DIP_Q = 3200.0, 0.7


def decode_ogg(path: str) -> np.ndarray:
    import miniaudio
    dec = miniaudio.decode_file(path, output_format=miniaudio.SampleFormat.FLOAT32,
                                nchannels=2, sample_rate=SR)
    return np.array(dec.samples, dtype=np.float64).reshape(-1, 2)


def refine_loop(x: np.ndarray, s0: int, n_nom: int, n_x: int,
                span: float = 0.15) -> tuple[int, float]:
    """Tinh chỉnh độ dài vòng lặp để hai đoạn được crossfade khớp pha.

    Trả về (số mẫu một vòng, hệ số tương quan đạt được). Cửa sổ so khớp chính
    là vùng crossfade, vì đó mới là chỗ hai đoạn thực sự chồng lên nhau.
    """
    m = x.mean(axis=1)
    a = m[s0:s0 + n_x]
    a = a - a.mean()
    denom_a = np.sqrt(np.sum(a ** 2)) + 1e-12

    best_n, best_c = n_nom, -2.0
    for n in range(n_nom - int(span * SR), n_nom + int(span * SR) + 1):
        b = m[s0 + n:s0 + n + n_x]
        if b.shape[0] < n_x:
            continue
        b = b - b.mean()
        c = float(np.dot(a, b) / (denom_a * (np.sqrt(np.sum(b ** 2)) + 1e-12)))
        if c > best_c:
            best_n, best_c = n, c
    return best_n, best_c


def build_loop(x: np.ndarray, s0: int, n_loop: int, n_x: int) -> np.ndarray:
    """Cắt một vòng lặp tuần hoàn tuyệt đối bằng crossfade equal-power.

    Đoạn đầu vòng được trộn với đoạn nhạc chạy tiếp sau cuối vòng:

        B[i] = x[s0+n_loop+i]*cos(u) + x[s0+i]*sin(u),  u = (pi/2)*i/n_x

    Tại i=0 trọng số dồn hết cho đoạn nối tiếp, nên B[n_loop-1] -> B[0] chính
    là hai mẫu liền kề của bản gốc: chỗ nối không có bước nhảy. cos^2+sin^2=1
    nên năng lượng giữ nguyên suốt vùng trộn, không bị hõm ở giữa như
    crossfade tuyến tính.
    """
    loop = x[s0:s0 + n_loop].copy()
    tail = x[s0 + n_loop:s0 + n_loop + n_x]
    if tail.shape[0] < n_x:
        raise SystemExit("không đủ nhạc sau cuối vòng lặp để crossfade")
    u = (np.pi / 2.0) * np.arange(n_x) / n_x
    loop[:n_x] = tail * np.cos(u)[:, None] + loop[:n_x] * np.sin(u)[:, None]
    return loop


def encode_calibrated(path: str, loop: np.ndarray, target: float, bitrate: int,
                      tol: float = 0.05, iters: int = 8) -> tuple[float, float, int]:
    """Encode rồi đo lại trên chính file mp3, hiệu chỉnh gain cho tới khi khớp.

    Cần thiết vì mã hoá mp3 KHÔNG bảo toàn độ to: ở 160kbps bộ lượng tử hoá
    làm hụt khoảng 0.45 dB năng lượng băng rộng trên bộ nhạc này (đo bằng cả
    RMS lẫn LUFS). Chuẩn hoá trước khi encode rồi tin vào con số đó là sai
    0.45 LU - đúng bằng loại sai lệch mà `verify_music.py` bắt được.

    Trả về (LUFS đo trên mp3, true peak đo trên mp3, số vòng lặp đã dùng).
    """
    from studio import decode_mp3

    gain = 10.0 ** ((target - loudness(loop)) / 20.0)
    s0, n = int(round(PAD_SEC * SR)), loop.shape[0]
    got = tp = float("nan")

    for i in range(1, iters + 1):
        write_mp3(path, with_padding(loop * gain), bitrate=bitrate)
        decoded = decode_mp3(path)[s0:s0 + n]
        got, tp = loudness(decoded), true_peak_db(decoded)
        if abs(got - target) <= tol:
            return got, tp, i
        gain *= 10.0 ** ((target - got) / 20.0)
    return got, tp, iters


def eq_curve(hp: float, shelf_db: float, dip_db: float):
    curves = [hp_curve(hp, HP_ORDER)]
    if shelf_db:
        curves.append(shelf_curve(SHELF_HZ, shelf_db, kind="low"))
    if dip_db:
        curves.append(peak_curve(DIP_HZ, dip_db, DIP_Q))
    return chain(*curves)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="thư mục chứa file .ogg gốc")
    ap.add_argument("--out", required=True, help="thư mục audio của web app")
    args = ap.parse_args()

    music_dir = os.path.join(args.out, "music")
    os.makedirs(music_dir, exist_ok=True)
    points: dict[str, dict[str, float]] = {}

    hdr = (f"{'track':6s} {'loop s':>10s} {'khớp pha':>9s} {'LUFS':>7s} {'TP dB':>7s} "
           f"{'kB':>8s} {'vòng':>5s} {'nguồn':s}")
    print(hdr)
    print("-" * 104)
    print("(LUFS và TP đo trên chính file mp3 đã encode, không phải trên bộ đệm)")

    for name, cfg in SOURCES.items():
        path = os.path.join(args.src, cfg["file"])
        if not os.path.exists(path):
            raise SystemExit(f"thiếu file nguồn: {path}")

        x = decode_ogg(path)
        s0 = int(round(cfg["t0"] * SR))
        n_x = int(round(cfg["xfade"] * SR))
        n_loop, corr = refine_loop(x, s0, int(round(cfg["loop"] * SR)), n_x)

        loop = build_loop(x, s0, n_loop, n_x)
        loop = fft_shape(loop, eq_curve(cfg["hp"], cfg["shelf_db"], cfg["dip_db"]))
        loop = normalise(loop, TARGET_LUFS[name], TRUE_PEAK_CEILING)

        out_path = os.path.join(music_dir, f"{name}.mp3")
        lufs, tp, rounds = encode_calibrated(out_path, loop, TARGET_LUFS[name],
                                             BITRATE_KBPS)
        if tp > TRUE_PEAK_CEILING:
            raise SystemExit(f"{name}: true peak {tp:.2f} dBTP vượt trần "
                             f"{TRUE_PEAK_CEILING} dBTP")

        loop_sec = n_loop / SR
        kb = os.path.getsize(out_path) / 1024.0
        points[name] = dict(
            loopStart=PAD_SEC,
            loopEnd=round(PAD_SEC + loop_sec, 6),
            loopLen=round(loop_sec, 6),
            fileLen=round(loop_sec + 2 * PAD_SEC, 6),
            loopSamples=int(n_loop),
            kb=round(kb, 1),
            source=cfg["title"],
        )
        print(f"{name:6s} {loop_sec:10.6f} {corr:9.4f} {lufs:7.2f} "
              f"{tp:7.2f} {kb:8.1f} {rounds:5d} {cfg['title']}")

    with open(os.path.join(args.out, "loop-points.json"), "w", encoding="utf-8") as fh:
        json.dump(points, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    total = sum(p["kb"] for p in points.values())
    print(f"\nnhạc: {total:.1f} kB ({total / 1024.0:.2f} MiB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
