"""P0-3: value-clip + entropy schedule + adv-norm theo vai cho train_ppo.
Chạy: python tests/test_ppo_p0.py

Mặc định (clip 0/const/global) giữ hành vi cũ byte-một.
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

ROWS, OBS, ACT = 64, 6, 9


def write_rollout(root: Path, init: PolicyValueNet) -> None:
    rng = np.random.default_rng(0)
    feats = rng.random((ROWS, OBS), dtype=np.float32)
    masks = np.zeros((ROWS, ACT), dtype=np.uint8)
    masks[:, :4] = 1
    with torch.no_grad():
        lg, val = init(torch.from_numpy(feats))
        lp = torch.log_softmax(masked_logits(lg, torch.from_numpy(masks.astype(bool))), 1)
    actions = torch.distributions.Categorical(logits=lp).sample().numpy().astype("<i4")
    logprobs = lp[np.arange(ROWS), actions].numpy().astype("<f4")
    rewards = np.where(actions == 0, 1, -1).astype(np.int8)
    roles = (np.arange(ROWS) % 2).astype(np.uint8)
    root.mkdir(parents=True, exist_ok=True)
    feats.astype("<f4").tofile(root / "features.f32.bin")
    masks.tofile(root / "masks.u8.bin")
    actions.tofile(root / "actions.i32.bin")
    rewards.tofile(root / "rewards.i8.bin")
    np.zeros(ROWS, np.uint8).tofile(root / "splits.u8.bin")
    roles.tofile(root / "roles.u8.bin")
    np.zeros(ROWS, np.uint8).tofile(root / "decisions.u8.bin")
    logprobs.tofile(root / "logprobs.f32.bin")
    val.numpy().astype("<f4").tofile(root / "values.f32.bin")
    (root / "meta.json").write_text(
        json.dumps(
            {
                "rows": ROWS, "obsSize": OBS, "actionSize": ACT,
                "datasetVersion": "ppo-p0", "roles": ["A", "B"], "decisions": ["VOTE"],
                "featureNames": [f"f{i}" for i in range(OBS)],
                "actionNames": [f"a{i}" for i in range(ACT)],
            }
        ),
        encoding="utf8",
    )


def run_case(tmp: str, *extra: str) -> dict:
    torch.manual_seed(0)
    init = PolicyValueNet(OBS, ACT, 8).eval()
    base = Path(tmp)
    data = base / "enc"
    write_rollout(data, init)
    initp = base / "init.weights.json"
    export_weights_json(
        init, json.loads((data / "meta.json").read_text(encoding="utf8")),
        initp, model_id="init", training_seed=0, hidden=8,
    )
    out = base / "out"
    sys.argv = [
        "train_ppo", "--data", str(data), "--init", str(initp), "--out", str(out),
        "--epochs", "2", "--batch-size", "32", "--model-id", "p",
        "--shaping-weight", "0", *extra,
    ]
    train_ppo.main()
    return json.loads((out / "metrics.json").read_text(encoding="utf8"))


def test_clipped_value_loss_exact() -> None:
    new = torch.tensor([0.5, -0.3])
    old = torch.tensor([0.4, 0.4])
    ret = torch.tensor([1.0, -1.0])
    # clip lớn = MSE thường.
    assert abs(train_ppo.clipped_value_loss(new, old, ret, 0.0).item() - 0.37) < 1e-6
    assert abs(train_ppo.clipped_value_loss(new, old, ret, 10.0).item() - 0.37) < 1e-6
    # clip 0.05: hàng 1 new 0.5→clip 0.45, MSE max(0.25, 0.3025)=0.3025;
    # hàng 2 new −0.3→clip 0.35?? clamp(−0.7, ±0.05)=−0.05→0.35, MSE max(0.49, 1.8225).
    got = train_ppo.clipped_value_loss(new, old, ret, 0.05).item()
    assert abs(got - (0.3025 + 1.8225) / 2) < 1e-6, got


def test_entropy_coef_schedule() -> None:
    assert train_ppo.entropy_coef(0.01, 1, 4, "const") == 0.01
    assert train_ppo.entropy_coef(0.01, 4, 4, "const") == 0.01
    assert train_ppo.entropy_coef(0.01, 1, 4, "linear") == 0.01
    assert abs(train_ppo.entropy_coef(0.01, 3, 4, "linear") - 0.005) < 1e-9
    try:
        train_ppo.entropy_coef(0.01, 1, 4, "exp")
    except ValueError:
        return
    raise AssertionError("schedule lạ phải bị từ chối")


def test_new_flags_run_and_recorded() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        m = run_case(
            tmp, "--value-clip", "0.2", "--entropy-schedule", "linear",
            "--adv-norm", "role",
        )
        assert m["valueClip"] == 0.2, m.get("valueClip")
        assert m["entropySchedule"] == "linear", m.get("entropySchedule")
        assert m["advNorm"] == "role", m.get("advNorm")
        assert len(m["history"]) == 2


def test_normalize_adv_by_role_exact() -> None:
    """Mỗi vai mean 0 / std 1 riêng — không trộn hai mốc thắng khác nhau."""
    from masoi_training.train_ppo import normalize_adv_by_role

    adv = torch.tensor([1.0, 3.0, 10.0, 20.0])
    roles = __import__("numpy").array([0, 0, 1, 1])
    out = normalize_adv_by_role(adv, roles)
    assert abs(out[:2].mean().item()) < 1e-6 and abs(out[2:].mean().item()) < 1e-6
    # Nhóm 1 phần tử → 0, không NaN.
    out1 = normalize_adv_by_role(torch.tensor([5.0]), __import__("numpy").array([0]))
    assert out1.item() == 0.0


def main() -> None:
    test_clipped_value_loss_exact()
    test_entropy_coef_schedule()
    test_normalize_adv_by_role_exact()
    test_new_flags_run_and_recorded()
    print("ok")


if __name__ == "__main__":
    main()
