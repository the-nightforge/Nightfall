"""rl_stages: chọn champion/ứng viên, gợi ý bước tiếp, status, dừng theo giờ.

Chạy: python tests/test_rl_stages.py
"""

from __future__ import annotations

import json
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import rl_stages as rs  # noqa: E402


def make_run(rl: Path, name: str, promoted: bool) -> Path:
    out = rl / name
    (out / "champions").mkdir(parents=True)
    (out / "champions" / "champion-0000.weights.json").write_text("{}", encoding="utf8")
    if promoted:
        (out / "champions" / "champion-0010.weights.json").write_text("{}", encoding="utf8")
    scores = [{"iteration": 10, "score": 3.1, "otherSide": 0.2, "imbalance": 6.0}]
    (out / "state.json").write_text(json.dumps({"done": list(range(1, 21)), "scores": scores,
                                                "championScore": 3.1 if promoted else 0.9}), encoding="utf8")
    return out


def main() -> None:
    # Mọi stage phe dùng cờ D11 và thư mục v3 - cùng tên với các notebook.
    for stage, (name, side, iterations, extra) in rs.STAGES.items():
        assert name.startswith(f"bc-{side}-v3"), (stage, name)
        assert iterations == 20 and extra[-len(rs.SIDE_STAGE):] == rs.SIDE_STAGE or "--lr" in extra, (stage, extra)
        assert "--balance-slack" in extra and "--bench-every" in extra, (stage, extra)

    with tempfile.TemporaryDirectory() as tmp:
        rl = Path(tmp)
        assert rs.status(rl) == "village"  # chưa có gì
        assert rs.start_model(rl, "village") == rs.CHAMPION0
        try:
            rs.start_model(rl, "wolves")
            raise AssertionError("wolves phải đòi champion làng đã thăng hạng")
        except SystemExit as error:
            assert "village" in str(error)

        make_run(rl, "bc-village-v3", promoted=False)
        assert rs.status(rl) == "village-lr3"
        (rl / "bc-village-v3" / "state.json").write_text(json.dumps(
            {"done": [1], "scores": [], "championScore": 0.9}), encoding="utf8")
        assert rs.status(rl) == "village", "lượt dở phải chạy tiếp, không nhảy sang lr3"
        (rl / "bc-village-v3" / "state.json").write_text(json.dumps(
            {"done": list(range(1, 21)), "scores": [], "championScore": 0.9}), encoding="utf8")
        assert rs.status(rl) == "village-lr3"
        assert rs.candidate(rl) is None

        make_run(rl, "bc-village-v3-lr3", promoted=True)
        assert rs.start_model(rl, "wolves").parent.parent.name == "bc-village-v3-lr3"
        assert rs.status(rl) == "wolves"
        assert rs.candidate(rl).parent.parent.name == "bc-village-v3-lr3"

        make_run(rl, "bc-wolves-v3", promoted=True)
        assert rs.candidate(rl).parent.parent.name == "bc-wolves-v3"  # giai đoạn xa hơn thắng
        assert rs.status(rl).startswith("night")

    assert rs.next_hint("village", True) == "wolves"
    assert rs.next_hint("village", False) == "village-lr3"
    assert rs.next_hint("village-lr3", False).startswith("DỪNG")
    assert rs.next_hint("wolves", False) == "wolves-lr3"
    assert rs.next_hint("wolves-lr3", False) == "confirm"

    # Giới hạn thời gian dừng CẢ cây tiến trình (Windows: taskkill /T) và ném OutOfTime.
    with tempfile.TemporaryDirectory() as tmp:
        log = Path(tmp) / "t.log"
        child = "import time\nfor i in range(200): print(i, flush=True); time.sleep(0.1)"
        start = time.time()
        try:
            rs.run_logged([sys.executable, "-c", child], log, cwd=Path(tmp), deadline=time.time() + 1.5)
            raise AssertionError("không dừng ở giới hạn thời gian")
        except rs.OutOfTime:
            pass
        assert time.time() - start < 10, "dừng quá chậm"
        assert "[dừng ở giới hạn thời gian]" in log.read_text(encoding="utf8")

    # Ngắt (Jupyter Interrupt) cũng dừng cây con, rồi mới ném tiếp KeyboardInterrupt.
    import threading
    import _thread

    with tempfile.TemporaryDirectory() as tmp:
        log = Path(tmp) / "i.log"
        marker = Path(tmp) / "alive.txt"
        child = ("import time, pathlib\np = pathlib.Path(r'" + str(marker) + "')\n"
                 "for i in range(200):\n    p.write_text(str(i)); print(i, flush=True); time.sleep(0.1)")
        threading.Timer(1.5, _thread.interrupt_main).start()
        try:
            rs.run_logged([sys.executable, "-c", child], log, cwd=Path(tmp))
            raise AssertionError("KeyboardInterrupt không được ném tiếp")
        except KeyboardInterrupt:
            pass
        seen = marker.read_text()
        time.sleep(1.0)
        assert marker.read_text() == seen, "tiến trình con vẫn chạy sau khi ngắt"
        assert "[đã ngắt]" in log.read_text(encoding="utf8")

    # Dự án B (spec 2026-09-19): hằng số riêng, stage làng có đối thủ ppo-0001.
    rs.set_project("b")
    try:
        assert rs.CHAMPION0.name == "village-bc-0003.weights.json"
        name, side, iterations, extra = rs.STAGES["village"]
        assert name == "b-village" and side == "village" and iterations == 20
        assert extra[extra.index("--opponent") + 1].endswith("village-ppo-0001.weights.json"), extra
        assert "--opponent" not in rs.STAGES["wolves"][3]
        with tempfile.TemporaryDirectory() as tmp:
            rl = Path(tmp)
            make_run(rl, "bc-village-v3", promoted=True)  # lượt của dự án A không được tính
            assert rs.status(rl) == "village"
            try:
                rs.start_model(rl, "wolves")
                raise AssertionError("wolves B phải đòi b-village đã thăng hạng")
            except SystemExit:
                pass
            make_run(rl, "b-village", promoted=True)
            assert rs.start_model(rl, "wolves").parent.parent.name == "b-village"
            assert rs.status(rl) == "wolves"
    finally:
        rs.set_project("a")
    assert rs.STAGES["village"][0] == "bc-village-v3"

    # Dự án M (spec 2026-09-22): năm cỡ bàn, cổng cân bằng theo cỡ ở stage sói.
    rs.set_project("m")
    try:
        assert rs.CHAMPION0.name == "village-bc-0004.weights.json"
        name, side, iterations, extra = rs.STAGES["village"]
        assert name == "m-village" and side == "village" and iterations == 20
        assert extra[extra.index("--players") + 1] == "8,9,10,11,12", extra
        assert "--size-balance-slack" not in extra
        wolves = rs.STAGES["wolves"][3]
        assert wolves[wolves.index("--size-balance-slack") + 1] == "2", wolves
        assert rs.STAGES["wolves"][0] == "m-wolves"
    finally:
        rs.set_project("a")

    # judge_size: tiêu chí D7 trên một file bench dựng tay.
    def bench(path: Path, base: float, village: float, wolves: float, all_: float, violations: int = 0,
              paired: dict | None = None) -> Path:
        summary = [{"setup": s, "villageWinMean": v} for s, v in
                   (("baseline", base), ("village", village), ("wolves", wolves), ("all", all_))]
        path.write_text(json.dumps({"summary": summary, "rows": [{"violations": violations}],
                                    "paired": paired or {}}), encoding="utf8")
        return path

    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        ok, _ = rs.judge_size(bench(t / "a.json", 0.40, 0.45, 0.39, 0.41), 10)   # làng +5, sói +1, lệch 9 ≤ 10+2
        assert ok
        bad, detail = rs.judge_size(bench(t / "b.json", 0.40, 0.45, 0.43, 0.41), 10)  # sói −3
        assert not bad and not detail["checks"]["không phe nào < heuristic − 1"]
        unbal, _ = rs.judge_size(bench(t / "c.json", 0.50, 0.53, 0.47, 0.35), 10)   # lệch 15 > 0 + 2
        assert not unbal
        dirty, _ = rs.judge_size(bench(t / "d.json", 0.40, 0.45, 0.39, 0.41, violations=1), 10)
        assert not dirty
        h2h = {"h2h-village": {"mean": 0.5, "se": 1}, "h2h-wolves": {"mean": -1.5, "se": 1}}
        eight, detail8 = rs.judge_size(bench(t / "e.json", 0.50, 0.55, 0.47, 0.51, paired=h2h), 8)
        assert not eight and not detail8["checks"]["đối đầu ppo-0001 mỗi phe ≥ −1"]

    print("ok")


if __name__ == "__main__":
    main()
