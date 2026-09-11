"""In được tiếng Việt trên console Windows mặc định (cp1252).

Console Windows không phải UTF-8, còn mọi thông báo ở tầng train là tiếng Việt:
không có đoạn này thì một lần train 30 phút chạy hết vòng lặp rồi crash ở dòng
báo kết quả cuối (UnicodeEncodeError) — exit code ≠ 0, và `rl_loop` coi bước đó
là chưa xong. `reconfigure` chỉ có trên TextIOWrapper; khi stdout đã bị thay
(pytest capsys, pipe cấu hình sẵn, pythonw) thì bỏ qua — PYTHONUTF8 của rl_loop
và của docs là lớp dự phòng phía sau.
"""

from __future__ import annotations

import sys


def force_utf8_console() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError, OSError):
            pass
