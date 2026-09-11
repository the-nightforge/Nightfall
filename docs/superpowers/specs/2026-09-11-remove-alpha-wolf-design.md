# Xóa Sói Alpha, đưa Kẻ Phản Bội vào nhóm Sói ở phòng chờ

> **Ngày tạo:** 2026-09-11

## 1. Vấn đề

Sói Alpha và Kẻ Phản Bội trùng nhau ở đúng một điểm dễ thấy nhất: Tiên Tri soi ra "Dân".
Kẻ Phản Bội luôn ra Dân - đó là cả lá bài (đồng minh ngầm của Sói, không thuộc bầy). Sói Alpha
chỉ ra Dân lần soi đầu - và đó là thứ DUY NHẤT phân biệt nó với Sói thường. Số đo bot xác nhận
khiên soi gần như không đáng gì: Alpha +21.9 so với Sói thường +20.9.

Quyết định: **xóa cứng Sói Alpha** (cùng tiền lệ Bà Đồng/Linh Mục, spec 2026-09-05). Kẻ Phản
Bội **giữ nguyên luật**, chỉ được bày vào nhóm Sói ở phòng chờ và thế ghế Alpha ở preset 19-20.

## 2. Xóa ALPHA_WOLF

- **shared:** `ROLES`, `ROLE_META`, `isWolfPack`; `RoomConfig.alphaWolf`, `roomConfigSchema`,
  `DECK_KEYS`; `deckWolfCount`/`validateRoomConfig`/`generateWarnings` bỏ vế Alpha;
  `ROLE_POWER.ALPHA_WOLF`; preset builder (`if (config.alphaWolf)`).
- **engine:** `GameState.alphaShieldUsed` (type, init, `??=` khi load) và hook khiên trong case
  `SEE`; `bot/roles/registry.ts`, `chat-analysis.ts` ("sói alpha"), `speech-dataset.ts`;
  `alphaShieldedSeerResults` ở `selfplay.ts` + `invariants.ts`.
- **server:** `alphaShieldUsed` trong persistence schema; dòng Alpha ở `scripts/role-power.ts`,
  `preset-balance.ts`, `role-power-sweep.ts`.
- **web:** `NightPanel.tsx`, `lobby-summary.ts` (`WOLF_SPECIAL_ROLES`, `CONFIG_KEY`), `role-art.ts`.
- **test:** xóa `alpha-wolf.test.ts`; gỡ case Alpha ở `extended-roles-flow`, `selfplay-invariants`,
  `chat-permission-guard`, `night-role`, `roles`, `room-config`, `balance-warnings`,
  `lobby-summary`, `role-art`, `bot-sorcerer`, `bot-trace`, `bot-transcript`, `RoleDeckPanel`;
  gỡ `alphaShieldUsed: {}` khỏi mọi fixture state.

Ghi chú lịch sử trong comment `balance.ts` (bảng đo cũ) giữ nguyên - đó là số liệu đã đo, không
phải code. Spec 2026-09-05 giữ nguyên.

## 3. Dữ liệu cũ

- **Config phòng lưu có `alphaWolf`:** `storedRoomConfigSchema` đã `.strip()` key lạ. Không làm gì.
- **Ván đang chạy lúc deploy có người cầm ALPHA_WOLF:** `roleSchema` hiện `.catch("VILLAGER")`,
  tức một con Sói giữa ván hóa Dân - đổi phe, sai ván. Thêm ánh xạ `ALPHA_WOLF -> WEREWOLF` trước
  `roleSchema` khi đọc snapshot: người đó vẫn ở bầy, chỉ mất khiên. Vai lạ khác vẫn rơi về
  VILLAGER như cũ.
- **`alphaShieldUsed` trong snapshot cũ:** schema `z.object()` strip key lạ. Không làm gì.
- **Hồ sơ vụ án ván cũ:** đã có `isRole` chặn. Không làm gì.

## 4. Kẻ Phản Bội ở phòng chờ

- `WOLF_SPECIAL_ROLES = ["WOLF_CUB", "SORCERER", "TRAITOR"]`, `CONFIG_KEY.TRAITOR = "traitor"`.
  Host bật/tắt được lá này (trước giờ chỉ vào ván qua preset 11/12/18).
- Luật không đổi: không thuộc bầy, không hành động đêm, Tiên Tri soi ra Dân, hóa Ma Sói khi
  con Sói cuối chết. `validateRoomConfig` không đổi: chiếm ghế, không vào `wolfCount`.
- `deckCounts` của phòng chờ đếm nó vào cột Sói - cùng cách đang đếm Sói Pháp Sư (không cắn
  nhưng thắng cùng Sói).

## 5. Preset 19-20

`alphaWolf: true` -> `traitor: true`. Số Sói cắn 5 -> 4, và theo bảng đo Alpha +21.9 so với
Kẻ Phản Bội +17.0 - dự đoán phe Sói yếu đi khoảng 5 điểm ở hai preset này. Đây là dự đoán, không
phải số đo: chạy `preset-balance` cho 19 và 20 sau khi đổi. Nếu lệch khỏi ngưỡng, báo số liệu
cho người quyết định cách chỉnh - không tự đoán thêm vai.

## 6. Kiểm thử

- Test mới: snapshot có player `role: "ALPHA_WOLF"` đọc lại ra `WEREWOLF`.
- Test mới: `WOLF_SPECIAL_ROLES` chứa TRAITOR và `CONFIG_KEY.TRAITOR === "traitor"`.
- `npm run test` + `build` toàn repo xanh; `grep ALPHA_WOLF|alphaWolf|alphaShield` trong
  `src/` và `tests/` chỉ còn ánh xạ legacy + comment lịch sử.
- `preset-balance` preset 19-20 (mục 5).
