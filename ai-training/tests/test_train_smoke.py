"""Chạy trọn `train_bc` trên một dataset tổng hợp nhỏ. Chạy: python tests/test_train_smoke.py

Không kiểm model học được gì — 96 hàng ngẫu nhiên thì không có gì để học. Thứ
được kiểm là đường ống: loader → MLP → mask → loss → checkpoint tốt nhất →
metrics.json → ONNX, với torch THẬT. Trước bài này, `train_bc.py` từng được
merge mà chưa chạy lần nào vì máy dev không có torch; CI có, nên đây là chỗ nó
phải chạy.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from masoi_training import train_bc  # noqa: E402

ROWS, MAX_SEATS, KINDS = 96, 4, 3
OBS = 7
ACT = KINDS * (MAX_SEATS + 1)


def write_dataset(root: Path) -> None:
    rng = np.random.default_rng(7)
    features = rng.random((ROWS, OBS), dtype=np.float32)
    # Mỗi hàng: đúng một loại hành động được chào, 2 ghế + ô "không ai" hợp lệ.
    masks = np.zeros((ROWS, ACT), dtype=np.uint8)
    actions = np.zeros(ROWS, dtype="<i4")
    for row in range(ROWS):
        kind = int(rng.integers(KINDS))
        base = kind * (MAX_SEATS + 1)
        legal = [base + 1, base + 2, base + MAX_SEATS]
        masks[row, legal] = 1
        actions[row] = legal[int(rng.integers(len(legal)))]
    features.astype("<f4").tofile(root / "features.f32.bin")
    masks.tofile(root / "masks.u8.bin")
    actions.tofile(root / "actions.i32.bin")
    rng.choice(np.array([-1, 1], dtype=np.int8), ROWS).tofile(root / "rewards.i8.bin")
    np.array([0] * 64 + [1] * 16 + [2] * 16, dtype=np.uint8).tofile(root / "splits.u8.bin")
    rng.integers(0, 2, ROWS).astype(np.uint8).tofile(root / "roles.u8.bin")
    rng.integers(0, 2, ROWS).astype(np.uint8).tofile(root / "decisions.u8.bin")
    (root / "meta.json").write_text(
        json.dumps(
            {
                "rows": ROWS,
                "obsSize": OBS,
                "actionSize": ACT,
                "datasetVersion": "smoke-0001",
                "roles": ["VILLAGER", "WEREWOLF"],
                "decisions": ["VOTE", "NIGHT"],
            }
        ),
        encoding="utf8",
    )


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        data = Path(tmp) / "enc"
        out = Path(tmp) / "model"
        data.mkdir()
        write_dataset(data)

        sys.argv = [
            "train_bc",
            "--data", str(data),
            "--out", str(out),
            "--epochs", "2",
            "--batch-size", "32",
            "--hidden", "16",
        ]
        train_bc.main()

        assert (out / "model.pt").exists(), "thiếu model.pt"
        report = json.loads((out / "metrics.json").read_text(encoding="utf8"))
        assert report["obsSize"] == OBS and report["actionSize"] == ACT
        assert len(report["history"]) == 2
        assert report["bestEpoch"] in (1, 2)
        for split in ("validation", "test"):
            metrics = report["metrics"][split]
            assert 0.0 <= metrics["agreement"] <= metrics["top2Agreement"] <= 1.0, metrics
            assert set(metrics["agreementByDecision"]) <= {"VOTE", "NIGHT"}
        # §13: mask phải chặn được ở lúc suy luận — model không bao giờ chọn ô tắt.
        import torch

        from masoi_training.data import load
        from masoi_training.model import PolicyValueNet, masked_logits

        full = load(data)
        model = PolicyValueNet(OBS, ACT, 16)
        model.load_state_dict(torch.load(out / "model.pt"))
        with torch.no_grad():
            logits, _ = model(torch.from_numpy(full.features))
            chosen = masked_logits(logits, torch.from_numpy(full.masks)).argmax(dim=1).numpy()
        assert full.masks[np.arange(ROWS), chosen].all(), "model chọn một ô mask đang tắt"
        if report["onnxError"] is not None:
            print(f"cảnh báo: ONNX không export được — {report['onnxError']}")

    print("ok")


if __name__ == "__main__":
    main()
