"""Kiểm chứng ba track nhạc nền trên chính file mp3 đã encode.

Không kiểm trên bộ đệm trong bộ nhớ mà giải mã lại mp3, vì thứ trình duyệt
nghe là file, không phải mảng float trong lúc dựng.

Bốn phép đo:

1. Tính tuần hoàn - phép đo quan trọng nhất. Nếu d[i] == d[i+N] với mọi i thì
   *mọi* cửa sổ dài N mẫu đều lặp liền mạch, kể cả khi bộ giải mã mp3 làm trễ
   toàn bộ file. So một cửa sổ trong vùng đệm đầu với chính nó cách đúng N mẫu;
   sai số còn lại chỉ là nhiễu lượng tử của mp3.
2. Bước nhảy biên độ ở chỗ nối, tính bằng dBFS tuyệt đối và bằng phân vị trong
   chính phân bố sai phân của track.
3. Năng lượng dải cao quanh chỗ nối - tiếng click là broadband nên đây là phép
   đo bắt được click mà biên độ đơn thuần có thể bỏ sót.
4. Mô phỏng loa điện thoại - xem `phone_metrics`. Nhạc nền game phần lớn được
   nghe qua loa điện thoại, thứ gần như không tái tạo được gì dưới ~200Hz, nên
   một track dồn năng lượng xuống dải thấp sẽ *biến mất* đúng ở nơi nó được
   nghe nhiều nhất - trong khi mọi phép đo ở trên vẫn đẹp.

Mặc định chạy ở chế độ NGHIÊM NGẶT: mỗi ngưỡng ở `THRESHOLDS` là một điều kiện
phải đạt, và script trả exit code 1 kèm danh sách điều kiện hỏng nếu có bất kỳ
điều kiện nào không đạt. `--no-strict` chỉ in báo cáo (dùng khi đang dò tìm).

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

from dsp import bp_curve, fft_shape
from make_music import TARGET_LUFS
from studio import true_peak_db, loudness

SR = 44100
TRACKS = ("night", "day", "vote")

# Mô phỏng loa điện thoại ---------------------------------------------------
#
# Một dải thông 180Hz-8kHz, bậc 3. Đây là mô hình THÔ của một loa điện thoại,
# và nó cố ý thô: nó không mô phỏng méo, không mô phỏng cộng hưởng thùng, chỉ
# trả lời đúng một câu hỏi - "bỏ đi phần mà cái loa đó không phát ra được thì
# còn lại bao nhiêu?". Bậc 3 là độ dốc khiến số đo khớp với phép đo tay đã dùng
# để chẩn đoán bản mix trước; đổi bậc là đổi thang đo, nên đừng đổi nếu không
# muốn mọi ngưỡng dưới đây mang nghĩa khác.
PHONE_LOW, PHONE_HIGH, PHONE_ORDER = 180.0, 8000.0, 3.0
BODY_SPLIT_HZ = 200.0

THRESHOLDS = dict(
    lufs_tolerance=0.2,        # LU, lệch mục tiêu của từng track
    lufs_spread=1.5,           # LU, chênh lệch lớn nhất giữa ba track
    true_peak_db=-2.0,         # dBFS
    total_mib=6.0,             # MiB, cả thư mục audio
    periodicity_corr=0.995,    # tối thiểu
    periodicity_err_db=-20.0,  # tối đa
    seam_jump_db=-35.0,        # dBFS, tối đa
    hf_z=3.0,                  # tối đa
    phone_loss_lu=2.2,         # LU, tối đa cho track vote
    phone_body_pct=50.0,       # %, tối thiểu cho track vote
    phone_gap_vs_day=0.5,      # LU, vote không được nhỏ hơn day quá mức này
)


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


def phone_metrics(loop: np.ndarray, lufs: float) -> tuple[float, float, float]:
    """Track còn lại bao nhiêu sau khi bỏ phần loa điện thoại không phát được.

    Trả về (LUFS sau lọc, số LU đã mất, % năng lượng trên 200Hz). Hai số đầu
    trả lời "nghe có còn to không", số thứ ba trả lời "cái còn lại có phải là
    nhạc không hay chỉ là phần đuôi" - một track có thể mất ít LU chỉ vì nó
    vốn đã nhỏ, nên một mình số đầu không đủ.
    """
    filtered = fft_shape(loop, bp_curve(PHONE_LOW, PHONE_HIGH, PHONE_ORDER))
    lufs_phone = loudness(filtered)

    mono = loop.mean(axis=1)
    power = np.abs(np.fft.rfft(mono)) ** 2
    freqs = np.fft.rfftfreq(mono.shape[0], 1.0 / SR)
    body_pct = 100.0 * float(power[freqs >= BODY_SPLIT_HZ].sum() / power.sum())
    return lufs_phone, lufs - lufs_phone, body_pct


# --------------------------------------------------------------------------
# Chế độ nghiêm ngặt
# --------------------------------------------------------------------------

class Checks:
    """Gom điều kiện đạt/hỏng để báo cáo nói rõ *cái nào* hỏng, không chỉ hỏng.

    Mỗi điều kiện mang theo giá trị đo được và ngưỡng của chính nó. Một dòng
    "FAIL" không kèm hai con số đó buộc người đọc phải mở lại script để biết
    mình trượt bao xa, và đó đúng là lúc người ta bỏ qua nó.
    """

    def __init__(self) -> None:
        self.rows: list[tuple[bool, str, str]] = []

    def add(self, ok: bool, label: str, detail: str) -> None:
        self.rows.append((bool(ok), label, detail))

    def le(self, value: float, limit: float, label: str, unit: str = "") -> None:
        self.add(value <= limit, label, f"{value:.3f}{unit} (trần {limit:g}{unit})")

    def ge(self, value: float, limit: float, label: str, unit: str = "") -> None:
        self.add(value >= limit, label, f"{value:.3f}{unit} (sàn {limit:g}{unit})")

    @property
    def failed(self) -> list[tuple[bool, str, str]]:
        return [r for r in self.rows if not r[0]]

    def report(self) -> bool:
        print()
        print("kiểm tra nghiêm ngặt")
        print("-" * 78)
        for ok, label, detail in self.rows:
            print(f"  {'PASS' if ok else 'FAIL'}  {label:<44s} {detail}")
        if self.failed:
            print(f"\n{len(self.failed)}/{len(self.rows)} điều kiện KHÔNG đạt:")
            for _, label, detail in self.failed:
                print(f"  - {label}: {detail}")
            return False
        print(f"\n{len(self.rows)}/{len(self.rows)} điều kiện đạt.")
        return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", required=True)
    ap.add_argument("--plots", default=None, help="thư mục lưu ảnh sóng chỗ nối")
    ap.add_argument("--auditions", default=None, help="thư mục lưu file nghe thử 3 vòng")
    ap.add_argument("--no-strict", dest="strict", action="store_false",
                    help="chỉ in báo cáo, luôn trả exit 0")
    args = ap.parse_args()

    checks = Checks()

    points_path = os.path.join(args.audio, "loop-points.json")
    if not os.path.exists(points_path):
        print(f"thiếu {points_path}")
        return 1
    with open(points_path, encoding="utf-8") as fh:
        points = json.load(fh)

    # Thiếu file hoặc thiếu mốc lặp là điều kiện DỪNG, không phải một dòng FAIL
    # trong bảng: mọi phép đo phía dưới đều cần cả hai thứ đó tồn tại.
    missing = []
    for name in TRACKS:
        if not os.path.exists(os.path.join(args.audio, "music", f"{name}.mp3")):
            missing.append(f"thiếu track music/{name}.mp3")
        p = points.get(name)
        if not isinstance(p, dict):
            missing.append(f"thiếu mốc lặp cho {name}")
        elif not all(k in p for k in ("loopStart", "loopEnd")):
            missing.append(f"mốc lặp {name} thiếu loopStart/loopEnd")
    if missing:
        print("kiểm tra nghiêm ngặt")
        print("-" * 78)
        for item in missing:
            print(f"  FAIL  {item}")
        print(f"\n{len(missing)} điều kiện KHÔNG đạt.")
        return 1 if args.strict else 0

    if args.plots:
        os.makedirs(args.plots, exist_ok=True)
    if args.auditions:
        os.makedirs(args.auditions, exist_ok=True)

    rows = []
    total_kb = 0.0
    for name in TRACKS:
        path = os.path.join(args.audio, "music", f"{name}.mp3")
        p = points[name]
        d = decode(path)
        n_loop = int(round((p["loopEnd"] - p["loopStart"]) * SR))
        s0 = int(round(p["loopStart"] * SR))
        loop = d[s0:s0 + n_loop]

        err_db, corr, ctrl_db = periodicity(d, n_loop)
        jump_db, pct, hf_z = seam_metrics(loop)
        lufs = loudness(loop)
        lufs_phone, phone_loss, body_pct = phone_metrics(loop, lufs)
        kb = os.path.getsize(path) / 1024.0
        total_kb += kb
        file_sec = d.shape[0] / SR
        rows.append(dict(name=name, loop_sec=n_loop / SR, file_sec=file_sec,
                         lufs=lufs, tp=true_peak_db(loop), kb=kb,
                         kbps=kb * 8 / file_sec, err_db=err_db, corr=corr,
                         ctrl_db=ctrl_db, jump_db=jump_db, pct=pct, hf_z=hf_z,
                         lufs_phone=lufs_phone, phone_loss=phone_loss,
                         body_pct=body_pct))

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

    print(f"\nmô phỏng loa điện thoại (dải thông {PHONE_LOW:.0f}Hz-{PHONE_HIGH / 1000:.0f}kHz)")
    phdr = (f"{'track':6s} {'LUFS gốc':>10s} {'LUFS loa':>10s} {'mất LU':>8s} "
            f"{'trên 200Hz':>11s}")
    print(phdr)
    print("-" * len(phdr))
    for r in rows:
        print(f"{r['name']:6s} {r['lufs']:10.2f} {r['lufs_phone']:10.2f} "
              f"{r['phone_loss']:8.2f} {r['body_pct']:10.1f}%")

    lufs = [r["lufs"] for r in rows]
    spread = max(lufs) - min(lufs)
    max_tp = max(r["tp"] for r in rows)
    print(f"\nnhạc: {total_kb:.1f} kB   chênh lệch độ to lớn nhất: "
          f"{spread:.2f} LU   true peak cao nhất: {max_tp:.2f} dBFS")

    sfx = os.path.join(args.audio, "sfx")
    sfx_kb = sum(os.path.getsize(os.path.join(sfx, f)) for f in os.listdir(sfx)) / 1024.0
    total_mib = (total_kb + sfx_kb) / 1024.0
    print(f"tổng thư mục audio: {total_mib:.2f} MiB (nhạc "
          f"{total_kb / 1024.0:.2f} MiB + hiệu ứng {sfx_kb / 1024.0:.2f} MiB)")

    by_name = {r["name"]: r for r in rows}
    for r in rows:
        name = r["name"]
        target = TARGET_LUFS[name]
        checks.le(abs(r["lufs"] - target), THRESHOLDS["lufs_tolerance"],
                  f"{name}: LUFS lệch mục tiêu {target:g}", " LU")
        checks.le(r["tp"], THRESHOLDS["true_peak_db"], f"{name}: true peak", " dBFS")
        checks.ge(r["corr"], THRESHOLDS["periodicity_corr"], f"{name}: tương quan tuần hoàn")
        checks.le(r["err_db"], THRESHOLDS["periodicity_err_db"],
                  f"{name}: sai số tuần hoàn", " dB")
        checks.le(r["jump_db"], THRESHOLDS["seam_jump_db"],
                  f"{name}: bước nhảy chỗ nối", " dBFS")
        checks.le(r["hf_z"], THRESHOLDS["hf_z"], f"{name}: năng lượng cao tần chỗ nối")

    checks.le(spread, THRESHOLDS["lufs_spread"], "chênh lệch LUFS giữa ba track", " LU")
    checks.le(total_mib, THRESHOLDS["total_mib"], "tổng thư mục audio", " MiB")

    # Ba điều kiện dưới đây chỉ áp cho `vote`, và đó là có chủ đích: nó là track
    # duy nhất có nhiệm vụ tạo cao trào. `night` được phép tối và trầm - đó là
    # công việc của nó. Áp cùng một ngưỡng cho cả ba sẽ ép `night` sáng lên và
    # phá đúng thứ khiến nó dùng được.
    vote, day = by_name["vote"], by_name["day"]
    checks.le(vote["phone_loss"], THRESHOLDS["phone_loss_lu"],
              "vote: mất mát qua loa điện thoại", " LU")
    checks.ge(vote["body_pct"], THRESHOLDS["phone_body_pct"],
              "vote: năng lượng trên 200Hz", "%")
    checks.ge(vote["lufs_phone"] - day["lufs_phone"], -THRESHOLDS["phone_gap_vs_day"],
              "vote: LUFS qua loa so với day", " LU")

    ok = checks.report()
    if not args.strict:
        print("\n(--no-strict: luôn trả exit 0)")
        return 0
    return 0 if ok else 1


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
    sys.exit(main())
