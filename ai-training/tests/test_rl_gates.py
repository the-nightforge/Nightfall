"""Cổng thăng hạng mới (spec 2026-09-17 D3/D4). Chạy: python tests/test_rl_gates.py

Model logits thuần là MỘT bộ trọng số cho cả hai phe: train cho làng có thể
kéo sói xuống, và một model mạnh lên có thể đẩy cả bàn lệch khỏi 50 %. Hai cổng
này chặn đúng hai kiểu thăng hạng đó.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rl_loop import (  # noqa: E402
    BenchRead,
    champion_of,
    imbalance_of,
    passes_gates,
    read_bench,
)


def write_bench(path: Path, baseline: float, village: float, wolves: float, all_: float | None) -> Path:
    summary = [
        {"setup": "baseline", "villageWinMean": baseline},
        {"setup": "village", "villageWinMean": village},
        {"setup": "wolves", "villageWinMean": wolves},
    ]
    if all_ is not None:
        summary.append({"setup": "all", "villageWinMean": all_})
    path.write_text(json.dumps({"summary": summary}), encoding="utf8")
    return path


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)

        # imbalance đọc cấu hình `all`, theo điểm phần trăm, đối xứng quanh 50 %.
        b = write_bench(root / "a.json", 0.54, 0.56, 0.54, 0.558)
        assert abs(imbalance_of(b) - 5.8) < 1e-9, imbalance_of(b)
        b2 = write_bench(root / "b.json", 0.54, 0.56, 0.54, 0.44)
        assert abs(imbalance_of(b2) - 6.0) < 1e-9, imbalance_of(b2)

        # Thiếu `all` → ném, không trả 0 im lặng.
        missing = write_bench(root / "c.json", 0.54, 0.56, 0.54, None)
        try:
            imbalance_of(missing)
        except ValueError as error:
            assert "all" in str(error)
        else:
            raise AssertionError("imbalance_of phải ném khi thiếu cấu hình all")

        # read_bench: village → other là điểm phe sói; all → other None.
        r = read_bench(b, "village")
        assert abs(r.score - 2.0) < 1e-9 and r.other is not None and abs(r.other - 0.0) < 1e-9, r
        assert read_bench(b, "all").other is None

    champ = BenchRead(score=0.0, other=0.0, imbalance=5.8)

    # Qua cả ba cổng.
    good = [BenchRead(3.0, -0.5, 6.5), BenchRead(2.5, 0.2, 6.0)]
    assert passes_gates(good, champ, margin=2.0, balance_slack=1.0, other_slack=1.0)

    # Điểm không đủ trên bộ xác nhận → chặn (cổng cũ vẫn đứng đầu).
    assert not passes_gates([BenchRead(3.0, 0.0, 5.0), BenchRead(1.9, 0.0, 5.0)], champ, 2.0, 1.0, 1.0)

    # Lệch cân bằng vượt champion + slack trên MỘT bộ seed → chặn.
    assert not passes_gates([BenchRead(3.0, 0.0, 6.9), BenchRead(3.0, 0.0, 5.0)], champ, 2.0, 1.0, 1.0)
    # Slack âm = tắt cổng cân bằng.
    assert passes_gates([BenchRead(3.0, 0.0, 30.0)], champ, 2.0, -1.0, 1.0)

    # Phe kia tụt quá slack → chặn; đúng bằng slack → qua.
    assert not passes_gates([BenchRead(3.0, -1.1, 5.0)], champ, 2.0, 1.0, 1.0)
    assert passes_gates([BenchRead(3.0, -1.0, 5.0)], champ, 2.0, 1.0, 1.0)
    # Slack âm = tắt cổng phe kia.
    assert passes_gates([BenchRead(3.0, -9.0, 5.0)], champ, 2.0, 1.0, -1.0)
    # --side all: champion.other None → bỏ qua cổng phe kia.
    assert passes_gates([BenchRead(3.0, None, 5.0)], BenchRead(0.0, None, 5.8), 2.0, 1.0, 1.0)

    # Champion mới lấy chiều bi quan trên mọi bộ seed.
    new = champion_of([BenchRead(3.0, -0.5, 6.5), BenchRead(2.5, 0.2, 6.0)])
    assert new == BenchRead(2.5, -0.5, 6.5), new
    assert champion_of([BenchRead(3.0, None, 6.5)]).other is None

    print("ok")


if __name__ == "__main__":
    main()
