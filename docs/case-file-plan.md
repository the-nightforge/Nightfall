# Hồ sơ vụ án — Implementation plan

Thiết kế đã duyệt: [case-file-design.md](./case-file-design.md).
Nhánh: `feat/case-file` (tách từ `f64d4d1`, cùng commit với `main`).

> Cây làm việc đang có thay đổi audio **chưa commit** của người dùng
> (`apps/web/public/audio/**`, `apps/web/src/lib/audio-*`, `tools/audio/**`).
> Không stage, không sửa, không commit những file đó.

## Thứ tự thi công (TDD: test đỏ → code → xanh)

### Bước 1 · Hạ tầng test cho `packages/shared`
- `vitest.config.mts` + `tsconfig.test.json` (mirror `packages/game-engine`).
- `package.json`: thêm script `test`, mở rộng `lint` sang `tsconfig.test.json`, devDep `vitest`.
- Root `package.json`: nối `@masoi/shared` vào cả `test` lẫn `lint`
  (hiện shared vắng mặt ở **cả hai**).
- Kỳ vọng phụ: `tests/roles.test.ts` chạy lần đầu tiên.

### Bước 2 · `packages/shared/src/case-file/` (pure, deterministic)
| File | Nội dung |
|---|---|
| `types.ts` | `CaseFile`, `CaseHighlight`, `CaseEvidence`, `CaseFilePlayer`, `CaseTimelineEntry` |
| `narrate.ts` | Câu chữ tiếng Việt sinh từ evidence + tên |
| `highlights.ts` | 15 detector + `selectHighlights` (dedup theo `eventKey`, trần 2/loại, thứ tự toàn phần) |
| `build.ts` | `buildCaseFile(snapshot) → CaseFile \| null`, cổng `GAME_OVER`, hash `caseId` |
| `index.ts` | re-export; nối vào `packages/shared/src/index.ts` |

Test: `packages/shared/tests/case-file.test.ts` (+ `case-file-highlights.test.ts`).

### Bước 3 · `apps/web/src/lib/` (model + share, test bằng `node:test`)
| File | Nội dung |
|---|---|
| `case-card.ts` | `buildCaseCardModel(caseFile, opts) → CaseCardModel` — cắt chữ, chốt câu, dựng `shareText` |
| `case-share.ts` | `pickShareStrategy`, `describeShareOutcome`, `runShare` (adapter mỏng) |
| `case-canvas.ts` | `paintCaseCard(ctx, model, fonts)` — vẽ 1080×1920 từ đúng model |

### Bước 4 · Components
- `CaseFileCard.tsx` — mã hồ sơ, kết quả, 3–5 điểm ngoặt, timeline ngắn.
- `CaseShareCard.tsx` — preview DOM 9:16 + nút Chia sẻ / Tải ảnh / Sao chép.
- `GameOverView.tsx` — chèn hồ sơ; `NightRecapTimeline`/`HunterShotTimeline`
  chuyển sang mở bằng nút; **không đổi** Chơi lại / Rời phòng.

### Bước 5 · Regression + tài liệu
`npm test` · `npm run lint` · `npm run build`, rồi cập nhật README
(bảng Testing thiếu `@masoi/shared` và ghi sai số test web).

## Sai lệch có chủ đích so với bản thiết kế
`CaseFile.timeline` được **dùng thật** (dải "Dòng thời gian" ngắn trong thẻ hồ sơ,
đúng gạch đầu dòng "Timeline ngắn, dễ đọc"), còn nút "Xem toàn bộ diễn biến" mở
`NightRecapTimeline`/`HunterShotTimeline` chi tiết sẵn có. Hai thứ khác nhau, không
cái nào là code chết.
