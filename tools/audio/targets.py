"""Mục tiêu master của bộ nhạc nền — hằng số dùng chung, không kèm logic.

Tách riêng vì hai phía cần đúng cùng một con số nhưng không được phụ thuộc
vào nhau: `build_music.py` *đặt* mức này khi dựng asset, `verify_music.py`
*kiểm* lại mức đó trên chính file mp3 đã encode. Nếu hằng số nằm trong script
dựng thì bộ kiểm chứng không chạy được nếu thiếu script dựng — và script dựng
là thứ có thể bị thay khi đổi nguồn nhạc.

Ba mức nằm trong khoảng -27..-25 LUFS: nhạc nền phải chìm dưới hiệu ứng chứ
không tranh chỗ với nó. `vote` được để cao hơn hai track kia đúng 1.0 LU để
pha bỏ phiếu có thêm sức ép mà không phải đổi mix.
"""

from __future__ import annotations

# LUFS tích hợp (ITU-R BS.1770) đo trên đúng một vòng lặp.
TARGET_LUFS = {"night": -26.5, "day": -26.5, "vote": -25.5}

# Trần true peak khi chuẩn hoá, dBTP. Bỏ xa mức 0 để mp3 và bộ resample của
# thiết bị không đẩy đỉnh qua điểm cắt.
TRUE_PEAK_CEILING = -3.0

# Bitrate CBR của mp3 xuất ra.
BITRATE_KBPS = 160
