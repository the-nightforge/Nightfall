# Shaping Reward — Thiết kế

Ngày: 2026-09-11. Phụ thuộc: residual policy (`2026-09-09-residual-policy-design.md`,
đã chạy) và vòng lặp RL (`rl_loop.py`). Bối cảnh đo: spike `.tmp/spike-shaping.ts`
(500 ván, 84.203 quyết định, 0 invariant violation) — số liệu ở phần "Vấn đề".

## Vấn đề

Reward ±1 cấp-ván dàn đều cho ~35 quyết định mỗi ván: một nước đêm quyết định
thắng thua và một câu nói vô thưởng vô phạt nhận cùng một tín hiệu. Mười phép đo
RL độc lập (2 cấu hình × 5 vòng, 2026-09-09) chưa lần nào challenger vượt
champion +2 — điểm đi ngang trong nhiễu của chính benchmark. Nút thắt là credit
assignment, không phải số vòng.

Spike đo trên 500 ván xác nhận một tín hiệu từng-quyết-định có nguồn từ luật
game — "nước đi có trúng phe địch không" (`L ∈ {−1, +1}`) — mang thông tin mà
reward ±1 không có:

| decision | side | n | E[L\|win] − E[L\|loss] | corr(L, R) | E[R\|L=+1] | E[R\|L=−1] |
|---|---|---|---|---|---|---|
| VOTE | village | 12.932 | **+0.343 ± 0.017** | 0.172 | +0.324 | −0.019 |
| VOTE | wolves | 4.726 | **+0.133 ± 0.020** | 0.095 | −0.043 | −0.313 |
| FINAL_VOTE | village | 14.346 | **+0.425 ± 0.016** | 0.224 | +0.350 | −0.120 |
| FINAL_VOTE | wolves | 4.125 | +0.014 ± 0.027 (im lặng) | 0.008 | | |
| HUNTER_SHOT | village | 162 | **+0.886 ± 0.140** | 0.453 | | |

Ba phát hiện định hình thiết kế:

1. Tín hiệu mạnh nhất ở ghế làng (VOTE 20σ, FINAL_VOTE 27σ) và ghế làng hiện chỉ
   trúng địch 43 % số lượt — dư địa cải thiện thật.
2. FINAL_VOTE của Sói im lặng về mặt thống kê — nhãn ở đó chỉ thêm phương sai.
3. L là **tương quan** với thắng thua, không phải nhân quả — không được thay
   objective, chỉ được hiệu chỉnh nó.

## Quyết định

### D1. Shaping là bonus cộng vào advantage, không thay thế

```
A = R − b            (mọi hàng, như hôm nay)
A += α · L           (chỉ hàng có nhãn, trước bước chuẩn hoá)
```

- Giữ `R − b` đầy đủ nghĩa là objective thật vẫn nằm trong gradient; L chỉ
  phân bổ lại tín hiệu theo từng quyết định. Thay thế thuần (A = L) là tối ưu
  một proxy chưa được chứng minh nhân quả.
- α (`--shaping-weight`, mặc định 1.0) là núm đo lường: α = 0 trả lại hành vi cũ
  byte một — rollback và ablation cùng một cờ. Hàng không nhãn giữ nguyên
  `R − b`, nên chuẩn hoá advantage sau đó không đổi ngữ nghĩa.
- Baseline `b` không đổi (`--baseline role` mặc định). Mean của L KHÔNG đối xứng
  (spike: Sói +0.71, làng −0.13 — Sói gần như chỉ vote địch) nhưng chuẩn hoá
  (A − mean)/std ở cấp batch gỡ mọi offset hằng số, nên độ lệch mean không làm
  lệch thang; cái đọng lại là thành phần theo từng hàng — đúng thứ cần thêm.

### D2. Nhãn tính ở TypeScript, cấp line, cạnh `reward`

Module mới `packages/game-engine/src/bot/evaluation/shaping.ts`:

```ts
shapingLabelFor(game: SelfPlayGame, trace: BotDecisionTrace): number | null
```

- `VOTE` / `HUNTER_SHOT`: mục tiêu khác phe → +1, cùng phe → −1. Phe so bằng
  `sameFaction` (kế thừa luật "trung lập không cùng ai" của shared).
- `FINAL_VOTE`: bị cáo cố định (`targetId` = `trialAccusedId`), quyết định là
  treo/tha → nhãn = `(treo === enemy) ? +1 : −1`, tức thưởng sự nhất quán giữa
  phán quyết và phe của bị cáo.
- Trả `null` (không nhãn) khi: quyết định không phải ba loại trên, `targetId`
  null, actor hoặc mục tiêu có `ROLE_META.team === "neutral"`, hoặc thiếu vai
  trong `game.roles`.
- `gameToTrajectories` ghi field `shaping: number | null` ở CẤP MỘT của line,
  cạnh `reward`/`finalRole` — cùng pattern nhãn gốc-luật đã có. Khoá đặt ngay
  sau `reward` theo quy ước thứ tự khoá của line (file trajectory.ts ghi rõ thứ
  tự khoá là thứ tự byte của JSONL — thêm khoá mới phải tất định, không spread).
  Observation, knowledge boundary, trace invariant không đổi: nhãn này là nhãn
  cho tầng train (như reward), không phải đầu vào của bot.

