"""Bàn trộn, hiệu ứng vang và khâu xuất file.

Điểm cốt lõi của cả file này: bộ đệm dài đúng N mẫu *là* một tín hiệu tuần
hoàn chu kỳ N. Nốt nào tràn qua cuối vòng thì đuôi của nó được cộng ngược về
đầu (`Canvas.add`), và vang được tính bằng convolution vòng, nên đuôi vang
cũng quấn về đầu. Kết quả là bất kỳ cửa sổ nào dài đúng N mẫu cũng lặp liền
mạch - kể cả sau khi mp3 làm trễ toàn bộ file vài chục mili giây.
"""

from __future__ import annotations

import numpy as np
from scipy.signal import resample_poly

from dsp import SR, _t, fft_shape, hp_curve, bp_curve, chain

PAD_SEC = 0.5


# --------------------------------------------------------------------------
# Canvas: lịch diễn có quấn vòng, hai bus khô/vang
# --------------------------------------------------------------------------

class Canvas:
    def __init__(self, seconds: float):
        self.n = int(round(seconds * SR))
        self.dry = np.zeros((self.n, 2))
        self.wet = np.zeros((self.n, 2))

    def add(self, sig: np.ndarray, at: float, gain: float = 1.0, pan: float = 0.0,
            send: float = 0.25, spread_ms: float = 0.0) -> None:
        """Đặt sig vào thời điểm at (giây), quấn vòng nếu tràn qua cuối."""
        if sig.size == 0 or gain == 0.0:
            return
        theta = (pan + 1.0) * np.pi / 4.0
        gl, gr = np.cos(theta) * gain, np.sin(theta) * gain

        start = int(round(at * SR)) % self.n
        offs = int(round(spread_ms * SR / 1000.0))
        self._wrap_add(self.dry[:, 0], sig * gl, start)
        self._wrap_add(self.dry[:, 1], sig * gr, start + offs)
        if send > 0.0:
            self._wrap_add(self.wet[:, 0], sig * gl * send, start)
            self._wrap_add(self.wet[:, 1], sig * gr * send, start + offs)

    def bed(self, sig: np.ndarray, gain: float = 1.0, pan: float = 0.0,
            send: float = 0.15) -> None:
        """Lớp nền đã dài đúng một vòng (drone, gió)."""
        assert sig.shape[0] == self.n, "lớp nền phải dài đúng một vòng lặp"
        self.add(sig, 0.0, gain, pan, send)

    def _wrap_add(self, dst: np.ndarray, src: np.ndarray, start: int) -> None:
        n = self.n
        start %= n
        remaining = src
        pos = start
        while remaining.size:
            take = min(n - pos, remaining.size)
            dst[pos:pos + take] += remaining[:take]
            remaining = remaining[take:]
            pos = 0


# --------------------------------------------------------------------------
# Vang: đáp ứng xung tổng hợp + convolution vòng
# --------------------------------------------------------------------------

def make_ir(seconds: float, rt_low: float, rt_high: float, predelay: float = 0.02,
            seed: int = 7) -> np.ndarray:
    """IR kiểu sảnh đá: dải thấp ngân lâu, dải cao tắt nhanh."""
    n = int(seconds * SR)
    t = _t(n)
    rng = np.random.default_rng(seed)
    bands = [(20, 130), (130, 420), (420, 1100), (1100, 3000), (3000, 8000), (8000, 17000)]
    ir = np.zeros((n, 2))

    for ch in range(2):
        noise = rng.standard_normal(n)
        acc = np.zeros(n)
        for i, (lo, hi) in enumerate(bands):
            frac = i / (len(bands) - 1)
            rt = rt_low * (1.0 - frac) + rt_high * frac
            band = fft_shape(noise, bp_curve(lo, hi, 2.0))
            acc += band * np.exp(-6.9078 * t / max(rt, 0.05))
        # Phòng thật không đạt đỉnh năng lượng ngay mẫu đầu.
        acc *= 1.0 - np.exp(-t / 0.014)

        # Vài phản xạ sớm rời rạc: thứ cho tai biết kích thước không gian.
        for _ in range(9):
            d = int((predelay + rng.uniform(0.004, 0.075)) * SR)
            if d < n:
                acc[d] += rng.uniform(-0.55, 0.55)
        ir[:, ch] = acc

    pre = int(predelay * SR)
    if pre:
        ir = np.vstack([np.zeros((pre, 2)), ir[:-pre]])
    return ir / np.max(np.abs(ir))


