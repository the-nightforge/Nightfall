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

from .model import PolicyValueNet


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--from", dest="source", required=True, help="model.weights.json nguồn (schema encoder hiện tại)")
    p.add_argument("--out", required=True)
    p.add_argument("--beta", type=float, default=10.0, help="β: net xuất 0,3 dịch ứng viên 3 điểm (thang jitter)")
    p.add_argument("--model-id", default="residual-0000")
    p.add_argument("--fresh", action="store_true", help="trunk ngẫu nhiên (seed 0) thay vì chép từ nguồn")
    a = p.parse_args()
    assert a.beta > 0, "beta phải > 0"

    w = json.loads(Path(a.source).read_text(encoding="utf8"))
    assert w["format"] == "masoi-mlp-1", w.get("format")
    obs, act, hidden = int(w["obsSize"]), int(w["actionSize"]), int(w["hidden"])
    if a.fresh:
        torch.manual_seed(0)
        m = PolicyValueNet(obs, act, hidden)
        w["layers"] = [
            {"w": layer.weight.tolist(), "b": layer.bias.tolist()} for layer in (m.trunk[0], m.trunk[2])
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
