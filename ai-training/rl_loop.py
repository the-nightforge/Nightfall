"""Vòng lặp RL: rollout (TS) → PPO (Py) → benchmark (TS) → thăng hạng (spec R5).

Chạy từ thư mục ai-training. Champion là file JSON bất biến; challenger chỉ
thay champion khi điểm benchmark cao hơn ít nhất 2 điểm trên HAI bộ seed độc
lập (xem `should_promote` — một bộ seed đã từng cho +4,7 rồi −3,2 cho cùng
một model).

CHẠY TIẾP ĐƯỢC là yêu cầu, không phải tiện nghi: 20 vòng là ~3,5 giờ và người ta
sẽ tắt máy giữa chừng. Mỗi bước xong ghi một dấu `.done` cạnh sản phẩm của nó và
lượt sau bỏ qua. Dấu được ghi SAU khi tiến trình con thoát 0 — chứ không phải khi
file sản phẩm tồn tại — vì một tiến trình bị giết giữa lúc ghi để lại một file
cụt, và một file cụt được "bỏ qua" là cách im lặng nhất để hỏng cả đêm chạy.

RESIDUAL: champion có thể là file do `masoi_training.init_residual` tạo (model tự
khai `residual.beta`; engine tự đi đường hiệu chỉnh điểm heuristic). Vòng lặp
không đổi; chạy với `--temperature 5` vì thang điểm là belief 0..100 (τ = 1 gần
như argmax). Benchmark đo bốn cấu hình; `all` chỉ để đọc CÂN BẰNG cả bàn,
`score_of` vẫn thăng hạng theo `village`/`wolves` (sức mạnh từng phe).
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PY = sys.executable

# Thứ tự CỐ ĐỊNH của ba phần rollout: file gộp phải tất định, nếu không thì hai
# lần chạy cùng seed cho ra hai tập train khác nhau và không so được với nhau.
SEATS = ("all", "village", "wolves")


def tool(name: str) -> str:
    """`npm`/`npx` trên Windows là `npm.cmd`; `subprocess` không tự tìm ra."""
    return shutil.which(name) or name


# Console Windows mặc định là cp1252, và mọi thứ ở đây in tiếng Việt.
ENV = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}


def run(cmd: list[str], cwd: Path = ROOT) -> None:
    print("$", " ".join(cmd), flush=True)
    subprocess.run(cmd, cwd=cwd, check=True, env=ENV)


def done_marker(directory: Path, name: str) -> Path:
    """Dấu "bước `name` trong `directory` đã xong". Tên bước, không phải tên file
    sản phẩm: một bước có thể sinh nhiều file, và "file cuối tồn tại" không đồng
    nghĩa với "bước đã chạy xong"."""
    return directory / f".{name}.done"


def step(marker: Path, cmd: list[str], cwd: Path = ROOT) -> None:
    """Chạy `cmd` trừ khi lần trước đã chạy xong. Dấu chỉ ghi khi thoát 0."""
    if marker.exists():
        print(f"  bỏ qua (đã xong): {marker.name}", flush=True)
        return
    run(cmd, cwd)
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text("ok", encoding="utf8")


def score_of(bench_json: Path, side: str = "all") -> float:
    """Điểm của một model = trung bình hai chiều lợi thế, tính bằng ĐIỂM PHẦN TRĂM.

    `side` = wolves/village: chỉ Δ của phe đó — model train cho một phe thì
    phe kia đi đường residual chưa được dạy, và Δ của nó không phải thứ đang đo.

    Đọc `summary` của `ai:benchmark` THEO TÊN cấu hình, không theo vị trí:
    `--setups` cho phép thêm bớt hàng, và một vòng lặp đọc nhầm hàng `teacher`
    thành `wolves` sẽ thăng hạng theo một con số vô nghĩa mà không ai thấy.
    Làng mạnh lên đẩy `villageWin` LÊN, sói mạnh lên đẩy nó XUỐNG — nên phải trừ
    ngược chiều, không phải cộng hai hiệu.
    """
    b = json.loads(bench_json.read_text(encoding="utf8"))
    by = {s.get("setup"): s["villageWinMean"] for s in b["summary"]}
    missing = [name for name in ("baseline", "village", "wolves") if name not in by]
    if missing:
        raise ValueError(f"{bench_json}: thiếu cấu hình {missing} — benchmark phải chạy baseline,village,wolves")
    base, village, wolves = by["baseline"], by["village"], by["wolves"]
    if side == "village":
        return (village - base) * 100
    if side == "wolves":
        return (base - wolves) * 100
    return ((village - base) + (base - wolves)) / 2 * 100


def should_promote(scores: list[float], champion: float, margin: float) -> bool:
    """Thăng hạng khi MỌI bộ seed đều vượt `champion + margin`.

    Một bộ seed không đủ, và sai số chuẩn in ra từ 3 seed cũng không đủ để tin:
    2026-09-10, challenger `--side wolves` đạt +4,7 ± 1,9 trên `rl-bench` rồi cho
    −3,2 ± 1,8 trên `rl-conf` — cùng model, cùng số ván, chỉ khác bộ seed. Gộp 6
    seed ra +0,7 ± 2,1, tức không có hiệu ứng nào. Cổng AND ở đây loại đúng
    trường hợp đó, và cái giá là một lần benchmark thêm CHỈ khi có ứng viên.
    """
    return len(scores) > 0 and all(s > champion + margin for s in scores)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--champion", required=True, help="model.weights.json xuất phát")
    p.add_argument("--iterations", type=int, default=3)
    p.add_argument("--games", type=int, default=600, help="Tổng số ván rollout mỗi vòng (chia ba)")
    p.add_argument("--bench-games", type=int, default=300)
    p.add_argument("--bench-repeat", type=int, default=3)
    p.add_argument("--bench-every", type=int, default=1)
    p.add_argument("--out", default=".tmp/rl")
    p.add_argument("--promote-margin", type=float, default=2.0)
    p.add_argument("--temperature", type=float, default=1.0, help="policy logits: 1; residual: 5 (thang belief)")
    p.add_argument("--baseline", default="role", help="Xem train_ppo.baseline_for")
    p.add_argument("--side", default="all", choices=("all", "wolves", "village"),
                   help="Train residual cho MỘT phe; điểm thăng hạng = Δ của phe đó")
    p.add_argument("--target-kl", type=float, default=None, help="Xem train_ppo --target-kl")
    p.add_argument("--confirm-seed", default="rl-conf",
                   help="Tiền tố seed ĐỘC LẬP để xác nhận trước khi thăng hạng; rỗng = tắt (không khuyến nghị)")
    p.add_argument("--lr", type=float, default=3e-4, help="Xem train_ppo --lr")
    p.add_argument("--resume", action=argparse.BooleanOptionalAction, default=True)
    a = p.parse_args()

    out = (ROOT / a.out).resolve()
    champions = out / "champions"
    champions.mkdir(parents=True, exist_ok=True)

    state_path = out / "state.json"
    state = (
        json.loads(state_path.read_text(encoding="utf8"))
        if (a.resume and state_path.exists())
        else {"done": [], "champion": None, "championScore": None, "scores": []}
    )
    # State ghi bởi bản cũ có thể thiếu khoá; thiếu một khoá không phải lý do để
    # vứt cả một đêm chạy.
    state.setdefault("scores", [])

    def save_state() -> None:
        state_path.write_text(json.dumps(state, indent=2), encoding="utf8")

    champion = champions / "champion-0000.weights.json"
    if not champion.exists():
        shutil.copy(a.champion, champion)

    bench0 = out / "bench-champion-0000.json"
    step(
        done_marker(out, "bench-0000"),
        [tool("npm"), "run", "ai:benchmark", "--", "--model", str(champion),
         "--games", str(a.bench_games), "--repeat", str(a.bench_repeat),
         "--setups", "baseline,village,wolves,all",
         "--seed", "rl-bench", "--out", str(bench0)],
    )
    champion_score = score_of(bench0, a.side)
    print(f"champion điểm {champion_score:+.1f}", flush=True)

    # Khôi phục champion đã thăng hạng ở lần chạy trước. Đặt SAU bench0 để lần
    # chạy đầu vẫn có điểm xuất phát, và trước vòng lặp để rollout đi từ đúng nó.
    if state["champion"]:
        champion = Path(state["champion"])
        champion_score = state["championScore"]
        print(f"tiếp tục từ {champion.name} điểm {champion_score:+.1f}", flush=True)

    for k in range(1, a.iterations + 1):
        if k in state["done"]:
            print(f"vòng {k}: đã xong, bỏ qua", flush=True)
            continue
        it = out / f"iter-{k:04d}"
        it.mkdir(exist_ok=True)

        # Ba phần seats độc lập nhau → chạy cùng lúc. Máy 16 lõi; ĐỪNG đưa lên
        # GitHub Actions (runner 2 lõi, đã gỡ role-power.yml vì đúng lý do đó).
        def rollout_one(seats: str, iteration: int = k, source: Path = champion) -> None:
            part = it / f"roll-{seats}"
            step(
                done_marker(it, f"roll-{seats}"),
                [tool("npx"), "tsx", "apps/server/scripts/selfplay.ts",
                 "--games", str(a.games // 3), "--players", "8", "--preset", "--defense",
                 "--seed", f"rl-{iteration}-{seats}", "--policy", str(source),
                 "--temperature", str(a.temperature), "--learned-seats", seats,
                 "--trajectories", str(part), "--trace-games", str(a.games // 3), "--quiet"],
            )

        with ThreadPoolExecutor(max_workers=3) as pool:
            list(pool.map(rollout_one, SEATS))

        # Gộp CHỈ sau khi cả ba xong, theo thứ tự cố định.
        merged = it / "trajectories.jsonl"
        merge_marker = done_marker(it, "merge")
        if not merge_marker.exists():
            with merged.open("w", encoding="utf8") as f:
                for seats in SEATS:
                    f.write((it / f"roll-{seats}" / "trajectories.jsonl").read_text(encoding="utf8"))
            merge_marker.write_text("ok", encoding="utf8")

        enc = it / "enc"
        step(
            done_marker(it, "validate"),
            [tool("npm"), "run", "ai:validate-dataset", "--", str(merged)],
        )
        step(
            done_marker(it, "encode"),
            [tool("npm"), "run", "ai:encode", "--", "--in", str(merged), "--out", str(enc), "--rollout"],
        )

        model_id = f"ppo-{k:04d}"
        model_dir = it / "model"
        step(
            done_marker(it, "ppo"),
            [PY, "-m", "masoi_training.train_ppo", "--data", str(enc),
             "--init", str(champion), "--out", str(model_dir), "--model-id", model_id,
             "--baseline", a.baseline, "--side", a.side, "--lr", str(a.lr),
             *(["--target-kl", str(a.target_kl)] if a.target_kl is not None else [])],
            cwd=ROOT / "ai-training",
        )
        challenger = model_dir / "model.weights.json"

        # Benchmark tốn 6/16 phút mỗi vòng. Vòng không đo: challenger vẫn thành
        # điểm xuất phát của vòng sau (nó là kết quả của một update thật), nhưng
        # KHÔNG vào `champions/` — champion chính thức chỉ đổi khi có điểm.
        should_bench = (k % a.bench_every == 0) or (k == a.iterations)
        if not should_bench:
            print(f"vòng {k}: bỏ benchmark (--bench-every)", flush=True)
            champion = challenger
        else:
            bench = it / "bench.json"
            step(
                done_marker(it, "bench"),
                [tool("npm"), "run", "ai:benchmark", "--", "--model", str(challenger),
                 "--games", str(a.bench_games), "--repeat", str(a.bench_repeat),
                 "--setups", "baseline,village,wolves,all",
                 "--seed", "rl-bench", "--out", str(bench)],
            )
            s = score_of(bench, a.side)
            print(f"iteration {k}: challenger {s:+.1f} vs champion {champion_score:+.1f}", flush=True)
            row = {"iteration": k, "modelId": model_id, "score": round(s, 2)}
            scores = [s]
            # Bộ seed thứ hai chỉ chạy khi bộ thứ nhất đã vượt ngưỡng: nó tốn
            # thêm một lần benchmark, nhưng chỉ ở những vòng hiếm có ứng viên.
            if a.confirm_seed and should_promote(scores, champion_score, a.promote_margin):
                conf = it / "bench-confirm.json"
                step(
                    done_marker(it, "bench-confirm"),
                    [tool("npm"), "run", "ai:benchmark", "--", "--model", str(challenger),
                     "--games", str(a.bench_games), "--repeat", str(a.bench_repeat),
                     "--setups", "baseline,village,wolves,all",
                     "--seed", a.confirm_seed, "--out", str(conf)],
                )
                c = score_of(conf, a.side)
                scores.append(c)
                row["confirmScore"] = round(c, 2)
                print(f"  xác nhận trên seed {a.confirm_seed}: {c:+.1f}", flush=True)
            state["scores"].append(row)
            if should_promote(scores, champion_score, a.promote_margin):
                champion = champions / f"champion-{k:04d}.weights.json"
                shutil.copy(challenger, champion)
                champion_score = min(scores)
                print(f"THĂNG HẠNG → {champion.name}", flush=True)
            else:
                print("GIỮ champion", flush=True)

        state["done"].append(k)
        state["champion"] = str(champion)
        state["championScore"] = champion_score
        save_state()

    print(f"xong. champion: {champion} điểm {champion_score:+.1f}")


if __name__ == "__main__":
    main()
