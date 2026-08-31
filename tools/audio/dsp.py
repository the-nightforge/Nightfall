"""Khối lọc dùng chung cho bộ công cụ nhạc nền.

Nguyên tắc xuyên suốt: mọi phép tác động lên nguyên bộ đệm vòng lặp phải là
phép *vòng* (circular). Bộ đệm dài đúng N mẫu đại diện cho một tín hiệu tuần
hoàn chu kỳ N; nếu lọc bằng phép tuyến tính thường thì đuôi bộ lọc bị cắt ở
mép và chỗ nối lặp sẽ kêu. Lọc trong miền FFT giữ đúng tính tuần hoàn, nhờ
vậy điểm nối liền mạch theo đúng nghĩa toán học chứ không phải nhờ crossfade
che đi.

Trước đây file này còn chứa các khối tổng hợp âm (bao, nhiễu tuần hoàn, quy
đổi tên nốt) phục vụ script dựng nhạc procedural. Bộ nhạc hiện tại là tác
phẩm của bên thứ ba nên script đó đã bị gỡ, và các khối chỉ nó dùng cũng đi
theo - xem `apps/web/public/audio/CREDITS.md`.
"""

from __future__ import annotations

import numpy as np

SR = 44100


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
