# Nguon chan dung nhan vat

## Pack goc

- **12 Fantasy Character Portraits — Free Sample** by **Studio NIK**
  (https://studio-nik.itch.io)
- License: **CC BY 4.0** — thuong mai duoc, bat buoc ghi cong.
  Ghi cong trong game: `Character portraits by Studio Nik (https://studio-nik.itch.io), CC BY 4.0`.
  Xem `LICENSE.txt` trong zip goc. Khong xoa dong nay.
- Comic-book style, file goc `256_original_*.png` (nen trang).

## Anh xa 16 AvatarId -> 12 mat (4 mat dung chung, danh dau *)

| AvatarId   | Nguon    | Bien doi              |
| ---------- | -------- | --------------------- |
| farmer     | Vanya    | —                     |
| cook       | Indira   | —                     |
| blacksmith | Phelan   | —                     |
| miner      | Caius    | —                     |
| monk       | Kazimir  | —                     |
| mustache   | Caius *  | lat ngang + crop chat |
| jester     | Soleil   | —                     |
| ranger     | Zahara   | —                     |
| captain    | Wrenna   | —                     |
| viking     | Kestrel  | —                     |
| pilgrim    | Indira * | crop chat             |
| turban     | Eldrin   | —                     |
| sombrero   | Soleil * | lat ngang             |
| cowled     | Sabine   | —                     |
| hood       | Phaedra  | —                     |
| beard      | Eldrin * | crop chat             |

Cap `*` yeu nhat la turban/beard chung Eldrin — uu tien thay bang pack 2.

## Quy uoc sheet (pilot)

- 1 file/avatar: `<avatarId>.webp`, dai `1024x256`, 4 frame 256px.
- Frame 0 `idle` / 1 `blink` / 2 `talk` / 3 `dead`.
- Pack goc khong co bien the bieu cam: frame 1-2 tam dung idle,
  frame 3 lam tai bang script (xa xam 50% + sang 1.12).
  Trang thai "dang noi" do quang `seat-voice-halo` dam nhan.
- Nen trang tach bang flood-fill tu vien (nguong 235) + mo alpha 0.7.
- Tran: moi sheet ≤ 80KB, tong ≤ 1200KB.

## Tai sinh

Script: `C:\Users\Admin\AppData\Local\Temp\opencode\build_sheets.py`
(chay `python build_sheets.py`, khong tham so).
Doi nguon art thi cap nhat bang nay + `AVATAR-CREDITS.md`, khong sua code.
