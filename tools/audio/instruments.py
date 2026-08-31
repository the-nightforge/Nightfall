"""Nhạc cụ tổng hợp cho bộ nhạc "dark medieval folk ambient".

Không dùng sóng synth thuần: mỗi nhạc cụ mô phỏng một cơ chế vật lý (dây gảy
Karplus-Strong, dây kéo có nhiễu vĩ, màng trống theo mode Bessel, chuông với
bồi âm phi điều hoà) để tránh cảm giác nhạc stock/arcade.
"""

from __future__ import annotations

import numpy as np

from dsp import SR, _t, expdecay, fade_shape, fft_shape, lp_curve, bp_curve


# --------------------------------------------------------------------------
# Dây gảy - đàn luýt / thụ cầm nhỏ (Karplus-Strong nội suy tuyến tính)
# --------------------------------------------------------------------------

def pluck(freq: float, dur: float, decay: float = 2.5, brightness: float = 0.45,
          seed: int = 0) -> np.ndarray:
    n = int(dur * SR)
    delay = SR / freq
    li = int(np.floor(delay))
    frac = delay - li
    size = li + 2

    rng = np.random.default_rng(seed)
    buf = rng.uniform(-1.0, 1.0, size)
    # Làm mềm kích thích = gảy bằng thịt ngón thay vì móng.
    k = max(1, int(round((1.0 - brightness) * 12)))
    if k > 1:
        buf = np.convolve(buf, np.ones(k) / k, mode="same")
    buf -= buf.mean()
    buf /= max(np.max(np.abs(buf)), 1e-9)

    rho = 10.0 ** (-3.0 / max(decay * freq, 1.0))
    damp = 0.10 + 0.38 * (1.0 - brightness)

    out = np.empty(n)
    idx = 0
    prev = 0.0
    for i in range(n):
        s = (1.0 - frac) * buf[idx] + frac * buf[(idx + 1) % size]
        out[i] = s
        prev = (1.0 - damp) * s + damp * prev
        buf[idx] = rho * prev
        idx = (idx + 1) % size

    # Thân đàn gỗ: đuôi tắt dần thay vì kéo lê.
    out *= np.minimum(1.0, np.exp(-_t(n) / (decay * 1.6)) + 0.02)
    return out


# --------------------------------------------------------------------------
# Dây kéo - viol / fiddle, dùng cho các mảng swell và ostinato
# --------------------------------------------------------------------------

def bowed(freq: float, dur: float, attack: float = 0.9, release: float = 1.2,
          brightness: float = 0.5, vib: float = 0.35, players: int = 3,
          seed: int = 0) -> np.ndarray:
    n = int(dur * SR)
    t = _t(n)
    rng = np.random.default_rng(seed)
    out = np.zeros(n)

    for p in range(players):
        detune = 1.0 + rng.uniform(-0.0035, 0.0035)
        vrate = rng.uniform(4.2, 5.4)
        vphase = rng.uniform(0, 2 * np.pi)
        drift = 0.0018 * np.sin(2 * np.pi * rng.uniform(0.07, 0.19) * t + rng.uniform(0, 6.28))
        vdepth = vib * 0.006 * np.clip(t / max(attack, 0.05), 0, 1)
        f = freq * detune * (1.0 + drift + vdepth * np.sin(2 * np.pi * vrate * t + vphase))
        phase = 2 * np.pi * np.cumsum(f) / SR

        voice = np.zeros(n)
        h = 1
        while h * freq < 12000 and h <= 18:
            amp = 1.0 / h ** (1.25 - brightness * 0.45)
            if h % 2 == 0:
                amp *= 0.72
            voice += amp * np.sin(h * phase + rng.uniform(0, 6.28))
            h += 1
        # Nhiễu vĩ: thành phần khí bám theo biên độ, thứ khiến dây kéo không
        # nghe ra là sóng cưa đem đi lọc.
        bow = fft_shape(rng.standard_normal(n), bp_curve(freq * 1.5, 7000.0))
        voice += bow * 0.05 * (1.0 + 0.5 * np.sin(2 * np.pi * 3.1 * t + p))
        out += voice / max(players, 1)

    env = fade_shape(n, attack, release, curve=1.6)
    # Áp lực vĩ đổi chậm -> âm lượng không phẳng lì.
    env *= 1.0 + 0.12 * np.sin(2 * np.pi * 0.13 * t + seed)
    out *= env
    return fft_shape(out, lp_curve(1600.0 + 3200.0 * brightness, 1.4))


# --------------------------------------------------------------------------
# Drone kiểu đàn quay tay (hurdy-gurdy) / phong cầm nhà thờ
# --------------------------------------------------------------------------

