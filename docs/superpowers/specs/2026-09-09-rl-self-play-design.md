# RL Self-Play — Thiết kế

Ngày: 2026-09-09. Phụ thuộc: `2026-09-09-learned-policy-runtime-design.md`
(policy học được phải chơi được trọn ván trước). Bối cảnh:
`reports/train-policy-0002.md`, `docs/BOT_SELF_LEARNING_AUDIT.md` §3b.

## Vấn đề

Behavior cloning cho ra bản sao 86% của bot heuristic. Bản sao không hay hơn
bản gốc. Bot chỉ mạnh lên khi được thưởng theo THẮNG THUA, tức RL. Đồng thời
thước đo `agreement` đang chấm oan 28% nước đi hoà điểm (48% ở đêm), nên mọi
so sánh sau này sẽ nhiễu nếu không sửa trước.

## Quyết định

### R1. Sửa thước đo trước, vì nó là mỏ neo

Encoder xuất thêm `optimal.u8.bin`: với mỗi mẫu, tập MỌI hành động hoà đỉnh
trong thang điểm của teacher (bỏ jitter). `train_bc` báo `agreementTieAware` =
argmax của model ∈ tập đó. Với RL, agreement với heuristic không còn là mục
tiêu nhưng vẫn là mỏ neo: win-rate tăng mà agreement sụp về 0,2 là dấu hiệu
khai thác lỗi engine hoặc suy thoái, cần nhìn.

### R2. Rollout ở TypeScript, train ở Python — ranh giới §39 giữ nguyên

Không dựng `reset/step` (audit §1.3). Self-play chạy policy học được ở chế độ
LẤY MẪU (softmax nhiệt độ T, RNG có seed, đi qua `rngDraws` của trace nên
replay được), và mỗi quyết định ghi thêm `learned: { actionIndex, logProb,
value }`. `ai:encode` xuất `logprobs.f32.bin`, `values.f32.bin`. Python chỉ
đọc số, như trước.

### R3. Phần thưởng và advantage: Monte Carlo

Reward ±1 cuối ván (có sẵn), γ = 1, không chiết khấu vì ván ngắn và reward
chỉ ở cuối. Advantage `A = R − V(s)`; value target = `R`. Đó là GAE với
γ = λ = 1, viết thẳng ra để không ai đi tìm bootstrapping ở đâu.

### R4. PPO clipped, khởi tạo từ BC

ε = 0,2, 4 epoch/iteration, minibatch 4096, entropy 0,01, value 0,5, Adam
3e-4. Mask áp lên logits TRƯỚC log-softmax bằng `MASK_FILL` (như `model.py`).
`old_logprob` đọc từ rollout; policy hiện tại tính `new_logprob` trên cùng
mask. Khởi tạo từ `model.weights.json` của champion (lần đầu: policy-0004).

### R5. Đối thủ và cổng thăng hạng

Mỗi iteration sinh rollout theo ba phần bằng nhau: `learnedSeats` = all /
village / wolves, để policy vừa tự đấu vừa gặp heuristic. Sau khi train,
`ai:benchmark` challenger (3 × 300 ván). Điểm = trung bình của (Δ làng học
được, Δ sói học được) so với baseline heuristic. **Thăng hạng khi điểm >
điểm champion + 2** (ngưỡng trên nhiễu ±3% đã đo). Champion là file JSON bất
biến, đặt tên theo `modelId`; không bao giờ ghi đè.

### R6. Không có gì tự bật ở production

Toàn bộ kế hoạch chạy trong self-play và script. `session-registry.ts` không
đổi.

## Ngoài phạm vi

- Không gian hành động cho FINAL_VOTE/SPEECH; mục tiêu phụ Thám Tử.
- Opponent pool nhiều thế hệ (v2: giữ 3 champion gần nhất làm đối thủ).
- GPU, phân tán, Colab cho RL.

## Tiêu chí xong

- `agreementTieAware` xuất hiện trong `metrics.json` và ≥ `agreement`.
- `rl_loop.py --iterations 3 --games 600` chạy hết, mỗi iteration in điểm
  challenger, và có ít nhất một lần in "GIỮ champion" hoặc "THĂNG HẠNG" theo
  đúng luật R5.
- Replay một ván rollout bằng đúng policy + seed ra cùng kết quả.
