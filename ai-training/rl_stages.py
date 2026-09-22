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

Dự án B (spec 2026-09-19): thêm `--project b` vào mọi lệnh, vd
    ai-training/.venv/Scripts/python.exe ai-training/rl_stages.py --project b village

Dự án M (spec 2026-09-22): thêm `--project m` vào mọi lệnh, vd
    ai-training/.venv/Scripts/python.exe ai-training/rl_stages.py --project m village
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

PROJECT = "a"
PPO1 = ROOT / "apps" / "server" / "assets" / "models" / "village-ppo-0001.weights.json"
_PROJECT_A = (CHAMPION0, STAGES, VILLAGE_RUNS, WOLVES_RUNS, NIGHT_RUNS)
_PROJECT_B = (
    # Dự án B đã đóng (spec 2026-09-19) và file đã gỡ khỏi assets. Chạy lại B:
    #   git show 04360fb:apps/server/assets/models/village-bc-0003.weights.json > <file đó>
    ROOT / "apps" / "server" / "assets" / "models" / "village-bc-0003.weights.json",
    {
        "village": ("b-village", "village", 20,
                    ["--train-decisions", NO_NIGHT, *SIDE_STAGE, "--opponent", str(PPO1)]),
        "village-lr3": ("b-village-lr3", "village", 20,
                        ["--train-decisions", NO_NIGHT, *SIDE_STAGE, "--opponent", str(PPO1), "--lr", "3e-4"]),
        "wolves": ("b-wolves", "wolves", 20,
                   ["--train-decisions", NO_NIGHT, "--shaping-decisions", "vote", *SIDE_STAGE]),
        "wolves-lr3": ("b-wolves-lr3", "wolves", 20,
                       ["--train-decisions", NO_NIGHT, "--shaping-decisions", "vote", *SIDE_STAGE, "--lr", "3e-4"]),
    },
    ("b-village-lr3", "b-village"),
    ("b-wolves-lr3", "b-wolves"),
    ("b-night-wolves", "b-night-village"),
)

M_SIZES = [8, 9, 10, 11, 12]
# Spec 2026-09-22 D4/D5: rollout và chấm theo năm cỡ; 200 ván × 3 seed MỖI cỡ.
M_FLAGS = ["--players", ",".join(map(str, M_SIZES)), "--bench-games", "200"]
_PROJECT_M = (
    ROOT / "apps" / "server" / "assets" / "models" / "village-bc-0004.weights.json",
    {
        "village": ("m-village", "village", 20, ["--train-decisions", NO_NIGHT, *SIDE_STAGE, *M_FLAGS]),
        "village-lr3": ("m-village-lr3", "village", 20,
                        ["--train-decisions", NO_NIGHT, *SIDE_STAGE, *M_FLAGS, "--lr", "3e-4"]),
        # D6: làng mạnh lên ở bàn 9–12 là cân bằng TỐT lên; sói mạnh lên là thứ
        # đã phá ppo-0001 — cổng cân bằng theo cỡ chỉ ở stage sói.
        "wolves": ("m-wolves", "wolves", 20,
                   ["--train-decisions", NO_NIGHT, "--shaping-decisions", "vote", *SIDE_STAGE, *M_FLAGS,
                    "--size-balance-slack", "2"]),
        "wolves-lr3": ("m-wolves-lr3", "wolves", 20,
                       ["--train-decisions", NO_NIGHT, "--shaping-decisions", "vote", *SIDE_STAGE, *M_FLAGS,
                        "--size-balance-slack", "2", "--lr", "3e-4"]),
    },
    ("m-village-lr3", "m-village"),
    ("m-wolves-lr3", "m-wolves"),
    ("m-night-wolves", "m-night-village"),
)


def set_project(name: str) -> None:
    """'a' = spec 2026-09-17 (mặc định), 'b' = spec 2026-09-19, 'm' = spec 2026-09-22. Mọi hàm đọc các
    hằng số này lúc gọi, nên đổi ở đây là đổi cả status/run_stage/confirm."""
    global PROJECT, CHAMPION0, STAGES, VILLAGE_RUNS, WOLVES_RUNS, NIGHT_RUNS
    if name not in ("a", "b", "m"):
        raise SystemExit(f"dự án lạ: {name!r} (có: a, b, m)")
    PROJECT = name
    CHAMPION0, STAGES, VILLAGE_RUNS, WOLVES_RUNS, NIGHT_RUNS = {"a": _PROJECT_A, "b": _PROJECT_B, "m": _PROJECT_M}[name]


