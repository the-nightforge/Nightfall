"""Cỡ bàn theo dòng (spec 2026-09-22 D3): đọc, gom nhóm, xuất ra file model.

Chạy: python tests/test_table_sizes.py
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from masoi_training.data import load  # noqa: E402
from masoi_training.train_bc import by_table_size  # noqa: E402
from test_data import write_dataset  # noqa: E402


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        write_dataset(root)
        assert load(root).table_sizes is None  # dataset cũ: không bịa cột

        np.array([8, 8, 10, 10, 12, 12], dtype=np.uint8).tofile(root / "tableSize.u8.bin")
        data = load(root)
        assert data.table_sizes.tolist() == [8, 8, 10, 10, 12, 12]
        kept = data.where(np.array([True, False, True, False, True, False]))
        assert kept.table_sizes.tolist() == [8, 10, 12]

        np.array([8, 8], dtype=np.uint8).tofile(root / "tableSize.u8.bin")
        try:
            load(root)
            raise AssertionError("file cỡ bàn cụt phải ném")
        except ValueError as error:
            assert "table" in str(error).lower(), error

    hits = np.array([1, 0, 1, 1, 0, 0], dtype=float)
    sizes = np.array([8, 8, 10, 10, 12, 12], dtype=np.uint8)
    assert by_table_size(hits, sizes) == {"8": 0.5, "10": 1.0, "12": 0.0}
    assert by_table_size(hits, None) is None

    from masoi_training.export import export_weights_json  # noqa: E402
    from masoi_training.model import PolicyValueNet  # noqa: E402
    from test_export_v2 import ACT, HIDDEN, META, OBS  # noqa: E402

    def build_model():  # test_export_v2.py không có build_model: dựng y như file đó
        import torch

        torch.manual_seed(5)
        return PolicyValueNet(OBS, ACT, HIDDEN)

    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "w.json"
        export_weights_json(build_model(), {**META, "tableSizes": [8, 10]}, out, model_id="t", training_seed=0, hidden=HIDDEN)
        assert json.loads(out.read_text(encoding="utf8"))["tableSizes"] == [8, 10]
        export_weights_json(build_model(), META, out, model_id="t", training_seed=0, hidden=HIDDEN)
        assert "tableSizes" not in json.loads(out.read_text(encoding="utf8"))

    print("ok")


if __name__ == "__main__":
    main()
