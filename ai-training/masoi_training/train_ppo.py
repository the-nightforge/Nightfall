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
from .model import PolicyValueNet, masked_logits, norm_layers, trunk_linears, value_norm_layers, value_trunk_linears


def load_init(path: Path, obs: int, act: int) -> tuple[PolicyValueNet, int, dict | None]:
    """Nạp champion từ chính file JSON mà TypeScript đã chơi bằng nó.

    Đọc file JSON chứ không đọc `model.pt`: file JSON là thứ engine nạp, nên nó
    là định nghĩa duy nhất của "champion". Một `model.pt` cạnh đó có thể là một
    epoch khác, và không có gì trong hai file nói ra điều đó.
    """
    w = json.loads(Path(path).read_text(encoding="utf8"))
    if w["format"] not in ("masoi-mlp-1", "masoi-mlp-2"):
        raise ValueError(f"init không phải masoi-mlp-1/2: {w.get('format')!r}")
    if w["obsSize"] != obs or w["actionSize"] != act:
        raise ValueError(
            f"init lệch schema: obs {w['obsSize']} vs {obs}, action {w['actionSize']} vs {act}"
        )
    hidden = int(w["hidden"])
    activation = w.get("activation", "relu")
    norm = w.get("norm", "none")
    if activation not in ("relu", "silu") or norm not in ("none", "layernorm"):
        raise ValueError(f"init có cấu hình lạ: {activation}/{norm}")
    norms = w.get("normLayers") or []
    if norm == "layernorm" and len(norms) != 2:
        raise ValueError(f"init layernorm thiếu normLayers (có {len(norms)}, cần 2)")
    value_trunk = w.get("valueTrunk", "shared")
    if value_trunk not in ("shared", "separate"):
        raise ValueError(f"init có valueTrunk lạ: {value_trunk!r}")
    value_layers = w.get("valueLayers") or []
    if value_trunk == "separate" and len(value_layers) != 2:
        raise ValueError(f"init separate thiếu valueLayers (có {len(value_layers)}, cần 2)")
    value_norms = w.get("valueNormLayers") or []
    if value_trunk == "separate" and norm == "layernorm" and len(value_norms) != 2:
        raise ValueError("init separate+layernorm thiếu valueNormLayers (cần 2)")
    m = PolicyValueNet(obs, act, hidden, activation=activation, norm=norm, value_trunk=value_trunk)
    with torch.no_grad():
        for layer, src in zip(trunk_linears(m), w["layers"]):
            layer.weight.copy_(torch.tensor(src["w"]))
            layer.bias.copy_(torch.tensor(src["b"]))
        for layer, src in zip(norm_layers(m), norms):
            layer.weight.copy_(torch.tensor(src["w"]))
            layer.bias.copy_(torch.tensor(src["b"]))
        for layer, src in zip(value_trunk_linears(m), value_layers):
            layer.weight.copy_(torch.tensor(src["w"]))
            layer.bias.copy_(torch.tensor(src["b"]))
        for layer, src in zip(value_norm_layers(m), value_norms):
            layer.weight.copy_(torch.tensor(src["w"]))
            layer.bias.copy_(torch.tensor(src["b"]))
        m.policy_head.weight.copy_(torch.tensor(w["policyHead"]["w"]))
        m.policy_head.bias.copy_(torch.tensor(w["policyHead"]["b"]))
        if w.get("valueHead"):
            m.value_head[0].weight.copy_(torch.tensor(w["valueHead"]["w"]))
            m.value_head[0].bias.copy_(torch.tensor(w["valueHead"]["b"]))
    return m, hidden, w.get("residual")


def rows_mean(values: torch.Tensor, rows: torch.Tensor | None) -> torch.Tensor:
    """Trung bình trên hàng được chọn; `rows=None` = mọi hàng; chọn rỗng = 0 (không NaN)."""
    if rows is None:
        return values.mean()
    picked = values[rows]
    return picked.mean() if picked.numel() > 0 else values.new_zeros(())


