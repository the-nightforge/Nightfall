"""PPO clipped trên rollout do self-play TypeScript ghi (spec R3/R4).

Advantage Monte Carlo: A = R − V(s), reward ±1 cuối ván, γ = λ = 1. Value
target = R. Mask áp lên logits trước log-softmax, cùng MASK_FILL với BC.
Khởi tạo từ model.weights.json của champion.

Vì sao Monte Carlo chứ không GAE: một ván Ma Sói chỉ có MỘT phần thưởng, ở cuối,
và không có reward trung gian nào để bootstrap. GAE với γ = λ = 1 và không có
reward giữa chừng rút gọn đúng về `R − V(s)` — nên viết thẳng nó ra là trung
thực hơn là dựng một vòng lặp GAE trông có vẻ tổng quát mà chạy ra cùng số.

Vì sao `logProb` cũ đến từ TypeScript: nó phải là log-xác suất của policy ĐÃ ĐI
nước đó, đo trên ĐÚNG vector nó đã thấy. Tính lại ở đây từ trọng số init sẽ ra
một con số gần đúng — và `ratio` của PPO là một tỉ số, nên "gần đúng" ở mẫu số
biến clip thành một phép cắt vào chỗ không ai kiểm được.
"""

from __future__ import annotations

import argparse
import copy
import json
import subprocess
from pathlib import Path

import numpy as np
import torch
from torch import nn

from .data import load
from .export import export_weights_json
from .model import PolicyValueNet, masked_logits


