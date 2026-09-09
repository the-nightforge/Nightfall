"""Behavior cloning: học hành động của bot heuristic (BOT_SELF_LEARNING §17).

Mục tiêu KHÔNG phải thắng. Mục tiêu là `Learned Bot ≈ Current Bot`; §17 nói rõ
chưa tái lập được baseline thì chưa được sang RL. Vì vậy số đo được nhìn ở đây
là ĐỘ KHỚP hành động trên tập validation/test, không phải loss.

Chạy:
    python -m masoi_training.train_bc --data <enc-dir> --out <model-dir>
"""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

import numpy as np
import torch
from torch import nn

from .data import SPLIT_NAMES, action_distribution, load
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


def evaluate(model: PolicyValueNet, data, device: torch.device) -> dict:
    """Độ khớp với bot heuristic, tổng thể và theo vai (§28)."""
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

    by_role: dict[str, float] = {}
    role_names = data.meta["roles"]
    for index in np.unique(data.roles):
        keep = data.roles == index
        name = role_names[int(index)] if int(index) < len(role_names) else str(index)
        by_role[name] = round(float(correct[keep].mean()), 4)

    return {
        "samples": len(data),
        "policyLoss": round(loss, 4),
        "agreement": round(float(correct.mean()), 4),
        "valueMae": round(float((value - rewards).abs().mean().item()), 4),
        "agreementByRole": by_role,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", required=True, help="Thư mục do ai:encode ghi ra")
    parser.add_argument("--out", required=True, help="Thư mục nhận model + metrics")
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=512)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--hidden", type=int, default=128)
    # §21: reward cuối ván là nhãn của value head, KHÔNG phải của policy head.
    parser.add_argument("--value-weight", type=float, default=0.5)
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

    history = []
    for epoch in range(1, args.epochs + 1):
        model.train()
        total = 0.0
        seen = 0
        for index in batches(len(train), args.batch_size, generator):
            index = index.to(device)
            logits, value = model(features[index])
            policy_loss = nn.functional.cross_entropy(
                masked_logits(logits, masks[index]), actions[index]
            )
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
        print(
            f"epoch {epoch:>3}  loss {row['trainLoss']:.4f}"
            f"  val agreement {row.get('val_agreement', float('nan'))}"
        )

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), out / "model.pt")

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
            dynamic_axes={"observation": {0: "batch"}},
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
        },
        "obsSize": full.obs_size,
        "actionSize": full.action_size,
        "splitSizes": {name: len(full.split(name)) for name in SPLIT_NAMES},
        # §43: bảng này để người đọc thấy mất cân bằng lớp, không để tự động cân.
        "trainActionDistribution": action_distribution(train),
        "history": history,
        "metrics": {
            "validation": evaluate(model, validation, device),
            "test": evaluate(model, test, device),
        },
        "onnxError": onnx_error,
    }
    (out / "metrics.json").write_text(json.dumps(report, indent=2), encoding="utf8")

    test_metrics = report["metrics"]["test"]
    print(f"\nĐã ghi {out}")
    print(f"test agreement với bot heuristic: {test_metrics.get('agreement')}")
    if onnx_error:
        print(f"CẢNH BÁO: không export được ONNX — {onnx_error}")


if __name__ == "__main__":
    main()
