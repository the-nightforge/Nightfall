"""Xuất trọng số MLP ra JSON để runtime TypeScript chạy forward pass thuần.

Vì sao không nạp ONNX ở runtime: `packages/game-engine` phải thuần (không I/O),
`onnxruntime-node` chỉ có API bất đồng bộ trong khi mọi quyết định của bot là
đồng bộ, và model chỉ là ba phép nhân ma trận. `featureNames`/`actionNames`
đi kèm để runtime TỪ CHỐI một model lệch schema encoder thay vì chạy sai.
"""

from __future__ import annotations

import json
from pathlib import Path

from torch import nn

from .model import PolicyValueNet, norm_layers, trunk_linears, value_norm_layers, value_trunk_linears

FORMAT_V1 = "masoi-mlp-1"
FORMAT_V2 = "masoi-mlp-2"
FORMAT = FORMAT_V1

ACTIVATIONS = ("relu", "silu")
NORMS = ("none", "layernorm")


def check_engine_config(activation: str, norm: str) -> None:
    """Tên lạ bị từ chối ngay — lặng lẽ xuất sai là học sai trong im lặng."""
    if activation not in ACTIVATIONS:
        raise ValueError(f"activation không hợp lệ: {activation!r} (có: {ACTIVATIONS})")
    if norm not in NORMS:
        raise ValueError(f"norm không hợp lệ: {norm!r} (có: {NORMS})")


def _linear(layer: nn.Linear) -> dict:
    return {
        "w": layer.weight.detach().cpu().tolist(),
        "b": layer.bias.detach().cpu().tolist(),
    }


def _norm(layer: nn.LayerNorm) -> dict:
    return {
        "w": layer.weight.detach().cpu().tolist(),
        "b": layer.bias.detach().cpu().tolist(),
    }


def export_weights_json(
    model: PolicyValueNet,
    meta: dict,
    path: Path,
    *,
    model_id: str,
    training_seed: int,
    hidden: int,
    residual: dict | None = None,
) -> None:
    """`residual={"beta": β}` đánh dấu model RESIDUAL: engine đọc trường này để
    đi đường hiệu chỉnh điểm heuristic thay vì thay teacher. Model thường KHÔNG
    mang trường này.

    Cấu hình mặc định (relu/none/shared) ra `masoi-mlp-1` byte-một với bản cũ —
    không có keys mới. Cấu hình khác ra `masoi-mlp-2` thêm `activation`/`norm` (+
    `normLayers` khi layernorm) và `valueTrunk`/`valueLayers` (+ `valueNormLayers`
    khi layernorm) để engine chạy đúng forward đã train."""
    activation = getattr(model, "activation", "relu")
    norm = getattr(model, "norm", "none")
    separate = getattr(model, "value_trunk_kind", "shared") == "separate"
    check_engine_config(activation, norm)
    linears = trunk_linears(model)
    payload = {
        "format": FORMAT_V1
        if (activation == "relu" and norm == "none" and not separate)
        else FORMAT_V2,
        "modelId": model_id,
        "gitCommit": meta.get("gitCommit"),
        "datasetVersion": meta.get("datasetVersion"),
        "trainingSeed": training_seed,
        "obsSize": int(meta["obsSize"]),
        "actionSize": int(meta["actionSize"]),
        "hidden": hidden,
        "featureNames": list(meta.get("featureNames", [])),
        "actionNames": list(meta.get("actionNames", [])),
        "layers": [_linear(linears[0]), _linear(linears[1])],
        "policyHead": _linear(model.policy_head),
        "valueHead": _linear(model.value_head[0]),
    }
    if payload["format"] == FORMAT_V2:
        payload["activation"] = activation
        payload["norm"] = norm
        if norm == "layernorm":
            payload["normLayers"] = [_norm(layer) for layer in norm_layers(model)]
        payload["valueTrunk"] = "separate" if separate else "shared"
        if separate:
            payload["valueLayers"] = [
                _linear(layer) for layer in value_trunk_linears(model)
            ]
            if norm == "layernorm":
                payload["valueNormLayers"] = [
                    _norm(layer) for layer in value_norm_layers(model)
                ]
    if residual is not None:
        payload["residual"] = {"beta": float(residual["beta"])}
    Path(path).write_text(json.dumps(payload), encoding="utf8")
