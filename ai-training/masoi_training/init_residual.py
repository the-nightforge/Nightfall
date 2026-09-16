"""Tạo champion-0000 cho residual policy (spec 2026-09-09-residual-policy D2).

Chép trunk + value head + tên đặc trưng từ một model có sẵn (policy-0004: đặc
trưng đã học), ZERO `policyHead` để residual = 0 với mọi observation, và gắn
`residual.beta`. Kết quả nạp vào engine là heuristic đúng byte — điểm xuất phát
của PPO là teacher, không phải một bản sao thua teacher.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch

from .console import force_utf8_console
from .model import PolicyValueNet, norm_layers, trunk_linears, value_norm_layers, value_trunk_linears


def main() -> None:
    force_utf8_console()
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--from", dest="source", required=True, help="model.weights.json nguồn (schema encoder hiện tại)")
    p.add_argument("--out", required=True)
    p.add_argument("--beta", type=float, default=10.0, help="β: net xuất 0,3 dịch ứng viên 3 điểm (thang jitter)")
    p.add_argument("--model-id", default="residual-0000")
    p.add_argument("--fresh", action="store_true", help="trunk ngẫu nhiên (seed 0) thay vì chép từ nguồn")
    a = p.parse_args()
    if a.beta <= 0:
        raise ValueError(f"beta phải > 0, nhận {a.beta}")

    w = json.loads(Path(a.source).read_text(encoding="utf8"))
    assert w["format"] in ("masoi-mlp-1", "masoi-mlp-2"), w.get("format")
    obs, act, hidden = int(w["obsSize"]), int(w["actionSize"]), int(w["hidden"])
    if a.fresh:
        # Trunk mới phải CÙNG kiến trúc với source — nếu không các keys v2 còn
        # lại (activation/norm/valueLayers) sẽ mô tả sai trọng số mới sinh.
        torch.manual_seed(0)
        m = PolicyValueNet(
            obs, act, hidden,
            activation=w.get("activation", "relu"),
            norm=w.get("norm", "none"),
            value_trunk=w.get("valueTrunk", "shared"),
        )
        w["layers"] = [
            {"w": layer.weight.tolist(), "b": layer.bias.tolist()}
            for layer in trunk_linears(m)
        ]
        if w.get("normLayers") is not None:
            w["normLayers"] = [
                {"w": layer.weight.tolist(), "b": layer.bias.tolist()}
                for layer in norm_layers(m)
            ]
        if w.get("valueLayers") is not None:
            w["valueLayers"] = [
                {"w": layer.weight.tolist(), "b": layer.bias.tolist()}
                for layer in value_trunk_linears(m)
            ]
        if w.get("valueNormLayers") is not None:
            w["valueNormLayers"] = [
                {"w": layer.weight.tolist(), "b": layer.bias.tolist()}
                for layer in value_norm_layers(m)
            ]
        w["valueHead"] = {"w": m.value_head[0].weight.tolist(), "b": m.value_head[0].bias.tolist()}
    w["policyHead"] = {"w": [[0.0] * hidden for _ in range(act)], "b": [0.0] * act}
    w["residual"] = {"beta": a.beta}
    w["modelId"] = a.model_id
    w["trainingSeed"] = 0

    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(w), encoding="utf8")
    trunk = "mới (seed 0)" if a.fresh else f"chép từ {a.source}"
    print(f"Đã ghi {out}: residual β={a.beta}, policyHead = 0, trunk {trunk}")


if __name__ == "__main__":
    main()
