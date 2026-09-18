"""Chạy RL (PPO từ bản sao BC) theo từng giai đoạn trên máy local — resume được.

Cùng thí nghiệm, cùng tên thư mục và cờ với mục 6 của `colab/train_bc_local.ipynb`,
`colab/train_rl_colab.ipynb` và `colab/train_rl_kaggle.ipynb` (spec
`docs/superpowers/specs/2026-09-17-rl-ppo-from-bc-design.md`, v3/D11), nên kết quả
của các nơi chạy dùng chung được.

Chạy từ thư mục gốc repo (Git Bash):

    ai-training/.venv/Scripts/python.exe ai-training/rl_stages.py village
    ai-training/.venv/Scripts/python.exe ai-training/rl_stages.py status

Thứ tự: village → (village-lr3) → wolves → (wolves-lr3) → night (tuỳ chọn) → confirm.
Dòng cuối luôn in `>>> NEXT:`.

Tắt máy giữa chừng: chạy lại ĐÚNG lệnh đó. `rl_loop` bỏ qua mọi vòng và mọi bước
đã xong (`state.json` + dấu `.done`); chỉ bước đang dở làm lại. Trong lúc chạy,
script giữ Windows không ngủ (SetThreadExecutionState) và trả lại khi thoát.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRAIN_DIR = ROOT / "ai-training"
CHAMPION0 = ROOT / "apps" / "server" / "assets" / "models" / "village-bc-0002.weights.json"
NO_NIGHT = "vote,final_vote,hunter_shot"
COMMON = [
    "--temperature", "1", "--lr", "1e-4", "--target-kl", "0.01",
    "--shaping-alpha", "1", "--baseline", "role", "--bench-every", "5",
]
# Spec D11: tích luỹ 10 vòng rồi mới chấm; cân bằng chỉ gác ở `confirm`. Cờ sau thắng.
SIDE_STAGE = ["--bench-every", "10", "--balance-slack", "-1"]

# stage → (thư mục chạy, phe, số vòng, cờ thêm)
STAGES: dict[str, tuple[str, str, int, list[str]]] = {
    "village": ("bc-village-v3", "village", 20, ["--train-decisions", NO_NIGHT, *SIDE_STAGE]),
    "village-lr3": ("bc-village-v3-lr3", "village", 20,
                    ["--train-decisions", NO_NIGHT, *SIDE_STAGE, "--lr", "3e-4"]),
    "wolves": ("bc-wolves-v3", "wolves", 20,
               ["--train-decisions", NO_NIGHT, "--shaping-decisions", "vote", *SIDE_STAGE]),
    "wolves-lr3": ("bc-wolves-v3-lr3", "wolves", 20,
                   ["--train-decisions", NO_NIGHT, "--shaping-decisions", "vote", *SIDE_STAGE, "--lr", "3e-4"]),
}
VILLAGE_RUNS = ("bc-village-v3-lr3", "bc-village-v3")
WOLVES_RUNS = ("bc-wolves-v3-lr3", "bc-wolves-v3")
NIGHT_RUNS = ("bc-night-wolves-v3", "bc-night-village-v3")
CONFIRM = ["--games", "300", "--repeat", "5", "--seed", "confirm-0917",
           "--setups", "baseline,village,wolves,all,teacher",
           "--learned-decisions", "vote,night,final,hunter"]
ENV = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}


class OutOfTime(Exception):
    pass


def latest_champion(out: Path) -> tuple[Path | None, bool]:
    """(champion mới nhất, đã từng thăng hạng?). champion-0000 là bản xuất phát."""
    files = sorted((out / "champions").glob("champion-*.weights.json"))
    return (files[-1], len(files) > 1) if files else (None, False)


def promoted_champion(rl: Path, names: tuple[str, ...]) -> Path | None:
    """Champion ĐÃ thăng hạng của lượt chạy đầu tiên trong `names` có thăng hạng."""
    for name in names:
        champion, promoted = latest_champion(rl / name)
        if promoted:
            return champion
    return None


def candidate(rl: Path) -> Path | None:
    """Model đem đi xác nhận: giai đoạn xa nhất đã thăng hạng."""
    return (promoted_champion(rl, NIGHT_RUNS) or promoted_champion(rl, WOLVES_RUNS)
            or promoted_champion(rl, VILLAGE_RUNS))


def start_model(rl: Path, stage: str) -> Path:
    if stage.startswith("village"):
        return CHAMPION0
    champion = promoted_champion(rl, VILLAGE_RUNS)
    if champion is None:
        raise SystemExit("wolves cần champion làng ĐÃ thăng hạng - chạy 'village' (rồi 'village-lr3') trước")
    return champion


def next_hint(stage: str, promoted: bool) -> str:
    if stage == "village":
        return "wolves" if promoted else "village-lr3"
    if stage == "village-lr3":
        return "wolves" if promoted else "DỪNG: làng không thăng hạng - gửi bảng status cho Claude (dự án con B)"
    if stage == "wolves":
        return "night (tuỳ chọn) hoặc confirm" if promoted else "wolves-lr3"
    return "night (tuỳ chọn) hoặc confirm" if promoted else "confirm"


def _stop(proc: subprocess.Popen) -> None:
    # Cả cây tiến trình: rl_loop → npm/npx → node. Chỉ giết cha thì con chạy tiếp.
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
    else:
        os.killpg(proc.pid, signal.SIGTERM)
    proc.wait()


def run_logged(cmd: list, log: Path, cwd: Path = TRAIN_DIR, deadline: float | None = None) -> None:
    """In ra màn hình + nối vào log. Quá `deadline` thì dừng cả cây và ném OutOfTime."""
    log.parent.mkdir(parents=True, exist_ok=True)
    start = time.time()
    with log.open("a", encoding="utf8") as f:
        f.write(f"\n$ {' '.join(map(str, cmd))}\n")
        proc = subprocess.Popen(
            [str(c) for c in cmd], cwd=str(cwd), env=ENV, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf8", errors="replace", start_new_session=(os.name != "nt"),
        )
        for line in proc.stdout:
            print(line, end="", flush=True)
            f.write(line)
            if deadline is not None and time.time() > deadline:
                _stop(proc)
                f.write("\n[dừng ở giới hạn thời gian]\n")
                raise OutOfTime()
        proc.wait()
    print(f"\n{time.time() - start:.0f}s | exit {proc.returncode}", flush=True)
    if proc.returncode != 0:
        raise SystemExit(f"lỗi (exit {proc.returncode}) - log đầy đủ: {log}")


def rl_loop(rl: Path, name: str, champion: Path, side: str, iterations: int, extra: list[str],
            deadline: float | None) -> Path:
    out = rl / name
    run_logged([sys.executable, "rl_loop.py", "--champion", champion, "--side", side,
                "--iterations", iterations, "--games", 3000, "--out", out, *COMMON, *extra],
               rl / f"{name}.log", deadline=deadline)
    return out


def show_state(out: Path) -> bool:
    state = json.loads((out / "state.json").read_text(encoding="utf8"))
    print(f"\n[{out.name}] vòng xong: {len(state['done'])}")
    print(f"{'vòng':>4} {'điểm':>7} {'xác nhận':>9} {'phe kia':>8} {'lệch':>6}")
    for row in state["scores"]:
        print(f"{row['iteration']:>4} {row['score']:>+7.2f} {row.get('confirmScore', float('nan')):>+9.2f} "
              f"{row.get('otherSide', float('nan')):>+8.2f} {row.get('imbalance', float('nan')):>6.2f}")
    champion, promoted = latest_champion(out)
    print(f"champion {state['championScore']:+.2f} | {champion.name if champion else '-'} |",
          "ĐÃ THĂNG HẠNG" if promoted else "chưa thăng hạng")
    return promoted


def confirm(rl: Path, deadline: float | None) -> None:
    cand = candidate(rl)
    if cand is None:
        raise SystemExit("chưa có lượt chạy nào thăng hạng - không có gì để xác nhận")
    base_json, cand_json = rl / "confirm-v3-bc0002.json", rl / "confirm-v3-candidate.json"
    npm = shutil.which("npm") or "npm"
    for model, dest in ((CHAMPION0, base_json), (cand, cand_json)):
        if not dest.exists():
            run_logged([npm, "run", "ai:benchmark", "--", "--model", model, *CONFIRM, "--out", dest],
                       rl / "confirm.log", cwd=ROOT, deadline=deadline)
    sys.path.insert(0, str(TRAIN_DIR))
    from rl_loop import imbalance_of, score_of

    promoted_sides = {"village"} | ({"wolves"} if promoted_champion(rl, WOLVES_RUNS) else set())
    delta = {s: score_of(cand_json, s) - score_of(base_json, s) for s in ("village", "wolves")}
    imbalance = imbalance_of(cand_json)
    violations = sum(r["violations"] for r in json.loads(cand_json.read_text(encoding="utf8"))["rows"])
    checks = {
        "phe đã train >= +2": all(delta[s] >= 2.0 for s in promoted_sides),
        "không phe nào < -1": all(d >= -1.0 for d in delta.values()),
        "lệch cân bằng <= 6.8": imbalance <= 6.8,
        "0 vi phạm": violations == 0,
    }
    print("=" * 60)
    for side, d in delta.items():
        print(f"{side:<8} so với bc-0002 {d:+.2f}" + ("  (đã train)" if side in promoted_sides else ""))
    print(f"lệch cân bằng {imbalance:.2f} | vi phạm {violations}")
    for name, ok in checks.items():
        print(f"  [{'x' if ok else ' '}] {name}")
    print("VERDICT:", "PASS" if all(checks.values()) else "FAIL")
    print("candidate:", cand)
    print("=" * 60)


def status(rl: Path) -> str:
    runs = sorted(p for p in rl.glob("*-v3*") if (p / "state.json").exists()) if rl.exists() else []
    if not runs:
        return "village"
    for run in runs:
        show_state(run)
    if promoted_champion(rl, VILLAGE_RUNS) is None:
        return "village-lr3" if (rl / "bc-village-v3" / "state.json").exists() else "village"
    if promoted_champion(rl, WOLVES_RUNS) is None:
        return "wolves-lr3" if (rl / "bc-wolves-v3" / "state.json").exists() else "wolves"
    return "night (tuỳ chọn) hoặc confirm"


class KeepAwake:
    """Windows: cấm ngủ khi đang chạy (màn hình vẫn tắt được). Nơi khác: không làm gì."""

    ES_CONTINUOUS, ES_SYSTEM_REQUIRED = 0x80000000, 0x00000001

    def __enter__(self):
        if os.name == "nt":
            import ctypes
            ctypes.windll.kernel32.SetThreadExecutionState(self.ES_CONTINUOUS | self.ES_SYSTEM_REQUIRED)
        return self

    def __exit__(self, *exc):
        if os.name == "nt":
            import ctypes
            ctypes.windll.kernel32.SetThreadExecutionState(self.ES_CONTINUOUS)
        return False


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("stage", choices=[*STAGES, "night", "confirm", "status"])
    p.add_argument("--rl-dir", type=Path, default=ROOT / ".tmp" / "rl", help="thư mục các lượt chạy")
    p.add_argument("--budget-hours", type=float, default=None,
                   help="tự dừng sau số giờ này (chạy lại cùng lệnh để tiếp tục); mặc định không giới hạn")
    a = p.parse_args()
    rl = a.rl_dir.resolve()
    deadline = time.time() + a.budget_hours * 3600 if a.budget_hours else None
    t0 = time.time()

    if a.stage == "status":
        print("\n>>> NEXT:", status(rl))
        return
    if not CHAMPION0.exists():
        raise SystemExit(f"thiếu {CHAMPION0}")

    hint = None
    with KeepAwake():
        try:
            if a.stage in STAGES:
                name, side, iterations, extra = STAGES[a.stage]
                out = rl_loop(rl, name, start_model(rl, a.stage), side, iterations, extra, deadline)
                hint = next_hint(a.stage, show_state(out))
            elif a.stage == "night":
                if not (promoted_champion(rl, VILLAGE_RUNS) and promoted_champion(rl, WOLVES_RUNS)):
                    raise SystemExit("night cần CẢ làng lẫn sói đã thăng hạng - chuyển sang 'confirm'")
                show_state(rl_loop(rl, "bc-night-village-v3", candidate(rl), "village", 10,
                                   ["--train-decisions", "night", *SIDE_STAGE], deadline))
                show_state(rl_loop(rl, "bc-night-wolves-v3", candidate(rl), "wolves", 10,
                                   ["--train-decisions", "night", "--shaping-decisions", "vote", *SIDE_STAGE],
                                   deadline))
                hint = "confirm"
            else:
                confirm(rl, deadline)
                hint = "gửi khối VERDICT cho Claude"
        except OutOfTime:
            hint = f"CHẠY LẠI CÙNG LỆNH ({a.stage}): hết giới hạn thời gian, các bước đã xong sẽ được bỏ qua"
        except KeyboardInterrupt:
            hint = f"đã ngắt (Ctrl+C) - chạy lại cùng lệnh ({a.stage}) để tiếp tục"

    print("\n>>> NEXT:", hint)
    print(f">>> thời gian {(time.time() - t0) / 3600:.1f} giờ")


if __name__ == "__main__":
    main()
