# Learned Policy Runtime — Thiết kế

Ngày: 2026-09-09. Bối cảnh: `reports/train-policy-0002.md`,
`docs/BOT_SELF_LEARNING_AUDIT.md` §3b, `docs/BOT_SELF_LEARNING_TRAINING.md`.

## Vấn đề

`policy-0004` (behavior cloning, test agreement 0,861) tồn tại dưới dạng
`model.pt` + `model.onnx` nhưng **không có đường nào chạy trong một ván**:

1. Repo không có runtime ONNX.
2. `encodeObservation` nhận `BotTrajectory` (bản ghi đã có); lúc chơi chỉ có
   `BotKnowledgeView` + `BotBrainState`.
3. `PolicyModel` chỉ phủ lượt VOTE; `decideNight` gọi thẳng strategy theo vai.
4. Chưa có benchmark champion/challenger để biết bot học được có đáng bật không.

## Quyết định

### D1. Suy luận bằng MLP thuần TypeScript, không ONNX runtime

- `packages/game-engine` phải thuần (không `fs`/`process`; có test canh).
- `onnxruntime-node` chỉ có `run()` bất đồng bộ; mọi `decide*` của `BotRuntime`
  là đồng bộ và được engine/self-play gọi đồng bộ. Đổi sang async là đổi cả
  vòng lặp ván.
- Model là MLP `obs → 128 → 128 → 187` (~94k tham số). Forward pass là ba phép
  nhân ma trận.

Vì vậy `train_bc.py` xuất thêm `model.weights.json` (định dạng `masoi-mlp-1`,
gồm `featureNames` + `actionNames` để runtime TỪ CHỐI model lệch schema), và
`packages/game-engine/src/bot/learning/mlp.ts` chạy forward pass thuần, đồng
bộ, tất định. ONNX vẫn xuất như cũ cho consumer khác.

### D2. Một hàm dựng observation, hai đường gọi

Trace (`gameToTrajectories`) và lúc chơi (`buildLiveObservation`) phải sinh
**cùng một vector** cho cùng một trạng thái. Cách duy nhất chắc chắn là dùng
chung code: tách `snapshotKnowledge`/`snapshotBelief` khỏi `BotRuntime` thành
hàm thuần, tách `observationFromTrace` khỏi `gameToTrajectories`, và cả hai
đường đều đi qua chúng. Test quyết định: chạy self-play có trace, với mỗi
quyết định dựng observation bằng cả hai đường và so `features` bằng
`toEqual`.

### D3. Cắm học được vào cả ngày lẫn đêm, mặc định TẮT

- Ngày: `learnedPolicyModel(policy, weights)` là một `PolicyModel` cắm vào
  `votePolicy` có sẵn — không đổi call site.
- Đêm: `BotRuntime.decideNight` chạy heuristic như cũ, rồi nếu có
  `learnedPolicy` thì `selectLearnedNight` đề xuất (loại, mục tiêu); runtime
  chỉ nhận khi hợp lệ theo `knowledge.night`, và giữ `confidence`/`evidence`/
  `secondaryTargetId` của heuristic. Thám Tử (cần hai người) rơi về heuristic.
- `BotRuntime` không có `learnedPolicy` = hành vi production hiện hành, byte
  một. Production (`session-registry.ts`) KHÔNG đổi trong kế hoạch này.

### D4. Benchmark: học được đấu với heuristic, seed cố định

`SelfPlayInput.learnedPolicy` + `learnedSeats: "all" | "village" | "wolves"`.
Script `ai:benchmark` chạy ba cấu hình (baseline, làng học được, sói học được)
× `--repeat` seed × `--games` ván, in tỉ lệ thắng của làng và độ lệch giữa
các seed. Ngưỡng đọc: theo `reports`/memory, 60 ván nhiễu ±10 điểm; 3×300
ván mới kết luận được ±3%.

Record self-play ghi `learnedPolicyId` + `learnedSeats`; `replayGame` từ chối
khi thiếu policy đúng id — cùng luật với `weightsVersion`.

## Ngoài phạm vi

- Bật policy học được ở production.
- RL (kế hoạch riêng: `2026-09-09-rl-self-play`).
- Không gian hành động cho FINAL_VOTE/SPEECH; mục tiêu phụ của Thám Tử.

## Tiêu chí xong

- `npm run ai:benchmark -- --model .tmp/model-ob/model.weights.json --games 300 --repeat 3`
  in bảng ba cấu hình, chạy hết không lỗi, tất định theo seed.
- Test "cùng vector hai đường" xanh trên ≥ 20 ván self-play có trace.
- Toàn bộ test hiện có xanh; production không đổi hành vi.
