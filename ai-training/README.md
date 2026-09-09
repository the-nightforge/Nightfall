# ai-training

Tầng train của BOT_SELF_LEARNING (§39/§40). Ranh giới cố định:

```text
TypeScript   Game engine, bot runtime, knowledge boundary, observation encoder
Python       Train, đánh giá, thử nghiệm
```

Python **không** parse trajectory và **không** có bản sao nào của observation
encoder — nó chỉ đọc số từ các file `.bin` mà `npm run ai:encode` ghi ra. Đó là
lý do một trường ẩn không thể lọt vào đây: đường duy nhất tới dữ liệu đi qua
`BotKnowledgeView` → trajectory → leak validator → encoder, tất cả ở TypeScript.

## Cài

```bash
python -m venv .venv && .venv/Scripts/activate   # Windows
pip install -r requirements.txt
```

PyTorch chưa có wheel cho mọi bản Python mới nhất; nếu `pip install` báo không
tìm thấy bản phù hợp thì tạo venv bằng Python 3.12 hoặc 3.13.

## Chạy

```bash
# 1. sinh trajectory (TypeScript). --no-jitter: teacher tất định, xem docs/BOT_SELF_LEARNING_TRAINING.md
npm run ai:dataset -- --games 10000 --players 8 --preset --defense --seed bc --trajectories <dir> --trace-games 10000 --no-jitter

# 2. kiểm rò rỉ — bắt buộc trước khi train (§7)
npm run ai:validate-dataset -- <dir>/trajectories.jsonl

# 3. encode ra tensor
npm run ai:encode -- --in <dir>/trajectories.jsonl --out <enc-dir>

# 4. behavior cloning
python -m masoi_training.train_bc --data <enc-dir> --out <model-dir>
```

Kết quả: `model.pt`, `model.onnx`, `metrics.json`. Số cần nhìn là
`metrics.test.agreementTieAware` — nước model chọn có HOÀ ĐỈNH với teacher không
(§17). `agreement` cũ chấm oan mọi nước hoà điểm mà teacher phá hoà bằng id thô,
thứ §9 cố tình giấu khỏi observation; nó vẫn được in ra để so với bảng cũ.

## RL (self-play → PPO → benchmark)

```bash
# 1. rollout: chính champion chơi, lấy mẫu ở T=1 để có gradient
npx tsx apps/server/scripts/selfplay.ts --games 1000 --players 8 --preset --defense \
  --seed rl-1 --policy <champion.weights.json> --temperature 1 --learned-seats all \
  --trajectories <dir> --trace-games 1000 --quiet

# 2. encode tập PPO (chỉ giữ nước chính policy đã đi, kèm logprobs/values)
npm run ai:encode -- --in <dir>/trajectories.jsonl --out <enc-dir> --rollout

# 3. một vòng PPO, khởi tạo từ champion
python -m masoi_training.train_ppo --data <enc-dir> --init <champion.weights.json> --out <model-dir>
```

Cả ba bước cộng thăng hạng nằm trong `rl_loop.py` — xem
`docs/BOT_SELF_LEARNING_TRAINING.md` bước 8.

## Residual policy (`docs/superpowers/specs/2026-09-09-residual-policy-design.md`)

Model KHÔNG thay teacher, nó hiệu chỉnh teacher: `adjusted = score_heuristic +
β·net(obs)[ô]`. Champion-0000 có `policyHead = 0` nên là heuristic đúng byte;
PPO chỉ học phần hơn heuristic. Loại policy và β nằm TRONG file model
(`residual: {beta}`) — engine, benchmark, replay tự nhận, không có cờ CLI.

```bash
# champion-0000: chép trunk từ policy-0004, zero policyHead, β = 10
python -m masoi_training.init_residual --from ../.tmp/model-ob/model.weights.json \
  --out ../.tmp/residual/champion-0000.weights.json --beta 10

# vòng lặp như cũ; τ = 5 vì thang điểm là belief 0..100
python rl_loop.py --champion ../.tmp/residual/champion-0000.weights.json \
  --iterations 3 --games 900 --temperature 5 --out ../.tmp/rl-residual
```

### Tách phe và cổng KL

Đo 2026-09-09: một bước PPO từ heuristic làm LÀNG yếu đi ~3 điểm (ổn định qua 3
mẫu độc lập) trong khi SÓI mạnh lên +2..4. Hai phe có tín hiệu ngược dấu, nên
train chung một residual là để hai gradient triệt tiêu nhau.

```bash
# chỉ cập nhật trên hàng của phe Sói; điểm thăng hạng = Δ sói (không phải trung bình hai phe)
python rl_loop.py --champion R.json --side wolves --lr 1e-4 --target-kl 0.01 \
  --iterations 5 --games 900 --temperature 5 --bench-every 5 --out .tmp/rl-wolves
```

- `--side wolves|village` lọc hàng theo bảng `meta.wolfPack` mà `ai:encode` ghi
  bằng `isWolfPack` phía TypeScript — Python vẫn không biết vai nào là Sói.
  Cùng predicate với `--learned-seats` của benchmark, nên train và đo cùng một
  định nghĩa phe.
- `--target-kl` dừng epoch khi `approxKl` trung bình vượt ngưỡng; `metrics.json`
  ghi `epochsRun`. Mốc lành mạnh: `agreementWithInit` ≥ 0,97 mỗi vòng.
- `--bench-every <n>` ≥ số vòng để các vòng NỐI TIẾP nhau: một challenger không
  thăng hạng sẽ bị vứt ở vòng có benchmark, nên bench mỗi vòng làm mất tích luỹ.

`ai:encode --rollout` của tập residual ghi thêm `bases.f32.bin` — điểm THẬT
(có jitter) theo ô hành động, NaN ngoài bảng ứng viên — cùng `meta.beta`,
`meta.temperature`. `train_ppo` dựng lại `softmax((bases + β·net)/τ)` từ đó,
nên `approxKl` epoch 1 ≈ 0 (test_ppo canh cả hai loại).

## Test

```bash
python tests/test_data.py          # loader nhị phân, không cần torch
python tests/test_train_smoke.py   # trọn vòng train trên dataset tổng hợp, cần torch
python tests/test_ppo.py           # một update PPO trên rollout tổng hợp, cần torch
python tests/test_rl_loop.py       # cổng thăng hạng hai bộ seed, không cần torch
```

CI chạy cả ba (job `ai-training`) mỗi khi `ai-training/**` đổi.
