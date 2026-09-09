"""export_weights_json phải cho forward pass numpy == torch. Chạy: python tests/test_export.py"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from masoi_training.model import PolicyValueNet  # noqa: E402
from masoi_training.export import export_weights_json  # noqa: E402


def np_forward(w: dict, x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    h = x
    for layer in w["layers"]:
        h = np.maximum(0.0, h @ np.array(layer["w"]).T + np.array(layer["b"]))
    logits = h @ np.array(w["policyHead"]["w"]).T + np.array(w["policyHead"]["b"])
    value = np.tanh(h @ np.array(w["valueHead"]["w"]).T + np.array(w["valueHead"]["b"]))
    return logits, value[..., 0]


def main() -> None:
    torch.manual_seed(1)
    obs, act, hidden = 7, 5, 6
    model = PolicyValueNet(obs, act, hidden).eval()
    meta = {
        "obsSize": obs,
        "actionSize": act,
        "featureNames": [f"f{i}" for i in range(obs)],
        "actionNames": [f"a{i}" for i in range(act)],
        "datasetVersion": "test",
        "gitCommit": None,
    }
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "model.weights.json"
        export_weights_json(model, meta, path, model_id="t", training_seed=1, hidden=hidden)
        w = json.loads(path.read_text(encoding="utf8"))
    assert w["format"] == "masoi-mlp-1" and w["obsSize"] == obs and w["actionSize"] == act
    assert len(w["layers"]) == 2
    assert len(w["layers"][0]["w"]) == hidden and len(w["layers"][0]["w"][0]) == obs
    x = np.random.default_rng(3).random((4, obs), dtype=np.float32)
    with torch.no_grad():
        t_logits, t_value = model(torch.from_numpy(x))
    n_logits, n_value = np_forward(w, x.astype(np.float64))
    assert np.allclose(n_logits, t_logits.numpy(), atol=1e-5), "logits lệch"
    assert np.allclose(n_value, t_value.numpy(), atol=1e-5), "value lệch"
    print("ok")


if __name__ == "__main__":
    main()
