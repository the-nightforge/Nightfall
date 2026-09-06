# Ảnh các màn hình chính

Hai bộ, cùng một kịch bản, chỉ khác khung màn hình:

- `mobile/` — 390x844 @2x (khung điện thoại, bố cục mobile-first)
- `desktop/` — 1440x900 (bố cục web, breakpoint `lg`)

Chụp bằng `node tools/capture-screens.mjs` — script tự tạo phòng, thêm 7 bot,
bắt đầu ván và chụp mỗi khi pha đổi.

| Ảnh | Màn hình |
|---|---|
| `01-trang-chu.png` | **Trang chủ** — hero, ô vào phòng, bảng xếp hạng, lời mời cài PWA (cuộn hết trang) |
| `02-phong-cho.png` | **Phòng chờ** — lưới người chơi, nút Bắt đầu, tóm tắt bộ bài (cuộn hết trang) |
| `03-phong-cho-luat-va-vai-tro.png` | Phòng chờ → bảng "Luật và vai trò" |
| `04-xem-vai-tro.png` | Vào ván — màn xem vai trò |
| `05-ban-dem.png` | **Màn chơi** — ban đêm, bảng hành động của vai |
| `06-troi-sang.png` | **Màn chơi** — trời sáng, ai không qua khỏi đêm (chỉ có ở bản web) |
| `07-thao-luan.png` | **Màn chơi** — thảo luận ban ngày |
| `08-bo-phieu-so-bo.png` | **Màn chơi** — bỏ phiếu sơ bộ, đề cử bị cáo |
| `09-bien-ho.png` | **Màn chơi** — biện hộ, sân khấu phiên toà 3D |
| `10-bo-phieu-xac-nhan.png` | **Màn chơi** — bỏ phiếu Treo/Tha |
| `11-ket-qua.png` | **Kết quả** — vừa khung màn hình |
| `12-ket-qua-full.png` | **Kết quả** — cuộn hết trang: đội hình lộ vai, hồ sơ vụ án, chia sẻ |

Cùng một số thứ tự là cùng một màn hình ở cả hai bộ. Pha "Trời sáng" chỉ dài 8
giây nên không phải lần chạy nào cũng chụp được khung ổn định - bộ `mobile/`
thiếu ảnh 06, nội dung của nó lặp lại ở đầu màn Thảo luận.

## Chụp lại

```bash
docker compose up -d
npm run dev:server        # cổng 4100
npm run dev:web           # cổng 3000

node tools/capture-screens.mjs                                            # mobile
OUT=docs/screens/desktop W=1440 H=900 DSF=1 MOBILE=0 node tools/capture-screens.mjs
```
