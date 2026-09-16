"""P0-2: AdamW + cosine scheduler + grad-clip + patience cho train_bc.
Chạy: python tests/test_bc_p0.py

Mặc định (adam/none/clip 0/patience 0) giữ hành vi cũ byte-một.
"""

from __future__ import annotations

import json
import math
import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from masoi_training import train_bc  # noqa: E402

ROWS, OBS, ACT = 48, 7, 9


def write_dataset(root: Path) -> None:
    rng = np.random.default_rng(7)
    rng.random((ROWS, OBS)).astype("<f4").tofile(root / "features.f32.bin")
    masks = np.zeros((ROWS, ACT), dtype=np.uint8)
    masks[:, :3] = 1
    masks.tofile(root / "masks.u8.bin")
    rng.integers(0, 3, ROWS).astype("<i4").tofile(root / "actions.i32.bin")
    rng.choice(np.array([-1, 1], dtype=np.int8), ROWS).tofile(root / "rewards.i8.bin")
    np.array([0] * 32 + [1] * 8 + [2] * 8, dtype=np.uint8).tofile(root / "splits.u8.bin")
    rng.integers(0, 2, ROWS).astype(np.uint8).tofile(root / "roles.u8.bin")
    rng.integers(0, 2, ROWS).astype(np.uint8).tofile(root / "decisions.u8.bin")
    (root / "meta.json").write_text(
        json.dumps(
            {
                "rows": ROWS,
                "obsSize": OBS,
                "actionSize": ACT,
                "datasetVersion": "bc-p0",
                "roles": ["VILLAGER", "WEREWOLF"],
                "decisions": ["VOTE", "NIGHT"],
            }
        ),
        encoding="utf8",
    )


def test_cosine_factor_values() -> None:
    assert train_bc.lr_factor(1, 10, 2) == 0.5
    assert train_bc.lr_factor(2, 10, 2) == 1.0
    assert abs(train_bc.lr_factor(6, 10, 2) - 0.5) < 1e-9
    assert train_bc.lr_factor(10, 10, 2) == 0.0
    assert train_bc.lr_factor(3, 10, 0) == 0.5 * (1 + math.cos(math.pi * 3 / 10))


def test_new_flags_run_and_recorded() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        data, out = Path(tmp) / "enc", Path(tmp) / "model"
        data.mkdir()
        write_dataset(data)
        sys.argv = [
            "train_bc", "--data", str(data), "--out", str(out),
            "--epochs", "3", "--batch-size", "16", "--hidden", "8",
            "--optimizer", "adamw", "--weight-decay", "0.01",
            "--scheduler", "cosine", "--warmup-epochs", "1",
            "--grad-clip", "1.0", "--patience", "2",
        ]
        train_bc.main()
        assert (out / "model.pt").exists() and (out / "model.weights.json").exists()
        cfg = json.loads((out / "metrics.json").read_text(encoding="utf8"))["trainingConfig"]
        assert cfg["optimizer"] == "adamw" and cfg["weightDecay"] == 0.01
        assert cfg["scheduler"] == "cosine" and cfg["warmupEpochs"] == 1
        assert cfg["gradClip"] == 1.0 and cfg["patience"] == 2


def test_patience_stops_early_on_noise() -> None:
    """Dữ liệu ngẫu nhiên + patience 1: val không cải thiện liên tục được."""
    with tempfile.TemporaryDirectory() as tmp:
        data, out = Path(tmp) / "enc", Path(tmp) / "model"
        data.mkdir()
        write_dataset(data)
        sys.argv = [
            "train_bc", "--data", str(data), "--out", str(out),
            "--epochs", "10", "--batch-size", "16", "--hidden", "8", "--patience", "1",
        ]
        train_bc.main()
        report = json.loads((out / "metrics.json").read_text(encoding="utf8"))
        assert len(report["history"]) < 10, "patience=1 phải dừng sớm trên dữ liệu nhiễu"
        assert report["bestEpoch"] >= 1


def test_non_engine_config_rejected_fast() -> None:
    """Tên activation lạ: từ chối ngay khi parse, không train rồi mới rớt."""
    with tempfile.TemporaryDirectory() as tmp:
        data, out = Path(tmp) / "enc", Path(tmp) / "model"
        data.mkdir()
        write_dataset(data)
        sys.argv = [
            "train_bc", "--data", str(data), "--out", str(out),
            "--epochs", "1", "--activation", "gelu",
        ]
        try:
            train_bc.main()
        except ValueError:
            return
    raise AssertionError("--activation lạ phải bị từ chối trước khi train")


def test_silu_trains_and_exports_v2() -> None:
    """P1-1: silu train được và export ra masoi-mlp-2 (engine đã hỗ trợ)."""
    import json as _json

    with tempfile.TemporaryDirectory() as tmp:
        data, out = Path(tmp) / "enc", Path(tmp) / "model"
        data.mkdir()
        write_dataset(data)
        sys.argv = [
            "train_bc", "--data", str(data), "--out", str(out),
            "--epochs", "1", "--batch-size", "16", "--hidden", "8",
            "--activation", "silu",
        ]
        train_bc.main()
        w = _json.loads((out / "model.weights.json").read_text(encoding="utf8"))
        assert w["format"] == "masoi-mlp-2" and w["activation"] == "silu", w.get("format")


def main() -> None:
    test_cosine_factor_values()
    test_new_flags_run_and_recorded()
    test_patience_stops_early_on_noise()
    test_non_engine_config_rejected_fast()
    test_silu_trains_and_exports_v2()
    print("ok")


if __name__ == "__main__":
    main()
