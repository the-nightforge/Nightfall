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

## Test

```bash
python tests/test_data.py          # loader nhị phân, không cần torch
python tests/test_train_smoke.py   # trọn vòng train trên dataset tổng hợp, cần torch
python tests/test_ppo.py           # một update PPO trên rollout tổng hợp, cần torch
```

CI chạy cả ba (job `ai-training`) mỗi khi `ai-training/**` đổi.
