"""P0-1: activation/norm/init cho PolicyValueNet. Chạy: python tests/test_model_p0.py

Mặc định phải byte-một với model cũ (ReLU, không norm, init mặc định của torch).
"""

from __future__ import annotations

import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from masoi_training.model import PolicyValueNet  # noqa: E402

OBS, ACT, HIDDEN = 7, 5, 6


def test_activation_silu_option() -> None:
    m = PolicyValueNet(OBS, ACT, HIDDEN, activation="silu").eval()
    with torch.no_grad():
        logits, value = m(torch.zeros(2, OBS))
    assert logits.shape == (2, ACT) and value.shape == (2,)


def test_norm_layernorm_option() -> None:
    m = PolicyValueNet(OBS, ACT, HIDDEN, norm="layernorm").eval()
    with torch.no_grad():
        logits, value = m(torch.zeros(2, OBS))
    assert logits.shape == (2, ACT) and value.shape == (2,)


def test_unknown_activation_rejected() -> None:
    try:
        PolicyValueNet(OBS, ACT, HIDDEN, activation="gelu")
    except ValueError:
        return
    raise AssertionError("activation lạ phải bị từ chối bằng ValueError")


def test_unknown_norm_rejected() -> None:
    try:
        PolicyValueNet(OBS, ACT, HIDDEN, norm="batchnorm")
    except ValueError:
        return
    raise AssertionError("norm lạ phải bị từ chối bằng ValueError")


def test_default_byte_identical() -> None:
    """Mặc định == chỉ rõ relu/none/default: không đổi trọng số cũ một bit nào."""
    torch.manual_seed(11)
    plain = PolicyValueNet(OBS, ACT, HIDDEN)
    torch.manual_seed(11)
    explicit = PolicyValueNet(
        OBS, ACT, HIDDEN, activation="relu", norm="none", init="default"
    )
    for key in plain.state_dict():
        assert torch.equal(plain.state_dict()[key], explicit.state_dict()[key]), key


def test_orthogonal_init() -> None:
    """Trunk trực giao theo hàng, policy head khởi nhỏ để residual xuất phát ≈ 0."""
    torch.manual_seed(0)
    m = PolicyValueNet(OBS, ACT, HIDDEN, init="orthogonal")
    for layer in (m.trunk[0],):
        w = layer.weight.detach()
        gram = w @ w.T
        eye = torch.eye(w.shape[0]) * gram.diag().mean()
        assert torch.allclose(gram, eye, atol=1e-4), "trunk chưa trực giao"
    assert float(m.policy_head.weight.detach().std()) < 0.05, "policy head phải khởi nhỏ"


def test_export_rejects_non_engine_configs() -> None:
    """Engine chạy ReLU thuần: model silu/LN xuất ra JSON sẽ chạy SAI trong im lặng."""
    import json
    import tempfile
    from masoi_training.export import export_weights_json

    meta = {"obsSize": OBS, "actionSize": ACT, "datasetVersion": "t", "gitCommit": None}
    for kwargs in ({"activation": "silu"}, {"norm": "layernorm"}):
        m = PolicyValueNet(OBS, ACT, HIDDEN, **kwargs)
        with tempfile.TemporaryDirectory() as tmp:
            try:
                export_weights_json(
                    m, meta, Path(tmp) / "w.json",
                    model_id="x", training_seed=0, hidden=HIDDEN,
                )
            except ValueError:
                continue
        raise AssertionError(f"export phải từ chối {kwargs} — engine chưa chạy được")


def main() -> None:
    test_activation_silu_option()
    test_norm_layernorm_option()
    test_unknown_activation_rejected()
    test_unknown_norm_rejected()
    test_default_byte_identical()
    test_orthogonal_init()
    test_export_rejects_non_engine_configs()
    print("ok")


if __name__ == "__main__":
    main()
