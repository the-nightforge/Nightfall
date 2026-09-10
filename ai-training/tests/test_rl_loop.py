"""Cổng thăng hạng: một điểm cao trên MỘT bộ seed không đủ. Chạy: python tests/test_rl_loop.py

Vì sao có bài kiểm này: 2026-09-10, challenger `--side wolves` đạt +4,7 ± 1,9 trên
seed `rl-bench` và được thăng hạng, nhưng trên seed `rl-conf` chính nó cho −3,2 ± 1,8.
Sai số chuẩn in ra từ 3 seed tự nó quá nhiễu để tin (chi-square 2 bậc tự do), nên
cổng phải đòi CẢ HAI bộ seed cùng vượt ngưỡng.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rl_loop import score_of, should_promote  # noqa: E402


def main() -> None:
    # Cả hai bộ vượt ngưỡng → thăng hạng.
    assert should_promote([4.7, 3.1], champion=0.0, margin=2.0)
    # Bộ xác nhận lật dấu → KHÔNG thăng hạng, dù bộ chính rất cao.
    assert not should_promote([4.7, -3.2], champion=0.0, margin=2.0)
    # Bộ xác nhận dương nhưng dưới ngưỡng → vẫn không.
    assert not should_promote([4.7, 1.9], champion=0.0, margin=2.0)
    # Champion đang dương thì ngưỡng dịch theo.
    assert not should_promote([4.7, 4.7], champion=3.0, margin=2.0)
    assert should_promote([5.1, 5.2], champion=3.0, margin=2.0)
    # Danh sách rỗng không bao giờ thăng hạng.
    assert not should_promote([], champion=0.0, margin=2.0)

    # `score_of` đọc theo TÊN cấu hình và theo phe đang train.
    import json
    import tempfile

    bench = {
        "summary": [
            {"setup": "baseline", "villageWinMean": 0.55},
            {"setup": "village", "villageWinMean": 0.60},
            {"setup": "wolves", "villageWinMean": 0.50},
        ]
    }
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "b.json"
        p.write_text(json.dumps(bench), encoding="utf8")
        assert abs(score_of(p, "village") - 5.0) < 1e-9, score_of(p, "village")
        assert abs(score_of(p, "wolves") - 5.0) < 1e-9, score_of(p, "wolves")
        assert abs(score_of(p, "all") - 5.0) < 1e-9, score_of(p, "all")
        bench["summary"][2]["villageWinMean"] = 0.58
        p.write_text(json.dumps(bench), encoding="utf8")
        # sói yếu đi (làng thắng nhiều hơn) → điểm phe sói ÂM, phe làng không đổi.
        assert abs(score_of(p, "wolves") + 3.0) < 1e-9, score_of(p, "wolves")
        assert abs(score_of(p, "village") - 5.0) < 1e-9, score_of(p, "village")

    print("ok")


if __name__ == "__main__":
    main()
