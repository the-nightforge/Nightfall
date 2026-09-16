"""P0-4: ECE calibration trong train_bc.evaluate. Chạy: python tests/test_metrics_p0.py

ECE =(sum) |acc − conf| theo bin: model báo 90% mà chỉ đúng 60% là quá tự tin —
agreement cao nhưng calibration tệ sẽ làm PPO sampling (T=1) lệch.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from masoi_training import train_bc  # noqa: E402
from masoi_training.data import load  # noqa: E402
from masoi_training.model import PolicyValueNet  # noqa: E402


def test_ece_exact() -> None:
    ece = train_bc.expected_calibration_error
    # Hoàn hảo: luôn đúng với conf 1.0.
    assert ece(np.ones(10), np.ones(10)) == 0.0
    # Conf 1.0 nhưng đúng một nửa → 0.5.
    conf = np.ones(10)
    assert abs(ece(conf, np.array([1, 0] * 5)) - 0.5) < 1e-9
    # Hai bin đối xứng: bin cao (conf 1.0, acc 0.5) + bin thấp (conf 0.0, acc 0.5).
    conf2 = np.array([1.0, 1.0, 0.0, 0.0])
    assert abs(ece(conf2, np.array([1, 0, 1, 0])) - 0.5) < 1e-9
    # Rỗng → 0, không NaN.
    assert ece(np.array([]), np.array([])) == 0.0


def test_evaluate_reports_ece() -> None:
    rng = np.random.default_rng(3)
    rows, obs, act = 32, 7, 9
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        rng.random((rows, obs)).astype("<f4").tofile(root / "features.f32.bin")
        masks = np.zeros((rows, act), dtype=np.uint8)
        masks[:, :3] = 1
        masks.tofile(root / "masks.u8.bin")
        rng.integers(0, 3, rows).astype("<i4").tofile(root / "actions.i32.bin")
        rng.choice(np.array([-1, 1], dtype=np.int8), rows).tofile(root / "rewards.i8.bin")
        np.zeros(rows, np.uint8).tofile(root / "splits.u8.bin")
        rng.integers(0, 2, rows).astype(np.uint8).tofile(root / "roles.u8.bin")
        rng.integers(0, 2, rows).astype(np.uint8).tofile(root / "decisions.u8.bin")
        (root / "meta.json").write_text(
            json.dumps(
                {
                    "rows": rows, "obsSize": obs, "actionSize": act,
                    "roles": ["VILLAGER", "WEREWOLF"], "decisions": ["VOTE", "NIGHT"],
                }
            ),
            encoding="utf8",
        )
        data = load(root)
    torch.manual_seed(0)
    model = PolicyValueNet(obs, act, 8).eval()
    rep = train_bc.evaluate(model, data, torch.device("cpu"))
    assert 0.0 <= rep["ece"] <= 1.0, rep.get("ece")
    assert set(rep["eceByDecision"]) <= {"VOTE", "NIGHT"}, rep.get("eceByDecision")
    for v in rep["eceByDecision"].values():
        assert 0.0 <= v <= 1.0, v


def main() -> None:
    test_ece_exact()
    test_evaluate_reports_ece()
    print("ok")


if __name__ == "__main__":
    main()
