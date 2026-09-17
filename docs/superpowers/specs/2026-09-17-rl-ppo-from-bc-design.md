# RL PPO từ bản sao BC — Thiết kế

Ngày: 2026-09-17. Phụ thuộc: RL self-play (2026-09-09), shaping reward
(2026-09-11), FINAL_VOTE action space (2026-09-14), và thay đổi runtime cờ
`"hunter"` + production `seats: "all"` (cùng ngày, phải vào trước spec này).

Đây là dự án con A trong bốn hướng cải thiện model (A: mạnh hơn heuristic,
kèm cân bằng phe làm ràng buộc; B: observation đầy đủ hơn; C: khó đoán hơn;
SPEECH ngoài phạm vi). B và C có spec riêng khi tới lượt.

## Vấn đề

`village-bc-0002` (masoi-mlp-2, dataset-0004) là bản sao TRUNG THÀNH của
teacher: test `agreementTieAware` 0,972 trên trần 0,984. Benchmark 3×300 ván,
seed `bench`:

| Cấu hình | Δ so với baseline |
|---|---|
| Làng dùng model | −0,9 ± 0,8 |
| Sói dùng model | −0,0 ± 0,8 |
| Cả bàn, vote+night+final+hunter | +1,6 ± 0,4 (làng thắng 55,8 %) |

BC không thể vượt teacher — trần của nó là chính teacher. Muốn MẠNH HƠN phải
học từ kết quả ván. Đường ống RL (`rl_loop.py`) đã có nhưng chưa từng cho kết
quả trên action space hiện tại, và có ba lỗ hổng khiến nó train và đo sai thứ
nếu chạy nguyên trạng với model này.

Lần RL trước từ bản sao BC đi ngang vì bản sao đó thua teacher 6,6 điểm
(observation thiếu số hạng điểm). `0002` đã ngang teacher, nên lý do ấy phần
lớn không còn; vì vậy spec này đi thẳng PPO trên logits thuần thay vì residual.

## Quyết định

### D1. PPO logits thuần, xuất phát từ `village-bc-0002`

Không residual. Residual chỉ có seam VOTE/NIGHT (Phù Thuỷ giữ heuristic),
không học được FINAL_VOTE/HUNTER_SHOT, và buộc production quay về cấu hình
hai lượt. Logits thuần dùng đúng cả bốn lượt production đang chạy, không thêm
code runtime.

### D2. Rollout và benchmark bật đủ bốn lượt

Hiện `selfplay.ts` không có `--learned-decisions`, và `rl_loop.py` không
truyền cờ này cho rollout lẫn benchmark → cả hai chạy mặc định `"both"`
(vote+night): model không bao giờ có dữ liệu FINAL_VOTE/HUNTER_SHOT tự sinh,
và benchmark đo một cấu hình khác production.

- `apps/server/scripts/selfplay.ts` thêm `--learned-decisions`, parse bằng
  CÙNG logic với `ai-benchmark.ts` (tách hàm dùng chung trong `scripts/`,
  không chép hai bản). Giá trị hợp lệ: `both` hoặc CSV trong
  `vote,night,final,hunter`.
- `rl_loop.py` thêm `--learned-decisions` (mặc định `vote,night,final,hunter`)
  và truyền xuống MỌI lệnh rollout và benchmark.

### D3. Cổng cân bằng

`should_promote` thêm điều kiện đọc cấu hình `all` (đã được benchmark sẵn,
hiện chỉ in ra):

    imbalance(x) = |villageWinMean(all) − 0,5| × 100
    imbalance(challenger) ≤ imbalance(champion) + balance_slack

`--balance-slack` mặc định 1,0 điểm (nhiễu 3×300 ván của cấu hình `all` đo
được ±0,4; slack 0 sẽ chặn gần như mọi ứng viên). Giá trị âm = tắt cổng.
Cổng áp dụng trên MỌI bộ seed thăng hạng (bench + confirm), cùng kỷ luật AND
với điều kiện điểm.

### D4. Cổng không tụt phe kia

Model logits thuần là MỘT bộ trọng số cho cả hai phe: train `--side village`
kéo lệch cả hành vi sói. Khi `--side` là `village` hoặc `wolves`:

    score_of(challenger, phe_kia) ≥ score_of(champion, phe_kia) − other_side_slack

`--other-side-slack` mặc định 1,0 điểm. `--side all` bỏ qua cổng này (điểm đã
là trung bình hai phe).

Để so được, `state.json` lưu thêm điểm phe kia và imbalance của champion cạnh
`championScore`; state cũ thiếu khoá → tính lại từ `bench-champion-0000.json`.

### D5. Tạm bỏ lượt đêm khỏi policy-loss

Giai đoạn 1–2 chạy `--train-decisions vote,final_vote,hunter_shot`. Ablation
champion-0009 (900 ván/ô): night-only cho +1,22 / −2,67 trên hai bộ seed —
đổi dấu = nhiễu, và gradient đêm pha loãng update. Lượt đêm vẫn chạy bằng
trọng số BC trong rollout/benchmark; value và entropy vẫn tính trên mọi hàng
(hành vi sẵn có của `--train-decisions`). Giai đoạn 3 thử riêng đêm.

### D6. Sửa guard ghi `learned` cho FINAL_VOTE