def drone(freq: float, n: int, cut: float = 900.0, buzz: float = 0.12,
          voices: int = 4, seed: int = 0, fund: float = 1.0,
          rolloff: float = 0.95) -> np.ndarray:
    """Drone dài đúng n mẫu và tuần hoàn theo n.

    Mỗi giọng bị ép về lưới tần số k*SR/n, nhờ vậy drone chứa số nguyên chu kỳ
    trong một vòng lặp và chỗ nối không có bước nhảy pha.
    """
    rng = np.random.default_rng(seed)
    t = _t(n)
    out = np.zeros(n)
    for v in range(voices):
        detune = 1.0 + rng.uniform(-0.004, 0.004)
        f = freq * detune
        cycles = max(1.0, round(f * n / SR))
        f = cycles * SR / n
        phase = 2 * np.pi * f * t + rng.uniform(0, 6.28)
        sig = np.zeros(n)
        h = 1
        while h * f < 9000 and h <= 26:
            # fund < 1 ha rieng hoa am co ban. Hoa am co ban chiem gan het nang
            # luong, nen day la nut chinh de keo drone ra khoi vung bass.
            amp = (fund if h == 1 else 1.0) / h ** rolloff
            sig += amp * np.sin(h * phase)
            h += 1
        # Bánh xe nhựa thông cọ dây: rung biên độ chậm, lệch pha từng giọng.
        sig *= 1.0 + 0.09 * np.sin(2 * np.pi * (rng.uniform(0.11, 0.28)) * t + v)
        out += sig / voices

    if buzz > 0:
        rasp = fft_shape(rng.standard_normal(n), bp_curve(freq * 3, freq * 14))
        out += buzz * rasp * (0.6 + 0.4 * np.sin(2 * np.pi * 0.07 * t))
    return fft_shape(out, lp_curve(cut, 1.6))


# --------------------------------------------------------------------------
# Chuông xa
# --------------------------------------------------------------------------

_BELL_PARTIALS = [
    (0.500, 0.85, 1.00), (1.000, 1.00, 0.85), (1.183, 0.55, 0.62),
    (1.506, 0.42, 0.48), (2.000, 0.60, 0.40), (2.514, 0.28, 0.26),
    (2.662, 0.22, 0.22), (3.011, 0.18, 0.17), (4.166, 0.12, 0.10),
    (5.433, 0.08, 0.07),
]


def bell(freq: float, dur: float, decay: float = 6.0, seed: int = 0) -> np.ndarray:
    n = int(dur * SR)
    t = _t(n)
    rng = np.random.default_rng(seed)
    out = np.zeros(n)
    for ratio, amp, dec in _BELL_PARTIALS:
        f = freq * ratio * (1.0 + rng.uniform(-0.002, 0.002))
        beat = 1.0 + 0.25 * np.sin(2 * np.pi * rng.uniform(0.3, 1.1) * t)
        out += amp * beat * np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) * np.exp(-t / (decay * dec))
    strike = fft_shape(rng.standard_normal(n), bp_curve(freq * 2, freq * 10)) * expdecay(n, 0.02, 1.0)
    out = out / max(np.max(np.abs(out)), 1e-9) + 0.18 * strike
    return out


# --------------------------------------------------------------------------
# Trống khung (bodhran / trống lễ) - mode màng tròn
# --------------------------------------------------------------------------

_MEMBRANE = [1.000, 1.594, 2.136, 2.296, 2.653, 2.918, 3.156]


def frame_drum(freq: float = 92.0, dur: float = 1.1, hardness: float = 0.5,
               tone: float = 0.6, seed: int = 0) -> np.ndarray:
    n = int(dur * SR)
    t = _t(n)
    rng = np.random.default_rng(seed)

    body = np.zeros(n)
    for i, ratio in enumerate(_MEMBRANE):
        f = freq * ratio
        dec = 0.45 / (1.0 + i * 0.75)
        # Màng căng: cao độ tụt nhanh lúc đầu vì biên độ lớn.
        bend = 1.0 + 0.35 * np.exp(-t / 0.03)
        phase = 2 * np.pi * np.cumsum(f * bend) / SR
        body += (tone / (1.0 + i * 1.2)) * np.sin(phase) * np.exp(-t / dec)

    slap = fft_shape(rng.standard_normal(n), bp_curve(700 + 2600 * hardness, 6000 + 5000 * hardness))
    slap *= expdecay(n, 0.012 + 0.02 * (1 - hardness), 0.6)
    skin = fft_shape(rng.standard_normal(n), bp_curve(160, 900)) * expdecay(n, 0.09, 1.5)

    out = body + slap * (0.55 + 0.70 * hardness) + skin * 0.3
    return out / max(np.max(np.abs(out)), 1e-9)


