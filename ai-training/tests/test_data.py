"""Self-check cho `masoi_training.data`. Chạy: python tests/test_data.py

Không framework: assert là đủ, và một dependency thêm vào chỉ để chạy sáu câu
assert là một dependency phải bảo trì mãi mãi.

Thứ được kiểm là chỗ dễ hỏng nhất của một loader nhị phân: reshape. Một file
cụt một dòng vẫn reshape "thành công" nếu không ai đếm, và mọi nhãn sau đó lệch
đi một hàng — train vẫn chạy, loss vẫn giảm, và model học sai trong im lặng.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from masoi_training.data import action_distribution, load  # noqa: E402

ROWS, OBS, ACT = 6, 4, 3


def write_dataset(root: Path, *, truncate_features: bool = False) -> None:
    features = np.arange(ROWS * OBS, dtype="<f4")
    if truncate_features:
        features = features[:-1]
    features.tofile(root / "features.f32.bin")
    np.tile(np.array([1, 1, 0], dtype=np.uint8), ROWS).tofile(root / "masks.u8.bin")
    np.array([0, 1, 0, 1, 0, 1], dtype="<i4").tofile(root / "actions.i32.bin")
    np.array([1, -1, 1, -1, 1, -1], dtype=np.int8).tofile(root / "rewards.i8.bin")
    # 3 train, 2 validation, 1 test
    np.array([0, 0, 0, 1, 1, 2], dtype=np.uint8).tofile(root / "splits.u8.bin")
    np.array([0, 0, 1, 1, 2, 2], dtype=np.uint8).tofile(root / "roles.u8.bin")
    np.array([0, 1, 0, 1, 0, 1], dtype=np.uint8).tofile(root / "decisions.u8.bin")
    (root / "meta.json").write_text(
        json.dumps(
            {
                "rows": ROWS,
                "obsSize": OBS,
                "actionSize": ACT,
                "datasetVersion": "test-0001",
                "roles": ["VILLAGER", "WEREWOLF", "SEER"],
                "decisions": ["VOTE", "NIGHT"],
            }
        ),
        encoding="utf8",
    )


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        write_dataset(root)
        data = load(root)

        assert len(data) == ROWS
        assert data.features.shape == (ROWS, OBS)
        assert data.masks.shape == (ROWS, ACT)
        assert data.masks.dtype == bool
        assert data.features[1, 0] == 4.0, "reshape sai hàng"

        # §15: mỗi hàng thuộc đúng một phần, và ba phần cộng lại là cả tập.
        sizes = {name: len(data.split(name)) for name in ("train", "validation", "test")}
        assert sizes == {"train": 3, "validation": 2, "test": 1}, sizes
        assert sum(sizes.values()) == ROWS
        assert data.split("train").actions.tolist() == [0, 1, 0]
        assert data.split("validation").decisions.tolist() == [1, 0]

        assert action_distribution(data) == {0: 3, 1: 3}

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        write_dataset(root, truncate_features=True)
        try:
            load(root)
        except ValueError as error:
            assert "features" in str(error), error
        else:
            raise AssertionError("file cụt phải bị TỪ CHỐI, không được reshape lệch hàng")

    print("ok")


if __name__ == "__main__":
    main()
