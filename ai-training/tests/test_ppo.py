"""Một update PPO trên dữ liệu tổng hợp: loss giảm, mask được tôn trọng, ratio ban đầu = 1.

Bài kiểm quan trọng nhất ở đây là `approxKl` của batch ĐẦU TIÊN. PPO chỉ đúng
khi `ratio = exp(logp_mới − logp_cũ)` bắt đầu ở 1: nếu init lệch policy đã sinh
ra rollout (nạp sai trọng số, mask khác, log-softmax trên logits chưa che), ratio
bắt đầu ở một chỗ tuỳ tiện và clip cắt nhầm — loss vẫn giảm, và model vẫn học
sai trong im lặng.
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

ROWS, OBS, ACT = 256, 6, 9


def logits_case() -> None:
    torch.manual_seed(0)
    rng = np.random.default_rng(0)
    init = PolicyValueNet(OBS, ACT, 8).eval()
    feats = rng.random((ROWS, OBS), dtype=np.float32)
    masks = np.zeros((ROWS, ACT), dtype=np.uint8)
    masks[:, :4] = 1
    with torch.no_grad():
        lg, val = init(torch.from_numpy(feats))
        lp = torch.log_softmax(masked_logits(lg, torch.from_numpy(masks.astype(bool))), 1)
    actions = torch.distributions.Categorical(logits=lp).sample().numpy().astype("<i4")
    logprobs = lp[np.arange(ROWS), actions].numpy().astype("<f4")
    rewards = np.where(actions == 0, 1, -1).astype(np.int8)  # hành động 0 luôn thắng
    # Hai vai với tỉ lệ thắng LỆCH NHAU: vai 1 được thắng thêm ở nửa số hàng.
    # Không có chênh lệch này thì baseline theo vai bằng hệt baseline hằng số,
    # và bài kiểm không phân biệt được hai cách tính.
    roles = (np.arange(ROWS) % 2).astype(np.uint8)
    rewards = np.where((roles == 1) & (np.arange(ROWS) % 4 == 1), 1, rewards).astype(np.int8)

    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp) / "enc"
        d.mkdir()
        feats.astype("<f4").tofile(d / "features.f32.bin")
        masks.tofile(d / "masks.u8.bin")
        actions.tofile(d / "actions.i32.bin")
        rewards.tofile(d / "rewards.i8.bin")
        np.zeros(ROWS, np.uint8).tofile(d / "splits.u8.bin")
        roles.tofile(d / "roles.u8.bin")
        np.zeros(ROWS, np.uint8).tofile(d / "decisions.u8.bin")
        logprobs.tofile(d / "logprobs.f32.bin")
        val.numpy().astype("<f4").tofile(d / "values.f32.bin")
        meta = {
            "rows": ROWS,
            "obsSize": OBS,
            "actionSize": ACT,
            "datasetVersion": "rollout-test",
            "roles": ["A", "B"],
            "decisions": ["VOTE"],
            "featureNames": [f"f{i}" for i in range(OBS)],
            "actionNames": [f"a{i}" for i in range(ACT)],
        }
        (d / "meta.json").write_text(json.dumps(meta), encoding="utf8")
        initp = Path(tmp) / "init.weights.json"
        export_weights_json(init, meta, initp, model_id="init", training_seed=0, hidden=8)

        out = Path(tmp) / "out"
        sys.argv = [
            "train_ppo",
            "--data", str(d),
            "--init", str(initp),
            "--out", str(out),
            "--epochs", "8",
            "--batch-size", "64",
            "--model-id", "t",
            "--shaping-weight", "0",
        ]
        train_ppo.main()

        m = json.loads((out / "metrics.json").read_text(encoding="utf8"))
        assert m["history"][0]["approxKl"] < 1e-4, ("ratio ban đầu phải ≈ 1", m["history"][0])
        assert m["history"][-1]["policyLoss"] < m["history"][0]["policyLoss"], m["history"]

        # Sau update, xác suất hành động 0 (luôn thắng) phải tăng.
        new = PolicyValueNet(OBS, ACT, 8)
        new.load_state_dict(torch.load(out / "model.pt"))
        new.eval()
        with torch.no_grad():
            logits, _ = new(torch.from_numpy(feats))
            probs = torch.softmax(masked_logits(logits, torch.from_numpy(masks.astype(bool))), 1)
            p0 = probs[:, 0].mean()
            q0 = torch.softmax(lp, 1)[:, 0].mean()
            # §13: ô bị che phải giữ xác suất 0, kể cả sau khi gradient đi qua.
            assert float(probs[:, 4:].max()) < 1e-6, float(probs[:, 4:].max())
        assert p0 > q0, (p0, q0)
        assert (out / "model.weights.json").exists()
        assert m["baseline"] == "role", m["baseline"]

        # Baseline: ba cách tính, đo bằng chính MSE của chúng với reward.
        #
        # Thứ tự phải là role ≤ mean < value ở đây, và nó KHÔNG hiển nhiên:
        # `value` là value head chưa train (init ngẫu nhiên), nên nó tệ hơn cả
        # một hằng số — đúng tình huống đã gặp thật với value head của BC. Bài
        # kiểm này tồn tại để lần sau ai đổi `baseline_for` thì hỏng ngay, chứ
        # không hỏng âm thầm ở một lần chạy 3,5 giờ.
        mses = {}
        for kind in ("role", "mean", "value"):
            sub = Path(tmp) / f"out-{kind}"
            sys.argv = [
                "train_ppo",
                "--data", str(d),
                "--init", str(initp),
                "--out", str(sub),
                "--epochs", "1",
                "--batch-size", "64",
                "--model-id", f"t-{kind}",
                "--baseline", kind,
                "--shaping-weight", "0",
            ]
            train_ppo.main()
            report = json.loads((sub / "metrics.json").read_text(encoding="utf8"))
            assert report["baseline"] == kind, report["baseline"]
            mses[kind] = report["baselineMse"]
            constant = report["constantMse"]

        assert mses["mean"] == constant, (mses, constant)
        assert mses["role"] < mses["mean"], ("vai có tỉ lệ thắng lệch nhau thì role phải chặt hơn", mses)
        assert mses["value"] > constant, ("value head chưa train phải TỆ hơn hằng số", mses, constant)


def residual_case() -> None:
    """Residual (spec 2026-09-09-residual-policy D6): ratio trên softmax((bases + β·net)/τ).

    Bài kiểm cốt lõi vẫn là `approxKl` batch đầu ≈ 0 — với residual, điều đó
    chỉ đúng khi trainer dựng lại ĐÚNG phân phối đã lấy mẫu: cùng bases (điểm
    có jitter), cùng β, cùng τ, mask = tập ứng viên (NaN) chứ không phải mask
    encoder (rộng hơn bảng).
    """
    torch.manual_seed(1)
    rng = np.random.default_rng(1)
    beta, tau = 10.0, 5.0
    init = PolicyValueNet(OBS, ACT, 8).eval()
    with torch.no_grad():
        # champion-0000: policyHead = 0 → residual 0.
        init.policy_head.weight.zero_()
        init.policy_head.bias.zero_()
    feats = rng.random((ROWS, OBS), dtype=np.float32)
    masks = np.zeros((ROWS, ACT), dtype=np.uint8)
    masks[:, :5] = 1  # mask encoder RỘNG hơn bảng ứng viên
    bases = np.full((ROWS, ACT), np.nan, dtype=np.float32)
    bases[:, :4] = rng.random((ROWS, 4), dtype=np.float32) * 20  # bảng = 4 ứng viên
    cand = ~np.isnan(bases)
    with torch.no_grad():
        lg, val = init(torch.from_numpy(feats))
        adj = (torch.from_numpy(np.nan_to_num(bases)) + beta * lg) / tau
        lp = torch.log_softmax(masked_logits(adj, torch.from_numpy(cand)), 1)
    actions = torch.distributions.Categorical(logits=lp).sample().numpy().astype("<i4")
    logprobs = lp[np.arange(ROWS), actions].numpy().astype("<f4")
    rewards = np.where(actions == 0, 1, -1).astype(np.int8)
    roles = (np.arange(ROWS) % 2).astype(np.uint8)

    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp) / "enc"
        d.mkdir()
        feats.astype("<f4").tofile(d / "features.f32.bin")
        masks.tofile(d / "masks.u8.bin")
        actions.tofile(d / "actions.i32.bin")
        rewards.tofile(d / "rewards.i8.bin")
        np.zeros(ROWS, np.uint8).tofile(d / "splits.u8.bin")
        roles.tofile(d / "roles.u8.bin")
        np.zeros(ROWS, np.uint8).tofile(d / "decisions.u8.bin")
        logprobs.tofile(d / "logprobs.f32.bin")
        val.numpy().astype("<f4").tofile(d / "values.f32.bin")
        bases.astype("<f4").tofile(d / "bases.f32.bin")
        meta = {
            "rows": ROWS,
            "obsSize": OBS,
            "actionSize": ACT,
            "datasetVersion": "rollout-test",
            "roles": ["A", "B"],
            "decisions": ["VOTE"],
            "featureNames": [f"f{i}" for i in range(OBS)],
            "actionNames": [f"a{i}" for i in range(ACT)],
            "policyKind": "residual",
            "beta": beta,
            "temperature": tau,
        }
        (d / "meta.json").write_text(json.dumps(meta), encoding="utf8")
        initp = Path(tmp) / "init.weights.json"
        export_weights_json(
            init, meta, initp, model_id="res0", training_seed=0, hidden=8, residual={"beta": beta}
        )
        out = Path(tmp) / "out"
        sys.argv = [
            "train_ppo",
            "--data", str(d),
            "--init", str(initp),
            "--out", str(out),
            "--epochs", "8",
            "--batch-size", "64",
            "--model-id", "r",
            "--shaping-weight", "0",
        ]
        train_ppo.main()
        m = json.loads((out / "metrics.json").read_text(encoding="utf8"))
        assert m["history"][0]["approxKl"] < 1e-4, ("residual: ratio ban đầu phải ≈ 1", m["history"][0])
        assert m["policyKind"] == "residual" and m["beta"] == beta and m["temperature"] == tau, m
        w = json.loads((out / "model.weights.json").read_text(encoding="utf8"))
        assert w["residual"] == {"beta": beta}, w.get("residual")

        new = PolicyValueNet(OBS, ACT, 8)
        new.load_state_dict(torch.load(out / "model.pt"))
        new.eval()
        with torch.no_grad():
            lg2, _ = new(torch.from_numpy(feats))
            adj2 = (torch.from_numpy(np.nan_to_num(bases)) + beta * lg2) / tau
            p = torch.softmax(masked_logits(adj2, torch.from_numpy(cand)), 1)
        assert float(p[:, 4:].max()) < 1e-6, "ô ngoài bảng phải giữ xác suất 0"
        p0, q0 = float(p[:, 0].mean()), float(torch.softmax(lp, 1)[:, 0].mean())
        assert p0 > q0, ("hành động thắng phải tăng xác suất", p0, q0)

        # --side: chỉ train trên hàng có vai thuộc phe, đọc bảng `wolfPack` do
        # TypeScript ghi trong meta (Python không biết vai nào là Sói).
        meta_side = {**meta, "wolfPack": [False, True]}
        (d / "meta.json").write_text(json.dumps(meta_side), encoding="utf8")
        side_out = Path(tmp) / "side"
        sys.argv = ["train_ppo", "--data", str(d), "--init", str(initp), "--out", str(side_out),
                    "--epochs", "2", "--batch-size", "64", "--side", "wolves", "--shaping-weight", "0"]
        train_ppo.main()
        ms = json.loads((side_out / "metrics.json").read_text(encoding="utf8"))
        assert ms["rows"] == int((roles == 1).sum()) and ms["side"] == "wolves", (ms["rows"], ms["side"])
        # Thiếu bảng thì phải dừng, không được lặng lẽ train cả bàn.
        (d / "meta.json").write_text(json.dumps(meta), encoding="utf8")
        sys.argv = ["train_ppo", "--data", str(d), "--init", str(initp), "--out", str(Path(tmp) / "y"),
                    "--epochs", "1", "--side", "village", "--shaping-weight", "0"]
        try:
            train_ppo.main()
        except ValueError:
            pass
        else:
            raise AssertionError("--side không có wolfPack trong meta phải bị từ chối")

        # --target-kl: lr lớn đẩy KL vượt ngưỡng ngay → dừng sớm, ghi epochsRun.
        kl_out = Path(tmp) / "kl"
        sys.argv = ["train_ppo", "--data", str(d), "--init", str(initp), "--out", str(kl_out),
                    "--epochs", "8", "--batch-size", "64", "--lr", "0.05", "--target-kl", "1e-4",
                    "--shaping-weight", "0"]
        train_ppo.main()
        mk = json.loads((kl_out / "metrics.json").read_text(encoding="utf8"))
        assert mk["epochsRun"] < 8 and len(mk["history"]) == mk["epochsRun"], (mk["epochsRun"], len(mk["history"]))
        assert m["epochsRun"] == 8, m["epochsRun"]

        # Init residual nhưng rollout logits thuần (không bases) → phải dừng.
        (d / "bases.f32.bin").unlink()
        meta.update({"policyKind": "logits", "beta": None})
        (d / "meta.json").write_text(json.dumps(meta), encoding="utf8")
        sys.argv = ["train_ppo", "--data", str(d), "--init", str(initp), "--out", str(Path(tmp) / "x"),
                    "--epochs", "1", "--shaping-weight", "0"]
        try:
            train_ppo.main()
        except ValueError:
            pass
        else:
            raise AssertionError("init residual + rollout logits phải bị từ chối")


def shaping_case() -> None:
    """Shaping bonus (spec 2026-09-11 D1/D6): A += α·L trên hàng có nhãn.

    Bốn bài kiểm: (a) α > 0 thiếu cột phải dừng; (b) α = 0 cho trọng số GIỐNG
    HẰNG BYTE trên dataset có/không có cột; (c) nhãn +1 gắn hành động 0 phải
    kéo xác suất của nó lên hơn chạy α = 0; (d) --shaping-decisions lọc đúng
    và coverage trong metrics phản ánh đúng phần được giữ.
    """
    torch.manual_seed(2)
    rng = np.random.default_rng(2)
    init = PolicyValueNet(OBS, ACT, 8).eval()
    feats = rng.random((ROWS, OBS), dtype=np.float32)
    masks = np.zeros((ROWS, ACT), dtype=np.uint8)
    masks[:, :4] = 1
    with torch.no_grad():
        lg, val = init(torch.from_numpy(feats))
        lp = torch.log_softmax(masked_logits(lg, torch.from_numpy(masks.astype(bool))), 1)
    actions = torch.distributions.Categorical(logits=lp).sample().numpy().astype("<i4")
    logprobs = lp[np.arange(ROWS), actions].numpy().astype("<f4")
    rewards = rng.choice(np.array([-1, 1], dtype=np.int8), ROWS)
    roles = (np.arange(ROWS) % 2).astype(np.uint8)
    decisions = (np.arange(ROWS) % 2).astype(np.uint8)  # meta: ["VOTE", "NIGHT"]
    # Nhãn +1 cho hành động 0, −1 cho mọi hành động khác.
    shaping = np.where(actions == 0, 1, -1).astype(np.int8)

    def write(root: Path, with_shaping: bool) -> None:
        root.mkdir(parents=True, exist_ok=True)
        feats.astype("<f4").tofile(root / "features.f32.bin")
        masks.tofile(root / "masks.u8.bin")
        actions.tofile(root / "actions.i32.bin")
        rewards.tofile(root / "rewards.i8.bin")
        np.zeros(ROWS, np.uint8).tofile(root / "splits.u8.bin")
        roles.tofile(root / "roles.u8.bin")
        decisions.tofile(root / "decisions.u8.bin")
        logprobs.tofile(root / "logprobs.f32.bin")
        val.numpy().astype("<f4").tofile(root / "values.f32.bin")
        if with_shaping:
            shaping.tofile(root / "shaping.i8.bin")
        meta = {
            "rows": ROWS,
            "obsSize": OBS,
            "actionSize": ACT,
            "datasetVersion": "rollout-test",
            "roles": ["A", "B"],
            "decisions": ["VOTE", "NIGHT"],
            "featureNames": [f"f{i}" for i in range(OBS)],
            "actionNames": [f"a{i}" for i in range(ACT)],
        }
        (root / "meta.json").write_text(json.dumps(meta), encoding="utf8")

    with tempfile.TemporaryDirectory() as tmp:
        d_with = Path(tmp) / "enc-with"
        d_without = Path(tmp) / "enc-without"
        write(d_with, True)
        write(d_without, False)

        initp = Path(tmp) / "init.weights.json"
        export_weights_json(init, json.loads((d_with / "meta.json").read_text(encoding="utf8")),
                            initp, model_id="init", training_seed=0, hidden=8)
        common = ["--init", str(initp), "--epochs", "6", "--batch-size", "64", "--model-id", "sh"]

        # (a) α mặc định > 0 mà thiếu cột → dừng.
        sys.argv = ["train_ppo", "--data", str(d_without), "--out", str(Path(tmp) / "reject"), *common]
        try:
            train_ppo.main()
        except SystemExit:
            pass
        else:
            raise AssertionError("thiếu shaping.i8.bin phải bị từ chối khi --shaping-weight > 0")

        # (b) α = 0: dataset có/không có cột cho cùng trọng số — hành vi cũ byte một.
        sys.argv = ["train_ppo", "--data", str(d_without), "--out", str(Path(tmp) / "base0"), *common,
                    "--shaping-weight", "0"]
        train_ppo.main()
        sys.argv = ["train_ppo", "--data", str(d_with), "--out", str(Path(tmp) / "base1"), *common,
                    "--shaping-weight", "0"]
        train_ppo.main()
        a_state = torch.load(Path(tmp) / "base0" / "model.pt")
        b_state = torch.load(Path(tmp) / "base1" / "model.pt")
        for key in a_state:
            assert torch.equal(a_state[key], b_state[key]), f"α=0 phải byte một: lệch ở {key}"

        # (c) shaping kéo P(action 0) lên hơn chạy không shaping.
        sys.argv = ["train_ppo", "--data", str(d_with), "--out", str(Path(tmp) / "shaped"), *common]
        train_ppo.main()
        m = json.loads((Path(tmp) / "shaped" / "metrics.json").read_text(encoding="utf8"))
        assert m["shapingCoverage"] == 1.0, m["shapingCoverage"]
        assert m["config"]["shaping_weight"] == 1.0, m["config"]

        def p0(model_dir: Path) -> float:
            net = PolicyValueNet(OBS, ACT, 8)
            net.load_state_dict(torch.load(model_dir / "model.pt"))
            net.eval()
            with torch.no_grad():
                lg, _ = net(torch.from_numpy(feats))
                probs = torch.softmax(masked_logits(lg, torch.from_numpy(masks.astype(bool))), 1)
                return float(probs[:, 0].mean())

        assert p0(Path(tmp) / "shaped") > p0(Path(tmp) / "base1"), (p0(Path(tmp) / "shaped"), p0(Path(tmp) / "base1"))

        # (d) lọc theo loại quyết định: chỉ VOTE (chỉ số 0) giữ nhãn.
        sys.argv = ["train_ppo", "--data", str(d_with), "--out", str(Path(tmp) / "filtered"), *common,
                    "--shaping-decisions", "vote"]
        train_ppo.main()
        mf = json.loads((Path(tmp) / "filtered" / "metrics.json").read_text(encoding="utf8"))
        assert abs(mf["shapingCoverage"] - float((decisions == 0).mean())) < 1e-3, mf["shapingCoverage"]


def main() -> None:
    logits_case()
    residual_case()
    shaping_case()
    print("ok")


if __name__ == "__main__":
    main()
