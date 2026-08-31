"""Đo độ to, chuẩn hoá, đệm vòng lặp và xuất file.

Điểm cốt lõi của `with_padding`: bộ đệm dài đúng N mẫu *là* một tín hiệu tuần
hoàn chu kỳ N, nên phần đệm hai đầu file được lấy từ chính đoạn quấn vòng chứ
không phải im lặng. Nhờ vậy cả file mp3 là một tín hiệu liên tục, bộ mã hoá
không thấy điểm gãy nào, và độ trễ mã hoá có dịch file đi vài chục mili giây
cũng không phá vòng lặp.

Trước đây file này còn chứa bàn trộn `Canvas`, bộ dựng đáp ứng xung và hàm
`master` phục vụ script dựng nhạc procedural. Bộ nhạc hiện tại là tác phẩm
của bên thứ ba nên script đó đã bị gỡ cùng các phần chỉ nó dùng.
"""

from __future__ import annotations

import numpy as np
from scipy.signal import resample_poly

from dsp import SR

PAD_SEC = 0.5


# --------------------------------------------------------------------------
# Đo đạc
# --------------------------------------------------------------------------

def loudness(x: np.ndarray) -> float:
    """LUFS tích hợp theo ITU-R BS.1770."""
    import pyloudnorm
    return pyloudnorm.Meter(SR).integrated_loudness(x)


def true_peak_db(x: np.ndarray) -> float:
    """Đỉnh liên tục ước lượng bằng cách nội suy gấp 4 lần tần số lấy mẫu."""
    up = resample_poly(x, 4, 1, axis=0)
    return 20.0 * np.log10(max(np.max(np.abs(up)), 1e-12))


def normalise(x: np.ndarray, target_lufs: float, ceiling_db: float = -3.0) -> np.ndarray:
    """Đưa về mức LUFS mục tiêu, rồi hạ tiếp nếu true peak vượt trần.

    Chỉ nhân với một hệ số - không nén, không limiter. Nhạc nền bị nén mạnh là
    thứ nghe mười phút thì mệt tai, và ở mức -26 LUFS thì cũng không có gì để
    limiter phải xử lý.
    """
    x = x * 10.0 ** ((target_lufs - loudness(x)) / 20.0)
    tp = true_peak_db(x)
    if tp > ceiling_db:
        x = x * 10.0 ** ((ceiling_db - tp) / 20.0)
    return x


# --------------------------------------------------------------------------
# Xuất file
# --------------------------------------------------------------------------

def with_padding(loop: np.ndarray) -> np.ndarray:
    """Bọc 0.5s đệm hai đầu bằng chính phần quấn vòng của đoạn lặp."""
    pad = int(PAD_SEC * SR)
    return np.vstack([loop[-pad:], loop, loop[:pad]])


def to_int16(x: np.ndarray, seed: int = 1) -> np.ndarray:
    rng = np.random.default_rng(seed)
    tpdf = (rng.random(x.shape) - rng.random(x.shape)) / 32768.0
    y = np.clip(x + tpdf, -1.0, 1.0)
    return (y * 32767.0).astype(np.int16)


def decode_mp3(path: str) -> np.ndarray:
    import miniaudio
    dec = miniaudio.decode_file(path, output_format=miniaudio.SampleFormat.FLOAT32,
                                nchannels=2, sample_rate=SR)
    return np.array(dec.samples, dtype=np.float64).reshape(-1, 2)


def write_mp3(path: str, x: np.ndarray, bitrate: int = 160) -> None:
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
