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
# 1. sinh trajectory (TypeScript)
npm run ai:dataset -- --games 10000 --players 8 --preset --defense --seed bc --trajectories <dir> --trace-games 10000

# 2. kiểm rò rỉ — bắt buộc trước khi train (§7)
npm run ai:validate-dataset -- <dir>/trajectories.jsonl

# 3. encode ra tensor
npm run ai:encode -- --in <dir>/trajectories.jsonl --out <enc-dir>

# 4. behavior cloning
python -m masoi_training.train_bc --data <enc-dir> --out <model-dir>
```

Kết quả: `model.pt`, `model.onnx`, `metrics.json`. Số cần nhìn là
`metrics.test.agreement` — độ khớp hành động với bot heuristic (§17), không phải
loss.

## Test

```bash
python tests/test_data.py
```
