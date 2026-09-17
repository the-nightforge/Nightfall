"""Chống trôi lượt không train (2026-09-17). Chạy: python tests/test_ppo_anchor.py

Vì sao có bài kiểm này: giai đoạn 1 (`--side village --train-decisions
vote,final_vote,hunter_shot`) làm làng tụt từ +0,9 xuống −7,0 sau 10 vòng. Ablation
trả lượt đêm cho heuristic kéo nó về +0,7: NIGHT — lượt KHÔNG train — đã trôi
(argmax còn giống init 57 %, entropy 0,77 → 1,15). Ba cơ chế:

1. entropy bonus tính trên MỌI hàng, kể cả hàng đã loại khỏi policy-loss;
2. không gì neo hàng không train về init;
3. `approxKl` (cổng `--target-kl`) trung bình trên mọi hàng, bị FINAL_VOTE gần
   tất định pha loãng nên không bao giờ kích hoạt.
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

ROWS, OBS, ACT, HIDDEN = 256, 6, 9, 8


def unit_case() -> None:
    torch.manual_seed(1)
    used = torch.zeros(4, ACT, dtype=torch.bool)
    used[:, :4] = True
    logp = torch.log_softmax(masked_logits(torch.randn(4, ACT), used), 1)
    actions = torch.tensor([0, 1, 2, 3])
    old = logp.gather(1, actions.unsqueeze(1)).squeeze(1) + 0.1  # approxKl = old − new = 0,1
    adv = torch.tensor([1.0, -1.0, 0.5, 2.0])
    rows = torch.tensor([True, True, False, False])

    terms = train_ppo.ppo_loss_terms(logp, used, actions, old, adv, 0.2, rows, None)
    ent_rows = -(logp.exp() * logp.masked_fill(~used, 0.0)).sum(1)
    assert torch.isclose(terms["entropy"], ent_rows[:2].mean()), terms["entropy"]
    assert torch.isclose(terms["approxKl"], torch.tensor(0.1)), terms["approxKl"]
    assert float(terms["anchor"]) == 0.0

    # Hàng KHÔNG train đổi tuỳ ý → policy/entropy/approxKl không nhúc nhích.
    logp2 = logp.clone()
    logp2[2:] = torch.log_softmax(masked_logits(torch.randn(2, ACT) * 5, used[2:]), 1)
    adv2 = adv.clone()
    adv2[2:] = -adv2[2:]
    t2 = train_ppo.ppo_loss_terms(logp2, used, actions, old, adv2, 0.2, rows, None)
    for key in ("policy", "entropy", "approxKl", "clipFraction"):
        assert torch.isclose(terms[key], t2[key]), (key, terms[key], t2[key])

    # rows=None = mọi hàng (hành vi cũ).
    all_rows = train_ppo.ppo_loss_terms(logp, used, actions, old, adv, 0.2, None, None)
    assert torch.isclose(all_rows["entropy"], ent_rows.mean())

    # Neo: 0 khi trùng init, > 0 khi lệch, và tính trên MỌI hàng.
    same = train_ppo.ppo_loss_terms(logp, used, actions, old, adv, 0.2, rows, logp)
    assert abs(float(same["anchor"])) < 1e-6, same["anchor"]
    moved = train_ppo.ppo_loss_terms(logp2, used, actions, old, adv, 0.2, rows, logp)
    assert float(moved["anchor"]) > 1e-3, moved["anchor"]
    assert torch.isfinite(moved["anchor"])

    # Batch không có hàng train: 0, không NaN.
    none = train_ppo.ppo_loss_terms(logp, used, actions, old, adv, 0.2, torch.zeros(4, dtype=torch.bool), logp)
    for key in ("policy", "entropy", "approxKl", "clipFraction"):
        assert float(none[key]) == 0.0, (key, none[key])


def write_rollout(root: Path, init: PolicyValueNet) -> dict:
    rng = np.random.default_rng(7)
    feats = rng.random((ROWS, OBS), dtype=np.float32)
    masks = np.zeros((ROWS, ACT), dtype=np.uint8)
    masks[:, :4] = 1
    with torch.no_grad():
        lg, val = init(torch.from_numpy(feats))
        lp = torch.log_softmax(masked_logits(lg, torch.from_numpy(masks.astype(bool))), 1)
    actions = torch.distributions.Categorical(logits=lp).sample().numpy().astype("<i4")
    root.mkdir(parents=True)
    feats.astype("<f4").tofile(root / "features.f32.bin")
    masks.tofile(root / "masks.u8.bin")
    actions.tofile(root / "actions.i32.bin")
    rng.choice(np.array([-1, 1], dtype=np.int8), ROWS).tofile(root / "rewards.i8.bin")
    np.zeros(ROWS, np.uint8).tofile(root / "splits.u8.bin")
    np.zeros(ROWS, np.uint8).tofile(root / "roles.u8.bin")
    (np.arange(ROWS) % 2).astype(np.uint8).tofile(root / "decisions.u8.bin")
    lp[np.arange(ROWS), actions].numpy().astype("<f4").tofile(root / "logprobs.f32.bin")
    val.numpy().astype("<f4").tofile(root / "values.f32.bin")
    meta = {
        "rows": ROWS,
        "obsSize": OBS,
        "actionSize": ACT,
        "datasetVersion": "rollout-test",
        "roles": ["A"],
        "decisions": ["VOTE", "NIGHT"],
        "featureNames": [f"f{i}" for i in range(OBS)],
        "actionNames": [f"a{i}" for i in range(ACT)],
    }
    (root / "meta.json").write_text(json.dumps(meta), encoding="utf8")
    return meta


def integration_case() -> None:
    torch.manual_seed(0)
    init = PolicyValueNet(OBS, ACT, HIDDEN, activation="silu", norm="layernorm", value_trunk="separate").eval()
    with tempfile.TemporaryDirectory() as tmp:
        data = Path(tmp) / "enc"
        meta = write_rollout(data, init)
        initp = Path(tmp) / "init.weights.json"
        export_weights_json(init, meta, initp, model_id="init", training_seed=0, hidden=HIDDEN)

        def run(name: str, anchor: float) -> dict:
            out = Path(tmp) / name
            sys.argv = [
                "train_ppo", "--data", str(data), "--init", str(initp), "--out", str(out),
                "--epochs", "8", "--batch-size", "64", "--lr", "1e-2", "--entropy", "0.5",
                "--model-id", name, "--shaping-weight", "0",
                "--train-decisions", "vote", "--anchor-kl", str(anchor),
            ]
            train_ppo.main()
            return json.loads((out / "metrics.json").read_text(encoding="utf8"))

        free = run("free", 0.0)
        anchored = run("anchored", 5.0)

        for m in (free, anchored):
            assert set(m["agreementWithInitByDecision"]) == {"VOTE", "NIGHT"}, m["agreementWithInitByDecision"]
            assert set(m["klToInitByDecision"]) == {"VOTE", "NIGHT"}, m["klToInitByDecision"]
            assert set(m["history"][0]["approxKlByDecision"]) == {"VOTE", "NIGHT"}, m["history"][0]
            assert m["anchorKl"] in (0.0, 5.0)
        night_free = free["klToInitByDecision"]["NIGHT"]
        night_anchored = anchored["klToInitByDecision"]["NIGHT"]
        assert night_free > 1e-4, ("kịch bản phải làm NIGHT trôi khi không neo", night_free)
        assert night_anchored < 0.5 * night_free, (night_anchored, night_free)


def main() -> None:
    unit_case()
    integration_case()
    print("ok")


if __name__ == "__main__":
    main()
