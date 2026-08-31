"""Dựng file nghe thử mô phỏng đúng cách engine phát nhạc.

Tái hiện `audio-engine.ts`: nguồn mới bắt đầu tại loopStart, lặp giữa
loopStart/loopEnd, và crossfade 600ms bằng `linearRampToValueAtTime` - tức là
gain tuyến tính, không phải equal-power. Nhờ vậy nghe được cả chỗ nối vòng lặp
lẫn chỗ chuyển pha đúng như trong game.

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

SR = 44100
FADE = 0.6          # khớp FADE_SEC trong audio-engine.ts


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

    loops = {}
    for name in ("night", "day", "vote"):
        d = decode_mp3(os.path.join(args.audio, "music", f"{name}.mp3"))
        p = points[name]
        s0 = int(round(p["loopStart"] * SR))
        n = int(round((p["loopEnd"] - p["loopStart"]) * SR))
        loops[name] = d[s0:s0 + n]

    # Nghe thử ba vòng liên tiếp: chỗ nối rơi vào giữa file, dễ bắt lỗi.
    for name, loop in loops.items():
        write_mp3(os.path.join(args.out, f"{name}-3loops.mp3"), np.vstack([loop] * 3))

    # Chuỗi chuyển pha giống một ván thật: đêm -> ngày -> bỏ phiếu -> đêm.
    plan = [("night", 16.0), ("day", 16.0), ("vote", 16.0), ("night", 14.0)]
    total = sum(d for _, d in plan) + FADE
    out = np.zeros((int(total * SR) + SR, 2))

    t = 0.0
    for name, dur in plan:
        seg = looped(loops[name], dur + FADE)
        env = np.ones(seg.shape[0])
        f = int(FADE * SR)
        env[:f] = np.linspace(0.0, 1.0, f)
        env[-f:] = np.linspace(1.0, 0.0, f)
        start = int(t * SR)
        out[start:start + seg.shape[0]] += seg * env[:, None]
        t += dur

    write_mp3(os.path.join(args.out, "phase-transitions.mp3"), out)
    print(f"đã ghi {len(loops) + 1} file nghe thử vào {args.out}")
    print("  *-3loops.mp3        - ba vòng liên tiếp, kiểm chỗ nối")
    print("  phase-transitions.mp3 - đêm->ngày->bỏ phiếu->đêm, crossfade 600ms")


if __name__ == "__main__":
    main()
