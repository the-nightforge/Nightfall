"""Dựng bộ âm thanh "kinh dị làng quê" từ ba bản thu Việt Nam.

Nguồn là các bản thu người thật/hiện trường được đăng trên Freesound theo
CC BY 4.0 hoặc CC0. Script KHÔNG sinh nốt nhạc hay thêm nhạc cụ: nó chỉ cắt
vòng lặp, crossfade, chỉnh EQ nhẹ, chuẩn hoá độ to và encode.

Bốn bước cho mỗi track:

1. Chọn vùng ổn định, không có tiếng nói. Bản thu môi trường không có ô nhịp,
   nên mốc lặp là số mẫu cố định đã nghe/đo trước chứ không ép theo nhịp.
2. Crossfade equal-power dài 6 giây. Đầu vòng được trộn với phần chạy tiếp SAU
   cuối vòng, nên khi vòng lặp quay lại, thứ tai nghe được ở chỗ nối chính là
   đoạn nối tiếp tự nhiên của bản nhạc. Bộ đệm thu được tuần hoàn theo đúng
   nghĩa toán học: lặp nó chính là lặp lại cùng một mảng.
3. EQ nhẹ + chuẩn hoá + đệm + encode. Toàn bộ EQ chạy bằng FFT vòng
   (`fft_shape`) nên không phá tính tuần hoàn ở bước 2.

Chạy:
  python tools/audio/build_music.py --src <thư mục mp3 nguồn> --out apps/web/public/audio
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile

import numpy as np

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except Exception:
        pass

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dsp import SR, chain, fft_shape, hp_curve, lp_curve, peak_curve, shelf_curve
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
        file="night-source.mp3", title="BR_041_VN_FluteInNight.mp3",
        creator="Kevin Luce (kevp888)",
        source_page="https://freesound.org/people/kevp888/sounds/578505/",
        source_url="https://cdn.freesound.org/previews/578/578505_9034501-hq.mp3",
        license="CC-BY-4.0",
        license_url="https://creativecommons.org/licenses/by/4.0/",
        source_sha256="ed1875c246bc113b9ed775dfb7cccf2fd4c6deee6e4314b6a914e51b6fc218c4",
        t0=0.0, loop=37.0, xfade=6.0,
        hp=50.0, lp=10000.0, shelf_hz=3000.0, shelf_db=-3.0,
        dip_hz=1900.0, dip_db=-2.0,
    ),
    "day": dict(
        file="day-source.mp3", title="BR_017_VN_QuietFields.mp3",
        creator="Kevin Luce (kevp888)",
        source_page="https://freesound.org/people/kevp888/sounds/578503/",
        source_url="https://cdn.freesound.org/previews/578/578503_9034501-hq.mp3",
        license="CC-BY-4.0",
        license_url="https://creativecommons.org/licenses/by/4.0/",
        source_sha256="4190c0937a09cc3ca3d6d34dca414cf64b9b1622ba2c9ec139e0abbe45a50c0c",
        t0=0.0, loop=38.0, xfade=6.0,
        hp=55.0, lp=9000.0, shelf_hz=2800.0, shelf_db=-4.0,
        dip_hz=4200.0, dip_db=-2.0,
    ),
    "vote": dict(
        file="vote-source.mp3", title="ZOOM0005.WAV",
        creator="molinsky",
        source_page="https://freesound.org/people/molinsky/sounds/497058/",
        source_url="https://cdn.freesound.org/previews/497/497058_729547-hq.mp3",
        license="CC0-1.0",
        license_url="https://creativecommons.org/publicdomain/zero/1.0/",
        source_sha256="91180cae6e643ea22b7324a9c7a5c9f69f300cae096b0cce7e658c9c747940de",
        t0=1.0, loop=51.0, xfade=6.0,
        hp=45.0, lp=11000.0, shelf_hz=5000.0, shelf_db=-1.5,
        dip_hz=3200.0, dip_db=-1.0,
    ),
}

HP_ORDER = 2.5
DIP_Q = 0.8


def decode_source(path: str) -> np.ndarray:
    import miniaudio
    dec = miniaudio.decode_file(path, output_format=miniaudio.SampleFormat.FLOAT32,
                                nchannels=2, sample_rate=SR)
    return np.array(dec.samples, dtype=np.float64).reshape(-1, 2)


def sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


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
    raise RuntimeError(f"không hội tụ LUFS sau {iters} vòng: đo được {got:.2f}, "
                       f"mục tiêu {target:.2f}")


def eq_curve(cfg: dict):
    curves = [hp_curve(cfg["hp"], HP_ORDER), lp_curve(cfg["lp"], 2.0)]
    if cfg["shelf_db"]:
        curves.append(shelf_curve(cfg["shelf_hz"], cfg["shelf_db"], kind="high"))
    if cfg["dip_db"]:
        curves.append(peak_curve(cfg["dip_hz"], cfg["dip_db"], DIP_Q))
    return chain(*curves)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="thư mục chứa ba file MP3 nguồn")
    ap.add_argument("--out", required=True, help="thư mục audio của web app")
    args = ap.parse_args()

    music_dir = os.path.join(args.out, "music")

    # Kiểm tra đủ nguồn và đúng mã băm trước khi ghi bất kỳ asset nào.
    source_paths = {}
    for name, cfg in SOURCES.items():
        path = os.path.join(args.src, cfg["file"])
        if not os.path.exists(path):
            raise SystemExit(f"thiếu file nguồn: {path}")
        got_hash = sha256(path)
        if got_hash != cfg["source_sha256"]:
            raise SystemExit(f"{name}: SHA-256 file nguồn không khớp\n"
                             f"  nhận: {got_hash}\n  cần:  {cfg['source_sha256']}")
        source_paths[name] = path

    os.makedirs(music_dir, exist_ok=True)
    points: dict[str, dict[str, float]] = {}
    manifest = {"schemaVersion": 1, "tracks": {}}

    hdr = (f"{'track':6s} {'loop s':>10s} {'xfade s':>9s} {'LUFS':>7s} {'TP dB':>7s} "
           f"{'kB':>8s} {'vòng':>5s} {'nguồn':s}")
    print(hdr)
    print("-" * 104)
    print("(LUFS và TP đo trên chính file mp3 đã encode, không phải trên bộ đệm)")

    with tempfile.TemporaryDirectory(prefix="masoi-music-build-", dir=args.out) as stage:
        for name, cfg in SOURCES.items():
            x = decode_source(source_paths[name])
            s0 = int(round(cfg["t0"] * SR))
            n_x = int(round(cfg["xfade"] * SR))
            n_loop = int(round(cfg["loop"] * SR))
            if s0 + n_loop + n_x > x.shape[0]:
                raise SystemExit(f"{name}: nguồn quá ngắn cho loop + crossfade")

            loop = build_loop(x, s0, n_loop, n_x)
            loop = fft_shape(loop, eq_curve(cfg))
            loop = normalise(loop, TARGET_LUFS[name], TRUE_PEAK_CEILING)

            out_path = os.path.join(stage, f"{name}.mp3")
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
            manifest["tracks"][name] = {
                "title": cfg["title"], "creator": cfg["creator"],
                "sourcePage": cfg["source_page"],
                "sourceFileUrl": cfg["source_url"],
                "license": cfg["license"], "licenseUrl": cfg["license_url"],
                "sourceSha256": cfg["source_sha256"],
                "assetSha256": sha256(out_path),
            }
            print(f"{name:6s} {loop_sec:10.6f} {cfg['xfade']:9.1f} {lufs:7.2f} "
                  f"{tp:7.2f} {kb:8.1f} {rounds:5d} {cfg['title']}")

        points_path = os.path.join(stage, "loop-points.json")
        manifest_path = os.path.join(stage, "music-sources.json")
        with open(points_path, "w", encoding="utf-8") as fh:
            json.dump(points, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        with open(manifest_path, "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, indent=2, ensure_ascii=False)
            fh.write("\n")

        # Chỉ thay asset thật sau khi cả ba bản dựng và toàn bộ metadata xong.
        for name in SOURCES:
            os.replace(os.path.join(stage, f"{name}.mp3"),
                       os.path.join(music_dir, f"{name}.mp3"))
        os.replace(points_path, os.path.join(args.out, "loop-points.json"))
        os.replace(manifest_path, os.path.join(args.out, "music-sources.json"))

    total = sum(p["kb"] for p in points.values())
    print(f"\nnhạc: {total:.1f} kB ({total / 1024.0:.2f} MiB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
