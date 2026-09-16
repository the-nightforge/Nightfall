"""Sinh packages/game-engine/tests/fixtures/mlp-parity.json: mạng 4→3→3→5 có
trọng số cố định, một input, và output torch tính ra. Test TS so với nó."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from masoi_training.model import PolicyValueNet  # noqa: E402
from masoi_training.export import export_weights_json  # noqa: E402

torch.manual_seed(2026)
model = PolicyValueNet(4, 5, 3).eval()
out = Path(__file__).resolve().parents[2] / "packages/game-engine/tests/fixtures/mlp-parity.json"
out.parent.mkdir(parents=True, exist_ok=True)
tmp = out.with_suffix(".tmp.json")
meta = {
    "obsSize": 4,
    "actionSize": 5,
    "featureNames": ["f0", "f1", "f2", "f3"],
    "actionNames": ["a0", "a1", "a2", "a3", "a4"],
    "datasetVersion": "fixture",
    "gitCommit": None,
}
export_weights_json(model, meta, tmp, model_id="fixture", training_seed=2026, hidden=3)
w = json.loads(tmp.read_text(encoding="utf8"))
tmp.unlink()
x = [0.1, -0.2, 0.3, 0.9]
with torch.no_grad():
    logits, value = model(torch.tensor([x]))
w["parity"] = {"input": x, "logits": logits[0].tolist(), "value": float(value[0])}
out.write_text(json.dumps(w, indent=1), encoding="utf8")
print("wrote", out)

# P1-1: fixture v2 (silu + layernorm) — test TS so outputs torch 1e-6.
torch.manual_seed(2027)
model2 = PolicyValueNet(4, 5, 3, activation="silu", norm="layernorm").eval()
out2 = out.parent / "mlp-parity-v2.json"
tmp2 = out2.with_suffix(".tmp.json")
export_weights_json(model2, meta, tmp2, model_id="fixture-v2", training_seed=2027, hidden=3)
w2 = json.loads(tmp2.read_text(encoding="utf8"))
tmp2.unlink()
assert w2["format"] == "masoi-mlp-2", w2.get("format")
with torch.no_grad():
    logits2, value2 = model2(torch.tensor([x]))
w2["parity"] = {"input": x, "logits": logits2[0].tolist(), "value": float(value2[0])}
out2.write_text(json.dumps(w2, indent=1), encoding="utf8")
print("wrote", out2)

# Tách trunk value: value đi đường riêng — test TS so outputs torch 1e-6.
torch.manual_seed(2028)
model3 = PolicyValueNet(4, 5, 3, value_trunk="separate").eval()
out3 = out.parent / "mlp-parity-v3.json"
tmp3 = out3.with_suffix(".tmp.json")
export_weights_json(model3, meta, tmp3, model_id="fixture-v3", training_seed=2028, hidden=3)
w3 = json.loads(tmp3.read_text(encoding="utf8"))
tmp3.unlink()
assert w3["format"] == "masoi-mlp-2" and w3.get("valueTrunk") == "separate", w3
with torch.no_grad():
    logits3, value3 = model3(torch.tensor([x]))
w3["parity"] = {"input": x, "logits": logits3[0].tolist(), "value": float(value3[0])}
out3.write_text(json.dumps(w3, indent=1), encoding="utf8")
print("wrote", out3)
