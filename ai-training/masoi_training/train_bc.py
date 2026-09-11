"""Behavior cloning: học hành động của bot heuristic (BOT_SELF_LEARNING §17).

Mục tiêu KHÔNG phải thắng. Mục tiêu là `Learned Bot ≈ Current Bot`; §17 nói rõ
chưa tái lập được baseline thì chưa được sang RL. Vì vậy số đo được nhìn ở đây
là ĐỘ KHỚP hành động trên tập validation/test, không phải loss.

Chạy:
    python -m masoi_training.train_bc --data <enc-dir> --out <model-dir>
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
from .data import SPLIT_NAMES, action_distribution, load
from .export import export_weights_json
from .model import PolicyValueNet, masked_logits


def git_commit() -> str | None:
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    except Exception:
        return None


def batches(count: int, size: int, generator: torch.Generator):
    order = torch.randperm(count, generator=generator)
    for start in range(0, count, size):
        yield order[start : start + size]


def _group_means(correct: np.ndarray, groups: np.ndarray, names: list[str]) -> dict[str, float]:
    out: dict[str, float] = {}
    for index in np.unique(groups):
        keep = groups == index
        name = names[int(index)] if int(index) < len(names) else str(index)
        out[name] = round(float(correct[keep].mean()), 4)
    return out


def evaluate(model: PolicyValueNet, data, device: torch.device) -> dict:
    """Độ khớp với bot heuristic: tổng thể, theo vai (§28) và theo loại quyết định.

    `agreement` là argmax trùng nước bot đã đi. `top2Agreement` là nước đó nằm
    trong hai lựa chọn cao nhất của model — thước đo mềm hơn, để nhìn thấy
    tiến bộ trên tập có jitter, nơi argmax bị chặn trần bởi RNG của chính bot.
    """
    if len(data) == 0:
        return {"samples": 0}
    model.eval()
    with torch.no_grad():
        features = torch.from_numpy(data.features).to(device)
        masks = torch.from_numpy(data.masks).to(device)
        actions = torch.from_numpy(data.actions).to(device)
        rewards = torch.from_numpy(data.rewards).to(device)

        logits, value = model(features)
        logits = masked_logits(logits, masks)
        loss = nn.functional.cross_entropy(logits, actions).item()
        predicted = logits.argmax(dim=1)
        correct = (predicted == actions).cpu().numpy()
        top2 = logits.topk(2, dim=1).indices
        in_top2 = (top2 == actions.unsqueeze(1)).any(dim=1).cpu().numpy()

    # `agreementTieAware`: chấm đúng khi nước model chọn HOÀ đỉnh với teacher.
    # `agreement` chấm oan mọi nước hoà điểm mà teacher phá hoà bằng id thô —
    # thông tin §9 cố tình giấu khỏi observation, nên model không thể học nó.
    tie_aware = None
    if data.optimal is not None:
        pred = predicted.cpu().numpy()
        tie_aware = round(float(data.optimal[np.arange(len(pred)), pred].mean()), 4)

    return {
        "samples": len(data),
        "policyLoss": round(loss, 4),
        "agreement": round(float(correct.mean()), 4),
        "agreementTieAware": tie_aware,
        "top2Agreement": round(float(in_top2.mean()), 4),
        "valueMae": round(float((value - rewards).abs().mean().item()), 4),
        "agreementByRole": _group_means(correct, data.roles, data.meta["roles"]),
        "agreementByDecision": _group_means(
            correct, data.decisions, data.meta.get("decisions", [])
        ),
    }


def main() -> None:
    force_utf8_console()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", required=True, help="Thư mục do ai:encode ghi ra")
    parser.add_argument("--out", required=True, help="Thư mục nhận model + metrics")
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--batch-size", type=int, default=512)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--hidden", type=int, default=128)
    # §21: reward cuối ván là nhãn của value head, KHÔNG phải của policy head.
    # Mặc định 0 cho behavior cloning: một timestep đơn lẻ gần như không dự
    # đoán được kết cục (MAE ≈ 1.0, tức đoán 0), nên trọng số dương chỉ lấy
    # sức chứa của policy head mà không đổi lại gì. Bật lên khi tới RL.
    parser.add_argument("--value-weight", type=float, default=0.0)
    # Distillation theo ĐIỂM của teacher (`scores.f32.bin`): loss =
    # (1−α)·CE(nước đã chọn) + α·CE-mềm(softmax(điểm/τ)). Vì sao: 80% nước bản
    # sao lệch teacher là "teacher ở hạng 2 của model" — nó có đúng tập ứng viên
    # nhưng sai thứ tự giữa hai người đứng đầu, và nhãn one-hot không nói gì về
    # thứ tự đó. Điểm thì có. Mặc định 0 = hành vi cũ, byte một.
    parser.add_argument("--distill-alpha", type=float, default=0.0)
    # τ theo thang điểm teacher: gap top-1/top-2 ở VOTE median ≈ 2,7, p75 ≈ 6,
    # p90 ≈ 9; τ = 3 cho gap 3 → tỉ lệ ~2,7:1, gap 9 → ~20:1. Lượt đêm hoà đỉnh
    # nhiều (median gap 0) → target tự chia đều giữa các ô hoà, đúng ý tie-aware.
    parser.add_argument("--distill-tau", type=float, default=3.0)
    parser.add_argument("--seed", type=int, default=12345)
    parser.add_argument("--model-id", default="policy-v001")
    args = parser.parse_args()

    # §45/§46: cùng seed + cùng dataset phải cho cùng model.
    torch.manual_seed(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    full = load(args.data)
    train = full.split("train")
    validation = full.split("validation")
    test = full.split("test")
    if len(train) == 0:
        raise SystemExit("tập train rỗng — kiểm lại ai:encode")

    model = PolicyValueNet(full.obs_size, full.action_size, args.hidden).to(device)
    optimiser = torch.optim.Adam(model.parameters(), lr=args.lr)
    generator = torch.Generator().manual_seed(args.seed)

    features = torch.from_numpy(train.features).to(device)
    masks = torch.from_numpy(train.masks).to(device)
    actions = torch.from_numpy(train.actions).to(device)
    rewards = torch.from_numpy(train.rewards).to(device)

    # Phân phối mục tiêu của teacher, tính MỘT lần: softmax(điểm/τ) trên các ô
    # ứng viên, 0 ở mọi ô khác. Chỉ áp cho hàng có ≥ 2 ứng viên VÀ nước đã chọn
    # là một ứng viên: khi teacher bỏ phiếu trắng / giữ thuốc, bảng ứng viên vẫn
    # có điểm nhưng nước thật là "không ai" — hai nhãn mâu thuẫn, và CE giữ nhãn
    # thật.
    teacher_q = None
    distill_rows = None
    if args.distill_alpha > 0:
        if train.scores is None:
            raise SystemExit("--distill-alpha cần scores.f32.bin — encode lại bằng bản mới")
        raw = torch.from_numpy(train.scores).to(device)
        has = ~torch.isnan(raw)
        teacher_logits = torch.where(has, torch.nan_to_num(raw) / args.distill_tau, torch.full_like(raw, -1e9))
        teacher_q = torch.softmax(teacher_logits, dim=1)
        chosen_is_candidate = has.gather(1, actions.unsqueeze(1)).squeeze(1)
        distill_rows = (has.sum(dim=1) >= 2) & chosen_is_candidate
        print(
            f"distill α={args.distill_alpha} τ={args.distill_tau}: "
            f"{int(distill_rows.sum())}/{len(train)} hàng có target mềm"
        )

    history = []
    # Giữ trọng số của epoch có val agreement cao nhất, không phải epoch cuối:
    # với tập nhỏ, đường cong còn nhiễu và epoch cuối không phải epoch tốt nhất.
    best_state = copy.deepcopy(model.state_dict())
    best_epoch = 0
    best_agreement = -1.0
    for epoch in range(1, args.epochs + 1):
        model.train()
        total = 0.0
        seen = 0
        for index in batches(len(train), args.batch_size, generator):
            index = index.to(device)
            logits, value = model(features[index])
            masked = masked_logits(logits, masks[index])
            if teacher_q is None:
                policy_loss = nn.functional.cross_entropy(masked, actions[index])
            else:
                # Trộn THEO TỪNG HÀNG, không theo batch: hàng không có target
                # mềm (teacher bỏ phiếu trắng / giữ thuốc) phải giữ nguyên CE,
                # nếu không thì với α = 1 model không bao giờ học "không treo
                # ai" — đã xảy ra: tie-aware rơi từ 0,946 xuống 0,893.
                logp = torch.log_softmax(masked, dim=1)
                hard = -logp.gather(1, actions[index].unsqueeze(1)).squeeze(1)
                soft = -(teacher_q[index] * logp).sum(dim=1)
                alpha = torch.where(
                    distill_rows[index],
                    torch.full_like(hard, args.distill_alpha),
                    torch.zeros_like(hard),
                )
                policy_loss = ((1 - alpha) * hard + alpha * soft).mean()
            value_loss = nn.functional.mse_loss(value, rewards[index])
            loss = policy_loss + args.value_weight * value_loss

            optimiser.zero_grad()
            loss.backward()
            optimiser.step()

            total += float(loss.item()) * len(index)
            seen += len(index)

        row = {"epoch": epoch, "trainLoss": round(total / max(seen, 1), 4)}
        row.update({f"val_{k}": v for k, v in evaluate(model, validation, device).items()})
        history.append(row)
        # Chọn theo tie-aware khi có: `agreement` cũ chấm oan nước hoà điểm, và
        # chọn epoch theo nó là chọn epoch đoán trúng cách phá hoà bằng id thô.
        agreement = row.get("val_agreementTieAware")
        if agreement is None:
            agreement = row.get("val_agreement")
        if agreement is not None and agreement > best_agreement:
            best_agreement = agreement
            best_epoch = epoch
            best_state = copy.deepcopy(model.state_dict())
        print(
            f"epoch {epoch:>3}  loss {row['trainLoss']:.4f}"
            f"  val agreement {row.get('val_agreement', float('nan'))}"
            f"  tie-aware {row.get('val_agreementTieAware')}"
        )

    if best_epoch > 0:
        model.load_state_dict(best_state)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), out / "model.pt")

    # Đường vào runtime TypeScript: trọng số thuần JSON, kèm schema encoder
    # để `loadMlpPolicy` từ chối một model train trên vector khác.
    export_weights_json(
        model,
        full.meta,
        out / "model.weights.json",
        model_id=args.model_id,
        training_seed=args.seed,
        hidden=args.hidden,
    )

    # §39: ONNX là đường vào runtime TypeScript. Không có exporter thì vẫn giữ
    # được model.pt — thiếu ONNX là bất tiện, không phải mất kết quả train.
    onnx_error = None
    try:
        torch.onnx.export(
            model,
            torch.zeros(1, full.obs_size, device=device),
            out / "model.onnx",
            input_names=["observation"],
            output_names=["policyLogits", "value"],
            # Khoá là tên tham số của forward, không phải tên input ONNX —
            # exporter dynamo của torch từ chối dict lệch tên ngay ở bước export.
            dynamic_shapes={"features": {0: "batch"}},
        )
    except Exception as error:  # pragma: no cover - phụ thuộc bản torch
        onnx_error = str(error)

    report = {
        # §46: model không truy được về dataset/commit/seed là model không tái lập được.
        "modelId": args.model_id,
        "gitCommit": git_commit(),
        "datasetVersion": full.meta.get("datasetVersion"),
        "datasetGitCommit": full.meta.get("gitCommit"),
        "trainingSeed": args.seed,
        "trainingConfig": {
            "epochs": args.epochs,
            "batchSize": args.batch_size,
            "lr": args.lr,
            "hidden": args.hidden,
            "valueWeight": args.value_weight,
            "distillAlpha": args.distill_alpha,
            "distillTau": args.distill_tau,
        },
        "obsSize": full.obs_size,
        "actionSize": full.action_size,
        "splitSizes": {name: len(full.split(name)) for name in SPLIT_NAMES},
        "bestEpoch": best_epoch,
        # §43: bảng này để người đọc thấy mất cân bằng lớp, không để tự động cân.
        "trainActionDistribution": action_distribution(train),
        "history": history,
        "metrics": {
            # Phân biệt HAI nguyên nhân trông giống nhau từ ngoài: train ≈ val
            # nghĩa là underfit (model chưa khai thác hết thứ nó đang thấy, hoặc
            # observation không đủ để quyết định); train ≫ val nghĩa là overfit.
            # Hai chẩn đoán dẫn tới hai việc trái ngược nhau.
            "train": evaluate(model, train, device),
            "validation": evaluate(model, validation, device),
            "test": evaluate(model, test, device),
        },
        "onnxError": onnx_error,
    }
    (out / "metrics.json").write_text(json.dumps(report, indent=2), encoding="utf8")

    test_metrics = report["metrics"]["test"]
    print(f"\nĐã ghi {out} (epoch tốt nhất: {best_epoch})")
    for name in ("train", "validation", "test"):
        entry = report["metrics"][name]
        print(
            f"  {name:<11} agreement {entry.get('agreement')}"
            f"  (tie-aware: {entry.get('agreementTieAware')}"
            f", top-2 {entry.get('top2Agreement')})"
        )

    train_score = report["metrics"]["train"].get("agreement", 0)
    gap = train_score - report["metrics"]["validation"].get("agreement", 0)
    print(
        "\nCHẨN ĐOÁN: "
        + (
            "overfit — giảm hidden/epochs hoặc thêm dữ liệu"
            if gap > 0.05
            else "underfit — model chưa khai thác hết thứ nó ĐANG thấy, "
            "hoặc observation chưa đủ để quyết định"
        )
        + f"  (train − val = {gap:+.4f})"
    )
    if onnx_error:
        print(f"CẢNH BÁO: không export được ONNX — {onnx_error}")


if __name__ == "__main__":
    main()