SƠN KHÔNG đổi: `--no-jitter`, replay, benchmark — nhãn không đi vào bất kỳ
đường quyết định nào của bot.

### D3. NIGHT và vai trung lập không có nhãn trong v1

- Với Sói, "cắn trúng phe địch" tầm thường (mục tiêu đêm không bao giờ là Sói)
  → nhãn zero-variance, vô dụng. Nhãn đêm có giá trị là "cắn trúng người đang
  uy hiếp cao" — định nghĩa theo threat, là một việc riêng sau v1.
- Thằng Hề/Kẻ Báo Thù/Kẻ Phản Bội thắng bằng điều kiện riêng, không theo phe →
  nhãn phe-hoá sai bản chất của chúng. Chúng vẫn nhận `R − b` như hôm nay.

### D4. Vận chuyển: cột `shaping.i8.bin` (0 = không nhãn)

`ai:encode` ghi thêm cột optional `shaping.i8.bin` — int8 ∈ {−1, 0, +1}, 0 là
sentinel cho "không nhãn" (nhãn không bao giờ 0). Cùng pattern `rewards.i8`;
nhẹ hơn float32-NaN hai lần cho cột thưa. `data.py` đọc optional, kiểm kích
thước như các cột khác, `where()` mang theo.

### D5. Validator kiểm hình thức, test kiểm semantics

`validateTrajectoryLine` thêm luật: `shaping` nếu có mặt phải ∈ {−1, +1} (null
/ vắng = hợp lệ). Validator chỉ thấy line nên không xác thực được semantics
(không có ground-truth roles của người khác trong line) — semantics được bảo vệ
bằng test bảng của `shaping.ts`, đúng cách split trách nhiệm hiện có (validator
chặn rò rỉ cấu trúc, test chặn sai logic).

### D6. train_ppo: hai cờ, metrics ghi coverage

- `--shaping-weight` (α, mặc định 1.0): α > 0 mà dataset không có cột → từ chối
  với thông điệp "encode lại bằng bản mới". α = 0 → bỏ term, không đụng cột.
- `--shaping-decisions` (CSV, mặc định tất cả): lọc loại quyết định được shaping,
  ví dụ chạy `--side wolves` loại FINAL_VOTE (D-vấn đề 2) bằng
  `--shaping-decisions vote,hunter_shot`. Lọc theo tên trong `meta.decisions`.
- metrics.json ghi `shapingCoverage` (tỉ lệ hàng có nhãn sau khi lọc) và α đã
  nằm sẵn trong `config` qua `vars(a)` — tái lập được (§46).

### D7. rl_loop: passthrough, không đổi vòng lặp

`--shaping-alpha` và `--shaping-decisions` truyền thẳng vào `train_ppo`. Không
cờ mới ở tầng benchmark — điểm thăng hạng vẫn là Δ phe (residual line).

## Kiểm chứng

- TS: `shaping.test.ts` — bảng vai × quyết định (village/wolves/neutral actor,
  village/wolves/neutral/null target, treo/tha); mở rộng test trajectory
  (`shaping` present/absent, không lẫn vào observation); validator từ chối
  `shaping: 0.5`, chấp nhận ±1/vắng.
- Python: `test_data` (cột load, `where`, file cụt bị từ chối); `test_ppo` —
  (a) α > 0 thiếu cột → từ chối; (b) α = 0 cho metrics khớp chạy cũ; (c) dataset
  tổng hợp với nhãn gắn liền hành động thắng → xác suất hành động đó tăng cao
  hơn chạy không shaping; smoke test không đổi.
- CI job `ai-training` và suite TS chạy cả hai phía.

## Tiêu chí thành công & rollback

- **Thành công**: rl_loop `--side village` (residual line, τ = 5,
  `--target-kl 0.01`) với shaping — challenger ĐẦU TIÊN vượt champion +2 trên
  HAI bộ seed độc lập (`rl-bench` + `rl-conf`). Chạy đối chứng `--side wolves`
  với `--shaping-decisions vote` (loại FINAL_VOTE im lặng). Anchor
  `agreementWithInit ≥ 0.97` mỗi vòng giữ nguyên.
- **Rollback**: `--shaping-weight 0` — hành vi cũ byte một, không cần revert code.
- **Kỳ vọng trung thực**: nếu shaping không đổi được kết quả thăng hạng, thì nút
  thắt nằm ở chỗ khác (quan sát, đối thủ pool) — đó cũng là một kết quả đo được,
  và ghi lại vào `docs/BOT_SELF_LEARNING_TRAINING.md`.

## Giới hạn đã biết

1. NIGHT chưa có nhãn (D3) — phần thưởng đêm chất lượng cao là việc tiếp theo.
2. L tương quan không nhân quả; α quá lớn → tối ưu proxy. Mốc v1: α = 1.
3. Vai trung lập không nhận gradient shaping (D3) — chấp nhận có chủ đích.
4. `--shaping-decisions vote,hunter_shot` viết thường; mapping tên ở meta là
   HOA (`VOTE`, `HUNTER_SHOT`) — train_ppo so sánh không phân biệt hoa thường.
