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

RESIDUAL (spec 2026-09-09-residual-policy D6): khi `meta.policyKind == "residual"`,
policy là `softmax((bases + β·net(obs)) / τ)` trên tập ứng viên (`~isnan(bases)`),
với `bases` là điểm THẬT (có jitter) mà TypeScript đã ghi. Cùng `bases` cho cả
policy cũ và mới nên jitter triệt tiêu trong ratio; gradient chỉ đi qua `net`.
β đọc từ meta và PHẢI bằng `residual.beta` của init; τ từ meta.
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

from .console import force_utf8_console
from .data import load
from .export import export_weights_json
from .model import PolicyValueNet, masked_logits


def load_init(path: Path, obs: int, act: int) -> tuple[PolicyValueNet, int, dict | None]:
    """Nạp champion từ chính file JSON mà TypeScript đã chơi bằng nó.

    Đọc file JSON chứ không đọc `model.pt`: file JSON là thứ engine nạp, nên nó
    là định nghĩa duy nhất của "champion". Một `model.pt` cạnh đó có thể là một
    epoch khác, và không có gì trong hai file nói ra điều đó.
    """
    w = json.loads(Path(path).read_text(encoding="utf8"))
    if w["format"] != "masoi-mlp-1":
        raise ValueError(f"init không phải masoi-mlp-1: {w.get('format')!r}")
    if w["obsSize"] != obs or w["actionSize"] != act:
        raise ValueError(
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
    return m, hidden, w.get("residual")


BASELINES = ("role", "mean", "value")


def baseline_for(kind: str, data, rewards: torch.Tensor) -> torch.Tensor:
    """`b` trong `A = R − b`, tính theo một trong ba cách.

    - `value`: value head của policy đã đi rollout. Đúng về lý thuyết, nhưng chỉ
      giúp khi head ấy THẬT SỰ dự đoán được kết quả ván.
    - `mean`: một hằng số bằng tỉ lệ thắng chung. Không bao giờ tệ hơn không có
      baseline, và không cần model nào cả.
    - `role`: trung bình reward theo TỪNG VAI. Vai đã nằm sẵn ở cột `roles` của
      encoder, nên gom nhóm được mà Python KHÔNG cần biết vai nào là Sói — §39
      cấm dựng lại luật game ở tầng train, và "phe" là luật game. Vai mịn hơn
      phe, và nó bắt được đúng thứ khiến `mean` chưa đủ: một Sói thắng 45% ván
      và một Dân thắng 60% ván không thể dùng chung một mốc "bình thường".
    """
    if kind == "value":
        assert data.values is not None, "baseline=value cần cột values (encode --rollout)"
        return torch.from_numpy(data.values.astype(np.float32))
    if kind == "mean":
        return torch.full_like(rewards, float(rewards.mean()))
    base = torch.empty_like(rewards)
    for index in np.unique(data.roles):
        keep = torch.from_numpy(data.roles == index)
        base[keep] = rewards[keep].mean()
    return base


def main() -> None:
    force_utf8_console()
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
    p.add_argument(
        "--side",
        choices=("all", "wolves", "village"),
        default="all",
        help="Chỉ train trên hàng của một phe (đọc meta.wolfPack do TypeScript ghi). Xem Dataset.side",
    )
    p.add_argument(
        "--target-kl",
        type=float,
        default=None,
        help="Dừng sớm khi approxKl trung bình của một epoch vượt ngưỡng (ghi epochsRun)",
    )
    p.add_argument(
        "--baseline",
        choices=BASELINES,
        default="role",
        help="`b` trong A = R − b. Mặc định `role`; `value` là value head (xem baseline_for)",
    )
    p.add_argument(
        "--shaping-weight",
        type=float,
        default=1.0,
        help="α trong A = R − b + α·L (spec 2026-09-11 D1). 0 = tắt, hành vi cũ byte một",
    )
    p.add_argument(
        "--shaping-decisions",
        default="",
        help="Chỉ shaping các loại quyết định này (CSV, viết thường: vote,final_vote). Rỗng = tất cả hàng có nhãn",
    )
    a = p.parse_args()
    torch.manual_seed(a.seed)

    d = load(a.data).side(a.side)
    if d.logprobs is None or d.values is None:
        raise ValueError("dataset không phải rollout (thiếu logprobs/values) — encode với --rollout")
    if len(d) == 0:
        raise ValueError(f"không còn hàng nào sau khi lọc --side {a.side}")
    model, hidden, init_residual = load_init(Path(a.init), d.obs_size, d.action_size)
    init_state = copy.deepcopy(model.state_dict())
    opt = torch.optim.Adam(model.parameters(), lr=a.lr)

    X = torch.from_numpy(d.features)
    M = torch.from_numpy(d.masks)
    A = torch.from_numpy(d.actions)
    R = torch.from_numpy(d.rewards)
    OLD = torch.from_numpy(d.logprobs.astype(np.float32))

    # Residual: phân phối trên (bases + β·net)/τ, mask = tập ứng viên. Init và
    # rollout phải CÙNG loại và CÙNG β — hai policy khác nhau chung một ratio
    # là học sai trong im lặng, nên dừng ngay ở đây.
    residual = d.meta.get("policyKind") == "residual"
    beta = tau = None
    if residual:
        if d.bases is None:
            raise ValueError("meta nói residual nhưng thiếu bases.f32.bin")
        beta = float(d.meta["beta"])
        tau = float(d.meta["temperature"])
        if tau <= 0:
            raise ValueError("rollout residual phải có temperature > 0")
        if init_residual is None or abs(float(init_residual["beta"]) - beta) >= 1e-9:
            raise ValueError(f"β của init ({init_residual}) khác β của rollout ({beta})")
        BASES = torch.from_numpy(np.nan_to_num(d.bases, nan=0.0).astype(np.float32))
        CAND = torch.from_numpy(~np.isnan(d.bases))
        if not bool(CAND[torch.arange(len(d)), A].all()):
            raise ValueError("có hàng mà hành động đã đi không nằm trong bảng ứng viên — tập không nhất quán")
    else:
        if init_residual is not None:
            raise ValueError("init là residual nhưng rollout không phải — hai policy khác nhau")

    # Shaping (spec 2026-09-11 D1/D6): nhãn ±1 từ luật game, cộng vào advantage
    # TRƯỚC chuẩn hoá. α = 0 → không đụng cột, dataset cũ vẫn train được.
    shaping: torch.Tensor | None = None
    if a.shaping_weight > 0:
        if d.shaping is None:
            raise SystemExit("--shaping-weight cần shaping.i8.bin — encode lại dataset bằng bản mới")
        raw = d.shaping.astype(np.float32).copy()
        if a.shaping_decisions:
            wanted = {name.strip().lower() for name in a.shaping_decisions.split(",") if name.strip()}
            names = np.array([str(d.meta["decisions"][int(i)]).lower() for i in d.decisions])
            raw[~np.isin(names, sorted(wanted))] = 0.0
        shaping = torch.from_numpy(raw)
    shaping_coverage = round(float((shaping.numpy() != 0).mean()), 4) if shaping is not None else None

    def policy_logp(logits: torch.Tensor, idx: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        """(log-softmax toàn hàng, mask đang dùng) của policy trên batch `idx`."""
        if residual:
            adj = (BASES[idx] + beta * logits) / tau
            return torch.log_softmax(masked_logits(adj, CAND[idx]), dim=1), CAND[idx]
        return torch.log_softmax(masked_logits(logits, M[idx]), dim=1), M[idx]

    base = baseline_for(a.baseline, d, R)
    # Baseline chỉ đáng dùng khi nó dự đoán `R` TỐT HƠN một hằng số. Ghi cả hai
    # số vào metrics để lần sau không phải đoán: `A = R − b` với `b` tệ hơn hằng
    # số là phép trừ CỘNG THÊM phương sai, tức baseline làm đúng điều ngược lại
    # với việc nó sinh ra để làm. Đã xảy ra thật với value head của BC
    # (corr 0,03, MSE 1,11 so với 0,99 của hằng số) — xem reports/.
    baseline_mse = float(((base - R) ** 2).mean())
    constant_mse = float(((R.mean() - R) ** 2).mean())

    # Chuẩn hoá advantage: reward ±1 làm A dồn về hai cụm, và bước cập nhật khi
    # đó phụ thuộc tỉ lệ thắng của batch chứ không phụ thuộc nước đi nào tốt hơn.
    adv = R - base
    if shaping is not None:
        adv = adv + a.shaping_weight * shaping
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
            logp_all, used = policy_logp(logits, idx)
            logp = logp_all.gather(1, A[idx].unsqueeze(1)).squeeze(1)
            ratio = torch.exp(logp - OLD[idx])
            unclipped = ratio * adv[idx]
            clipped = torch.clamp(ratio, 1 - a.clip, 1 + a.clip) * adv[idx]
            policy_loss = -torch.min(unclipped, clipped).mean()
            value_loss = nn.functional.mse_loss(value, R[idx])
            probs = logp_all.exp()
            # Chỉ cộng entropy của các ô ĐANG BẬT: ô bị che có logp = log(0) và
            # tích `0 * -inf` là NaN, thứ sẽ lan ra toàn bộ gradient.
            entropy = -(probs * logp_all.masked_fill(~used, 0.0)).sum(1).mean()
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
        # Cổng KL: một bước quá xa policy đã sinh rollout là một bước mà ratio
        # không còn nói đúng về nó — đo 2026-09-09: 4 epoch đổi 12,5 % argmax
        # trong khi advantage gần như nhiễu. Dừng ở epoch vượt ngưỡng (đã cập
        # nhật), không quay lui: trọng số vẫn là của epoch đó, và metrics ghi rõ.
        if a.target_kl is not None and row["approxKl"] > a.target_kl:
            print(f"dừng sớm: approxKl {row['approxKl']:.5f} > target {a.target_kl}")
            break

    # Độ trôi so với init: bao nhiêu % argmax còn giống champion (mỏ neo, xem R1).
    model.eval()
    with torch.no_grad():
        everything = torch.arange(len(d))
        new = policy_logp(model(X)[0], everything)[0].argmax(1)
        ref = PolicyValueNet(d.obs_size, d.action_size, hidden)
        ref.load_state_dict(init_state)
        ref.eval()
        old = policy_logp(ref(X)[0], everything)[0].argmax(1)
        agree_init = float((new == old).float().mean())

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), out / "model.pt")
    export_weights_json(
        model, d.meta, out / "model.weights.json",
        model_id=a.model_id, training_seed=a.seed, hidden=hidden, residual=init_residual,
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
                "side": a.side,
                "config": vars(a),
                "history": history,
                "epochsRun": len(history),
                "agreementWithInit": round(agree_init, 4),
                "baseline": a.baseline,
                # `baselineMse` > `constantMse` nghĩa là baseline đang LÀM HẠI.
                "baselineMse": round(baseline_mse, 4),
                "shapingWeight": a.shaping_weight,
                "shapingDecisions": a.shaping_decisions or None,
                "shapingCoverage": shaping_coverage,
                "constantMse": round(constant_mse, 4),
                "policyKind": "residual" if residual else "logits",
                "beta": beta,
                "temperature": d.meta.get("temperature"),
            },
            indent=2,
        ),
        encoding="utf8",
    )
    verdict = "hại" if baseline_mse > constant_mse else "có ích"
    print(
        f"baseline {a.baseline}: MSE {baseline_mse:.4f} vs hằng số {constant_mse:.4f} — {verdict}"
    )
    print(f"Đã ghi {out}  agreementWithInit {agree_init:.3f}")


if __name__ == "__main__":
    main()
