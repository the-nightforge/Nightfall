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

### Con thieu 8 khuon mat (do ngay 2026-09-04)

Ngay 2026-09-04 tran phong len **20** (`MAX_PLAYERS_PER_ROOM`) trong khi
`AVATAR_IDS` van 16, va 16 id nay chi ánh xa vao **12 khuon mat**. Hai con so
do cong lai:

| So ghe | Trung ID hinh | Trung KHUON MAT | Ghe thua nhieu nhat |
| ------ | ------------- | --------------- | ------------------- |
| 15     | 0%            | 100%            | 4                   |
| 16     | 0%            | 100%            | 4                   |
| 20     | 100%          | 100%            | 8                   |

Do bang 4000 phong ngau nhien moi cot. Doc nhu sau: o 15-16 ghe thi
`assignAvatars` khong bao gio cap trung *id*, nhung vi 4 cap id dung chung mat
goc nen gan nhu van nao cung co 4 cap nguoi trong giong nhau. O 20 ghe con
thieu ca id, nen thanh 8 cap — tuc 16 tren 20 nguoi nam trong mot cap nhin
giong ai do.

**Can mua them 8 khuon mat.** 12 hien co + 8 = 20: vua du moi ghe mot mat
rieng, va xoa luon 4 cap dung chung. Mot lan giai ca hai van de.

Uu tien mua tu CUNG tac gia neu co ban day du. Tron pack khac vao nghia la 12
mat cu va 8 mat moi ngoi canh nhau trong cung mot ban, va lech phong cach o do
thi nhin ra ngay.

Day la van de THAM MY, khong phai bug: moi ghe van co hinh, khong o nao trong,
va `tintFor` van cho sac nen rieng nen hai o trung mat van phan biet duoc.
Khong co gi xau di theo thoi gian.

Them mot nhan vat = 5 buoc, xem `## Tai sinh` ben duoi. Them id vao
`AVATAR_IDS` khi CHUA co sheet thi khong lam do suite: `portraitSource` roi ve
hinh SVG trong `avatar-art.ts` - dung duong ma nguoi bat Save-Data van di. Cai
BAT BUOC la id do phai co path trong `AVATAR_PATHS`, va TypeScript ep san vi do
la `Record<AvatarId, string>` day du. Doi lai: 4 id do hien la net SVG mot mau
giua mot ban toan anh chan dung - de nhin ra, nen day la ly do thu hai de mua
them mat, sau chuyen 4 cap dung chung.

## Quy uoc sheet (pilot)

- 1 file/avatar: `<avatarId>.webp`, dai `1024x256`, 4 frame 256px.
- Frame 0 `idle` / 1 `blink` / 2 `talk` / 3 `dead`.
- Pack goc khong co bien the bieu cam: frame 1-2 tam dung idle,
  frame 3 lam tai bang script (xa xam 50% + sang 1.12).
  Trang thai "dang noi" do quang `seat-voice-halo` dam nhan.
- Nen trang tach bang flood-fill tu vien (nguong 235) + mo alpha 0.7.
- Tran: moi sheet ≤ 80KB, tong ≤ 1200KB.

## Tai sinh

Script: `tools/build-character-sheets.py`

```
python tools/build-character-sheets.py <thu-muc-pack>
```

`<thu-muc-pack>` la thu muc giai nen cua pack Studio Nik, tuc thu muc chua
`Caius/`, `Eldrin/`, ... Duong dan nay la THAM SO chu khong viet cung trong
script: no chi ton tai tren may da tai pack ve. Thu muc ghi ra thi suy tu vi
tri chinh script nen khong can khai bao; muon ghi cho khac thi them `--out`.

Script kiem du 12 file nguon TRUOC khi ghi bat cu gi - thieu mot anh giua
chung thi 15 sheet da de len ban cu roi.

Doi nguon art thi cap nhat bang nay + `AVATAR-CREDITS.md`, khong sua code.

## Đã đo, không phải phỏng đoán

**Frame 1 và 2 KHÔNG khác frame 0.** Đo trên `hood`, `farmer`, `viking`: lệch
trung bình 0.7–1.5 trên 255, max 21–33 — đúng bằng nhiễu nén WebP. Frame 3 thì
khác thật: lệch trung bình 4.9–8.4, max 68–74.

Vì vậy mọi sheet khai báo `variants: false` trong
`apps/web/src/lib/character-art.ts`, và CSS không chạy animation cho chúng.
Ngày nào có sheet biến thể thật, đổi cờ đó thành `true` ở đúng dòng của nhân
vật đó — nháy mắt và mấp máy tự sống dậy, không đụng code.

**Bốn khuôn mặt dùng chung.** `mustache` và `miner` cùng là Caius; `beard` và
`turban` cùng là Eldrin; `pilgrim` và `cook` cùng là Indira; `sombrero` và
`jester` cùng là Soleil. `assignAvatars` không cho trùng AvatarId nhưng KHÔNG
biết bốn cặp này, nên một phòng 15 ghế gần như chắc chắn xếp một cặp cạnh nhau
— hai khuôn mặt gần giống, một cái bị lật. Đây là lý do ưu tiên số một để thay
pack, quan trọng hơn cả chuyện biến thể biểu cảm: chân dung tồn tại để phân biệt
người này với người kia.

**Kích thước là hợp đồng.** 1024×256, 4 frame vuông. `character-art.test.ts`
đọc header WebP và chặn file sai tỉ lệ — CSS trượt theo phần trăm nên một sheet
3 frame sẽ ghép nửa mặt người này với nửa mặt người kia.
