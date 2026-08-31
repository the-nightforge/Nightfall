"""Dựng ba track nhạc nền của Ma Sói Online.

Chạy:  python tools/audio/make_music.py --out apps/web/public/audio

Bộ ba dùng chung một bảng màu để không lệch tông khi crossfade: cùng tâm âm
Rê, cùng nhạc cụ (drone đàn quay tay, dây kéo, đàn gảy, trống khung, chuông),
cùng loại vang sảnh đá. Khác nhau ở mật độ và nhịp, không khác ở chất liệu.

Mỗi track là một tín hiệu tuần hoàn dựng sẵn theo đúng số mẫu của vòng lặp,
nên chỗ nối liền mạch theo cấu tạo chứ không nhờ crossfade che.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np

# Console Windows mac dinh cp1252; ban ghi tieng Viet ra stdout se vo neu khong ep utf-8.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except Exception:
        pass

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import instruments as ins
from dsp import SR, _t, brown, fft_shape, lp_curve, hp_curve, bp_curve, chain, note, peak_curve, shelf_curve
from studio import (Canvas, PAD_SEC, decode_mp3, make_ir, master, normalise, loudness,
                    true_peak_db, with_padding, write_mp3, write_wav)

# Bảng màu chung -----------------------------------------------------------
HALL = None          # IR sảnh đá, dựng một lần rồi dùng cho cả ba track
_PLUCK_CACHE: dict = {}


def hall() -> np.ndarray:
    global HALL
    if HALL is None:
        HALL = make_ir(seconds=4.2, rt_low=3.6, rt_high=0.55, predelay=0.024, seed=11)
    return HALL


def pluck(freq: float, dur: float, decay: float, brightness: float, seed: int) -> np.ndarray:
    key = (round(freq, 3), round(dur, 3), decay, brightness, seed)
    if key not in _PLUCK_CACHE:
        _PLUCK_CACHE[key] = ins.pluck(freq, dur, decay, brightness, seed)
    return _PLUCK_CACHE[key]


def wind_bed(n: int, seed: int, low: float, high: float, lfos) -> np.ndarray:
    """Nền gió/không khí: nhiễu nâu lọc dải, biên độ đưa theo vài LFO chậm.

    Lọc bằng FFT nên nền gió tuần hoàn tuyệt đối theo n - không có tiếng "phựt"
    ở chỗ nối như khi lọc IIR thường.
    """
    rng = np.random.default_rng(seed)
    t = _t(n)
    out = np.zeros((n, 2))
    for ch in range(2):
        x = brown(rng.standard_normal(n))
        x = fft_shape(x, bp_curve(low, high, 1.6))
        env = np.ones(n)
        for period, depth, phase in lfos:
            env *= 1.0 + depth * np.sin(2 * np.pi * t / period + phase + ch * 0.7)
        out[:, ch] = x * env
    return out / np.max(np.abs(out))


# ==========================================================================
# NIGHT - 72s. Rừng đêm, nghi lễ. Không giai điệu, không nhịp rõ.
# ==========================================================================

def build_night():
    length = 72.0
    c = Canvas(length)
    n = c.n

    # Nền: drone Rê hai quãng tám + quãng năm La, tối và gần như bất động.
    c.bed(ins.drone(note("D1"), n, cut=200.0, buzz=0.0, voices=2, seed=3), gain=0.05, send=0.05)
    c.bed(ins.drone(note("D2"), n, cut=2200.0, buzz=0.10, voices=4, seed=5, fund=0.30),
          gain=0.26, pan=-0.15, send=0.22)
    c.bed(ins.drone(note("A2"), n, cut=1900.0, buzz=0.07, voices=3, seed=8, fund=0.32),
          gain=0.15, pan=0.20, send=0.26)

    # Gió trong tán cây: chu kỳ LFO 18s và 24s đều chia hết 72s.
    gust = wind_bed(n, seed=21, low=190.0, high=5200.0,
                    lfos=[(24.0, 0.45, 0.0), (18.0, 0.30, 1.9), (9.0, 0.16, 3.4)])
    c.dry += gust * 0.105
    c.wet += gust * 0.055

    # Dây kéo: các swell dài trên hợp âm Rê thứ, đủ thưa để không thành giai điệu.
    swells = [
        (2.0, "D3", 12.0, -0.35, 0.205), (17.0, "F3", 11.0, 0.30, 0.175),
        (33.0, "A2", 13.0, -0.20, 0.150), (49.0, "Bb2", 11.0, 0.35, 0.140),
        (62.0, "D3", 13.0, 0.05, 0.180),
    ]
    for i, (at, name, dur, pan, g) in enumerate(swells):
        sig = ins.bowed(note(name), dur, attack=dur * 0.42, release=dur * 0.5,
                        brightness=0.46, vib=0.30, players=3, seed=40 + i)
        c.add(sig, at, gain=g, pan=pan, send=0.55, spread_ms=9.0)

    # Chuông xa: 3 tiếng, cách nhau đúng 24s.
    for i, (at, name) in enumerate([(7.0, "D4"), (31.0, "A3"), (55.0, "D4")]):
        c.add(ins.bell(note(name), 13.0, decay=5.0, seed=60 + i), at,
              gain=0.130, pan=(-0.4 if i % 2 else 0.45), send=0.85, spread_ms=13.0)

    # "Tiếng dây kéo": bồi âm cao, mờ, rợn - đặc sản của pha đêm.
    for i, (at, name, dur) in enumerate([(20.0, "A4", 7.0), (44.0, "D5", 6.0)]):
        c.add(ins.string_scrape(note(name), dur, seed=70 + i), at,
              gain=0.075, pan=(0.55 if i else -0.55), send=0.9, spread_ms=17.0)

    # Nhịp tim: trống rất nhẹ, cảm thấy chứ gần như không nghe thấy.
    for k in range(6):
        base = k * 12.0
        for off, g in ((0.0, 0.105), (0.44, 0.068)):
            c.add(ins.war_drum(58.0, 1.5, seed=80 + k), base + off, gain=g, pan=0.0, send=0.10)

    # Vài tiếng gảy lạc lõng, xa, như ai đó đang chỉnh dây trong làng.
    for i, (at, name) in enumerate([(10.5, "D3"), (28.0, "A2"), (46.5, "F3"), (65.0, "D3")]):
        c.add(pluck(note(name), 4.0, 3.0, 0.62, 90 + i), at,
              gain=0.140, pan=(-0.5 + 0.33 * i), send=0.7, spread_ms=11.0)

    eq = chain(shelf_curve(3800.0, -2.0, "high"), peak_curve(300.0, 1.0, 0.8),
               lp_curve(12000.0, 1.2))
    return master(c, hall(), wet_gain=0.95, eq=eq, drive=1.0, hp=58.0), length


# ==========================================================================
# DAY - 96s, 3/4 @ 90 BPM (ô nhịp 2.0s, 48 ô). Track nghe lâu nhất.
# Bốn đoạn 12 ô: mỏng -> dày -> dày nhất -> mỏng lại, để chỗ nối tự nhiên.
# ==========================================================================

def build_day():
    bpm, beats_per_bar, bars = 90.0, 3, 48
    beat = 60.0 / bpm
    bar = beat * beats_per_bar          # 2.0s
    length = bar * bars                 # 96.0s
    c = Canvas(length)
    n = c.n

    def at_bar(b: float) -> float:
        return b * bar

    # Bao đoạn: drone dày lên ở giữa vòng rồi mỏng lại - vòng lặp có nhịp thở.
    t = _t(n)
    arc = 0.62 + 0.38 * (0.5 - 0.5 * np.cos(2 * np.pi * t / length))

    c.bed(ins.drone(note("D2"), n, cut=2000.0, buzz=0.06, voices=3, seed=13, fund=0.28) * arc,
          gain=0.170, pan=-0.10, send=0.20)
    c.bed(ins.drone(note("A2"), n, cut=1800.0, buzz=0.0, voices=2, seed=17, fund=0.30) * arc,
          gain=0.090, pan=0.18, send=0.24)

    # Không khí ban ngày: sáng và nhẹ hơn gió đêm, mức thấp hơn hẳn.
    air = wind_bed(n, seed=23, low=380.0, high=7000.0,
                   lfos=[(32.0, 0.35, 0.4), (24.0, 0.22, 2.6)])
    c.dry += air * 0.072
    c.wet += air * 0.038

    # -- Đàn gảy: nốt lẻ ở đoạn A và D, ostinato ở B và C -------------------
    sparse = ["D3", "A3", "F3", "D3", "A2", "C4"]
    for i, b in enumerate([0, 2, 5, 7, 9, 11]):
        c.add(pluck(note(sparse[i % len(sparse)]), 3.4, 2.6, 0.66, 100 + i % 3),
              at_bar(b), gain=0.200, pan=-0.3 + 0.12 * i, send=0.55, spread_ms=8.0)

    # Ostinato 2 ô nhịp ở Rê Dorian. Ô lẻ đổi nốt để 4s không thành vòng cứng.
    figure_a = [(0.0, "D3"), (1.0, "A3"), (2.0, "F3")]
    figure_b = [(0.0, "E3"), (1.0, "A3"), (2.0, "C4")]
    figure_c = [(0.0, "D3"), (1.0, "B3"), (2.0, "G3")]
    for b in range(12, 36):
        fig = figure_a if b % 4 == 0 else (figure_b if b % 4 == 2 else (figure_c if b % 4 == 1 else None))
        if fig is None:
            continue
        for j, (bt, name) in enumerate(fig):
            jitter = 0.010 * np.sin(b * 1.7 + j)
            g = 0.170 if b < 24 else 0.200
            c.add(pluck(note(name), 3.0, 2.3, 0.66, 100 + (b + j) % 3),
                  at_bar(b) + bt * beat + jitter,
                  gain=g * (1.0 if j == 0 else 0.72), pan=-0.22 + 0.2 * j,
                  send=0.5, spread_ms=7.0)

    # -- Dây kéo: mảng đệm chuyển hoà âm, giữ căng thẳng ở mức vừa ----------
    pads = [
        (at_bar(2), "D3", 11.0, -0.30, 0.135), (at_bar(13), "F3", 12.0, 0.28, 0.120),
        (at_bar(25), "A3", 12.0, -0.25, 0.112), (at_bar(31), "C4", 10.0, 0.32, 0.090),
        (at_bar(37), "Bb2", 11.0, 0.10, 0.105),
        # Swell cuối tràn qua mốc lặp: đầu vòng sau đã có sẵn đuôi của nó.
        (at_bar(43), "D3", 12.0, -0.05, 0.140),
    ]
    for i, (at, name, dur, pan, g) in enumerate(pads):
        c.add(ins.bowed(note(name), dur, attack=dur * 0.38, release=dur * 0.5,
                        brightness=0.52, vib=0.30, players=3, seed=120 + i),
              at, gain=g, pan=pan, send=0.5, spread_ms=10.0)

    # -- Trống khung: chỉ ở đoạn C, rất nhẹ, vào rồi ra ---------------------
    for b in range(24, 38):
        ramp = min(1.0, (b - 23) / 3.0) * min(1.0, (38 - b) / 3.0)
        c.add(ins.frame_drum(96.0, 1.0, hardness=0.30, tone=0.55, seed=140 + b % 4),
              at_bar(b) + 0.006 * np.sin(b), gain=0.150 * ramp, pan=-0.12, send=0.30)
        c.add(ins.frame_drum(150.0, 0.5, hardness=0.42, tone=0.30, seed=150 + b % 3),
              at_bar(b) + 2 * beat + 0.008 * np.cos(b), gain=0.075 * ramp, pan=0.26, send=0.34)

    # -- Sáo gỗ: hai câu ngắn, rất khẽ. Đủ để có "người", không đủ để hút tai.
    phrases = [(at_bar(26), [("D4", 1.3), ("F4", 0.9), ("E4", 1.8)]),
               (at_bar(33), [("A4", 1.1), ("G4", 0.8), ("F4", 2.0)])]
    for pi, (start, notes) in enumerate(phrases):
        pos = start
        for ni, (name, dur) in enumerate(notes):
            c.add(ins.flute(note(name), dur, attack=0.22, release=dur * 0.45,
                            breath=0.55, seed=160 + pi * 5 + ni),
                  pos, gain=0.100, pan=0.34 if pi else -0.34, send=0.62, spread_ms=12.0)
            pos += dur * 0.92

    eq = chain(shelf_curve(4000.0, -1.0, "high"), peak_curve(420.0, 1.2, 0.7),
               peak_curve(2600.0, -1.2, 1.1), lp_curve(14000.0, 1.2))
    return master(c, hall(), wet_gain=0.80, eq=eq, drive=1.0, hp=64.0), length


# ==========================================================================
# VOTE - 85.714s, 4/4 @ 112 BPM (ô nhịp 2.142857s, 40 ô = 5 câu 8 ô).
# Sức nặng và phán quyết, không phải truy đuổi.
# ==========================================================================

def build_vote():
    bpm, bars = 112.0, 40
    beat = 60.0 / bpm                   # 0.535714s
    bar = beat * 4                      # 2.142857s
    length = bar * bars                 # 85.714286s
    c = Canvas(length)
    n = c.n

    def at_bar(b: float, b_beat: float = 0.0) -> float:
        return b * bar + b_beat * beat

    # Nền tối hơn hai track kia, có độ gằn.
    c.bed(ins.drone(note("D1"), n, cut=190.0, buzz=0.0, voices=2, seed=31), gain=0.030, send=0.05)
    c.bed(ins.drone(note("D2"), n, cut=2400.0, buzz=0.24, voices=4, seed=33, fund=0.34),
          gain=0.235, pan=-0.12, send=0.22)
    c.bed(ins.drone(note("A2"), n, cut=2000.0, buzz=0.15, voices=3, seed=37, fund=0.34),
          gain=0.115, pan=0.22, send=0.26)

    rumble = wind_bed(n, seed=41, low=110.0, high=2600.0,
                      lfos=[(21.428571, 0.40, 0.0), (17.142857, 0.25, 2.2)])
    c.dry += rumble * 0.070
    c.wet += rumble * 0.032

    # Cường độ theo câu: 1 vào, 2 dựng, 3 đầy, 4 nín thở, 5 dựng lại về mốc lặp.
    def phrase(b: int) -> int:
        return b // 8

    for b in range(bars):
        p = phrase(b)
        pos_in = b % 8

        # Trống trận: phách 1 và 3. Câu 4 chỉ còn phách 1 - khoảng lặng phán quyết.
        hits = [(0.0, 1.00)] if p == 3 else [(0.0, 1.00), (2.0, 0.82)]
        if p in (2, 4) and pos_in == 7:
            hits.append((3.0, 0.70))          # cú dẫn sang câu sau
        for bt, vel in hits:
            swing = 0.004 * np.sin(b * 2.3 + bt)
            gain = 0.26 * vel * (0.72 if p == 0 else 1.0) * (0.62 if p == 3 else 1.0)
            c.add(ins.war_drum(68.0, 1.7, seed=200 + b % 5), at_bar(b, bt) + swing,
                  gain=gain, pan=0.0, send=0.16)

        # Trống khung móc đơn: từ câu 2, nghỉ hẳn ở câu 4.
        if p in (1, 2, 4):
            dense = 0.85 if p != 1 else 0.55
            for e in range(8):
                bt = e * 0.5
                accent = 1.0 if e % 2 == 0 else 0.52
                if e in (3, 6):
                    accent = 0.78
                swing = 0.006 * np.sin(b * 3.1 + e * 1.3)
                c.add(ins.frame_drum(104.0, 0.62, hardness=0.55, tone=0.42, seed=220 + (b + e) % 6),
                      at_bar(b, bt) + swing,
                      gain=0.140 * accent * dense, pan=-0.28 + 0.1 * (e % 3), send=0.22)

        # Dây trầm kéo ngắn: pedal Rê, câu 3 và 5 nhích lên Fa/Mi cho sức ép.
        if p >= 1:
            line = {1: ["D2", "D2", "D2", "C3"], 2: ["D2", "F2", "D2", "E2"],
                    3: ["D2", "D2", "D2", "D2"], 4: ["D2", "F2", "E2", "F2"]}[p]
            name = line[pos_in % 4]
            dur = 1.9 if p == 3 else 0.62
            sig = ins.bowed(note(name), dur, attack=0.05 if p != 3 else 0.7,
                            release=dur * 0.45, brightness=0.50, vib=0.2,
                            players=2, seed=240 + b % 4)
            c.add(sig, at_bar(b), gain=0.190 if p != 3 else 0.140, pan=-0.18,
                  send=0.34, spread_ms=8.0)

    # Mảng dây trên: câu 4 giữ hợp âm Rê thứ, câu 5 dựng lên rồi tràn qua mốc lặp.
    c.add(ins.bowed(note("A3"), 18.0, attack=6.0, release=8.0, brightness=0.48,
                    vib=0.28, players=3, seed=260), at_bar(23), gain=0.150, pan=0.26,
          send=0.55, spread_ms=11.0)
    c.add(ins.bowed(note("F3"), 16.0, attack=5.0, release=7.0, brightness=0.46,
                    vib=0.25, players=3, seed=261), at_bar(26), gain=0.130, pan=-0.30,
          send=0.55, spread_ms=11.0)
    c.add(ins.bowed(note("D3"), 14.0, attack=4.5, release=6.0, brightness=0.52,
                    vib=0.30, players=3, seed=262), at_bar(34), gain=0.160, pan=0.05,
          send=0.50, spread_ms=10.0)

    # Chuông: đánh dấu đầu câu 3 và câu 5.
    for i, b in enumerate([16, 32]):
        c.add(ins.bell(note("D3" if i == 0 else "A3"), 12.0, decay=4.2, seed=280 + i),
              at_bar(b), gain=0.140, pan=-0.35 if i == 0 else 0.38, send=0.8, spread_ms=14.0)

    eq = chain(shelf_curve(3800.0, -1.5, "high"), peak_curve(95.0, 1.5, 0.7),
               peak_curve(430.0, -1.0, 1.0), lp_curve(13000.0, 1.2))
    return master(c, hall(), wet_gain=0.72, eq=eq, drive=1.15, hp=58.0), length


# ==========================================================================

BUILDERS = {"night": (build_night, -24.0), "day": (build_day, -24.7), "vote": (build_vote, -23.7)}

# 160 chu khong phai 128: nhac ambient nhieu duoi vang la thu mp3 ma hoa kem
# nhat, va o 128 nhieu luong tu du de lam chong chenh chinh cho noi vong lap.
# Ca thu muc van khoang 5MB, duoi tran 6MB cua hop dong file.
BITRATE = 160

# Dải để soi cân bằng phổ. Nhạc nền game phải nghe được trên loa điện thoại,
# thứ gần như không tái tạo được gì dưới ~200Hz, nên nếu năng lượng dồn hết
# xuống hai dải đầu thì trên mobile track coi như biến mất.
_BANDS = [(20, 60), (60, 120), (120, 250), (250, 500), (500, 1000),
          (1000, 2000), (2000, 4000), (4000, 8000), (8000, 20000)]


def band_report(x: np.ndarray) -> str:
    mono = x.mean(axis=1)
    power = np.abs(np.fft.rfft(mono)) ** 2
    freqs = np.fft.rfftfreq(mono.shape[0], 1.0 / SR)
    total = power.sum()
    parts = [f"{100 * power[(freqs >= lo) & (freqs < hi)].sum() / total:5.1f}" for lo, hi in _BANDS]
    return " ".join(parts)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="thư mục apps/web/public/audio")
    ap.add_argument("--wav", action="store_true", help="xuất thêm wav để soi sóng")
    ap.add_argument("--only", default=None)
    args = ap.parse_args()

    music_dir = os.path.join(args.out, "music")
    os.makedirs(music_dir, exist_ok=True)
    points_path = os.path.join(args.out, "loop-points.json")
    points = {}
    if os.path.exists(points_path):
        with open(points_path, encoding="utf-8") as fh:
            points = json.load(fh)

    for name, (builder, target) in BUILDERS.items():
        if args.only and name != args.only:
            continue
        print(f"[{name}] dựng...", flush=True)
        raw, length = builder()
        n = raw.shape[0]
        assert n == int(round(length * SR)), "độ dài vòng lặp phải khớp số mẫu"
        mp3_path = os.path.join(music_dir, f"{name}.mp3")

        # Hiệu chỉnh độ to trên chính file mp3 chứ không trên mảng float: bộ mã
        # hoá làm mức tụt khoảng nửa LU, mà thứ người chơi nghe là file.
        adj, loop, measured = 0.0, raw, target
        for _ in range(5):
            loop = normalise(raw, target_lufs=target + adj, ceiling_db=-2.0)
            write_mp3(mp3_path, with_padding(loop), bitrate=BITRATE)
            head = int(round(PAD_SEC * SR))
            measured = loudness(decode_mp3(mp3_path)[head:head + n])
            if abs(measured - target) <= 0.05:
                break
            adj += target - measured

        full = with_padding(loop)
        if args.wav:
            write_wav(os.path.join(music_dir, f"{name}.wav"), full)

        kb = os.path.getsize(mp3_path) / 1024.0
        points[name] = {
            "loopStart": round(PAD_SEC, 6),
            "loopEnd": round(PAD_SEC + n / SR, 6),
            "loopLen": round(n / SR, 6),
            "fileLen": round(full.shape[0] / SR, 6),
            "loopSamples": int(n),
            "kb": round(kb, 1),
        }
        print(f"[{name}] loop={n / SR:.6f}s  LUFS(mp3)={measured:.2f}  "
              f"TP={true_peak_db(loop):.2f}dBFS  {kb:.1f}kB", flush=True)
        print(f"         dải%  {'  '.join(f'{lo}' for lo, _ in _BANDS)}", flush=True)
        print(f"               {band_report(loop)}", flush=True)

    with open(points_path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(points, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print("đã ghi", points_path)


if __name__ == "__main__":
    main()