CONFIRM = ["--games", "300", "--repeat", "5", "--seed", "confirm-0917",
           "--setups", "baseline,village,wolves,all,teacher",
           "--learned-decisions", "vote,night,final,hunter"]
ENV = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
# Python chạy rl_loop/train_ppo (cần torch). Terminal: chính venv đang chạy script này.
# Notebook: kernel thường là Python hệ thống, nên notebook đặt lại thành python của .venv.
PYTHON = sys.executable


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
    with log.open("a", encoding="utf8", buffering=1) as f:  # từng dòng: log đọc được khi đang chạy
        f.write(f"\n$ {' '.join(map(str, cmd))}\n")
        proc = subprocess.Popen(
            [str(c) for c in cmd], cwd=str(cwd), env=ENV, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf8", errors="replace", start_new_session=(os.name != "nt"),
        )
        try:
            for line in proc.stdout:
                print(line, end="", flush=True)
                f.write(line)
                if deadline is not None and time.time() > deadline:
                    _stop(proc)
                    f.write("\n[dừng ở giới hạn thời gian]\n")
                    raise OutOfTime()
        except KeyboardInterrupt:
            # Jupyter "Interrupt" chỉ ngắt kernel: không dừng cây con thì rl_loop/node
            # chạy ngầm tiếp và tranh CPU với lần chạy lại.
            _stop(proc)
            f.write("\n[đã ngắt]\n")
            raise
        proc.wait()
    print(f"\n{time.time() - start:.0f}s | exit {proc.returncode}", flush=True)
    if proc.returncode != 0:
        raise SystemExit(f"lỗi (exit {proc.returncode}) - log đầy đủ: {log}")


