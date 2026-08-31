"""Kiểm chứng ba track nhạc nền trên chính file mp3 đã encode.

Không kiểm trên bộ đệm trong bộ nhớ mà giải mã lại mp3, vì thứ trình duyệt
nghe là file, không phải mảng float trong lúc dựng.

Ba phép đo:

1. Tính tuần hoàn - phép đo quan trọng nhất. Nếu d[i] == d[i+N] với mọi i thì
   *mọi* cửa sổ dài N mẫu đều lặp liền mạch, kể cả khi bộ giải mã mp3 làm trễ
   toàn bộ file. So một cửa sổ trong vùng đệm đầu với chính nó cách đúng N mẫu;
   sai số còn lại chỉ là nhiễu lượng tử của mp3.
2. Bước nhảy biên độ ở chỗ nối, tính bằng dBFS tuyệt đối và bằng phân vị trong
   chính phân bố sai phân của track.
3. Năng lượng dải cao quanh chỗ nối - tiếng click là broadband nên đây là phép
   đo bắt được click mà biên độ đơn thuần có thể bỏ sót.

Chạy:  python tools/audio/verify_music.py --audio apps/web/public/audio
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

from studio import true_peak_db, loudness

SR = 44100


def decode(path: str) -> np.ndarray:
    import miniaudio
    dec = miniaudio.decode_file(path, output_format=miniaudio.SampleFormat.FLOAT32,
                                nchannels=2, sample_rate=SR)
    return np.array(dec.samples, dtype=np.float64).reshape(-1, 2)


def db(x: float) -> float:
    return 20.0 * np.log10(max(x, 1e-12))


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x ** 2)))


def periodicity(d: np.ndarray, n_loop: int) -> tuple[float, float, float]:
    """So cửa sổ ở vùng đệm đầu với chính nó cách đúng một vòng lặp."""
    a = int(0.10 * SR)
    m = int(0.35 * SR)
    if a + n_loop + m > d.shape[0]:
        return float("nan"), float("nan"), float("nan")
    w1, w2 = d[a:a + m], d[a + n_loop:a + n_loop + m]
    err_db = db(rms(w1 - w2)) - db(rms(w1))
    corr = float(np.corrcoef(w1.ravel(), w2.ravel())[0, 1])
    # Đối chứng: hai cửa sổ không liên quan trong cùng track.
    b = int(0.10 * SR) + n_loop // 3
    ctrl = d[b:b + m]
    ctrl_db = db(rms(w1 - ctrl)) - db(rms(w1))
    return err_db, corr, ctrl_db


def seam_metrics(loop: np.ndarray) -> tuple[float, float, float]:
    """Nối hai vòng lặp rồi đo chỗ ghép, đúng như Web Audio sẽ làm.

    Cố ý *không* dùng z-score của bước nhảy: với nhạc thiên về tần số thấp,
    sai phân trung bình rất nhỏ nên bước nhảy nào cũng thành "nhiều sigma" dù
    tuyệt đối vẫn dưới ngưỡng nghe. Ba số dưới đây mới quyết định được:

    - jump_db: biên độ bước nhảy tính bằng dBFS. So với đỉnh khoảng -12 dBFS.
    - pct: bước nhảy nằm ở phân vị bao nhiêu của chính phân bố sai phân. Dưới
      100% nghĩa là trong track có sẵn những bước chuyển còn lớn hơn.
    - hf_z: năng lượng dải trên 6kHz quanh chỗ nối so với mọi nơi khác. Tiếng
      click là broadband, nên click thật sẽ đội số này lên rõ rệt.
    """
    two = np.vstack([loop, loop])
    n = loop.shape[0]
    x = two[:, 0]
    diff = np.abs(np.diff(x))
    jump = abs(x[n] - x[n - 1])
    pct = 100.0 * float(np.mean(diff < jump))

    def hf_energy(seg: np.ndarray) -> float:
        spec = np.fft.rfft(seg)
        spec[np.fft.rfftfreq(len(seg), 1.0 / SR) < 6000.0] = 0.0
        return rms(np.fft.irfft(spec, n=len(seg)))

    w = int(0.005 * SR)
    at = hf_energy(x[n - w:n + w])
    others = np.array([hf_energy(x[i - w:i + w])
                       for i in np.linspace(2 * w, n - 2 * w, 300).astype(int)])
    hf_z = float((at - others.mean()) / (others.std() + 1e-12))
    return db(jump), pct, hf_z


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", required=True)
    ap.add_argument("--plots", default=None, help="thư mục lưu ảnh sóng chỗ nối")
    ap.add_argument("--auditions", default=None, help="thư mục lưu file nghe thử 3 vòng")
    args = ap.parse_args()

    with open(os.path.join(args.audio, "loop-points.json"), encoding="utf-8") as fh:
        points = json.load(fh)

    if args.plots:
        os.makedirs(args.plots, exist_ok=True)
    if args.auditions:
        os.makedirs(args.auditions, exist_ok=True)

    rows = []
    total_kb = 0.0
    for name in ("night", "day", "vote"):
        path = os.path.join(args.audio, "music", f"{name}.mp3")
        p = points[name]
        d = decode(path)
        n_loop = int(round((p["loopEnd"] - p["loopStart"]) * SR))
        s0 = int(round(p["loopStart"] * SR))
        loop = d[s0:s0 + n_loop]

        err_db, corr, ctrl_db = periodicity(d, n_loop)
        jump_db, pct, hf_z = seam_metrics(loop)
        kb = os.path.getsize(path) / 1024.0
        total_kb += kb
        file_sec = d.shape[0] / SR
        rows.append(dict(name=name, loop_sec=n_loop / SR, file_sec=file_sec,
                         lufs=loudness(loop), tp=true_peak_db(loop), kb=kb,
                         kbps=kb * 8 / file_sec, err_db=err_db, corr=corr,
                         ctrl_db=ctrl_db, jump_db=jump_db, pct=pct, hf_z=hf_z))

        if args.auditions:
            from studio import write_mp3
            write_mp3(os.path.join(args.auditions, f"{name}-3loops.mp3"),
                      np.vstack([loop, loop, loop]))

        if args.plots:
            plot_seam(args.plots, name, loop)

    hdr = (f"{'track':6s} {'loop s':>10s} {'file s':>8s} {'LUFS':>7s} {'TP dB':>7s} "
           f"{'kB':>8s} {'kbps':>6s} {'periodic':>10s} {'corr':>7s} {'ctrl':>8s} "
           f"{'seam dBFS':>10s} {'pctile':>8s} {'hf_z':>6s}")
    print(hdr)
    print("-" * len(hdr))
    for r in rows:
        print(f"{r['name']:6s} {r['loop_sec']:10.6f} {r['file_sec']:8.3f} {r['lufs']:7.2f} "
              f"{r['tp']:7.2f} {r['kb']:8.1f} {r['kbps']:6.1f} {r['err_db']:9.1f}dB "
              f"{r['corr']:7.4f} {r['ctrl_db']:7.1f}dB {r['jump_db']:10.1f} {r['pct']:7.3f}% "
              f"{r['hf_z']:6.2f}")

    lufs = [r["lufs"] for r in rows]
    print(f"\nnhạc: {total_kb:.1f} kB   chênh lệch độ to lớn nhất: "
          f"{max(lufs) - min(lufs):.2f} LU   true peak cao nhất: {max(r['tp'] for r in rows):.2f} dBFS")

    sfx = os.path.join(args.audio, "sfx")
    sfx_kb = sum(os.path.getsize(os.path.join(sfx, f)) for f in os.listdir(sfx)) / 1024.0
    print(f"tổng thư mục audio: {(total_kb + sfx_kb) / 1024.0:.2f} MB (nhạc "
          f"{total_kb / 1024.0:.2f} MB + hiệu ứng {sfx_kb / 1024.0:.2f} MB)")


def plot_seam(outdir: str, name: str, loop: np.ndarray) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    two = np.vstack([loop, loop])
    n = loop.shape[0]
    fig, axes = plt.subplots(3, 1, figsize=(11, 7))
    for ax, ms, title in ((axes[0], 1000, "±1000 ms quanh chỗ nối"),
                          (axes[1], 50, "±50 ms"),
                          (axes[2], 2, "±2 ms (mức mẫu)")):
        w = int(ms * SR / 1000)
        seg = two[n - w:n + w, 0]
        t = (np.arange(-w, w) / SR) * 1000.0
        ax.plot(t, seg, lw=0.6 if ms > 10 else 1.4, color="#3b6ea5")
        ax.axvline(0, color="#c0392b", lw=1.0, ls="--")
        ax.set_title(f"{name}.mp3 — {title}", fontsize=9)
        ax.set_xlabel("ms")
        ax.grid(alpha=0.25)
    fig.suptitle(f"Chỗ nối vòng lặp {name}.mp3 (đường đỏ = loopEnd nối về loopStart)")
    fig.tight_layout()
    fig.savefig(os.path.join(outdir, f"seam-{name}.png"), dpi=110)
    plt.close(fig)


if __name__ == "__main__":
    main()
