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

from .model import PolicyValueNet

FORMAT = "masoi-mlp-1"


def _linear(layer: nn.Linear) -> dict:
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
) -> None:
    payload = {
        "format": FORMAT,
        "modelId": model_id,
        "gitCommit": meta.get("gitCommit"),
        "datasetVersion": meta.get("datasetVersion"),
        "trainingSeed": training_seed,
        "obsSize": int(meta["obsSize"]),
        "actionSize": int(meta["actionSize"]),
        "hidden": hidden,
        "featureNames": list(meta.get("featureNames", [])),
        "actionNames": list(meta.get("actionNames", [])),
        "layers": [_linear(model.trunk[0]), _linear(model.trunk[2])],
        "policyHead": _linear(model.policy_head),
        "valueHead": _linear(model.value_head[0]),
    }
    Path(path).write_text(json.dumps(payload), encoding="utf8")