def ppo_loss_terms(
    logp_all: torch.Tensor,
    used: torch.Tensor,
    actions: torch.Tensor,
    old_logp: torch.Tensor,
    adv: torch.Tensor,
    clip: float,
    rows: torch.Tensor | None,
    ref_logp_all: torch.Tensor | None,
) -> dict[str, torch.Tensor]:
    """Các số hạng loss PPO của một batch.

    `rows` (--train-decisions) giới hạn policy-loss, entropy, approxKl và
    clipFraction vào hàng được train: entropy trên hàng KHÔNG train là một lực
    làm phẳng không có gradient nào cân lại, và approxKl trung bình cả hàng
    FINAL_VOTE gần tất định thì cổng `--target-kl` không bao giờ thấy trôi
    (giai đoạn 1, 2026-09-17: NIGHT còn 57 % argmax, làng −7 điểm).

    `anchor` = KL(init ‖ mới) trên MỌI hàng — mỏ neo giữ lượt không train gần
    hành vi xuất phát. `ref_logp_all=None` → 0.
    """
    logp = logp_all.gather(1, actions.unsqueeze(1)).squeeze(1)
    ratio = torch.exp(logp - old_logp)
    selected = torch.min(ratio * adv, torch.clamp(ratio, 1 - clip, 1 + clip) * adv)
    # Chỉ cộng các ô ĐANG BẬT: ô bị che có logp = log(0) và `0 * -inf` là NaN.
    entropy_rows = -(logp_all.exp() * logp_all.masked_fill(~used, 0.0)).sum(1)
    terms = {
        "policy": -rows_mean(selected, rows),
        "entropy": rows_mean(entropy_rows, rows),
        "approxKl": rows_mean((old_logp - logp).detach(), rows),
        "clipFraction": rows_mean(((ratio - 1).abs() > clip).float().detach(), rows),
        "anchor": logp_all.new_zeros(()),
    }
    if ref_logp_all is not None:
        diff = (ref_logp_all - logp_all).masked_fill(~used, 0.0)
        terms["anchor"] = (ref_logp_all.exp() * diff).sum(1).mean()
    return terms


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


def wanted_decision_names(flag: str, flag_name: str, meta: dict) -> set[str] | None:
    """Tập tên quyết định từ flag CSV, hoặc None khi flag rỗng (= mọi hàng).

    Tên lạ bị từ chối ngay: lặng lẽ zero/mask hết là cách học sai trong im lặng.
    """
    if not flag:
        return None
    wanted = {name.strip().lower() for name in flag.split(",") if name.strip()}
    valid = {str(name).lower() for name in meta["decisions"]}
    unknown = wanted - valid
    if unknown:
        raise ValueError(f"{flag_name} có tên lạ {sorted(unknown)} — hợp lệ: {sorted(valid)}")
    return wanted


def clipped_value_loss(
    values: torch.Tensor, old_values: torch.Tensor, returns: torch.Tensor, clip: float
) -> torch.Tensor:
    """Loss value PPO2: max(MSE mới, MSE đã clip quanh giá trị cũ).

    `clip <= 0` = MSE thường (hành vi cũ byte-một). Clip chặn value head nhảy xa
    trong một batch khi advantage nhiễu — cùng lý do với clip của policy.
    """
    if clip <= 0:
        return nn.functional.mse_loss(values, returns)
    v_clipped = old_values + torch.clamp(values - old_values, -clip, clip)
    return torch.maximum(
        nn.functional.mse_loss(values, returns, reduction="none"),
        nn.functional.mse_loss(v_clipped, returns, reduction="none"),
    ).mean()


def entropy_coef(base: float, epoch: int, total: int, schedule: str) -> float:
    """Hệ số entropy của epoch `epoch` (đếm từ 1).

    - `const`: hằng số (cũ). `linear`: giảm tuyến tính về 0 ở epoch cuối —
      đầu train cần entropy để thoát argmax của champion, cuối cần tắt để hội tụ.
    """
    if schedule == "const":
        return base
    if schedule == "linear":
        return base * (1 - (epoch - 1) / max(total, 1))
    raise ValueError(f"entropy schedule không hợp lệ: {schedule!r} (có: const, linear)")


