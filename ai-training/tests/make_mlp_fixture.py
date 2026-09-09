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
