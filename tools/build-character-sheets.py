"""Build 16 portrait sheets (1024x256 WebP) tu pack Studio Nik sample.

Vao:  <thu-muc-pack>/<Ten>/256_original_*.png  - truyen vao qua dong lenh
Ra:   apps/web/public/characters/<avatarId>.webp

Cach chay:

    python tools/build-character-sheets.py <thu-muc-pack>

Thu muc pack la thu muc giai nen cua "12 Fantasy Character Portraits -
Free Sample" (Studio Nik), tuc thu muc chua Caius/, Eldrin/, ... Duong
dan nay KHONG viet cung trong file: no nam o may nguoi tai pack ve, va
viet cung thi may khac khong chay lai duoc.

Thu muc ra thi nguoc lai - suy tu vi tri chinh file nay, nen script chay
dung du goi tu dau. Muon ghi ra cho khac thi dung --out.

Moi sheet 4 frame 256px: [idle, blink~idle, talk~idle, dead pale].
Pack goc khong co bien the bieu cam nen frame 1-2 tam dung idle;
frame dead lam tai bang script. Trang thai "dang noi" do quang
seat-voice-halo san co dam nhan.
"""
import argparse
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

# tools/build-character-sheets.py -> len mot cap la goc repo
REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DST = REPO_ROOT / "apps" / "web" / "public" / "characters"

# avatarId -> (file goc, lat ngang, crop chat)
# crop chat = cat 30px moi vien roi phong lai 256 (phan biet cap dung chung mat)
FILES = {
    "Caius": "Caius/256_original_caius_.png",
    "Eldrin": "Eldrin/256_original_eldrin_.png",
    "Indira": "Indira/256_original_indira_.png",
    "Kazimir": "Kazimir/256_original_kazimir_1327f015_.png",
    "Kestrel": "Kestrel/256_original_kestrel_.png",
    "Phaedra": "Phaedra/256_original_phaedra_.png",
    "Phelan": "Phelan/256_original_phelan_7532bafa_.png",
    "Sabine": "Sabine/256_original_sabine_.png",
    "Soleil": "Soleil/256_original_soleil_.png",
    "Vanya": "Vanya/256_original_vanya_5803ab8f_.png",
    "Wrenna": "Wrenna/256_original_wrenna_be4bb578_.png",
    "Zahara": "Zahara/256_original_zahara_80e6d51f_.png",
}

MAP = {
    "farmer": ("Vanya", False, False),
    "cook": ("Indira", False, False),
    "blacksmith": ("Phelan", False, False),
    "miner": ("Caius", False, False),
    "monk": ("Kazimir", False, False),
    "mustache": ("Caius", True, True),
    "jester": ("Soleil", False, False),
    "ranger": ("Zahara", False, False),
    "captain": ("Wrenna", False, False),
    "viking": ("Kestrel", False, False),
    "pilgrim": ("Indira", False, True),
    "turban": ("Eldrin", False, False),
    "sombrero": ("Soleil", True, False),
    "cowled": ("Sabine", False, False),
    "hood": ("Phaedra", False, False),
    "beard": ("Eldrin", False, True),
}

WHITE_T = 235  # pixel trang hon nguong nay ma noi voi vien -> nen


def key_transparent(im: Image.Image) -> Image.Image:
    rgb = im.convert("RGB")
    a = np.asarray(rgb, dtype=np.int16)
    white = (a >= WHITE_T).all(axis=2)
    h, w = white.shape
    seen = np.zeros((h, w), dtype=bool)
    dq: deque = deque()
    for x in range(w):
        for y in (0, h - 1):
            if white[y, x] and not seen[y, x]:
                seen[y, x] = True
                dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if white[y, x] and not seen[y, x]:
                seen[y, x] = True
                dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        if y > 0 and white[y - 1, x] and not seen[y - 1, x]:
            seen[y - 1, x] = True
            dq.append((y - 1, x))
        if y < h - 1 and white[y + 1, x] and not seen[y + 1, x]:
            seen[y + 1, x] = True
            dq.append((y + 1, x))
        if x > 0 and white[y, x - 1] and not seen[y, x - 1]:
            seen[y, x - 1] = True
            dq.append((y, x - 1))
        if x < w - 1 and white[y, x + 1] and not seen[y, x + 1]:
            seen[y, x + 1] = True
            dq.append((y, x + 1))
    alpha = Image.fromarray(np.where(seen, 0, 255).astype(np.uint8))
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.7))
    rgb.putalpha(alpha)
    return rgb


def pale_frame(im: Image.Image) -> Image.Image:
    rgb = im.convert("RGB")
    gray = ImageOps.grayscale(rgb).convert("RGB")
    out = Image.blend(rgb, gray, 0.5)
    out = ImageEnhance.Brightness(out).enhance(1.12)
    out.putalpha(im.getchannel("A"))
    return out


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Dung 16 sprite sheet chan dung tu pack Studio Nik.",
    )
    parser.add_argument(
        "pack",
        type=Path,
        help="Thu muc giai nen cua pack, tuc thu muc chua Caius/, Eldrin/, ...",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_DST,
        help=f"Thu muc ghi sheet ra (mac dinh: {DEFAULT_DST})",
    )
    return parser.parse_args(argv)


def check_pack(src: Path) -> list[str]:
    """Bao TRUOC nhung gi thieu, thay vi vo truy vet o file dau tien khong co.

    Thieu mot anh giua chung thi 15 sheet da ghi de len ban cu roi - kiem
    truoc mot luot re hon nhieu so voi doi mot nua ket qua.
    """
    if not src.is_dir():
        return [f"khong thay thu muc pack: {src}"]
    return [f"thieu {rel}" for rel in FILES.values() if not (src / rel).is_file()]


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    src_root, dst = args.pack, args.out

    missing = check_pack(src_root)
    if missing:
        for line in missing:
            print(f"LOI: {line}", file=sys.stderr)
        print(
            "\nTruyen vao thu muc giai nen cua pack Studio Nik "
            "(thu muc chua Caius/, Eldrin/, ...).",
            file=sys.stderr,
        )
        return 2

    dst.mkdir(parents=True, exist_ok=True)
    total = 0
    bad = []
    for avatar, (src, flip, tight) in MAP.items():
        im = Image.open(src_root / FILES[src])
        if tight:
            im = im.crop((30, 30, 226, 226)).resize((256, 256), Image.LANCZOS)
        if flip:
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
        im = key_transparent(im)
        dead = pale_frame(im)
        sheet = Image.new("RGBA", (1024, 256), (0, 0, 0, 0))
        for i, fr in enumerate((im, im, im, dead)):
            sheet.paste(fr, (i * 256, 0), fr)
        out = dst / f"{avatar}.webp"
        sheet.save(out, "WEBP", quality=80, method=6)
        kb = out.stat().st_size / 1024
        total += kb
        flag = "OK" if kb <= 80 else "QUA TRAN"
        if kb > 80:
            bad.append(avatar)
        print(f"{avatar:11s} {kb:6.1f}KB {flag}  <- {src}")
    print(f"TONG: {total:.0f}KB / tran 1200KB")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