def rl_loop(rl: Path, name: str, champion: Path, side: str, iterations: int, extra: list[str],
            deadline: float | None) -> Path:
    out = rl / name
    run_logged([PYTHON, "rl_loop.py", "--champion", champion, "--side", side,
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


def confirm(rl: Path, deadline: float | None, model: Path | None = None) -> None:
    """Xác nhận `model`, mặc định là `candidate(rl)`. Kết quả bc-0002 dùng lại giữa các lần."""
    cand = model or candidate(rl)
    if cand is None:
        raise SystemExit("chưa có lượt chạy nào thăng hạng - không có gì để xác nhận")
    base_json = rl / "confirm-v3-bc0002.json"
    # Model tự chọn có file kết quả riêng (theo đường dẫn), không đè/đọc nhầm của candidate.
    cand_json = rl / ("confirm-v3-candidate.json" if model is None
                      else f"confirm-v3-{'_'.join(Path(cand).resolve().parts[-3:])}")
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


CONFIRM_B = ["--games", "300", "--repeat", "5", "--seed", "confirm-0919", "--temperature", "0.5",
             "--learned-decisions", "vote,night,final,hunter"]


def confirm_b(rl: Path, deadline: float | None, model: Path | None = None) -> None:
    """Tiêu chí spec 2026-09-19 (T=0,5, seed mới): đối đầu, không thụt lùi, cân bằng, 0 vi phạm."""
    cand = model or candidate(rl)
    if cand is None:
        raise SystemExit("chưa có lượt chạy nào thăng hạng - không có gì để xác nhận")
    ref_json = rl / "confirm-b-ppo0001.json"
    cand_json = rl / ("confirm-b-candidate.json" if model is None
                      else f"confirm-b-{'_'.join(Path(cand).resolve().parts[-3:])}")
    npm = shutil.which("npm") or "npm"
    runs = (
        (PPO1, ref_json, ["--setups", "baseline,village,wolves,all"]),
        (cand, cand_json, ["--opponent", PPO1,
                           "--setups", "baseline,village,wolves,all,h2h-village,h2h-wolves,opponent"]),
    )
    for m, dest, extra in runs:
        if not dest.exists():
            run_logged([npm, "run", "ai:benchmark", "--", "--model", m, *CONFIRM_B, *extra, "--out", dest],
                       rl / "confirm-b.log", cwd=ROOT, deadline=deadline)
    sys.path.insert(0, str(TRAIN_DIR))
    from rl_loop import imbalance_of, score_of

    report = json.loads(cand_json.read_text(encoding="utf8"))
    h2h = {s: report["paired"][f"h2h-{s}"]["mean"] for s in ("village", "wolves")}
    delta = {s: score_of(cand_json, s) - score_of(ref_json, s) for s in ("village", "wolves")}
    imbalance, ref_imbalance = imbalance_of(cand_json), imbalance_of(ref_json)
    violations = sum(r["violations"] for r in report["rows"])
    checks = {
        "đối đầu: làng hơn làng ppo-0001 >= +2": h2h["village"] >= 2.0,
        "không phe nào < ppo-0001 - 1": all(d >= -1.0 for d in delta.values()),
        f"lệch cân bằng <= ppo-0001 ({ref_imbalance:.2f}) + 1": imbalance <= ref_imbalance + 1.0,
        "0 vi phạm": violations == 0,
    }
    print("=" * 60)
    print(f"đối đầu  làng {h2h['village']:+.2f} | sói {h2h['wolves']:+.2f} (theo dõi)")
    for side, d in delta.items():
        print(f"{side:<8} so với ppo-0001 (đều so heuristic) {d:+.2f}")
    print(f"lệch cân bằng {imbalance:.2f} | vi phạm {violations}")
    for name, ok in checks.items():
        print(f"  [{'x' if ok else ' '}] {name}")
    print("VERDICT:", "PASS" if all(checks.values()) else "FAIL")
    print("candidate:", cand)
    print("=" * 60)


CONFIRM_M = ["--games", "200", "--repeat", "5", "--seed", "confirm-0922", "--temperature", "0.5",
             "--learned-decisions", "vote,night,final,hunter"]


def judge_size(bench: Path, size: int) -> tuple[bool, dict]:
    """Tiêu chí spec 2026-09-22 D7 cho MỘT cỡ bàn, đọc một file `ai:benchmark`."""
    sys.path.insert(0, str(TRAIN_DIR))
    from rl_loop import score_of

    b = json.loads(bench.read_text(encoding="utf8"))
    by = {s["setup"]: s["villageWinMean"] for s in b["summary"]}
    village, wolves = score_of(bench, "village"), score_of(bench, "wolves")
    imbalance, base = abs(by["all"] - 0.5) * 100, abs(by["baseline"] - 0.5) * 100
    violations = sum(r["violations"] for r in b["rows"])
    checks = {
        "không phe nào < heuristic − 1": min(village, wolves) >= -1.0,
        "một phe ≥ heuristic + 2": max(village, wolves) >= 2.0,
        f"cân bằng ≤ heuristic ({base:.1f}) + 2": imbalance <= base + 2.0,
        "0 vi phạm": violations == 0,
    }
    if size == 8:
        h2h = b.get("paired", {})
        checks["đối đầu ppo-0001 mỗi phe ≥ −1"] = (
            "h2h-village" in h2h and "h2h-wolves" in h2h
            and h2h["h2h-village"]["mean"] >= -1.0 and h2h["h2h-wolves"]["mean"] >= -1.0
        )
    return all(checks.values()), {"village": village, "wolves": wolves, "imbalance": imbalance,
                                  "baseImbalance": base, "violations": violations, "checks": checks}


def confirm_m(rl: Path, deadline: float | None, model: Path | None = None) -> list[int]:
    """Confirm dự án M: từng cỡ bàn, in bảng đạt/trượt và `tableSizes` để đóng gói."""
    cand = model or candidate(rl)
    if cand is None:
        raise SystemExit("chưa có lượt chạy nào thăng hạng - không có gì để xác nhận")
    tag = "candidate" if model is None else "_".join(Path(cand).resolve().parts[-3:])
    npm = shutil.which("npm") or "npm"
    results: dict[int, tuple[bool, dict]] = {}
    for n in M_SIZES:
        dest = rl / f"confirm-m-{tag}-p{n}.json"
        extra = (["--opponent", PPO1, "--setups", "baseline,village,wolves,all,h2h-village,h2h-wolves,opponent"]
                 if n == 8 else ["--setups", "baseline,village,wolves,all"])
        if not dest.exists():
            run_logged([npm, "run", "ai:benchmark", "--", "--model", cand, "--players", n, *CONFIRM_M, *extra,
                        "--out", dest], rl / "confirm-m.log", cwd=ROOT, deadline=deadline)
        results[n] = judge_size(dest, n)
    print("=" * 72)
    print(f"{'cỡ':>3} {'làng':>7} {'sói':>7} {'lệch':>6} {'heur':>6} {'vp':>3}  kết quả")
    for n, (ok, d) in results.items():
        failed = [k for k, v in d["checks"].items() if not v]
        print(f"{n:>3} {d['village']:>+7.2f} {d['wolves']:>+7.2f} {d['imbalance']:>6.2f} "
              f"{d['baseImbalance']:>6.2f} {d['violations']:>3}  {'ĐẠT' if ok else 'TRƯỢT: ' + '; '.join(failed)}")
    passed = [n for n, (ok, _) in results.items() if ok]
    print("tableSizes:", passed)
    print("VERDICT:", "PASS" if 8 in passed else ("PARTIAL (trượt bàn 8 - xem spec D8)" if passed else "FAIL"))
    print("candidate:", cand)
    print("=" * 72)
    return passed


def status(rl: Path) -> str:
    names = {v[0] for v in STAGES.values()} | set(NIGHT_RUNS)
    runs = sorted(rl / n for n in names if (rl / n / "state.json").exists()) if rl.exists() else []
    if not runs:
        return "village"
    for run in runs:
        show_state(run)
    for stage in ("village", "village-lr3", "wolves", "wolves-lr3"):  # lượt đang dở: chạy tiếp nó
        name, _, iterations, _ = STAGES[stage]
        state = rl / name / "state.json"
        if state.exists() and len(json.loads(state.read_text(encoding="utf8"))["done"]) < iterations:
            return stage
    if promoted_champion(rl, VILLAGE_RUNS) is None:
        return "village-lr3" if (rl / STAGES["village"][0] / "state.json").exists() else "village"
    if promoted_champion(rl, WOLVES_RUNS) is None:
        return "wolves-lr3" if (rl / STAGES["wolves"][0] / "state.json").exists() else "wolves"
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


def run_stage(stage: str, rl: Path, deadline: float | None = None, model: Path | None = None) -> str:
    """Chạy MỘT giai đoạn, trả gợi ý bước tiếp. Hết giờ hoặc bị ngắt: gợi ý chạy lại cùng stage."""
    try:
        if stage in STAGES:
            name, side, iterations, extra = STAGES[stage]
            out = rl_loop(rl, name, start_model(rl, stage), side, iterations, extra, deadline)
            return next_hint(stage, show_state(out))
        if stage == "night":
            if not (promoted_champion(rl, VILLAGE_RUNS) and promoted_champion(rl, WOLVES_RUNS)):
                raise SystemExit("night cần CẢ làng lẫn sói đã thăng hạng - chuyển sang 'confirm'")
            show_state(rl_loop(rl, NIGHT_RUNS[1], candidate(rl), "village", 10,
                               ["--train-decisions", "night", *SIDE_STAGE], deadline))
            show_state(rl_loop(rl, NIGHT_RUNS[0], candidate(rl), "wolves", 10,
                               ["--train-decisions", "night", "--shaping-decisions", "vote", *SIDE_STAGE], deadline))
            return "confirm"
        if stage == "confirm":
            {"a": confirm, "b": confirm_b, "m": confirm_m}[PROJECT](rl, deadline, model)
            return "gửi khối VERDICT cho Claude"
        raise SystemExit(f"stage lạ: {stage!r}")
    except OutOfTime:
        return f"CHẠY LẠI CÙNG STAGE ({stage}): hết giới hạn thời gian, các bước đã xong sẽ được bỏ qua"
    except KeyboardInterrupt:
        return f"đã ngắt - chạy lại cùng stage ({stage}) để tiếp tục"


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("stage", choices=[*STAGES, "night", "confirm", "status"])
    p.add_argument("--rl-dir", type=Path, default=ROOT / ".tmp" / "rl", help="thư mục các lượt chạy")
    p.add_argument("--budget-hours", type=float, default=None,
                   help="tự dừng sau số giờ này (chạy lại cùng lệnh để tiếp tục); mặc định không giới hạn")
    p.add_argument("--model", type=Path, default=None,
                   help="confirm: model cần xác nhận thay cho champion tự chọn (vd iter-0020/model/model.weights.json)")
    p.add_argument("--project", choices=("a", "b", "m"), default="a",
                   help="a = spec 2026-09-17; b = spec 2026-09-19 (lịch sử phiếu); m = spec 2026-09-22 (bàn 8–12)")
    a = p.parse_args()
    set_project(a.project)
    rl = a.rl_dir.resolve()
    deadline = time.time() + a.budget_hours * 3600 if a.budget_hours else None
    t0 = time.time()

    if a.stage == "status":
        print("\n>>> NEXT:", status(rl))
        return
    if not CHAMPION0.exists():
        raise SystemExit(f"thiếu {CHAMPION0}")

    with KeepAwake():
        hint = run_stage(a.stage, rl, deadline, a.model)

    print("\n>>> NEXT:", hint)
    print(f">>> thời gian {(time.time() - t0) / 3600:.1f} giờ")


if __name__ == "__main__":
    main()