def war_drum(freq: float = 58.0, dur: float = 1.6, seed: int = 0,
             stick: float = 0.40, shell: float = 0.0, shell_freq: float = 320.0,
             harmonics: float = 0.35) -> np.ndarray:
    """Trống trận sâu: dùng cho pha bỏ phiếu, nặng và chắc.

    Bốn tham số cuối đều mặc định về đúng giá trị cũ, nên mọi chỗ gọi không nêu
    chúng cho ra tín hiệu y hệt trước - đó là điều kiện để chỉnh riêng cú trống
    của `vote` mà không đụng tới nhịp tim của `night`.

    - `stick`: tiếng dùi gõ mặt, dải 1.2-5kHz. Đây là phần DUY NHẤT của cú
      trống mà loa điện thoại tái tạo được trọn vẹn.
    - `harmonics`: sức nặng của bồi âm bậc hai. Bồi âm bậc hai của một cú trống
      68Hz nằm ở 136Hz, vẫn dưới ngưỡng loa nhỏ, nên nó KHÔNG thay được stick.
    - `shell`: thân trống gỗ. Ba mode quanh `shell_freq` (mặc định 320Hz), tắt
      nhanh. Đây là thứ cho tai biết đây là một cái trống có kích thước, và nó
      rơi đúng vào dải 250Hz-2kHz mà loa điện thoại phát tốt nhất.
    """
    n = int(dur * SR)
    t = _t(n)
    rng = np.random.default_rng(seed)
    bend = freq * (1.0 + 0.55 * np.exp(-t / 0.045))
    phase = 2 * np.pi * np.cumsum(bend) / SR
    low = np.sin(phase) * np.exp(-t / 0.42)
    low += harmonics * np.sin(2 * phase) * np.exp(-t / 0.16)
    thump = fft_shape(rng.standard_normal(n), bp_curve(60, 420)) * expdecay(n, 0.07, 1.0)
    stick_sig = fft_shape(rng.standard_normal(n), bp_curve(1200, 5000)) * expdecay(n, 0.008, 0.5)
    # Loa dien thoai khong tai duoc <150Hz: khong co phan dui go thi
    # tren mobile cu danh nay bien mat hoan toan.
    out = low + 0.45 * thump + stick * stick_sig

    if shell > 0.0:
        # Ba mode gỗ lệch nhau chút ít; tỉ lệ không nguyên để thân trống không
        # nghe ra là một nốt nhạc.
        for i, (ratio, amp, dec) in enumerate(((1.00, 1.00, 0.13), (1.47, 0.62, 0.09),
                                               (2.13, 0.34, 0.06))):
            f = shell_freq * ratio * (1.0 + rng.uniform(-0.01, 0.01))
            out += shell * amp * np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) * expdecay(n, dec, 2.0)

    out = np.tanh(out * 1.4) / 1.4
    return out / max(np.max(np.abs(out)), 1e-9)


# --------------------------------------------------------------------------
# Sáo gỗ hơi thở (recorder) - dùng rất tiết chế
# --------------------------------------------------------------------------

def flute(freq: float, dur: float, attack: float = 0.18, release: float = 0.35,
          breath: float = 0.5, seed: int = 0) -> np.ndarray:
    n = int(dur * SR)
    t = _t(n)
    rng = np.random.default_rng(seed)
    vib = 0.004 * np.clip((t - 0.25) / 0.6, 0, 1) * np.sin(2 * np.pi * 4.8 * t + seed)
    phase = 2 * np.pi * np.cumsum(freq * (1.0 + vib)) / SR
    out = np.sin(phase) + 0.22 * np.sin(2 * phase) + 0.07 * np.sin(3 * phase)
    air = fft_shape(rng.standard_normal(n), bp_curve(freq * 1.2, 9000))
    out += air * breath * 0.28
    return out * fade_shape(n, attack, release, curve=1.3)


# --------------------------------------------------------------------------
# Dây kéo bồi âm - "tiếng dây kéo" rợn người cho ban đêm
# --------------------------------------------------------------------------

def string_scrape(freq: float, dur: float, seed: int = 0) -> np.ndarray:
    n = int(dur * SR)
    t = _t(n)
    rng = np.random.default_rng(seed)
    out = np.zeros(n)
    for h, amp in ((1, 1.0), (2, 0.55), (3, 0.3), (5, 0.12)):
        wobble = 1.0 + 0.010 * np.sin(2 * np.pi * rng.uniform(0.5, 1.4) * t + rng.uniform(0, 6))
        out += amp * np.sin(2 * np.pi * np.cumsum(freq * h * wobble) / SR + rng.uniform(0, 6))
    grit = fft_shape(rng.standard_normal(n), bp_curve(freq * 2, freq * 9))
    out = out * (1.0 + 0.3 * grit)
    return out * fade_shape(n, dur * 0.45, dur * 0.5, curve=2.2)