def convolve_circular(buf: np.ndarray, ir: np.ndarray) -> np.ndarray:
    """Convolution vòng: đuôi vang quấn về đầu, giữ nguyên tính tuần hoàn."""
    n = buf.shape[0]
    padded = np.zeros((n, 2))
    m = min(ir.shape[0], n)
    padded[:m] = ir[:m]
    out = np.zeros_like(buf)
    for ch in range(2):
        out[:, ch] = np.fft.irfft(np.fft.rfft(buf[:, ch]) * np.fft.rfft(padded[:, ch]), n=n)
    return out / np.sqrt(SR)


# --------------------------------------------------------------------------
# Master
# --------------------------------------------------------------------------

def master(canvas: Canvas, ir: np.ndarray, wet_gain: float, eq=None,
           drive: float = 1.0, hp: float = 48.0, hp_order: float = 2.5) -> np.ndarray:
    """Cat thap manh tay la co y: dien thoai khong tai duoc duoi ~150Hz, con
    chuan hoa ve -24 LUFS thi moi joule doi xuong vung khong nghe duoc deu
    keo phan nghe duoc tut theo."""
    mix = canvas.dry + convolve_circular(canvas.wet, ir) * wet_gain
    curves = [hp_curve(hp, hp_order)]
    if eq is not None:
        curves.append(eq)
    mix = fft_shape(mix, chain(*curves))
    if drive != 1.0:
        mix = np.tanh(mix * drive) / drive
    return mix


def loudness(x: np.ndarray) -> float:
    import pyloudnorm
    return pyloudnorm.Meter(SR).integrated_loudness(x)


def true_peak_db(x: np.ndarray) -> float:
    up = resample_poly(x, 4, 1, axis=0)
    return 20.0 * np.log10(max(np.max(np.abs(up)), 1e-12))


def normalise(x: np.ndarray, target_lufs: float, ceiling_db: float = -2.0) -> np.ndarray:
    """Đưa về mức LUFS mục tiêu, rồi hạ tiếp nếu true peak vượt trần."""
    x = x * 10.0 ** ((target_lufs - loudness(x)) / 20.0)
    tp = true_peak_db(x)
    if tp > ceiling_db:
        x = x * 10.0 ** ((ceiling_db - tp) / 20.0)
    return x


# --------------------------------------------------------------------------
# Xuất file
# --------------------------------------------------------------------------

def with_padding(loop: np.ndarray) -> np.ndarray:
    """Bọc 0.5s đệm hai đầu bằng chính phần quấn vòng của đoạn lặp.

    Đệm không phải im lặng mà là phần nối tiếp tuần hoàn, nên cả file là một
    tín hiệu liên tục: bộ mã hoá mp3 không thấy điểm gãy nào ở mốc 0.5s, và
    độ trễ mã hoá có dịch file đi bao nhiêu cũng không phá vòng lặp.
    """
    pad = int(PAD_SEC * SR)
    return np.vstack([loop[-pad:], loop, loop[:pad]])


def to_int16(x: np.ndarray, seed: int = 1) -> np.ndarray:
    rng = np.random.default_rng(seed)
    tpdf = (rng.random(x.shape) - rng.random(x.shape)) / 32768.0
    y = np.clip(x + tpdf, -1.0, 1.0)
    return (y * 32767.0).astype(np.int16)


def write_wav(path: str, x: np.ndarray) -> None:
    from scipy.io import wavfile
    wavfile.write(path, SR, to_int16(x))


def decode_mp3(path: str) -> np.ndarray:
    import miniaudio
    dec = miniaudio.decode_file(path, output_format=miniaudio.SampleFormat.FLOAT32,
                                nchannels=2, sample_rate=SR)
    return np.array(dec.samples, dtype=np.float64).reshape(-1, 2)


def write_mp3(path: str, x: np.ndarray, bitrate: int = 128) -> None:
    import lameenc
    enc = lameenc.Encoder()
    enc.set_bit_rate(bitrate)
    enc.set_in_sample_rate(SR)
    enc.set_channels(2)
    enc.set_quality(2)
    pcm = to_int16(x).tobytes()
    data = enc.encode(pcm) + enc.flush()
    with open(path, "wb") as fh:
        fh.write(data)
