"""PPO từ init masoi-mlp-2 (silu + layernorm + value trunk riêng). Chạy: python tests/test_ppo_mlp2.py

Vì sao có bài kiểm này: 2026-09-17, pilot RL từ `village-bc-0002` chạy hết 4 epoch
rồi crash ở bước đo `agreementWithInit` — model tham chiếu được dựng bằng cấu hình
MẶC ĐỊNH (relu/none/shared) nên không nạp được state của model mlp-2. Mọi test PPO
cũ đều dùng cấu hình mặc định, nên lỗi chỉ lộ ra sau khi rollout đã tốn thời gian.
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

ROWS, OBS, ACT, HIDDEN = 128, 6, 9, 8


def main() -> None:
    torch.manual_seed(0)
    rng = np.random.default_rng(0)
    init = PolicyValueNet(
        OBS, ACT, HIDDEN, activation="silu", norm="layernorm", value_trunk="separate"
    ).eval()
    feats = rng.random((ROWS, OBS), dtype=np.float32)
    masks = np.zeros((ROWS, ACT), dtype=np.uint8)
    masks[:, :4] = 1
    with torch.no_grad():
        lg, val = init(torch.from_numpy(feats))
        lp = torch.log_softmax(masked_logits(lg, torch.from_numpy(masks.astype(bool))), 1)
    actions = torch.distributions.Categorical(logits=lp).sample().numpy().astype("<i4")

    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp) / "enc"
        d.mkdir()
        feats.astype("<f4").tofile(d / "features.f32.bin")
        masks.tofile(d / "masks.u8.bin")
        actions.tofile(d / "actions.i32.bin")
        np.where(actions == 0, 1, -1).astype(np.int8).tofile(d / "rewards.i8.bin")
        np.zeros(ROWS, np.uint8).tofile(d / "splits.u8.bin")
        (np.arange(ROWS) % 2).astype(np.uint8).tofile(d / "roles.u8.bin")
        np.zeros(ROWS, np.uint8).tofile(d / "decisions.u8.bin")
        lp[np.arange(ROWS), actions].numpy().astype("<f4").tofile(d / "logprobs.f32.bin")
        val.numpy().astype("<f4").tofile(d / "values.f32.bin")
        meta = {
            "rows": ROWS,
            "obsSize": OBS,
            "actionSize": ACT,
            "datasetVersion": "rollout-test",
            "roles": ["A", "B"],
            "decisions": ["VOTE"],
            "featureNames": [f"f{i}" for i in range(OBS)],
            "actionNames": [f"a{i}" for i in range(ACT)],
        }
        (d / "meta.json").write_text(json.dumps(meta), encoding="utf8")
        initp = Path(tmp) / "init.weights.json"
        export_weights_json(init, meta, initp, model_id="init", training_seed=0, hidden=HIDDEN)
        assert json.loads(initp.read_text(encoding="utf8"))["format"] == "masoi-mlp-2"
        # Init nạp đúng → logits/value trùng hẳn model gốc, tức ratio ban đầu = 1.
        # So trực tiếp thay vì đọc approxKl epoch 1: đó là trung bình CẢ epoch,
        # gồm các batch chạy sau khi trọng số đã đổi.
        loaded, _, _ = train_ppo.load_init(initp, OBS, ACT)
        loaded.eval()
        with torch.no_grad():
            lg2, val2 = loaded(torch.from_numpy(feats))
        assert float((lg2 - lg).abs().max()) < 1e-6 and float((val2 - val).abs().max()) < 1e-6

        out = Path(tmp) / "out"
        sys.argv = [
            "train_ppo",
            "--data", str(d),
            "--init", str(initp),
            "--out", str(out),
            "--epochs", "2",
            "--batch-size", "64",
            "--model-id", "t",
            "--shaping-weight", "0",
        ]
        train_ppo.main()

        m = json.loads((out / "metrics.json").read_text(encoding="utf8"))
        # Hai epoch nhỏ không thể đảo phần lớn argmax; 0 ở đây là so với model khác.
        assert m["agreementWithInit"] > 0.5, m["agreementWithInit"]
        # Model xuất ra giữ nguyên kiến trúc của init.
        w = json.loads((out / "model.weights.json").read_text(encoding="utf8"))
        assert (w["format"], w["activation"], w["norm"], w["valueTrunk"]) == (
            "masoi-mlp-2", "silu", "layernorm", "separate"
        ), w["format"]

    print("ok")


if __name__ == "__main__":
    main()
