"""Cổng thăng hạng mới (spec 2026-09-17 D3/D4). Chạy: python tests/test_rl_gates.py

Model logits thuần là MỘT bộ trọng số cho cả hai phe: train cho làng có thể
kéo sói xuống, và một model mạnh lên có thể đẩy cả bàn lệch khỏi 50 %. Hai cổng
này chặn đúng hai kiểu thăng hạng đó.
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rl_loop import (  # noqa: E402
    BenchRead,
    bench_cmd,
    champion_from_state,
    champion_of,
    imbalance_of,
    latest_champion_file,
    next_start,
    passes_gates,
    ppo_cmd,
    prune_iteration,
    read_bench,
    rollout_cmd,
)


def write_bench(path: Path, baseline: float, village: float, wolves: float, all_: float | None) -> Path:
    summary = [
        {"setup": "baseline", "villageWinMean": baseline},
        {"setup": "village", "villageWinMean": village},
        {"setup": "wolves", "villageWinMean": wolves},
    ]
    if all_ is not None:
        summary.append({"setup": "all", "villageWinMean": all_})
    path.write_text(json.dumps({"summary": summary}), encoding="utf8")
    return path


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)

        # imbalance đọc cấu hình `all`, theo điểm phần trăm, đối xứng quanh 50 %.
        b = write_bench(root / "a.json", 0.54, 0.56, 0.54, 0.558)
        assert abs(imbalance_of(b) - 5.8) < 1e-9, imbalance_of(b)
        b2 = write_bench(root / "b.json", 0.54, 0.56, 0.54, 0.44)
        assert abs(imbalance_of(b2) - 6.0) < 1e-9, imbalance_of(b2)

        # Thiếu `all` → ném, không trả 0 im lặng.
        missing = write_bench(root / "c.json", 0.54, 0.56, 0.54, None)
        try:
            imbalance_of(missing)
        except ValueError as error:
            assert "all" in str(error)
        else:
            raise AssertionError("imbalance_of phải ném khi thiếu cấu hình all")

        # read_bench: village → other là điểm phe sói; all → other None.
        r = read_bench(b, "village")
        assert abs(r.score - 2.0) < 1e-9 and r.other is not None and abs(r.other - 0.0) < 1e-9, r
        assert read_bench(b, "all").other is None

    champ = BenchRead(score=0.0, other=0.0, imbalance=5.8)

    # Qua cả ba cổng.
    good = [BenchRead(3.0, -0.5, 6.5), BenchRead(2.5, 0.2, 6.0)]
    assert passes_gates(good, champ, margin=2.0, balance_slack=1.0, other_slack=1.0)

    # Điểm không đủ trên bộ xác nhận → chặn (cổng cũ vẫn đứng đầu).
    assert not passes_gates([BenchRead(3.0, 0.0, 5.0), BenchRead(1.9, 0.0, 5.0)], champ, 2.0, 1.0, 1.0)

    # Lệch cân bằng vượt champion + slack trên MỘT bộ seed → chặn.
    assert not passes_gates([BenchRead(3.0, 0.0, 6.9), BenchRead(3.0, 0.0, 5.0)], champ, 2.0, 1.0, 1.0)
    # Slack âm = tắt cổng cân bằng.
    assert passes_gates([BenchRead(3.0, 0.0, 30.0)], champ, 2.0, -1.0, 1.0)

    # Phe kia tụt quá slack → chặn; đúng bằng slack → qua.
    assert not passes_gates([BenchRead(3.0, -1.1, 5.0)], champ, 2.0, 1.0, 1.0)
    assert passes_gates([BenchRead(3.0, -1.0, 5.0)], champ, 2.0, 1.0, 1.0)
    # Slack âm = tắt cổng phe kia.
    assert passes_gates([BenchRead(3.0, -9.0, 5.0)], champ, 2.0, 1.0, -1.0)
    # --side all: champion.other None → bỏ qua cổng phe kia.
    assert passes_gates([BenchRead(3.0, None, 5.0)], BenchRead(0.0, None, 5.8), 2.0, 1.0, 1.0)

    # Cổng phe kia/cân bằng chỉ chấm bộ seed ĐẦU: champion chỉ được đo ở đó.
    # (2026-09-21: b-village vòng 10 bị loại vì phe sói của BỘ XÁC NHẬN.)
    conf_drop = [BenchRead(8.6, 5.1, 14.7), BenchRead(13.7, 2.6, 12.9)]
    assert passes_gates(conf_drop, BenchRead(0.2, 5.8, 0.4), 2.0, -1.0, 1.0)
    # Nhưng tụt ở chính bộ đầu thì vẫn chặn.
    primary_drop = [BenchRead(8.6, 4.7, 14.7), BenchRead(13.7, 5.9, 12.9)]
    assert not passes_gates(primary_drop, BenchRead(0.2, 5.8, 0.4), 2.0, -1.0, 1.0)

    # Champion mới lấy chiều bi quan trên mọi bộ seed.
    new = champion_of([BenchRead(3.0, -0.5, 6.5), BenchRead(2.5, 0.2, 6.0)])
    assert new == BenchRead(2.5, -0.5, 6.5), new
    assert champion_of([BenchRead(3.0, None, 6.5)]).other is None

    # State cũ (trước spec 2026-09-17) thiếu hai khoá mới → lấy từ bench champion-0000.
    initial = BenchRead(score=0.0, other=-0.3, imbalance=5.8)
    assert champion_from_state({"champion": None}, initial) == initial
    legacy = {"champion": "x.json", "championScore": 2.4}
    assert champion_from_state(legacy, initial) == BenchRead(2.4, -0.3, 5.8)
    full = {"champion": "x.json", "championScore": 2.4, "championOther": 0.1, "championImbalance": 6.2}
    assert champion_from_state(full, initial) == BenchRead(2.4, 0.1, 6.2)

    # Mọi lệnh rollout/benchmark mang cùng một cờ bốn lượt (D2).
    decisions = "vote,night,final,hunter"
    bench = bench_cmd(Path("m.json"), "rl-bench", Path("b.json"), 300, 3, decisions)
    assert bench[bench.index("--learned-decisions") + 1] == decisions, bench
    assert bench[bench.index("--setups") + 1] == "baseline,village,wolves,all", bench
    assert bench[bench.index("--seed") + 1] == "rl-bench", bench
    roll = rollout_cmd(Path("m.json"), "village", 3, Path("part"), 1000, 1.0, decisions)
    assert roll[roll.index("--learned-decisions") + 1] == decisions, roll
    assert roll[roll.index("--learned-seats") + 1] == "village", roll
    assert roll[roll.index("--seed") + 1] == "rl-3-village", roll
    assert roll[roll.index("--trace-games") + 1] == "1000", roll
    assert "--opponent-policy" not in roll, roll
    opp = rollout_cmd(Path("m.json"), "village", 3, Path("part"), 1000, 1.0, decisions, Path("ppo1.json"))
    assert opp[opp.index("--opponent-policy") + 1] == "ppo1.json", opp
    assert opp[opp.index("--learned-seats") + 1] == "village", opp

    # Điểm xuất phát vòng sau (2026-09-17): giai đoạn 1 train tiếp vòng 6–10 từ
    # model đã bị benchmark loại ở vòng 5 (−3,56) và kết thúc ở −7,0.
    best = Path("champions/champion-0000.weights.json")
    challenger = Path("iter-0005/model/model.weights.json")
    assert next_start(False, challenger, best) == challenger  # vòng không đo: đi tiếp
    assert next_start(True, challenger, best) == best  # vòng đo, không thăng hạng: quay về champion
    promoted = Path("champions/champion-0005.weights.json")
    assert next_start(True, challenger, promoted) == promoted  # thăng hạng: đi từ bản sao chính thức

    with tempfile.TemporaryDirectory() as tmp:
        champions = Path(tmp)
        for name in ("champion-0000", "champion-0005", "champion-0010"):
            (champions / f"{name}.weights.json").write_text("{}", encoding="utf8")
        assert latest_champion_file(champions).name == "champion-0010.weights.json"

    # Lệnh PPO mang hệ số neo (mặc định rl_loop 0,1) và các cờ train đi kèm.
    args = argparse.Namespace(
        baseline="role", side="village", lr=1e-4, shaping_alpha=1.0, shaping_decisions="",
        train_decisions="vote,final_vote,hunter_shot", target_kl=0.01, anchor_kl=0.1,
    )
    ppo = ppo_cmd(Path("enc"), Path("champ.json"), Path("best.json"), Path("model"), "ppo-0001", args)
    assert ppo[ppo.index("--anchor-kl") + 1] == "0.1", ppo
    assert ppo[ppo.index("--anchor-model") + 1] == "best.json", ppo
    assert ppo[ppo.index("--init") + 1] == "champ.json", ppo
    assert ppo[ppo.index("--train-decisions") + 1] == "vote,final_vote,hunter_shot", ppo
    assert "--shaping-decisions" not in ppo, ppo

    # Dọn rollout của vòng đã xong (~3 GB/vòng 3000 ván): chỉ dữ liệu train,
    # giữ model, benchmark và dấu .done để resume vẫn bỏ qua đúng các bước.
    with tempfile.TemporaryDirectory() as tmp:
        it = Path(tmp) / "iter-0001"
        for sub in ("roll-all", "roll-village", "roll-wolves", "enc", "model"):
            (it / sub).mkdir(parents=True)
            (it / sub / "data.bin").write_bytes(b"x" * 100)
        (it / "trajectories.jsonl").write_bytes(b"y" * 50)
        (it / "bench.json").write_text("{}", encoding="utf8")
        (it / "bench-confirm.json").write_text("{}", encoding="utf8")
        (it / ".ppo.done").write_text("ok", encoding="utf8")
        freed = prune_iteration(it)
        assert freed == 3 * 100 + 100 + 50, freed
        left = sorted(p.name for p in it.iterdir())
        assert left == [".ppo.done", "bench-confirm.json", "bench.json", "model"], left
        assert (it / "model" / "data.bin").exists()
        assert prune_iteration(it) == 0  # chạy lại: không lỗi, không còn gì để xoá

    print("ok")


if __name__ == "__main__":
    main()
