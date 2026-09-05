# Thay Bà Đồng + Linh Mục bằng Sói Pháp Sư + Sói Alpha (xóa cứng)

> **Ngày tạo:** 2026-09-05
> **Trạng thái:** Chờ review spec
> **Phạm vi:** `@masoi/shared`, `@masoi/game-engine`, `apps/server`, `apps/web`
> **Quyết định của user:** thay đúng cặp MEDIUM + PRIEST ("Bà đồng và mục sư"), **xóa cứng** khỏi codebase (không giữ deprecated).

---

## 1. Bối cảnh và số đo

Kiểm kê 20 role hiện tại: Sói 3 (`WEREWOLF` 5, `WOLF_CUB` 6, `TRAITOR` 3.5) vs Dân 14 vs Trung lập 3.
Phe Sói thiếu chủng loại: 0 counter-intel, 0 tank chủ động.

Hai role bị thay (đo self-play, speech BẬT):
- `MEDIUM` −0.5 (âm, 3.1σ): đã nối `mediumResult` vào bot vẫn âm; chi phí khai vai của bot (70.7% claim bị tranh chấp) nuốt hết giá trị lá bài.
- `PRIEST` 1.5 (đo +1.1→+1.9, chỉ 2 mẫu): kill chủ động của Dân nhưng ném mù, bot dùng kém.

Preset 17–20 đang lệch Dân 57–61% (trên dải 35–55 mà repo tuyên bố) — đây là chỗ 2 sói mới phải vá, không phải bàn nhỏ (8–10 đang quanh 50%).

## 2. Xóa cứng MEDIUM + PRIEST

Xóa khỏi: `ROLES` + `ROLE_META` (`shared/src/roles.ts`), `RoomConfig` (`phases.ts`: `medium?`, `priest?`),
`roomConfigSchema` + đếm ghế `validateRoomConfig` + enum `nightActionTypeSchema` (xóa `HOLY_WATER`) (`schemas.ts`),
`specialRoleList` + `ROLE_POWER` + mọi preset có `medium/priest: true` + `TOGGLES` (`balance.ts`, `role-power.ts`),
engine (`types.ts`: `mediumResults`, `priestTarget/Skipped/Results`, `priestHolyWaterUsed`; `engine.ts`: case
`MEDIUM_CHECK`/`HOLY_WATER`, khối Priest resolution, `MediumResultView`/`PriestResultView`, view/legal-actions/knowledge-bot),
bot (`roles/medium.ts`, `roles/priest.ts`, registry, `belief/private-info.ts` nhánh medium, `chat-analysis.ts` keywords,
claim/speech templates cho 2 role), web (`role-art.ts`, form đêm, toggle `RoleDeckPanel`, text hướng dẫn),
tests (`roles.test.ts`, `new-roles.test.ts` xóa describe Bà Đồng, `traitor.test.ts` đổi roster có PRIEST,
`bot-extended-roles-night.test.ts`, mọi `bot-*.test.ts` dựng `mediumResult: null` — giữ field hay xóa theo `BotKnowledgeView`).

**GIỮ LẠI (tương thích lịch sử):** enum `cause` `"priest" | "priest_backfire"` trong `snapshot.ts`/`types.ts`/`case-file`
(ván cũ đã lưu cause này trong `nightHistory`), `isRole` đã trả `false` cho role lạ — UI dùng fallback
"Vai không còn tồn tại" thay vì crash. `GameEngine` constructor map role lạ về `VILLAGER` (ghi log) để ván
đang chạy trong Redis lúc deploy không crash ở `roleTeam`.

## 3. Role mới 1: SÓI PHÁP SƯ (SORCERER)

- `team: "wolves"`, `isWolfPack = true` (thức cùng bầy, biết mặt bầy, bầy biết nó), `nightOrder = 1`
  (soi trước khi bầy chốt cắn để kịp báo mục tiêu).
- Action `SORCERER_CHECK`: mỗi đêm 1 người **còn sống**, không tự check; chốt ngay lần nộp đầu (giống SEER —
  kết quả về ngay nên "đổi ý" = soi lại). Kết quả: có phải dòng Tiên Tri (`SEER`/`APPRENTICE_SEER`) không.
  Hẹp hơn Seer cố ý để không mirror 1:1.
- Không tương tác với khiên Alpha (khiên Alpha chỉ chặn SEE của làng).
- `ROLE_POWER` tạm 2 (= Detective, mirror bên sói); đo so cặp speech BẬT rồi chốt.
- Bot `sorcerer.ts`: ưu tiên check người claim Seer / người được Guard che / người sống lâu bất thường.

## 4. Role mới 2: SÓI ALPHA (ALPHA_WOLF)

- `team: "wolves"`, `isWolfPack = true`, `nightOrder = 2` (cắn cùng bầy như sói thường).
- Passive duy nhất: **miễn nhiễm soi lần đầu**. `SEE` lên Alpha khi `alphaShieldUsed[playerId]` falsy →
  trả `village`/`isWolf=false`, bật cờ; từ lần 2 trở đi hiện nguyên hình. Không chặn Detective
  (`sameFaction` giữ nguyên — ít edge case), không đổi `checkWin`.
- Config `alphaWolf?: boolean`; vào `wolfCount` như `wolfCub` (nó cắn được → `validateRoomConfig` đếm sát thương
  đêm phải thấy nó). State `alphaShieldUsed: Record<string, boolean>` + `??=` defaults cho snapshot cũ.
- `ROLE_POWER` tạm 6 (= Cub, ổn định hơn Cub vì không phụ thuộc cỡ bàn); đo lại rồi chốt.
- Không rage, không tương tác Cub-rage ngoài việc cùng đi trong `wolfVotes`.

## 5. Preset và đo lường

- Thay ghế 1–1: preset 17–18 `medium → sorcerer`, preset 19–20 `priest → alpha` (tổng role giữ 20,
  mỗi preset vẫn còn ≥1 ghế Dân theo `preset-coverage.test.ts`).
- Cập nhật `preset-coverage.test.ts` (bỏ MEDIUM/PRIEST khỏi diện bắt buộc, thêm SORCERER/ALPHA_WOLF),
  `CORE_PRESET_ROLES` không đổi.
- Đo: `role-power.ts` so cặp trên đúng seed, **speech BẬT**, ≥600 ván/ô cho 2 role mới trước khi chốt số;
  `runBatch` đối chiếu preset 17–20 về dải 35–55. Không vặn số cho vừa ngưỡng.

## 6. Rủi ro và hàng rào

- Xóa `HOLY_WATER` khỏi zod enum: client cũ cache sẽ bị từ chối payload — chấp nhận (xóa cứng theo yêu cầu),
  ghi vào CHANGELOG/notes deploy.
- Deploy khi không còn ván đang chạy; nếu còn, guard VILLAGER ở §2 gánh.
- Ván custom đang bật medium/priest trong DB: `validateRoomConfig` vẫn pass (field thừa bị `.strict()` chặn ở
  lần update config tiếp theo) — host phải tự tắt; spec này không migrate DB.

## 7. Kiểm thử

- Unit engine mới: `sorcerer.test.ts` (check ra dòng Seer, chốt 1 lần/đêm, không tự check, target chết bị từ chối),
  `alpha-wolf.test.ts` (soi lần 1 ra Dân + bật cờ, lần 2 ra Sói, vẫn cắn/bị treo bình thường, vào wolfCount).
- Cập nhật mọi test liệt kê ở §2; `npm run test` + `build` toàn repo xanh.
- Self-play đo 2 role mới + preset 17–20 (số liệu đính kèm plan implement).