def normalize_adv_by_role(adv: torch.Tensor, roles: np.ndarray) -> torch.Tensor:
    """Chuẩn hoá advantage TRONG từng vai thay vì toàn cục.

    Vai có tỉ lệ thắng lệch nhau (Sói 45%, Dân 60%) thì chuẩn hoá chung trộn hai
    phân phối khác mốc vào một; chuẩn hoá riêng giữ mỗi phe mean 0 / std 1.
    """
    out = torch.empty_like(adv)
    for index in np.unique(roles):
        keep = torch.from_numpy(roles == index)
        group = adv[keep]
        # unbiased=False: nhóm 1 phần tử có std = 0 (ra 0), chứ không phải NaN
        # lan vào gradient của cả batch.
        out[keep] = (group - group.mean()) / (group.std(unbiased=False) + 1e-8)
    return out


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
    p.add_argument("--anchor-kl", type=float, default=0.0, dest="anchor_kl",
                   help="Hệ số KL(neo ‖ mới) trên mọi hàng; 0 = tắt (hành vi cũ)")
    p.add_argument("--anchor-model", default=None, dest="anchor_model",
                   help="model.weights.json làm mỏ neo KL; mặc định = --init. rl_loop truyền champion chính thức")
    p.add_argument("--value-coef", type=float, default=0.5)
    # P0-3: mặc định giữ hành vi cũ byte-một (clip 0/const/global).
    p.add_argument("--value-clip", type=float, default=0.0,
                   help="0 = MSE thường (cũ); > 0 = clip value quanh giá trị rollout")
    p.add_argument("--entropy-schedule", choices=("const", "linear"), default="const")
    p.add_argument("--adv-norm", choices=("global", "role"), default="global",
                   help="Chuẩn hoá advantage toàn cục (cũ) hay trong từng vai")
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
    p.add_argument(
        "--train-decisions",
        default="",
        help="Chỉ tính POLICY-LOSS trên các loại quyết định này (CSV, viết thường: vote). "
        "Rỗng = mọi hàng (hành vi cũ byte một). Value và entropy vẫn tính trên mọi hàng.",
    )
    a = p.parse_args()
    torch.manual_seed(a.seed)

    d = load(a.data).side(a.side)
    if d.logprobs is None or d.values is None:
        raise ValueError("dataset không phải rollout (thiếu logprobs/values) — encode với --rollout")
    if len(d) == 0:
        raise ValueError(f"không còn hàng nào sau khi lọc --side {a.side}")
    model, hidden, init_residual = load_init(Path(a.init), d.obs_size, d.action_size)
    # Bản sao ĐÓNG BĂNG của init, cùng kiến trúc: mỏ neo KL và thước đo độ trôi.
    ref = copy.deepcopy(model).eval()
    for param in ref.parameters():
        param.requires_grad_(False)
    # Mỏ neo KL: champion chính thức (đã benchmark) thay vì init của vòng này —
    # qua các vòng không đo, init là challenger vòng trước và trôi cộng dồn.
    anchor = ref
    if a.anchor_model:
        anchor, _, anchor_residual = load_init(Path(a.anchor_model), d.obs_size, d.action_size)
        if (anchor_residual is None) != (init_residual is None):
            raise ValueError("--anchor-model và --init phải cùng loại policy (residual hay logits)")
        anchor.eval()
        for param in anchor.parameters():
            param.requires_grad_(False)
    opt = torch.optim.Adam(model.parameters(), lr=a.lr)

    X = torch.from_numpy(d.features)
    M = torch.from_numpy(d.masks)
    A = torch.from_numpy(d.actions)
    R = torch.from_numpy(d.rewards)
    OLD = torch.from_numpy(d.logprobs.astype(np.float32))
    DEC = torch.from_numpy(d.decisions.astype(np.int64))
    decision_names = [str(name) for name in d.meta["decisions"]]
    present = sorted(int(k) for k in np.unique(d.decisions))

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
            raise ValueError("--shaping-weight cần shaping.i8.bin — encode lại dataset bằng bản mới")
        raw = d.shaping.astype(np.float32).copy()
        shaping_wanted = wanted_decision_names(a.shaping_decisions, "--shaping-decisions", d.meta)
        if shaping_wanted is not None:
            names = np.array([str(d.meta["decisions"][int(i)]).lower() for i in d.decisions])
            raw[~np.isin(names, sorted(shaping_wanted))] = 0.0
        shaping = torch.from_numpy(raw)
    shaping_coverage = round(float((shaping.numpy() != 0).mean()), 4) if shaping is not None else None

    # Mask loss theo luật (ablation 2026-09-11: luật đêm của champion-0009 cho
    # +1,2/−2,7 theo seed - nhiễu, trong khi luật phiếu cho +2,0/+3,0. Gradient
    # đêm pha loãng update nên policy-loss chỉ ăn hàng được chọn. Value và
    # entropy giữ nguyên trên mọi hàng: value head cần hiệu chỉnh trên toàn ván,
    # entropy là điều chuẩn chung. Rỗng = hành vi cũ byte một.
    train_wanted = wanted_decision_names(a.train_decisions, "--train-decisions", d.meta)
    train_rows: torch.Tensor | None = None
    if train_wanted is not None:
        names = np.array([str(d.meta["decisions"][int(i)]).lower() for i in d.decisions])
        train_rows = torch.from_numpy(np.isin(names, sorted(train_wanted)))
        if not bool(train_rows.any()):
            raise ValueError(
                f"--train-decisions {sorted(train_wanted)} không khớp hàng nào — "
                "policy-loss sẽ mean() trên rỗng ra NaN"
            )

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
    if a.adv_norm == "role":
        adv = normalize_adv_by_role(adv, d.roles)
    else:
        adv = (adv - adv.mean()) / (adv.std() + 1e-8)

    # Value-clip cần giá trị cũ của CHÍNH policy đã rollout — thiếu cột thì dừng.
    old_values: torch.Tensor | None = None
    if a.value_clip > 0:
        if d.values is None:
            raise ValueError("--value-clip cần cột values (encode --rollout)")
        old_values = torch.from_numpy(d.values.astype(np.float32))

    gen = torch.Generator().manual_seed(a.seed)
    history = []
    for epoch in range(1, a.epochs + 1):
        model.train()
        order = torch.randperm(len(d), generator=gen)
        tot = {"policyLoss": 0.0, "valueLoss": 0.0, "entropy": 0.0, "anchor": 0.0, "approxKl": 0.0, "clipFraction": 0.0}
        kl_sum = torch.zeros(len(decision_names), dtype=torch.float64)
        kl_count = torch.zeros(len(decision_names), dtype=torch.float64)
        n = 0
        for s in range(0, len(d), a.batch_size):
            idx = order[s : s + a.batch_size]
            logits, value = model(X[idx])
            logp_all, used = policy_logp(logits, idx)
            rows = train_rows[idx] if train_rows is not None else None
            ref_logp_all = None
            if a.anchor_kl > 0:
                with torch.no_grad():
                    ref_logp_all = policy_logp(anchor(X[idx])[0], idx)[0]
            terms = ppo_loss_terms(logp_all, used, A[idx], OLD[idx], adv[idx], a.clip, rows, ref_logp_all)
            value_loss = clipped_value_loss(
                value, old_values[idx], R[idx], a.value_clip
            ) if old_values is not None else nn.functional.mse_loss(value, R[idx])
            ent_coef = entropy_coef(a.entropy, epoch, a.epochs, a.entropy_schedule)
            loss = (
                terms["policy"]
                + a.value_coef * value_loss
                - ent_coef * terms["entropy"]
                + a.anchor_kl * terms["anchor"]
            )
            opt.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 0.5)
            opt.step()
            with torch.no_grad():
                per_row = (OLD[idx] - logp_all.gather(1, A[idx].unsqueeze(1)).squeeze(1)).double()
                kl_sum += torch.bincount(DEC[idx], weights=per_row, minlength=len(decision_names))
                kl_count += torch.bincount(DEC[idx], minlength=len(decision_names)).double()
            b = len(idx)
            n += b
            for k, v in (
                ("policyLoss", terms["policy"].item()),
                ("valueLoss", value_loss.item()),
                ("entropy", terms["entropy"].item()),
                ("anchor", terms["anchor"].item()),
                ("approxKl", terms["approxKl"].item()),
                ("clipFraction", terms["clipFraction"].item()),
            ):
                tot[k] += v * b
        row = {"epoch": epoch, **{k: round(v / max(n, 1), 5) for k, v in tot.items()}}
        row["approxKlByDecision"] = {
            decision_names[k]: round(float(kl_sum[k] / kl_count[k]), 5) for k in present
        }
        history.append(row)
        print(
            f"epoch {epoch}  policy {row['policyLoss']:.4f}  value {row['valueLoss']:.4f}"
            f"  ent {row['entropy']:.3f}  anchor {row['anchor']:.5f}  kl {row['approxKl']:.5f}"
            f"  clip {row['clipFraction']:.3f}"
        )
        print("  kl theo loại: " + "  ".join(f"{k} {v:.5f}" for k, v in row["approxKlByDecision"].items()))
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
        new_logp_all, used_all = policy_logp(model(X)[0], everything)
        old_logp_all = policy_logp(ref(X)[0], everything)[0]
        same = (new_logp_all.argmax(1) == old_logp_all.argmax(1)).float()
        agree_init = float(same.mean())
        kl_rows = (old_logp_all.exp() * (old_logp_all - new_logp_all).masked_fill(~used_all, 0.0)).sum(1)
        # Theo từng loại quyết định: trung bình toàn bộ che mất lượt KHÔNG train
        # đang trôi sau lượt FINAL_VOTE gần tất định.
        agree_by_decision = {decision_names[k]: round(float(same[DEC == k].mean()), 4) for k in present}
        kl_by_decision = {decision_names[k]: round(float(kl_rows[DEC == k].mean()), 5) for k in present}

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
                "agreementWithInitByDecision": agree_by_decision,
                "klToInitByDecision": kl_by_decision,
                "anchorKl": a.anchor_kl,
                "anchorModel": a.anchor_model or str(a.init),
                "baseline": a.baseline,
                # `baselineMse` > `constantMse` nghĩa là baseline đang LÀM HẠI.
                "baselineMse": round(baseline_mse, 4),
                "shapingWeight": a.shaping_weight,
                "shapingDecisions": a.shaping_decisions or None,
                "shapingCoverage": shaping_coverage,
                "trainDecisions": a.train_decisions or None,
                "constantMse": round(constant_mse, 4),
                "valueClip": a.value_clip,
                "entropySchedule": a.entropy_schedule,
                "advNorm": a.adv_norm,
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