def load_init(path: Path, obs: int, act: int) -> tuple[PolicyValueNet, int]:
    """Nạp champion từ chính file JSON mà TypeScript đã chơi bằng nó.

    Đọc file JSON chứ không đọc `model.pt`: file JSON là thứ engine nạp, nên nó
    là định nghĩa duy nhất của "champion". Một `model.pt` cạnh đó có thể là một
    epoch khác, và không có gì trong hai file nói ra điều đó.
    """
    w = json.loads(Path(path).read_text(encoding="utf8"))
    assert w["format"] == "masoi-mlp-1", f"init không phải masoi-mlp-1: {w.get('format')!r}"
    assert w["obsSize"] == obs and w["actionSize"] == act, (
        f"init lệch schema: obs {w['obsSize']} vs {obs}, action {w['actionSize']} vs {act}"
    )
    hidden = int(w["hidden"])
    m = PolicyValueNet(obs, act, hidden)
    with torch.no_grad():
        for layer, src in (
            (m.trunk[0], w["layers"][0]),
            (m.trunk[2], w["layers"][1]),
            (m.policy_head, w["policyHead"]),
        ):
            layer.weight.copy_(torch.tensor(src["w"]))
            layer.bias.copy_(torch.tensor(src["b"]))
        if w.get("valueHead"):
            m.value_head[0].weight.copy_(torch.tensor(w["valueHead"]["w"]))
            m.value_head[0].bias.copy_(torch.tensor(w["valueHead"]["b"]))
    return m, hidden


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--data", required=True, help="Thư mục do `ai:encode --rollout` ghi ra")
    p.add_argument("--init", required=True, help="model.weights.json của champion")
    p.add_argument("--out", required=True)
    p.add_argument("--epochs", type=int, default=4)
    p.add_argument("--batch-size", type=int, default=4096)
    p.add_argument("--lr", type=float, default=3e-4)
    p.add_argument("--clip", type=float, default=0.2)
    p.add_argument("--entropy", type=float, default=0.01)
    p.add_argument("--value-coef", type=float, default=0.5)
    p.add_argument("--model-id", default="ppo-0001")
    p.add_argument("--seed", type=int, default=12345)
    a = p.parse_args()
    torch.manual_seed(a.seed)

    d = load(a.data)
    assert d.logprobs is not None and d.values is not None, (
        "dataset không phải rollout (thiếu logprobs/values) — encode với --rollout"
    )
    model, hidden = load_init(Path(a.init), d.obs_size, d.action_size)
    init_state = copy.deepcopy(model.state_dict())
    opt = torch.optim.Adam(model.parameters(), lr=a.lr)

    X = torch.from_numpy(d.features)
    M = torch.from_numpy(d.masks)
    A = torch.from_numpy(d.actions)
    R = torch.from_numpy(d.rewards)
    OLD = torch.from_numpy(d.logprobs.astype(np.float32))
    # Chuẩn hoá advantage: reward ±1 làm A dồn về hai cụm, và bước cập nhật khi
    # đó phụ thuộc tỉ lệ thắng của batch chứ không phụ thuộc nước đi nào tốt hơn.
    adv = R - torch.from_numpy(d.values.astype(np.float32))
    adv = (adv - adv.mean()) / (adv.std() + 1e-8)

    gen = torch.Generator().manual_seed(a.seed)
    history = []
    for epoch in range(1, a.epochs + 1):
        model.train()
        order = torch.randperm(len(d), generator=gen)
        tot = {"policyLoss": 0.0, "valueLoss": 0.0, "entropy": 0.0, "approxKl": 0.0, "clipFraction": 0.0}
        n = 0
        for s in range(0, len(d), a.batch_size):
            idx = order[s : s + a.batch_size]
            logits, value = model(X[idx])
            logp_all = torch.log_softmax(masked_logits(logits, M[idx]), dim=1)
            logp = logp_all.gather(1, A[idx].unsqueeze(1)).squeeze(1)
            ratio = torch.exp(logp - OLD[idx])
            unclipped = ratio * adv[idx]
            clipped = torch.clamp(ratio, 1 - a.clip, 1 + a.clip) * adv[idx]
            policy_loss = -torch.min(unclipped, clipped).mean()
            value_loss = nn.functional.mse_loss(value, R[idx])
            probs = logp_all.exp()
            # Chỉ cộng entropy của các ô ĐANG BẬT: ô bị che có logp = log(0) và
            # tích `0 * -inf` là NaN, thứ sẽ lan ra toàn bộ gradient.
            entropy = -(probs * logp_all.masked_fill(~M[idx], 0.0)).sum(1).mean()
            loss = policy_loss + a.value_coef * value_loss - a.entropy * entropy
            opt.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 0.5)
            opt.step()
            with torch.no_grad():
                kl = (OLD[idx] - logp).mean().item()
                cf = ((ratio - 1).abs() > a.clip).float().mean().item()
            b = len(idx)
            n += b
            for k, v in (
                ("policyLoss", policy_loss.item()),
                ("valueLoss", value_loss.item()),
                ("entropy", entropy.item()),
                ("approxKl", kl),
                ("clipFraction", cf),
            ):
                tot[k] += v * b
        row = {"epoch": epoch, **{k: round(v / max(n, 1), 5) for k, v in tot.items()}}
        history.append(row)
        print(
            f"epoch {epoch}  policy {row['policyLoss']:.4f}  value {row['valueLoss']:.4f}"
            f"  ent {row['entropy']:.3f}  kl {row['approxKl']:.5f}  clip {row['clipFraction']:.3f}"
        )

    # Độ trôi so với init: bao nhiêu % argmax còn giống champion (mỏ neo, xem R1).
    model.eval()
    with torch.no_grad():
        new = masked_logits(model(X)[0], M).argmax(1)
        ref = PolicyValueNet(d.obs_size, d.action_size, hidden)
        ref.load_state_dict(init_state)
        ref.eval()
        old = masked_logits(ref(X)[0], M).argmax(1)
        agree_init = float((new == old).float().mean())

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), out / "model.pt")
    export_weights_json(
        model, d.meta, out / "model.weights.json",
        model_id=a.model_id, training_seed=a.seed, hidden=hidden,
    )
    try:
        commit = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    except Exception:
        commit = None
    (out / "metrics.json").write_text(
        json.dumps(
            {
                "modelId": a.model_id,
                "gitCommit": commit,
                "init": str(a.init),
                "datasetVersion": d.meta.get("datasetVersion"),
                "rows": len(d),
                "config": vars(a),
                "history": history,
                "agreementWithInit": round(agree_init, 4),
            },
            indent=2,
        ),
        encoding="utf8",
    )
    print(f"Đã ghi {out}  agreementWithInit {agree_init:.3f}")


if __name__ == "__main__":
    main()
