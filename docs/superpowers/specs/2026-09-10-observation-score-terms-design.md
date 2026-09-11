# Observation mang đủ số hạng điểm — Thiết kế

Ngày: 2026-09-10. Phụ thuộc: `2026-09-09-residual-policy-design.md` (PR #86),
PR #87. Bối cảnh đo: `reports/train-policy-0002.md`, hai mục cuối.

## Vấn đề

Residual policy đã chứng minh học được: **+2,5 ± 0,7 điểm cho phe làng** trên 18
seed, đối chứng ngẫu nhiên bằng 0. Nhưng nó dừng ở đó:

- Phần lợi nằm **trọn ở lượt bầu**; lượt đêm cho đúng 0,0 trên 1.800 ván.
- Ở cấu hình `all` (thứ production chạy) chỉ còn **+1,0 ± 1,2** — không phân
  biệt được với heuristic.
- Hướng "giảm phương sai advantage bằng baseline tốt hơn" đã ĐÓNG: observation
  chỉ giải thích ~2,5 % phương sai kết cục, và cuối ván không dễ đoán hơn đầu
  ván. Đo ngày 2026-09-10, xem mục "Kết quả ÂM" trong report.

Còn một nguyên nhân chưa ai chạm: **model không nhìn thấy phần lớn thứ mà chính
heuristic dùng để chấm điểm.** `scoreVoteCandidate` cộng 8 số hạng; observation
413 chiều chỉ mang đầu vào của 2 (`belief` → `suspicion`, `trustDamping` →
`trust`). Sáu số hạng còn lại — evidenceConfidence, hostility, pairPressure,
roleBias, isolation, nhánh Sói — model phải đoán từ dữ liệu khác.

Với behavior cloning, đó là lý do bản sao không tái lập được teacher. Với
**residual** thì vấn đề đổi hình: model không cần tái lập điểm, nó cần biết
điểm ấy được tạo ra từ đâu để biết chỗ nào đáng sửa. Một ứng viên 40 điểm vì
belief cao khác hẳn một ứng viên 40 điểm vì hostility cao; hiện model không
phân biệt được hai trường hợp đó.

## Quyết định

### O1. Năm đặc trưng mới cho MỖI GHẾ, tính ở `snapshotBelief`

| Tên | Nguồn | Thang encode | Số hạng nó giải thích |
|---|---|---|---|
| `evidenceConfidence` | `max(reason.confidence)` trên `state.suspicion[id].reasons`, 0 khi rỗng | clamp 0..1 | `evidenceConfidence` |
| `incomingHostility` | `incomingHostilityOf(state, id)` | clamp 0..1 | `hostility` |
| `pairPressure` | `pairPressure(state, id, weights)` | clamp 0..1 | `pairPressure` |
| `isolation` | `isolationScore(state, id, aliveIds)` | clamp −1..1 | `isolation` |
| `roleBias` | `strategyFor(selfRole, weights).voteBias(ctx, state)[id]`, chia `BELIEF_SCALE` | clamp −1..1 | `roleBias` |

`snapshotBelief` là chỗ DUY NHẤT tính chúng, bằng chính hàm mà scorer gọi —
cùng nguyên tắc đã dùng cho `informationValue` / `claimedPowerRole` /
`guardedBefore`. Không có công thức nào bị chép lần hai, nên không có đường để
observation trôi lệch khỏi bảng điểm.

Hai chi tiết kỹ thuật:

- `pairPressure` hiện là hàm private trong `vote-decision.ts`; export nó ra.
  Nó thuần và đã nhận `weights`, không đổi chữ ký.
- `voteBias` nhận `BotDecisionContext`, còn `snapshotBelief` chỉ có
  `knowledge`. Dựng `{ knowledge, visibleChat: [] }` tại chỗ: đã kiểm cả bảy
  `voteBias` (werewolf, sorcerer, serial-killer, jester, executioner, traitor,
  và mặc định rỗng) — không cái nào đọc `visibleChat`.

Không rò rỉ (§44): cả năm đại lượng đều tính từ `state` và `knowledge` của
CHÍNH bot đó — quan hệ xã hội nó tự dựng, bằng chứng nó tự nghe, thiên vị của
vai nó tự biết. Không cái nào chạm sự thật vai của người khác.

### O2. Ba đặc trưng CỐ Ý không thêm

- **Nhánh riêng của Sói** (bussing / cãi giả / bảo vệ đồng bọn): chỉ chạy vòng
  1–2, chỉ với ghế Sói, và `knownWolfTeam` đã nói cho model biết ai là đồng
  bọn. Thêm nó đòi gọi `fakeFightTarget` trong `snapshotBelief`, tức kéo cả
  logic hash theo vòng vào tầng quan sát.
- **`claimedSeerLine`** (Pháp Sư) và **`attackedBefore`** (Sát Nhân): hai vai
  này không có trong bộ bài 8 người mà mọi benchmark dùng, nên chúng sẽ là
  chiều chết trong 100 % dữ liệu đo.

Nếu sau này benchmark chuyển sang bộ bài có hai vai đó, đây là chỗ đầu tiên
cần xem lại.

### O3. Chiều observation 413 → 493, và mọi model cũ bị TỪ CHỐI

`loadMlpPolicy` đã kiểm `obsSize` và `featureNames`; sau thay đổi này mọi file
trọng số cũ bị từ chối khi nạp. Đó là hành vi ĐÚNG, không phải trở ngại: một
model 413 chiều chạy trên vector 493 chiều sẽ ra số, và số đó vô nghĩa.

Hệ quả phải xử lý: `init_residual --from <model cũ>` không còn dùng được, vì
nó chép trunk có lớp đầu vào 413. Thêm `--from-dataset <thư mục enc>`: đọc
`meta.json` (obsSize, actionSize, featureNames, actionNames), dựng trunk mới
theo seed, `policyHead` = 0. Champion-0000 vẫn là heuristic ĐÚNG BYTE vì
residual bằng 0 với mọi observation — trunk ngẫu nhiên không đổi điều đó.

`datasetVersion` bump: `dataset-0004`, `rollout-0002`.

### O4. Không đổi gì khác

Không gian hành động giữ 187. `session-registry.ts` không đổi. Cơ chế residual,
seam đêm, cổng thăng hạng hai bộ seed — giữ nguyên.

## Rủi ro

- **Thêm chiều mà không thêm thông tin hữu ích** → model học chậm hơn vì phải
  lọc nhiễu. Đo được: nếu sau 5 vòng `--side village` mà Δ làng không vượt
  +2,5 hiện tại thì thêm đặc trưng không giúp, và kết luận đó cũng có giá trị.
- **Chi phí retrain**: mọi champion trong `.tmp` thành rác, phải chạy lại từ
  champion-0000 mới. Một đêm.
- `snapshotBelief` chạy cho MỌI người trong bảng belief mỗi lần `observe` khi
  trace hoặc learnedPolicy bật. Năm đại lượng mới đều O(số quan hệ) hoặc
  O(số người); `pairPressure` là O(n²) trên số người có `reasons`. Với 16 ghế
  đây là vài trăm phép tính mỗi lượt — chấp nhận được, nhưng phải đo thời gian
  self-play trước/sau và ghi lại.

## Tiêu chí xong

- `observationFeatureNames()` dài 493, năm tên mới nằm đúng vị trí cuối khối
  mỗi ghế; test encode kiểm giá trị trên một line dựng tay.
- Test "hai đường một vector" (`bot-live-observation.test.ts`) vẫn xanh — đó là
  bằng chứng snapshot và encoder không trôi khỏi nhau.
- `ai:validate-dataset` trên rollout mới: 0 TỪ CHỐI; validator nhận năm khoá
  mới và vẫn chặn kiểu sai.
- `init_residual --from-dataset` tạo được champion-0000 493 chiều;
  `ai:benchmark` cho Δ = **0,0 đúng** ở `baseline,village,wolves,all`.
- 5 vòng `rl_loop --side village` trên schema mới, benchmark 6 seed, so thẳng
  với +2,5 ± 0,7 của schema cũ. Ghi vào `reports/train-policy-0002.md`.
- `npm run build`, `npm run lint` mã thoát 0; vitest engine + server xanh;
  5 test Python `ok`.
