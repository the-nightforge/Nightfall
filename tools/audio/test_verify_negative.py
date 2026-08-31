"""Kiểm thử âm tính cho `verify_music.py`.

Một bộ kiểm chứng luôn báo xanh thì không phân biệt được với việc không có bộ
kiểm chứng nào. Script này chứng minh điều ngược lại: nó làm hỏng một bản SAO
của thư mục audio theo nhiều cách khác nhau và đòi `verify_music.py` bắt được
từng cách, đúng bằng thông báo tương ứng.

Mọi thao tác diễn ra trong thư mục tạm do `tempfile` cấp phát. Asset thật
trong repo chỉ được ĐỌC, không bao giờ bị ghi - đó là lý do mỗi ca kiểm thử
tự copy lại từ đầu thay vì sửa rồi hoàn tác, vì một lần hoàn tác trượt sẽ để
lại file nhạc hỏng trong repo.

Ba ca cuối là ca mới của thiết kế một track: metadata còn mô tả track đã bỏ,
thư mục `music/` còn file nhạc không ai phát, và nhạc chưa xác minh được quyền
lọt vào quy trình phát hành.

Chạy:  python tools/audio/test_verify_negative.py --audio apps/web/public/audio
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
VERIFY = os.path.join(HERE, "verify_music.py")

sys.path.insert(0, HERE)
from targets import ASSET_FILE, TRACK


def run_verify(audio_dir: str, extra: tuple[str, ...] = ()) -> tuple[int, str]:
    proc = subprocess.run([sys.executable, VERIFY, "--audio", audio_dir, *extra],
                          capture_output=True, text=True, encoding="utf-8")
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def read_json(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def write_json(path: str, data: dict) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)


# --------------------------------------------------------------------------
# Các cách làm hỏng
# --------------------------------------------------------------------------

def break_missing_track(audio: str) -> None:
    os.remove(os.path.join(audio, "music", ASSET_FILE))


def break_missing_manifest(audio: str) -> None:
    os.remove(os.path.join(audio, "music-sources.json"))


def break_missing_loop_point(audio: str) -> None:
    path = os.path.join(audio, "loop-points.json")
    points = read_json(path)
    del points[TRACK]
    write_json(path, points)


def break_loop_point(audio: str) -> None:
    """Dời loopEnd đi 40ms.

    Đủ nhỏ để không ai nhìn ra khi đọc file JSON, và đúng bằng loại sai sót
    xảy ra thật khi sửa tay: cửa sổ lặp không còn là một chu kỳ nguyên, nên
    tính tuần hoàn sập trong khi mọi thứ khác vẫn bình thường.
    """
    path = os.path.join(audio, "loop-points.json")
    points = read_json(path)
    points[TRACK]["loopEnd"] = round(points[TRACK]["loopEnd"] - 0.040, 6)
    write_json(path, points)


def break_level(audio: str) -> None:
    """Giải mã rồi mã hoá lại track to hơn 1.2 dB."""
    from studio import decode_mp3, write_mp3
    path = os.path.join(audio, "music", ASSET_FILE)
    write_mp3(path, decode_mp3(path) * (10.0 ** (1.2 / 20.0)), bitrate=192)
    manifest_path = os.path.join(audio, "music-sources.json")
    manifest = read_json(manifest_path)
    with open(path, "rb") as asset:
        manifest["tracks"][TRACK]["assetSha256"] = hashlib.sha256(asset.read()).hexdigest()
    write_json(manifest_path, manifest)


def break_source_hash(audio: str) -> None:
    """Khai một manifest hợp lệ về hình thức nhưng sai mã băm asset.

    Ca này bảo vệ cả nguồn gốc lẫn thao tác thay file: một MP3 khác tên giống
    hệt không được phép lọt qua kiểm chứng chỉ vì các số đo âm thanh vẫn đẹp.
    """
    path = os.path.join(audio, "music-sources.json")
    write_json(path, {
        "schemaVersion": 2,
        "tracks": {
            TRACK: {
                "asset": ASSET_FILE,
                "title": "fixture",
                "creator": "fixture creator",
                "sourcePage": "https://example.invalid/source",
                "sourceFileUrl": "https://example.invalid/source.mp3",
                "license": "CC0-1.0",
                "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
                "sourceSha256": "1" * 64,
                "assetSha256": "0" * 64,
            }
        },
    })


def break_stale_metadata(audio: str) -> None:
    """Để lại metadata của một track đã bỏ.

    Đây là cách hỏng dễ xảy ra nhất khi rút ba track xuống một: file nhạc thì
    xoá rồi nhưng manifest vẫn còn mô tả `night`, và người đọc sau này tin
    rằng game vẫn phát ba bài.
    """
    path = os.path.join(audio, "music-sources.json")
    manifest = read_json(path)
    manifest["tracks"]["night"] = dict(manifest["tracks"][TRACK], asset="night.mp3")
    write_json(path, manifest)


def break_stray_asset(audio: str) -> None:
    """Bỏ quên một file nhạc không ai phát trong `music/`.

    Không phép đo âm thanh nào bắt được ca này - track đang phát vẫn đúng - mà
    người chơi vẫn phải tải thêm hơn một MiB.
    """
    src = os.path.join(audio, "music", ASSET_FILE)
    shutil.copyfile(src, os.path.join(audio, "music", "night.mp3"))


CASES = [
    ("thiếu manifest nguồn", break_missing_manifest, (), "thiếu music-sources.json"),
    ("thiếu track", break_missing_track, (), f"thiếu track music/{ASSET_FILE}"),
    ("thiếu mốc lặp", break_missing_loop_point, (), f"thiếu mốc lặp cho {TRACK}"),
    ("mốc lặp sai 40ms", break_loop_point, (), f"{TRACK}: tương quan tuần hoàn"),
    ("mức âm lệch 1.2 dB", break_level, (), f"{TRACK}: LUFS lệch mục tiêu"),
    ("mã băm asset sai", break_source_hash, (), f"{TRACK}: SHA-256 không khớp manifest"),
    ("metadata track đã bỏ", break_stale_metadata, (),
     "manifest còn track không dùng: night"),
    ("file nhạc thừa", break_stray_asset, (), "music/ không còn file thừa"),
    ("quyền chưa xác minh khi phát hành", lambda audio: None,
     ("--require-cleared-rights",), "quyền sử dụng đã được xác minh"),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", required=True)
    args = ap.parse_args()
    source = os.path.abspath(args.audio)

    failures = []

    with tempfile.TemporaryDirectory(prefix="masoi-audio-verify-") as tmp:
        # Đối chứng dương: bản sao NGUYÊN VẸN phải qua được. Không có nó thì
        # các ca dưới đây không chứng minh được gì - một script luôn trả 1 cũng
        # sẽ "đạt" hết.
        pristine = os.path.join(tmp, "pristine")
        shutil.copytree(source, pristine)
        code, out = run_verify(pristine)
        ok = code == 0
        print(f"[{'PASS' if ok else 'FAIL'}] đối chứng dương (bản sao nguyên vẹn) "
              f"-> exit {code}, mong đợi 0")
        if not ok:
            failures.append("đối chứng dương")
            for line in out.splitlines():
                if line.strip().startswith("- "):
                    print(f"         {line.strip()}")

        for i, (label, mutate, extra, expect) in enumerate(CASES):
            work = os.path.join(tmp, f"case{i}")
            shutil.copytree(source, work)
            mutate(work)
            code, out = run_verify(work, extra)
            hit = expect in out
            ok = code == 1 and hit
            print(f"[{'PASS' if ok else 'FAIL'}] {label} -> exit {code}, mong đợi 1"
                  f"{'' if hit else f'; KHÔNG thấy thông báo {expect!r}'}")
            if not ok:
                failures.append(label)

    # Bản gốc phải còn nguyên: mọi thao tác ở trên chỉ chạm vào thư mục tạm.
    if not os.path.exists(os.path.join(source, "music", ASSET_FILE)):
        failures.append("asset gốc đã bị đụng vào")
        print("[FAIL] asset gốc trong repo đã bị sửa - đây là lỗi của chính script này")

    if failures:
        print(f"\n{len(failures)} ca không đạt: {', '.join(failures)}")
        return 1
    print(f"\n{len(CASES) + 1}/{len(CASES) + 1} ca đạt.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
