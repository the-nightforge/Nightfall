"""Khối DSP dùng chung để dựng nhạc nền Ma Sói.

Nguyên tắc xuyên suốt: mọi thứ tác động lên nguyên bộ đệm vòng lặp phải là
phép *vòng* (circular). Bộ đệm dài đúng N mẫu đại diện cho một tín hiệu tuần
hoàn chu kỳ N; nếu lọc hay vang bằng phép tuyến tính thường thì đuôi bị cắt ở
mép và chỗ nối lặp sẽ kêu. Lọc trong miền FFT và convolution vòng giữ đúng
tính tuần hoàn, nhờ vậy điểm nối liền mạch theo đúng nghĩa toán học chứ không
phải nhờ crossfade che đi.
"""

from __future__ import annotations

import numpy as np

SR = 44100

_SEMITONE = {"C": -9, "D": -7, "E": -5, "F": -4, "G": -2, "A": 0, "B": 2}


def note(name: str) -> float:
    """"D2", "Bb3", "F#4" -> tần số Hz, chuẩn A4 = 440."""
    letter, rest = name[0].upper(), name[1:]
    semis = _SEMITONE[letter]
    while rest and rest[0] in "#b":
        semis += 1 if rest[0] == "#" else -1
        rest = rest[1:]
    octave = int(rest)
    return 440.0 * 2.0 ** (semis / 12.0 + (octave - 4))


# --------------------------------------------------------------------------
# Bao và tiện ích
# --------------------------------------------------------------------------

def _t(n: int) -> np.ndarray:
    return np.arange(n, dtype=np.float64) / SR


def fade_shape(n: int, attack: float, release: float, curve: float = 2.0) -> np.ndarray:
    """Bao attack/release mượt (cosine luỹ thừa) cho các nốt kéo dài."""
    env = np.ones(n)
    a = min(int(attack * SR), n // 2)
    r = min(int(release * SR), n - a)
    if a > 0:
        env[:a] = (0.5 - 0.5 * np.cos(np.linspace(0, np.pi, a))) ** curve
    if r > 0:
        env[n - r:] = (0.5 + 0.5 * np.cos(np.linspace(0, np.pi, r))) ** curve
    return env


def expdecay(n: int, tau: float, attack_ms: float = 3.0) -> np.ndarray:
    a = max(1, int(attack_ms * SR / 1000))
    env = np.exp(-_t(n) / max(tau, 1e-4))
    env[:a] *= np.linspace(0.0, 1.0, a) ** 2
    return env


# --------------------------------------------------------------------------
# Lọc trong miền FFT — tuần hoàn tuyệt đối, pha zero
# --------------------------------------------------------------------------

def fft_shape(x: np.ndarray, shaper) -> np.ndarray:
    """Nhân phổ của x với hàm đáp ứng biên độ shaper(freqs)."""
    n = x.shape[0]
    spec = np.fft.rfft(x, axis=0)
    freqs = np.fft.rfftfreq(n, 1.0 / SR)
    gain = shaper(freqs)
    if x.ndim == 2:
        gain = gain[:, None]
    return np.fft.irfft(spec * gain, n=n, axis=0)


def lp_curve(cut: float, order: float = 2.0):
    return lambda f: 1.0 / np.sqrt(1.0 + (np.maximum(f, 1e-6) / cut) ** (2 * order))


def hp_curve(cut: float, order: float = 2.0):
    def shaper(f):
        r = cut / np.maximum(f, 1e-6)
        return 1.0 / np.sqrt(1.0 + r ** (2 * order))
    return shaper


def bp_curve(low: float, high: float, order: float = 2.0):
    lo, hi = hp_curve(low, order), lp_curve(high, order)
    return lambda f: lo(f) * hi(f)


def shelf_curve(freq: float, gain_db: float, kind: str = "high"):
    g = 10.0 ** (gain_db / 20.0)
    def shaper(f):
        x = np.maximum(f, 1e-6) / freq
        blend = x ** 2 / (1.0 + x ** 2) if kind == "high" else 1.0 / (1.0 + x ** 2)
        return 1.0 + (g - 1.0) * blend
    return shaper


def peak_curve(freq: float, gain_db: float, q: float = 1.0):
    g = 10.0 ** (gain_db / 20.0)
    def shaper(f):
        x = (np.maximum(f, 1e-6) / freq - freq / np.maximum(f, 1e-6)) * q
        return 1.0 + (g - 1.0) / (1.0 + x ** 2)
    return shaper


def chain(*curves):
    return lambda f: np.prod([c(f) for c in curves], axis=0)


# --------------------------------------------------------------------------
# Nguồn nhiễu tuần hoàn
# --------------------------------------------------------------------------

def periodic_noise(n: int, rng: np.random.Generator, channels: int = 1) -> np.ndarray:
    x = rng.standard_normal((n, channels)) if channels > 1 else rng.standard_normal(n)
    return x


def brown(x: np.ndarray) -> np.ndarray:
    """Nhiễu nâu tuần hoàn: tích phân trong miền tần số (1/f), bỏ thành phần DC."""
    return fft_shape(x, lambda f: np.where(f < 20.0, 0.0, 20.0 / np.maximum(f, 1e-6)))
