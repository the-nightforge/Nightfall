"""P1-1: export masoi-mlp-2 (silu/layernorm) + load_init round-trip.
Chay: python tests/test_export_v2.py

v1 (relu/none) giu byte-mot: khong co keys moi.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from masoi_training.export import FORMAT_V1, export_weights_json  # noqa: E402
from masoi_training.model import PolicyValueNet  # noqa: E402

OBS, ACT, HIDDEN = 7, 5, 6
META = {
    "obsSize": OBS,
    "actionSize": ACT,
    "featureNames": [f"f{i}" for i in range(OBS)],
    "actionNames": [f"a{i}" for i in range(ACT)],
    "datasetVersion": "v2-test",
    "gitCommit": None,
}


def np_forward(w: dict, x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    act = w.get("activation", "relu")
    norm = w.get("norm", "none")
    norms = w.get("normLayers") or []

    def run_trunk(h: np.ndarray, layers: list, ln_layers: list) -> np.ndarray:
        for i, layer in enumerate(layers):
            h = h @ np.array(layer["w"]).T + np.array(layer["b"])
            if norm == "layernorm":
                g = np.array(ln_layers[i]["w"])
                b = np.array(ln_layers[i]["b"])
                h = (h - h.mean(axis=1, keepdims=True)) / np.sqrt(
                    h.var(axis=1, keepdims=True) + 1e-5
                )
                h = h * g + b
            h = h / (1.0 + np.exp(-h)) if act == "silu" else np.maximum(0.0, h)
        return h

    h = run_trunk(x, w["layers"], norms)
    logits = h @ np.array(w["policyHead"]["w"]).T + np.array(w["policyHead"]["b"])
    if "valueLayers" in w:
        vln = w.get("valueNormLayers") or []
        hv = run_trunk(x, w["valueLayers"], vln)
    else:
        hv = h
    value = np.tanh(hv @ np.array(w["valueHead"]["w"]).T + np.array(w["valueHead"]["b"]))
    return logits, value[..., 0]


def export(model: PolicyValueNet, **kw) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "w.json"
        export_weights_json(model, META, path, model_id="v2", training_seed=0, hidden=HIDDEN, **kw)
        return json.loads(path.read_text(encoding="utf8"))


def test_v1_default_unchanged() -> None:
    torch.manual_seed(5)
    w = export(PolicyValueNet(OBS, ACT, HIDDEN))
    assert w["format"] == FORMAT_V1 == "masoi-mlp-1"
    assert "activation" not in w and "norm" not in w and "normLayers" not in w


def test_v2_silu_payload_and_parity() -> None:
    torch.manual_seed(5)
    model = PolicyValueNet(OBS, ACT, HIDDEN, activation="silu").eval()
    w = export(model)
    assert w["format"] == "masoi-mlp-2" and w["activation"] == "silu"
    assert w["norm"] == "none" and "normLayers" not in w
    x = np.random.default_rng(3).random((4, OBS)).astype(np.float32)
    with torch.no_grad():
        t_logits, t_value = model(torch.from_numpy(x))
    n_logits, n_value = np_forward(w, x.astype(np.float64))
    assert np.allclose(n_logits, t_logits.numpy(), atol=1e-5), "silu logits lech"
    assert np.allclose(n_value, t_value.numpy(), atol=1e-5), "silu value lech"


def test_v2_layernorm_payload_and_parity() -> None:
    torch.manual_seed(6)
    model = PolicyValueNet(OBS, ACT, HIDDEN, norm="layernorm").eval()
    w = export(model)
    assert w["format"] == "masoi-mlp-2" and w["norm"] == "layernorm"
    assert len(w["normLayers"]) == 2
    assert len(w["normLayers"][0]["w"]) == HIDDEN
    x = np.random.default_rng(4).random((4, OBS)).astype(np.float32)
    with torch.no_grad():
        t_logits, t_value = model(torch.from_numpy(x))
    n_logits, n_value = np_forward(w, x.astype(np.float64))
    assert np.allclose(n_logits, t_logits.numpy(), atol=1e-5), "ln logits lech"
    assert np.allclose(n_value, t_value.numpy(), atol=1e-5), "ln value lech"


def test_load_init_v2_roundtrip() -> None:
    from masoi_training.train_ppo import load_init

    torch.manual_seed(7)
    model = PolicyValueNet(OBS, ACT, HIDDEN, activation="silu", norm="layernorm").eval()
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "init.json"
        export_weights_json(
            model, META, path, model_id="v2", training_seed=0, hidden=HIDDEN
        )
        restored, hidden, residual = load_init(path, OBS, ACT)
    assert hidden == HIDDEN and residual is None
    restored.eval()
    x = torch.from_numpy(np.random.default_rng(8).random((3, OBS)).astype(np.float32))
    with torch.no_grad():
        a = model(x)
        b = restored(x)
    assert torch.allclose(a[0], b[0], atol=1e-6), "load_init v2 lech logits"
    assert torch.allclose(a[1], b[1], atol=1e-6), "load_init v2 lech value"


def _parity_check(model: PolicyValueNet, w: dict, seed: int) -> None:
    model.eval()
    x = np.random.default_rng(seed).random((4, OBS)).astype(np.float32)
    with torch.no_grad():
        t_logits, t_value = model(torch.from_numpy(x))
    n_logits, n_value = np_forward(w, x.astype(np.float64))
    assert np.allclose(n_logits, t_logits.numpy(), atol=1e-5), "logits lech"
    assert np.allclose(n_value, t_value.numpy(), atol=1e-5), "value lech"


def test_v2_separate_payload_and_parity() -> None:
    torch.manual_seed(9)
    model = PolicyValueNet(OBS, ACT, HIDDEN, value_trunk="separate").eval()
    w = export(model)
    assert w["format"] == "masoi-mlp-2" and w["valueTrunk"] == "separate"
    assert len(w["valueLayers"]) == 2 and "valueNormLayers" not in w
    _parity_check(model, w, 10)


def test_v2_separate_layernorm_combo() -> None:
    torch.manual_seed(11)
    model = PolicyValueNet(
        OBS, ACT, HIDDEN, activation="silu", norm="layernorm", value_trunk="separate"
    ).eval()
    w = export(model)
    assert w["format"] == "masoi-mlp-2" and w["valueTrunk"] == "separate"
    assert len(w["normLayers"]) == 2 and len(w["valueNormLayers"]) == 2
    _parity_check(model, w, 12)


def test_load_init_separate_roundtrip() -> None:
    from masoi_training.train_ppo import load_init

    torch.manual_seed(13)
    model = PolicyValueNet(OBS, ACT, HIDDEN, value_trunk="separate").eval()
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "init.json"
        export_weights_json(
            model, META, path, model_id="sep", training_seed=0, hidden=HIDDEN
        )
        restored, hidden, _ = load_init(path, OBS, ACT)
    assert hidden == HIDDEN
    assert restored.value_trunk_kind == "separate"
    restored.eval()
    x = torch.from_numpy(np.random.default_rng(14).random((3, OBS)).astype(np.float32))
    with torch.no_grad():
        a = model(x)
        b = restored(x)
    assert torch.allclose(a[0], b[0], atol=1e-6), "load_init separate lech logits"
    assert torch.allclose(a[1], b[1], atol=1e-6), "load_init separate lech value"


def main() -> None:
    test_v1_default_unchanged()
    test_v2_silu_payload_and_parity()
    test_v2_layernorm_payload_and_parity()
    test_load_init_v2_roundtrip()
    test_v2_separate_payload_and_parity()
    test_v2_separate_layernorm_combo()
    test_load_init_separate_roundtrip()
    print("ok")


if __name__ == "__main__":
    main()
