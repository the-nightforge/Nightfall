"""Mục tiêu master của bộ nhạc nền — hằng số dùng chung, không kèm logic.

Tách riêng vì hai phía cần đúng cùng một con số nhưng không được phụ thuộc
vào nhau: `build_music.py` *đặt* mức này khi dựng asset, `verify_music.py`
*kiểm* lại mức đó trên chính file mp3 đã encode. Nếu hằng số nằm trong script
dựng thì bộ kiểm chứng không chạy được nếu thiếu script dựng — và script dựng
là thứ có thể bị thay khi đổi nguồn nhạc.

Ba mức nằm trong khoảng -28..-27 LUFS: nhạc nền phải chìm dưới hiệu ứng chứ
không tranh chỗ với nó. `vote` được để cao hơn hai track kia đúng 1.0 LU để
pha bỏ phiếu có thêm sức ép mà không phải đổi mix.
"""

from __future__ import annotations

# LUFS tích hợp (ITU-R BS.1770) đo trên đúng một vòng lặp.
TARGET_LUFS = {"night": -28.0, "day": -28.0, "vote": -27.0}

# Trần true peak khi chuẩn hoá, dBTP. Bỏ xa mức 0 để mp3 và bộ resample của
# thiết bị không đẩy đỉnh qua điểm cắt.
TRUE_PEAK_CEILING = -3.0

# Bản thu môi trường có nhiều nhiễu rộng (côn trùng, gió), 160kbps làm hai
# chu kỳ giống nhau bị lượng tử hoá khác nhau đủ để bộ kiểm seam bắt lỗi.
# 256kbps giữ sai số tuần hoàn dưới -20dB mà cả thư mục vẫn dưới 6MiB.
BITRATE_KBPS = 256
