"""Dựng file nghe thử mô phỏng đúng cách engine phát nhạc.

Tái hiện `audio-engine.ts`: nguồn mới bắt đầu tại loopStart, lặp giữa
loopStart/loopEnd, và fade 600ms bằng `linearRampToValueAtTime` - tức là gain
tuyến tính, không phải equal-power.

Từ 2026-08-31 chỉ còn một track chạy suốt ván, nên bản nghe thử "chuyển pha"
không còn là ba bài nối nhau nữa. Nó dựng đúng thứ thiết kế mới hứa: nhạc chạy
LIÊN TỤC qua các lần đổi pha (không có chỗ nối, không có lần khởi động lại),
rồi fade-out một lần duy nhất ở GAME_OVER.

Chạy:  python tools/audio/make_demo.py --audio apps/web/public/audio --out <thư mục>
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

from studio import decode_mp3, write_mp3
from targets import ASSET_FILE, TRACK

SR = 44100
FADE = 0.6          # khớp FADE_SEC trong audio-engine.ts

# Một chuỗi pha như trong ván thật. Ranh giới pha chỉ để đánh dấu trong bản in;
# nhạc không được đổi gì ở những mốc này - đó chính là điều cần nghe.
PHASES = [("LOBBY", 10.0), ("NIGHT", 14.0), ("DAY_DISCUSSION", 14.0),
          ("VOTING", 14.0), ("ELIMINATION", 8.0), ("CHECK_WIN", 6.0)]


def looped(loop: np.ndarray, seconds: float) -> np.ndarray:
    reps = int(np.ceil(seconds * SR / loop.shape[0])) + 1
    return np.vstack([loop] * reps)[:int(seconds * SR)]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    with open(os.path.join(args.audio, "loop-points.json"), encoding="utf-8") as fh:
        points = json.load(fh)

    d = decode_mp3(os.path.join(args.audio, "music", ASSET_FILE))
    p = points[TRACK]
    s0 = int(round(p["loopStart"] * SR))
    n = int(round((p["loopEnd"] - p["loopStart"]) * SR))
    loop = d[s0:s0 + n]

    # Ba vòng liên tiếp: chỗ nối rơi vào giữa file, dễ bắt lỗi.
    write_mp3(os.path.join(args.out, f"{TRACK}-3loops.mp3"), np.vstack([loop] * 3))

    # Một ván: fade-in ở lần đầu có nhạc, chạy thẳng qua mọi lần đổi pha, fade
    # out ở GAME_OVER.
    total = sum(sec for _, sec in PHASES)
    body = looped(loop, total)
    env = np.ones(body.shape[0])
    f = int(FADE * SR)
    env[:f] = np.linspace(0.0, 1.0, f)
    env[-f:] = np.linspace(1.0, 0.0, f)
    write_mp3(os.path.join(args.out, "match-one-track.mp3"), body * env[:, None])

    print(f"đã ghi 2 file nghe thử vào {args.out}")
    print(f"  {TRACK}-3loops.mp3      - ba vòng liên tiếp, kiểm chỗ nối")
    print("  match-one-track.mp3  - một ván đủ pha, nhạc không đứt ở chỗ đổi pha:")
    at = 0.0
    for name, sec in PHASES:
        print(f"      {at:6.1f}s  {name}")
        at += sec
    print(f"      {at:6.1f}s  GAME_OVER (fade-out {FADE}s)")


if __name__ == "__main__":
    main()
