# FINAL_VOTE Action Space — Thiết kế

Ngày: 2026-09-14. Phụ thuộc: residual policy (2026-09-09), shaping reward
(2026-09-11). Bối cảnh: spike 500 ván (2026-09-11) đo nhãn đêm-threat chỉ đạt
+0.049 ± 0.023 (~2σ, teacher đã cắn max-tier 83%) → dừng nhánh đêm. Tín hiệu
mạnh nhất từng đo — FINAL_VOTE làng +0.425 ± 0.016 (27σ) — hiện bỏ phí vì
FINAL_VOTE/SPEECH không có không gian hành động (0.15% hàng). Spec này mở
FINAL_VOTE trước; SPEECH là sub-project riêng.

## Vấn đề

`TARGETING_DECISIONS` chỉ gồm VOTE/NIGHT/HUNTER_SHOT. Line FINAL_VOTE có
`actionIndex null` (không nhãn), nên BC không học, PPO không nhận gradient,
shaping FINAL_VOTE không đi tới đâu — đúng chỗ tín hiệu mạnh nhất.

## Quyết định

### D1. Kind FINAL mới trong cùng action space

`ACTION_KINDS` append `"FINAL"` cuối mảng → 12 kinds × 17 slots = 204 chiều
(maxSeats 16). Chỉ số cũ 0–186 giữ nguyên. Mask của line FINAL_VOTE chỉ mở ô
ghế `trialAccusedId` + ô không-mục-tiêu; chọn ô bị cáo = treo, ô kia = tha
(đọc từ `chosen.label` "treo"/"tha" đã có trong trace). Bị cáo không xác định
→ mask rỗng → `actionIndex null` (quy ước "không nhãn" hiện tại).

Không tái dùng CHOOSE (trộn semantics bầu/treo), không đầu nhị phân riêng
(nhân đôi train/runtime/benchmark).

### D2. Observation đủ, không thêm đặc trưng

Đã có `decision:FINAL_VOTE`, `legalKind:FINAL` (tự sinh từ ACTION_KINDS),
`trialAccusedId`, `isAccused`. v1 không thêm đặc trưng; BC agreement sẽ xác
nhận (thiếu gì thì agreement treo/tha thấp và lúc đó mới bổ sung).

### D3. Runtime hook fail-closed

Seam `FinalVotePolicyModel` trong `BotRuntime.decideFinalVote`, mirror seam
`NightPolicyModel`. Mọi nhánh hard-rule đứng trước và không đổi: Sói không
treo đồng bọn, Hề luôn tha, Sát Nhân luôn treo, Báo Thù theo mục tiêu, không
bị cáo → tha. Policy chỉ quyết phần belief-driven cuối; thiếu policy hoặc lỗi
→ rơi về teacher. `LearnedDecisions` thêm giá trị `final`.

### D4. Dataset-0004, tương thích một chiều

Action space đổi → `datasetVersion dataset-0004`. Model/dataset-0003 × code
mới → loader từ chối (cơ chế hiện có). Phải sinh dataset và BC lại từ đầu,
không transfer weights.

### D5. v1 dừng ở benchmark parity, không PPO

Chuẩn pass: benchmark `baseline,village,wolves,all` với learned-decisions
final cho Δ ≈ 0 mọi cấu hình + violations = 0 (cổng Step 7: `all − teacher →
0`). Teacher FINAL_VOTE không có thang điểm ứng viên nên không có bases cho
residual — hàng FINAL trong tập residual-rollout ghi `bases` NaN và PPO-v1 bỏ
qua chúng. Thang residual cho FINAL (confidence-as-bases hay logits-only) là
spec v2 riêng; v1 model là BC-logits clone như thời policy-0004.

## Kiểm chứng

- TS: mask FINAL (ô bị cáo + ô tha; vắng bị cáo → rỗng/null); ánh xạ treo/tha;
  validator siết (có bị cáo mà không map được → violation); datasetVersion;
  runtime hook (policy → guilty; fallback teacher; hard-rule không bị ghi đè).
- Python: loader đọc size từ meta — verify `test_data` hiện có (sửa chỗ nào
  hard-code 187 nếu có).
- E2E smoke: 20 ván → encode → BC vài epoch → benchmark parity mini.
- CI hiện có, không thêm job.

## Tiêu chí thành công & rollback

- **Thành công**: clone treo/tha trung thành (Δ ≈ 0, violations 0) — mở đường
  PPO/shaping FINAL_VOTE ở v2, nơi tín hiệu +0.425 chờ sẵn.
- **Rollback**: không gắn policy vào runtime — production giữ heuristic đúng
  byte như hôm nay.
- **Kỳ vọng trung thực**: nếu BC agreement treo/tha thấp dù observation đủ theo
  lý thuyết, thiếu nằm ở đặc trưng phiên toà (ghi lại, bổ sung D2).

## Giới hạn đã biết

1. SPEECH ngoài phạm vi — sub-project riêng.
2. PPO/residual cho FINAL là v2 (cần thiết kế thang điểm).
3. Vai trung lập ở phiên toà (Hề/Báo Thù/Sát Nhân) đi đường hard-rule, policy
   không học chúng — chấp nhận có chủ đích.
