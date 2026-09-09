"""Một update PPO trên dữ liệu tổng hợp: loss giảm, mask được tôn trọng, ratio ban đầu = 1.

Bài kiểm quan trọng nhất ở đây là `approxKl` của batch ĐẦU TIÊN. PPO chỉ đúng
khi `ratio = exp(logp_mới − logp_cũ)` bắt đầu ở 1: nếu init lệch policy đã sinh
ra rollout (nạp sai trọng số, mask khác, log-softmax trên logits chưa che), ratio
bắt đầu ở một chỗ tuỳ tiện và clip cắt nhầm — loss vẫn giảm, và model vẫn học
sai trong im lặng.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from masoi_training import train_ppo  # noqa: E402
from masoi_training.export import export_weights_json  # noqa: E402
from masoi_training.model import PolicyValueNet, masked_logits  # noqa: E402

ROWS, OBS, ACT = 256, 6, 9


def main() -> None:
    torch.manual_seed(0)
    rng = np.random.default_rng(0)
    init = PolicyValueNet(OBS, ACT, 8).eval()
    feats = rng.random((ROWS, OBS), dtype=np.float32)
    masks = np.zeros((ROWS, ACT), dtype=np.uint8)
    masks[:, :4] = 1
    with torch.no_grad():
        lg, val = init(torch.from_numpy(feats))
        lp = torch.log_softmax(masked_logits(lg, torch.from_numpy(masks.astype(bool))), 1)
    actions = torch.distributions.Categorical(logits=lp).sample().numpy().astype("<i4")
    logprobs = lp[np.arange(ROWS), actions].numpy().astype("<f4")
    rewards = np.where(actions == 0, 1, -1).astype(np.int8)  # hành động 0 luôn thắng

    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp) / "enc"
        d.mkdir()
        feats.astype("<f4").tofile(d / "features.f32.bin")
        masks.tofile(d / "masks.u8.bin")
        actions.tofile(d / "actions.i32.bin")
        rewards.tofile(d / "rewards.i8.bin")
        np.zeros(ROWS, np.uint8).tofile(d / "splits.u8.bin")
        np.zeros(ROWS, np.uint8).tofile(d / "roles.u8.bin")
        np.zeros(ROWS, np.uint8).tofile(d / "decisions.u8.bin")
        logprobs.tofile(d / "logprobs.f32.bin")
        val.numpy().astype("<f4").tofile(d / "values.f32.bin")
        meta = {
            "rows": ROWS,
            "obsSize": OBS,
            "actionSize": ACT,
            "datasetVersion": "rollout-test",
            "roles": ["A"],
            "decisions": ["VOTE"],
            "featureNames": [f"f{i}" for i in range(OBS)],
            "actionNames": [f"a{i}" for i in range(ACT)],
        }
        (d / "meta.json").write_text(json.dumps(meta), encoding="utf8")
        initp = Path(tmp) / "init.weights.json"
        export_weights_json(init, meta, initp, model_id="init", training_seed=0, hidden=8)

        out = Path(tmp) / "out"
        sys.argv = [
            "train_ppo",
            "--data", str(d),
            "--init", str(initp),
            "--out", str(out),
            "--epochs", "8",
            "--batch-size", "64",
            "--model-id", "t",
        ]
        train_ppo.main()

        m = json.loads((out / "metrics.json").read_text(encoding="utf8"))
        assert m["history"][0]["approxKl"] < 1e-4, ("ratio ban đầu phải ≈ 1", m["history"][0])
        assert m["history"][-1]["policyLoss"] < m["history"][0]["policyLoss"], m["history"]

        # Sau update, xác suất hành động 0 (luôn thắng) phải tăng.
        new = PolicyValueNet(OBS, ACT, 8)
        new.load_state_dict(torch.load(out / "model.pt"))
        new.eval()
        with torch.no_grad():
            logits, _ = new(torch.from_numpy(feats))
            probs = torch.softmax(masked_logits(logits, torch.from_numpy(masks.astype(bool))), 1)
            p0 = probs[:, 0].mean()
            q0 = torch.softmax(lp, 1)[:, 0].mean()
            # §13: ô bị che phải giữ xác suất 0, kể cả sau khi gradient đi qua.
            assert float(probs[:, 4:].max()) < 1e-6, float(probs[:, 4:].max())
        assert p0 > q0, (p0, q0)
        assert (out / "model.weights.json").exists()

    print("ok")


if __name__ == "__main__":
    main()
