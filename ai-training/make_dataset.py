"""Sinh dataset BC theo từng shard rồi encode — không giữ 10.000 ván trace trong RAM.

`selfplay.ts` giữ trace của CẢ batch trong bộ nhớ tới cuối mới ghi; 10.000 ván một
lần vượt heap của Node (~4 GB). Ở đây: N shard × 1.000 ván (cỡ rollout RL đã chạy
ổn), chạy song song vài shard, shard xong thì bỏ qua khi chạy lại, rồi nối JSONL,
validate và encode.

Chạy từ gốc repo:

    ai-training/.venv/Scripts/python.exe ai-training/make_dataset.py --out .tmp/traj-b --enc .tmp/enc-b
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def npx() -> str:
    return shutil.which("npx") or "npx"


def run(cmd: list[str]) -> None:
    print("$", " ".join(cmd), flush=True)
    subprocess.run(cmd, cwd=ROOT, check=True)


def shard(out: Path, i: int, games: int, seed: str) -> Path:
    part = out / f"shard-{i:02d}"
    done = part / ".done"
    if not done.exists():
        # Recipe của dataset-0004 (ai-training/README.md), chỉ khác seed theo shard.
        run([npx(), "tsx", "apps/server/scripts/selfplay.ts", "--games", str(games), "--players", "8",
             "--preset", "--defense", "--seed", f"{seed}-{i}", "--trajectories", str(part),
             "--trace-games", str(games), "--no-jitter", "--quiet"])
        done.write_text("ok")
    return part / "trajectories.jsonl"


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", type=Path, required=True, help="thư mục trajectory (mỗi shard một thư mục con)")
    p.add_argument("--enc", type=Path, required=True, help="thư mục encode cho train_bc")
    p.add_argument("--shards", type=int, default=10)
    p.add_argument("--games", type=int, default=1000, help="số ván mỗi shard")
    p.add_argument("--jobs", type=int, default=3, help="số shard chạy cùng lúc (~4 GB RAM mỗi shard)")
    p.add_argument("--seed", default="bc")
    a = p.parse_args()
    out, enc = (ROOT / a.out).resolve(), (ROOT / a.enc).resolve()

    run([shutil.which("npm") or "npm", "run", "build:deps", "--silent"])
    with ThreadPoolExecutor(a.jobs) as pool:
        parts = list(pool.map(lambda i: shard(out, i, a.games, a.seed), range(a.shards)))

    merged = out / "trajectories.jsonl"
    with merged.open("wb") as dst:
        for part in parts:
            with part.open("rb") as src:
                shutil.copyfileobj(src, dst)
    print(f"nối {len(parts)} shard → {merged} ({merged.stat().st_size / 1e9:.2f} GB)", flush=True)

    run([npx(), "tsx", "apps/server/scripts/ai-validate-dataset.ts", str(merged)])
    run([npx(), "tsx", "apps/server/scripts/ai-encode.ts", "--in", str(merged), "--out", str(enc)])
    print("\nXONG. Dataset encode:", enc, flush=True)


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        sys.exit(f"lỗi (exit {error.returncode}): {' '.join(map(str, error.cmd))}")
