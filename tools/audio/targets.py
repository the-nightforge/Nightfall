"""Mục tiêu master của nhạc nền — hằng số dùng chung, không kèm logic.

Tách riêng vì hai phía cần đúng cùng một con số nhưng không được phụ thuộc
vào nhau: `build_music.py` *đặt* mức này khi dựng asset, `verify_music.py`
*kiểm* lại mức đó trên chính file mp3 đã encode. Nếu hằng số nằm trong script
dựng thì bộ kiểm chứng không chạy được nếu thiếu script dựng — và script dựng
là thứ có thể bị thay khi đổi nguồn nhạc.

Từ 2026-08-31 chỉ còn MỘT track chạy suốt ván (LOBBY → CHECK_WIN). Trước đó có
ba track đổi theo pha; mỗi lần đổi pha là một lần crossfade, và ba file nhạc là
gần 4 MiB người chơi phải tải. Một track duy nhất bỏ được cả hai thứ đó.
"""

from __future__ import annotations

# Tên track duy nhất và tên file asset của nó. Hai thứ tách nhau vì tên track
# là khoá trong loop-points.json/music-sources.json còn tên file là đường dẫn
# công khai mà trình duyệt tải.
TRACK = "theme"
ASSET_FILE = "werewolf-theme.mp3"

# LUFS tích hợp (ITU-R BS.1770) đo trên đúng một vòng lặp.
TARGET_LUFS = {TRACK: -27.0}

# Cửa sổ thiết kế: nhạc nền phải chìm dưới voice chat và hiệu ứng. Mục tiêu nằm
# giữa cửa sổ để sai số của bộ mã hoá mp3 không đẩy nó ra ngoài.
LUFS_WINDOW = (-28.0, -26.0)

# Trần true peak khi chuẩn hoá, dBTP. Bỏ xa mức 0 để mp3 và bộ resample của
# thiết bị không đẩy đỉnh qua điểm cắt.
TRUE_PEAK_CEILING = -3.0

# Nguồn là bản MP3 đã qua một lần mã hoá lossy (YouTube), phổ tắt hẳn trên
# 16kHz và không có nhiễu băng rộng như bản thu thực địa trước đây. 192kbps
# giữ sai số tuần hoàn dưới -20dB mà file nhỏ hơn hẳn mức 256kbps của bộ cũ.
BITRATE_KBPS = 192