Phát hiện khi lập kế hoạch (probe 10 ván preset 8 người, cờ `final,hunter`,
T=1): 378 trace FINAL_VOTE, **0** mang `learned`; HUNTER_SHOT có. Nguyên
nhân là giới hạn đã ghi sẵn ở `BotRuntime.beginTracedDecision`: guard so
`kind` với `DAY_ACTION_KIND` và so `targetId`, nhưng hai nước FINAL cùng
`targetId` (bị cáo) và kind là `FINAL` → không bao giờ khớp → rollout bỏ mọi
hàng FINAL_VOTE, PPO không học được phiên toà dù cờ đã bật.

Sửa: với `decision === "FINAL_VOTE"`, khớp khi `learnedDecided.kind ===
FINAL_ACTION_KIND` và "policy chọn treo" (`learnedDecided.targetId !== null`)
trùng "nước đã đi là treo" (`label === FINAL_VOTE_GUILTY_LABEL`). Các lượt
khác giữ guard cũ.

## Kế hoạch chạy

Máy: i5-10300H 4 lõi/8 luồng, 24 GB, CPU-only (rollout là TypeScript nên GPU
không giúp phần lớn thời gian). Ước lượng từ benchmark 4.500 ván ≈ 12 phút;
giai đoạn 0 đo số thật.

| Giai đoạn | Cấu hình | Ước lượng |
|---|---|---|
| 0. Chạy thử | 2 vòng × 600 ván, `--side village`, bench ở vòng cuối | ~45 phút |
| 1. Làng | 10 vòng × 3.000 ván, `--bench-every 5`, `--side village`, từ `village-bc-0002` | ~3 giờ |
| 2. Sói | như 1, từ champion giai đoạn 1, `--side wolves`, `--shaping-decisions vote` | ~3 giờ |
| 3. Đêm (tuỳ chọn) | 5 vòng mỗi phe, `--train-decisions night` | ~1,5 giờ/phe |
| 4. Xác nhận | 5 seed × 300 ván, seed MỚI chưa vòng nào dùng, cả 5 setup gồm `teacher` | ~40 phút |

Siêu tham số chung (giai đoạn 1–3): `--temperature 1`, `--lr 1e-4`,
`--target-kl 0.01`, `--shaping-alpha 1`, `--baseline role`,
`--promote-margin 2`, `--confirm-seed rl-conf`.

Giai đoạn 0 dừng cả kế hoạch nếu một trong các điều sau sai: đường ống chạy
hết không lỗi; tập encode có hàng `FINAL_VOTE` và `HUNTER_SHOT` mang `logProb`;
`approxKl` < 0,05 và `agreementWithInit` ≥ 0,95 sau vòng 1.

Giai đoạn 3 chỉ chạy khi giai đoạn 1 VÀ 2 đều có ít nhất một lần thăng hạng.

## Kiểm chứng

- `ai-training/tests`: `should_promote` với cổng cân bằng (qua/chặn/slack âm
  tắt) và cổng phe kia (qua/chặn/`--side all` bỏ qua); khôi phục state cũ
  thiếu khoá mới.
- `apps/server/tests`: parse `--learned-decisions` dùng chung — hợp lệ, rỗng,
  tên lạ đều như `ai-benchmark` hiện tại.
- Self-play TS: ván preset 8 người có `learnedDecisions: ["final","hunter"]`,
  T=1 + trace sinh trajectory có `learned` ở CẢ FINAL_VOTE lẫn HUNTER_SHOT, và
  nhãn encoder trùng `learned.actionIndex` (khoá D6).
- Giai đoạn 0 là kiểm chứng tích hợp của cả đường ống.

## Tiêu chí thành công & rollback

Champion cuối được đóng gói khi, trên bộ seed xác nhận của giai đoạn 4:

1. Phe được train mạnh hơn `village-bc-0002` ≥ +2 điểm (mỗi phe đã train).
2. Không phe nào tụt quá 1 điểm so với `village-bc-0002`.
3. `imbalance(all)` ≤ 5,8 + 1,0 điểm.
4. 0 vi phạm luật trong mọi lô.

Đạt → `apps/server/assets/models/village-ppo-0001.weights.json` (modelId
trùng tên file), cập nhật `learned-policy.test.ts`, `.env.example`,
`deploy/env.production.example`. Deploy do người duyệt, không tự động.

Không đạt → production giữ `village-bc-0002`. Rollback sau deploy = đổi
`BOT_POLICY_FILE` về `village-bc-0002` (file giữ trong image).

Không vòng nào thăng hạng sau giai đoạn 1 → chạy lại một lần với `--lr 3e-4`;
vẫn không → dừng A, chuyển dự án con B (observation).

## Giới hạn đã biết

1. Nhiễu benchmark: 3×300 ván cho SE hiệu ≈ 0,4–1,9 điểm tuỳ cấu hình; ngưỡng
   +2 trên hai bộ seed là cổng tối thiểu, không phải bằng chứng mạnh.
2. Đối thủ trong benchmark là heuristic. Mạnh hơn heuristic chưa chắc mạnh hơn
   người thật; `prod-metrics` sau deploy mới trả lời được.
3. Thám Tử chọn hai người, nhãn chỉ giữ người đầu — PPO không cải thiện được
   phần đó (dự án con B).
4. Mọi thời gian trong kế hoạch là ước lượng; giai đoạn 0 thay bằng số đo.
