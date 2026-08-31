"""Dựng track nhạc nền duy nhất của ván đấu từ một file nguồn.

Script KHÔNG sinh nốt nhạc và không thêm nhạc cụ: nó chọn một đoạn của bản
nhạc nguồn, cắt thành vòng lặp tuần hoàn tuyệt đối bằng crossfade equal-power,
chỉnh EQ nhẹ, chuẩn hoá độ to rồi encode.

Bốn bước:

1. Chọn vùng ổn định trong bản nhạc. Mốc lặp là số giây cố định đã đo trước
   bằng tự tương quan phổ, không ép theo ô nhịp đoán ra.
2. Crossfade equal-power dài 6 giây. Đầu vòng được trộn với phần chạy tiếp SAU
   cuối vòng, nên khi vòng lặp quay lại, thứ tai nghe được ở chỗ nối chính là
   đoạn nối tiếp tự nhiên của bản nhạc. Bộ đệm thu được tuần hoàn theo đúng
   nghĩa toán học: lặp nó chính là lặp lại cùng một mảng.
3. EQ nhẹ + chuẩn hoá + đệm + encode. Toàn bộ EQ chạy bằng FFT vòng
   (`fft_shape`) nên không phá tính tuần hoàn ở bước 2.
4. Ghi `loop-points.json` và `music-sources.json` cho đúng một track.

Chạy:
  python tools/audio/build_music.py --src <thư mục chứa nguồn> --out apps/web/public/audio
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
from studio import PAD_SEC, loudness, normalise, with_padding, write_mp3
from targets import ASSET_FILE, BITRATE_KBPS, TARGET_LUFS, TRACK, TRUE_PEAK_CEILING

# --------------------------------------------------------------------------
# Nguồn và tham số của track
# --------------------------------------------------------------------------
#
# `t0`/`loop` — vị trí và độ dài vòng lặp, tính bằng giây trong file nguồn.
# File nguồn dài 409s và là một tuyển tập: sáu đoạn ngăn nhau bằng khoảng lặng.
# Đoạn 130.9-248.1s là đoạn duy nhất vừa đủ dài vừa có chu kỳ rõ (10.21s và
# 28.05s theo tự tương quan phổ). 48.475s = 28.05 + 2x10.21, tức một chu kỳ
# lớn cộng hai chu kỳ nhỏ, nên hai đầu vòng rơi vào cùng chỗ trong câu nhạc:
# tương quan phổ giữa 6 giây đầu vòng và 6 giây sau cuối vòng đạt 0.90.
#
# `hp` — cắt hạ âm. Không phải gu thẩm mỹ mà là dọn rác: đoạn này có 53% tổng
# năng lượng nằm dưới 200Hz, dải mà loa điện thoại gần như không phát ra. Để
# nguyên thì lúc chuẩn hoá về -27 LUFS, phần không nghe được đó kéo tụt phần
# thực sự nghe được xuống theo. Cắt 80Hz đưa năng lượng trên 200Hz từ 47% lên
# 59% mà vẫn còn đủ trầm trên tai nghe.
#
# `lp` — nguồn là bản MP3 lossy, phổ đã tắt hẳn trên 16kHz. Cắt 14kHz chỉ bỏ
# phần rác của lần mã hoá trước, không đụng vào nhạc.
#
# `shelf_db` / `dip_db` — 0.0 nghĩa là không đụng. Phổ đoạn này trơn, không có
# dải chói nào trong 2-6kHz nên không cần hạ.

SOURCE = dict(
    file="theme-source.mp3",
    title="NHẠC NỀN MA SÓI ONLINE",
    creator="Nguyễn Hữu Hiếu",
    source_page="https://www.youtube.com/",
    source_url="local://downloads/theme-source.mp3",
    license="UNVERIFIED",
    license_url="https://creativecommons.org/unverified",
    rights_note=(
        "Bản tải về từ YouTube, chưa có văn bản cấp quyền của tác giả. "
        "Chỉ dùng nội bộ/thử nghiệm cho tới khi xin được phép. Chạy "
        "verify_music.py --require-cleared-rights trước khi phát hành công khai."
    ),
    source_sha256="9654dafdbd1e660e4ad574b6e77a984387773892c649b6ff813fa5e3fe18bbb2",
    t0=189.15, loop=48.475, xfade=6.0,
    hp=80.0, lp=14000.0, shelf_hz=4000.0, shelf_db=0.0,
    dip_hz=3000.0, dip_db=0.0,
)

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

    Cần thiết vì mã hoá mp3 KHÔNG bảo toàn độ to: bộ lượng tử hoá làm hụt vài
    phần mười dB năng lượng băng rộng. Chuẩn hoá trước khi encode rồi tin vào
    con số đó là sai đúng bằng loại sai lệch mà `verify_music.py` bắt được.

    Trả về (LUFS đo trên mp3, true peak đo trên mp3, số vòng lặp đã dùng).
    """
    from studio import decode_mp3, true_peak_db

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
    ap.add_argument("--src", required=True, help="thư mục chứa file MP3 nguồn")
    ap.add_argument("--out", required=True, help="thư mục audio của web app")
    args = ap.parse_args()

    cfg = SOURCE
    music_dir = os.path.join(args.out, "music")

    # Kiểm tra đúng mã băm nguồn trước khi ghi asset.
    source_path = os.path.join(args.src, cfg["file"])
    if not os.path.exists(source_path):
        raise SystemExit(f"thiếu file nguồn: {source_path}")
    got_hash = sha256(source_path)
    if got_hash != cfg["source_sha256"]:
        raise SystemExit("SHA-256 file nguồn không khớp\n"
                         f"  nhận: {got_hash}\n  cần:  {cfg['source_sha256']}")

    os.makedirs(music_dir, exist_ok=True)

    x = decode_source(source_path)
    s0 = int(round(cfg["t0"] * SR))
    n_x = int(round(cfg["xfade"] * SR))
    n_loop = int(round(cfg["loop"] * SR))
    if s0 + n_loop + n_x > x.shape[0]:
        raise SystemExit("nguồn quá ngắn cho loop + crossfade")

    loop = build_loop(x, s0, n_loop, n_x)
    loop = fft_shape(loop, eq_curve(cfg))
    loop = normalise(loop, TARGET_LUFS[TRACK], TRUE_PEAK_CEILING)

    print(f"{'track':8s} {'loop s':>10s} {'xfade s':>9s} {'LUFS':>7s} {'TP dB':>7s} "
          f"{'kB':>8s} {'vòng':>5s}")
    print("-" * 62)
    print("(LUFS và TP đo trên chính file mp3 đã encode, không phải trên bộ đệm)")

    # Dựng vào thư mục tạm và chỉ thay asset thật sau khi encode xong, để một
    # lần encode hỏng không để lại file nhạc dở dang trong repo.
    with tempfile.TemporaryDirectory(prefix="masoi-music-build-", dir=args.out) as stage:
        out_path = os.path.join(stage, ASSET_FILE)
        lufs, tp, rounds = encode_calibrated(out_path, loop, TARGET_LUFS[TRACK],
                                             BITRATE_KBPS)
        if tp > TRUE_PEAK_CEILING:
            raise SystemExit(f"true peak {tp:.2f} dBTP vượt trần {TRUE_PEAK_CEILING} dBTP")

        loop_sec = n_loop / SR
        kb = os.path.getsize(out_path) / 1024.0
        points = {
            TRACK: dict(
                asset=ASSET_FILE,
                loopStart=PAD_SEC,
                loopEnd=round(PAD_SEC + loop_sec, 6),
                loopLen=round(loop_sec, 6),
                fileLen=round(loop_sec + 2 * PAD_SEC, 6),
                loopSamples=int(n_loop),
                kb=round(kb, 1),
                source=cfg["title"],
            )
        }
        manifest = {
            "schemaVersion": 2,
            "tracks": {
                TRACK: {
                    "asset": ASSET_FILE,
                    "title": cfg["title"],
                    "creator": cfg["creator"],
                    "sourcePage": cfg["source_page"],
                    "sourceFileUrl": cfg["source_url"],
                    "license": cfg["license"],
                    "licenseUrl": cfg["license_url"],
                    "rightsNote": cfg["rights_note"],
                    "sourceSha256": cfg["source_sha256"],
                    "assetSha256": sha256(out_path),
                }
            },
        }
        print(f"{TRACK:8s} {loop_sec:10.6f} {cfg['xfade']:9.1f} {lufs:7.2f} "
              f"{tp:7.2f} {kb:8.1f} {rounds:5d}")

        points_path = os.path.join(stage, "loop-points.json")
        manifest_path = os.path.join(stage, "music-sources.json")
        with open(points_path, "w", encoding="utf-8") as fh:
            json.dump(points, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        with open(manifest_path, "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, indent=2, ensure_ascii=False)
            fh.write("\n")

        os.replace(out_path, os.path.join(music_dir, ASSET_FILE))
        os.replace(points_path, os.path.join(args.out, "loop-points.json"))
        os.replace(manifest_path, os.path.join(args.out, "music-sources.json"))

    print(f"\nnhạc: {kb:.1f} kB ({kb / 1024.0:.2f} MiB) -> music/{ASSET_FILE}")
    if cfg["license"] == "UNVERIFIED":
        print("\n*** CẢNH BÁO QUYỀN SỬ DỤNG ***")
        print(f"  {cfg['rights_note']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
