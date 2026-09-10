# Hướng dẫn train — Behavior Cloning (BOT_SELF_LEARNING §17)

Mọi thứ cần thiết đã nằm trong repo. File này là các bước bạn chạy, theo đúng
thứ tự, kèm con số cần nhìn ở mỗi bước.

Toàn bộ đường ống dưới đây **đã chạy thật trên máy dev** (Python 3.13 + torch
2.14 CPU), kể cả `train_bc.py` và export ONNX. CI cũng chạy tầng Python (job
`ai-training`) mỗi khi `ai-training/**` đổi.

Đường ống:

```text
self-play (TS, --no-jitter)  →  trajectory JSONL  →  leak validator + trần độ khớp
                                                              ↓
                                                        encoder (TS)
                                                              ↓
                                                     tensor .bin + meta.json
                                                              ↓
                                                  behavior cloning (Python)
                                                              ↓
                                                   model.pt + model.onnx
```

Ranh giới không được phá (§39): **luật game và encoder ở TypeScript, train ở
Python**. Python không parse trajectory và không có bản sao nào của encoder, nên
không có đường nào để một thông tin ẩn lọt vào tầng train.

---

## Điều quan trọng nhất: trần độ khớp và `--no-jitter`

Bot heuristic cộng một term `jitter` lấy từ RNG vào điểm của MỌI ứng viên
(`vote-decision.ts`, `night-scoring.ts`). RNG không có trong observation, nên
model không bao giờ học được phần đó. Đo trên bộ 200 ván có jitter: ứng viên
điểm cao nhất **sau khi bỏ jitter** chỉ trùng nước bot đã đi ở **60%** số lượt.
Đó là trần của mọi model trên dữ liệu ấy — ngưỡng 0,70 là bất khả thi theo
cấu trúc, không phải vì model yếu.

Vì vậy:

1. Sinh dataset train với `--no-jitter` (teacher tất định). Trần trên bộ 20 ván
   thử là **97,3%**.
2. `ai:validate-dataset` in dòng `trần độ khớp` cho mọi dataset. Đọc nó TRƯỚC
   khi đọc agreement của model: model 0,55 trên tập trần 0,60 là gần xong; trên
   tập trần 0,97 là còn xa.
3. `--no-jitter` chỉ dành cho dataset behavior cloning. Benchmark
   champion/challenger vẫn dùng bot thật (có jitter); record self-play ghi
   `weightsVersion` có đuôi `+nojitter` để không ai replay nhầm bằng preset gốc.

**Trần in ra là trần CÓ id, và model không được thấy id.** Nó phá hoà điểm bằng
`targetId.localeCompare`, đúng quy ước `rankNightTargets`; nhưng §9 cố tình xoá
ý nghĩa tuyệt đối của id khỏi observation. Đo trên 55.876 nước đi: **28% hoà
điểm ở đỉnh, riêng lượt đêm là 48%**. Một model mù id đoán đều trong nhóm hoà
chỉ đạt 75,3% tổng thể (62,6% ở lượt đêm), trong khi trần in ra là 97,3%
(99,2%). Trần thật nằm giữa hai mức đó. Đừng đọc "agreement còn cách trần bao
nhiêu" như thể toàn bộ khoảng cách ấy là lỗi của model — với nước đi hoà điểm,
chọn ứng viên nào cũng tái lập đúng chính sách của bot.

**Vì vậy thước đo chính từ nay là `agreementTieAware`**, không phải `agreement`.
Nó chấm một nước là ĐÚNG khi nước đó hoà đỉnh với teacher trong chính thang
điểm của teacher (đã bỏ jitter) — tức khi chọn nó tái lập đúng chính sách của
bot, dù `localeCompare` đã chọn người khác. `ai:encode` ghi tập hoà đỉnh ra
`optimal.u8.bin` và `train_bc` in cả hai số cạnh nhau.

Chênh lệch giữa hai thước đo KHÔNG nhỏ. policy-0004 trên đúng tập test cũ:

| Tập | agreement | **tie-aware** |
|---|---|---|
| tổng | 0,8607 | **0,9400** |
| VOTE | 0,9081 | 0,9307 |
| **NIGHT** | 0,7671 | **0,9589** |
| HUNTER_SHOT | 0,9049 | 0,9091 |

Đọc `agreement` cũ mà tưởng lượt đêm còn hổng 23 điểm là đuổi theo một khoảng
trống phần lớn không tồn tại.

---

## Bước 0 — Môi trường Python

`ai-training/.venv` đã có sẵn numpy + torch. Kiểm:

```bash
cd ai-training && ./.venv/Scripts/python.exe -c "import torch; print(torch.__version__)"
```

Nếu phải tạo lại: dùng Python 3.12 hoặc 3.13, rồi

```bash
cd ai-training && python -m venv .venv && ./.venv/Scripts/python.exe -m pip install numpy && ./.venv/Scripts/python.exe -m pip install torch --index-url https://download.pytorch.org/whl/cpu
```

Hai self-check của tầng Python (không cần dữ liệu thật, ~10 giây):

```bash
cd ai-training && ./.venv/Scripts/python.exe tests/test_data.py && ./.venv/Scripts/python.exe tests/test_train_smoke.py
```

Kết quả mong đợi: hai dòng `ok`.

---

## Bước 1 — Chạy thử toàn bộ đường ống (2 phút)

```bash
npm run ai:dataset -- --games 20 --players 8 --preset --defense --seed smoke --trajectories .tmp/smoke --trace-games 20 --no-jitter --quiet
```

```bash
npm run ai:validate-dataset -- .tmp/smoke/trajectories.jsonl
```

```bash
npm run ai:encode -- --in .tmp/smoke/trajectories.jsonl --out .tmp/smoke-enc
```

```bash
cd ai-training && ./.venv/Scripts/python.exe -m masoi_training.train_bc --data ../.tmp/smoke-enc --out ../.tmp/smoke-model --epochs 80
```

Con số tham chiếu (20 ván, seed `smoke2`, đã chạy thật): 4.180 dòng → 1.299 mẫu
có nhãn → test agreement **0,49** (top-2 0,67) với 788 mẫu train. Với 20 ván thì
số này thấp là bình thường; bước này chỉ trả lời "đường ống có chạy hết không".

---

## Bước 2 — Sinh dataset 10.000 ván (~30 phút, ~3 GB)

Chạy theo shard 250 ván. Lý do: runner giữ toàn bộ ván trong RAM tới lúc ghi
file, nên một lần chạy 10.000 ván sẽ hết bộ nhớ trước khi ghi được dòng nào.

Git Bash:

```bash
mkdir -p .tmp/dataset-0002 && : > .tmp/dataset-0002/trajectories.jsonl && for i in $(seq 0 39); do npx tsx apps/server/scripts/selfplay.ts --games 250 --players 8 --preset --defense --seed "bc-$i" --trajectories .tmp/shard --trace-games 250 --no-jitter --quiet > /dev/null && cat .tmp/shard/trajectories.jsonl >> .tmp/dataset-0002/trajectories.jsonl && echo "shard $i: $(wc -l < .tmp/dataset-0002/trajectories.jsonl) dòng"; done
```

PowerShell:

```powershell
New-Item -ItemType Directory -Force .tmp\dataset-0002 | Out-Null; Set-Content .tmp\dataset-0002\trajectories.jsonl ""; 0..39 | ForEach-Object { npx tsx apps/server/scripts/selfplay.ts --games 250 --players 8 --preset --defense --seed "bc-$_" --trajectories .tmp\shard --trace-games 250 --no-jitter --quiet > $null; Get-Content .tmp\shard\trajectories.jsonl | Add-Content .tmp\dataset-0002\trajectories.jsonl; Write-Host "shard $_ xong" }
```

Ý nghĩa từng cờ:

| Cờ | Vì sao |
|---|---|
| `--preset` | Dùng bộ bài THẬT của ván 8 người, không phải bộ bài mặc định của runner |
| `--defense` | Bật vòng bào chữa thật; không có nó thì pha DEFENSE không sinh dữ liệu nào |
| `--trace-games 250` | Bằng số ván mỗi shard — không có trace thì không có trajectory |
| `--seed "bc-$i"` | Seed khác nhau mỗi shard; `gameId` = `seed:index` nên không trùng giữa các shard |
| `--no-jitter` | Teacher tất định — xem phần đầu file |

Muốn nhanh hơn để thử trước: đổi `0..39` thành `0..3` (1.000 ván, ~3 phút).

---

## Bước 3 — Kiểm rò rỉ và trần (BẮT BUỘC, §7)

```bash
npm run ai:validate-dataset -- .tmp/dataset-0002/trajectories.jsonl
```

Phải thấy:

```text
invalid observations  0
invalid actions       0
leak violations       0
trần độ khớp (§17)    9x.x% — ...
KẾT LUẬN: dataset SẠCH — train được.
```

**Ba dòng đầu khác 0 thì dừng lại, đừng train.** Con số đó nghĩa là có bug
trong knowledge boundary, và train tiếp chỉ dạy model khai thác đúng bug đó.
Lệnh in ra tối đa 10 lý do vi phạm kèm số lần — đọc lý do đầu tiên trước.

**Trần dưới 90%** nghĩa là quên `--no-jitter`, hoặc bot có thêm nguồn RNG mới
ngoài jitter. Đừng train trên tập đó rồi kết luận model kém.

Validator kiểm cả các trường riêng tư theo vai mới thêm: nạn nhân bầy chỉ Sói
và Phù Thuỷ được thấy, bình thuốc chỉ Phù Thuỷ, người đêm trước chỉ Bảo Vệ.

---

## Bước 4 — Encode ra tensor

```bash
npm run ai:encode -- --in .tmp/dataset-0002/trajectories.jsonl --out .tmp/enc-0002
```

Kết quả mong đợi (tỉ lệ theo bộ 20 ván):

```text
Đã đọc      ~2.100.000 dòng (10.000 ván)
TỪ CHỐI     0
không nhãn  ~69%
mẫu train   ~650.000  (train ~70% / val ~15% / test ~15%)
vector      413 chiều, 187 hành động
```

`không nhãn` cao là ĐÚNG: không gian hành động chỉ mô tả VOTE/NIGHT/HUNTER_SHOT.
`SPEECH` và `FINAL_VOTE` (treo/tha) không phải nước đi trong không gian này, và
lượt đêm của vai không có hành động đêm (Dân, Thợ Săn) cũng không phải.

**Không gian hành động là (loại × ô)**: 11 loại (`CHOOSE` ban ngày + 10
`NightActionKind`) × 17 ô (16 ghế + "không mục tiêu"). HEAL và POISON cùng một
người là hai nhãn khác nhau; Phù Thuỷ "giữ thuốc" là nhãn `SKIP:none` thật chứ
không phải dòng bị bỏ. `meta.json` có `actionNames` để đọc ngược từng chỉ số, và
`decodeAction` ở TypeScript để runtime dùng.

Observation gồm, mỗi ghế: suspicion, trust, **wolfProbability, threat,
credibility, influence** (từ `assessPlayers`, cùng hàm scorer dùng), phe đã
biết (Sói/Làng/Trung lập), kết quả soi, hợp lệ, **nạn nhân bầy, chết đêm qua,
tỉ lệ phiếu, đang bị xử, Bảo Vệ đã canh**, và ba đầu vào riêng của scorer đêm:
**informationValue** (Tiên Tri/Thám Tử), **claimedPowerRole** (nhánh rẽ của
`wolfThreatScore`: ai đã khai vai quyền lực thì Sói cắn trước), **guardedBefore**
(`repeatPenalty` của Bảo Vệ). Ba cái sau thêm ở `dataset-0003`, sau khi đo trên
policy-0002 thấy observation trùng nước Sói đã đi 100% khi không ai khai vai
nhưng chỉ 71% khi có người khai. Toàn cục: pha, loại quyết định, vai,
tính cách, loại hành động được chào, hai bình thuốc, phiếu không treo.

---

## Bước 5 — Behavior cloning

```bash
cd ai-training && ./.venv/Scripts/python.exe -m masoi_training.train_bc --data ../.tmp/enc-0002 --out ../.tmp/model-v002
```

Mặc định: 40 epoch, `--value-weight 0`, và **giữ checkpoint có val agreement
cao nhất** chứ không phải epoch cuối (`metrics.json` ghi `bestEpoch`).

| Cờ | Mặc định | Khi nào đổi |
|---|---|---|
| `--epochs` | 40 | `bestEpoch` bằng epoch cuối → còn đang tăng, tăng lên 80 |
| `--lr` | 1e-3 | Loss nhảy loạn → giảm còn 3e-4 |
| `--hidden` | 128 | Chỉ tăng khi val agreement chững mà train loss cũng chững (thiếu sức chứa, không phải overfit) |
| `--batch-size` | 512 | Máy hết RAM → giảm |
| `--value-weight` | 0 | Bật (0,1–0,5) khi sang RL cần value head; với BC nó chỉ lấy sức chứa của policy |
| `--seed` | 12345 | Đổi để kiểm model có ổn định không, không phải để "chọn kết quả đẹp" |

Toàn bộ tập train được nạp lên device một lần (~620k × 413 × 4 byte ≈ 1 GB
float32). Trên CPU 16 GB thì ổn; nếu OOM, giảm số ván hoặc thêm đọc theo batch.

---

## Bước 6 — Đọc kết quả

```bash
cd ai-training && ./.venv/Scripts/python.exe -c "import json;m=json.load(open('../.tmp/model-v002/metrics.json'));print(json.dumps(m['metrics'],indent=2,ensure_ascii=False))"
```

Số quyết định: **`metrics.test.agreement`** so với **trần** ở Bước 3.

| agreement / trần | Nghĩa là | Làm gì |
|---|---|---|
| < 0,5 | Model chưa tái lập được phần lớn quyết định | Xem `agreementByDecision` và `agreementByRole`: loại/vai nào kém nhất, term nào của scorer cho loại đó chưa có trong observation |
| 0,5 – 0,8 | Học được xu hướng | Tăng epochs; nếu `bestEpoch` không ở cuối mà vẫn chững, làm giàu observation cho loại kém nhất |
| > 0,8 | Tái lập baseline | Đủ điều kiện §17 để tính tới RL |

`top2Agreement` là thước đo mềm: nước bot đi nằm trong hai lựa chọn cao nhất
của model. Nó hữu ích khi so hai model, không phải để qua cổng §17.

**Đừng nhìn loss để kết luận.** Loss giảm mà agreement không tăng nghĩa là model
đang học phân bố của lớp đông nhất, không phải học chơi.

`metrics.json` ghi `modelId`, `gitCommit`, `datasetVersion` (`dataset-0003` cho
định dạng này), `trainingSeed`, `bestEpoch` và toàn bộ `trainingConfig` (§46).

---

## Train trên Google Colab

Colab có sẵn PyTorch và GPU T4 miễn phí, nên bỏ qua được Bước 0.
Notebook: [`ai-training/colab/train_bc_colab.ipynb`](../ai-training/colab/train_bc_colab.ipynb).

Chia việc theo đúng ranh giới §39: **máy bạn sinh và encode (TypeScript), Colab
chỉ train (Python)**. Colab nhận file `.bin` toàn số, không parse trajectory và
không có bản sao nào của observation encoder — đưa việc train sang máy khác
không kéo theo ranh giới thông tin.

### 1. Máy bạn — sinh, kiểm, encode, đóng gói

Chạy Bước 2 → 3 → 4 ở trên (nhớ `--no-jitter`), rồi nén hai thứ Colab cần:

```powershell
Compress-Archive -Path ai-training\masoi_training, .tmp\enc-0001 -DestinationPath .tmp\bc-package.zip -Force
```

**Không tải JSONL lên.** Tensor đã encode nhẹ hơn nhiều và nén rất tốt vì phần
lớn đặc trưng là one-hot — bộ 10.000 ván ra khoảng vài chục MB.

### 2. Drive → Colab

Đặt `bc-package.zip` ở gốc `MyDrive` (chỗ khác thì sửa biến `ZIP` ở cell 2).
Mở notebook trên [colab.research.google.com](https://colab.research.google.com),
chọn `Runtime → Change runtime type → T4 GPU`. CPU cũng chạy được, chỉ chậm hơn.

### 3. Chạy các cell theo thứ tự

| Cell | Việc |
|---|---|
| 1 | Phiên bản torch + GPU |
| 2 | Mount Drive, giải nén vào `/content/bc` |
| 3 | **Kiểm dữ liệu** — file khớp `meta.json`, ba phần cộng đúng, mọi nhãn hợp lệ theo chính mask của nó |
| 4 | Chạy thử 2 epoch (~30 giây) |
| 5 | Train thật |
| 6-7 | Agreement train/val/test, so với trần, tách theo loại quyết định và theo vai |
| 8 | Chép `model.pt` / `model.onnx` / `metrics.json` về Drive |

Cell 3 đáng giá nhất: nó ném lỗi ngay nếu zip thiếu file hoặc dataset lệch, thay
vì để bạn phát hiện sau nửa giờ GPU.

**Session ngắt là mất `/content`** — cell cuối chép model về Drive, đừng bỏ qua.
Và đừng tách `metrics.json` khỏi `model.pt`/`model.onnx`: nó là thứ duy nhất
truy model về `datasetVersion`, `gitCommit` và `trainingSeed` (§46).

---

## Bước 7 — Cho model chơi và đo (champion/challenger)

`train_bc` xuất thêm `model.weights.json` (định dạng `masoi-mlp-1`). Runtime
TypeScript chạy forward pass thuần từ file này — không có ONNX runtime, vì
`game-engine` phải thuần và mọi quyết định của bot là đồng bộ. Loader TỪ CHỐI
model có `featureNames`/`actionNames` lệch encoder hiện tại.

```bash
npm run ai:benchmark -- --model .tmp/model-ob/model.weights.json --games 300 --repeat 3 --seed bench
```

Ba cấu hình mặc định trên cùng seed: heuristic cả bàn, làng học được, sói học
được. Đọc Δ tỉ lệ thắng của làng so với baseline, GHÉP THEO SEED ± sai số chuẩn
(lệnh tự in). Với 300 ván/lô, sàn nhiễu nhị thức là ±2,85 điểm bất kể cấu
hình; ba lô cho SE của hiệu ≈ 1,3 điểm — một hiệu +2 chỉ tương đương ~1,5σ.

**Hai hiệu làng/sói có thể NGƯỢC DẤU nhau** (policy-0004: −2,9 và +8,1), nên
không suy ra được "cả bàn dùng model" bằng cách lấy trung bình. Muốn biết cắm
vào production thì ra sao, phải đo thẳng:

```bash
npm run ai:benchmark -- --model .tmp/model-ob/model.weights.json --setups baseline,all,teacher
```

- `all` — cả bàn dùng model: đúng cấu hình production.
- `teacher` — heuristic KHÔNG jitter: chính teacher mà BC đã chép. **Khoảng
  cách `all − teacher` là độ trung thành đo bằng TỈ LỆ THẮNG**, thứ agreement
  không đo được. policy-0004: agreement tie-aware 0,940 nhưng thua teacher
  **6,6 điểm** — 6% nước lệch rơi đúng vào chỗ đắt giá.
- `--learned-decisions vote|night` — ablation: model chỉ quyết một lượt. Với
  policy-0004, mỗi nước đêm lệch đắt gấp ~4 lần một nước bầu lệch.

Mục tiêu của behavior cloning là `all − teacher → 0`, không phải agreement → 1.

**Nhưng `all` một mình KHÔNG nói model mạnh hay yếu.** Nó đo CÂN BẰNG (tỉ lệ
làng thắng khi cả bàn dùng model), và cân bằng tăng được vì *đối thủ dở đi*: một
model vừa là dân làng tệ hơn (−6,4) vừa là sói yếu hơn (+2,3) đã cho `all` =
62,6%, cao hơn cả teacher — vì sói yếu đi nhiều hơn. Luôn đọc `village` và
`wolves` (sức mạnh từng phe đo riêng, đối thủ cố định) TRƯỚC, rồi mới đọc `all`.

`--distill-alpha` (train theo điểm của teacher thay vì one-hot) đã thử: α = 0,5
không khác policy-0004, α = 1,0 tệ hơn ở cả hai phe. Giữ làm công cụ đo; mặc
định 0. Chi tiết ở `reports/train-policy-0002.md`.

Một lệnh chạy đủ ba cấu hình. Ở mỗi cấu hình, model chỉ được cấp cho ghế của
phe đang đo; ghế còn lại chạy heuristic y như production. Mã thoát khác 0 khi
có bất kỳ vi phạm bất biến nào — một nước đi engine không chào làm hỏng mọi
con số trong bảng.

Production KHÔNG đổi: `session-registry.ts` không cấp `learnedPolicy`.

---

## Bước 8 — RL self-play (rollout → PPO → benchmark → thăng hạng)

Behavior cloning chỉ chép lại bot heuristic; trần của nó là chính bot heuristic.
Muốn bot MẠNH HƠN teacher thì phải để nó tự chơi và học từ kết quả ván — đó là
việc của `rl_loop.py`.

```bash
cd ai-training && PYTHONUTF8=1 ./.venv/Scripts/python.exe rl_loop.py \
  --champion ../.tmp/model-ob/model.weights.json \
  --iterations 20 --games 3000 --bench-games 300 --bench-repeat 3 \
  --bench-every 5 --out .tmp/rl
```

Mỗi vòng làm bốn việc:

1. **Rollout** — chính champion chơi 3.000 ván ở `--temperature 1`, chia ba phần
   `all`/`village`/`wolves` chạy SONG SONG. Nhiệt độ 1 nghĩa là policy lấy mẫu
   từ softmax thay vì argmax: không thăm dò thì mọi ván giống nhau và không có
   gradient nào để học. RNG vẫn là RNG có seed của bot, nên `replayGame` dựng
   lại được một ván rollout.
2. **Encode `--rollout`** — chỉ giữ nước do CHÍNH policy đi, kèm `logProb` và
   `value` đo lúc nó đi. Nước heuristic trong cùng ván (Thám Tử, mọi lần rơi về
   nước lui, mọi lần `selectVote` ghi đè bằng hysteresis) bị bỏ: PPO chỉ cập
   nhật được theo hành động policy thật sự đã sinh ra.
3. **PPO** — một update clipped, khởi tạo từ champion, advantage `R − b`. `b`
   mặc định là trung bình reward THEO VAI (`--baseline role`); xem mục baseline
   bên dưới trước khi đổi nó.
4. **Benchmark + thăng hạng** — `ai:benchmark` ba cấu hình, điểm =
   trung bình (Δ làng, Δ sói). Challenger chỉ thay champion khi hơn **+2 điểm**;
   dưới mức đó là nhiễu (60 ván lệch ±10 điểm; 3×300 ván mới kết luận ±3%).

**Champion là file bất biến** trong `<out>/champions/champion-000k.weights.json`
— không bao giờ ghi đè, nên luôn quay lại được bản trước.

### Residual: xuất phát từ heuristic, không từ bản sao

Đo 2026-09-09 (`reports/train-policy-0002.md`): bản sao BC khớp teacher 94 %
mà thua chính teacher 6,6 điểm, vì observation chỉ mang 2 trong 8 số hạng
điểm bầu. RL từ bản sao ấy đi ngang. Cách xoá lớp vấn đề đó là **residual
policy** (`docs/superpowers/specs/2026-09-09-residual-policy-design.md`):

    adjusted_i = score_i (heuristic, CÓ jitter) + β · net(obs)[ô của ứng viên i]

- Model tự khai `residual: {beta}` trong `model.weights.json`; engine đi đường
  hiệu chỉnh ở CẢ VOTE lẫn NIGHT (seam `NightPolicyModel` trong
  `rankNightTargets`; Phù Thuỷ không có bảng nên giữ heuristic).
- Champion-0000 do `python -m masoi_training.init_residual` tạo: `policyHead`
  = 0 → heuristic đúng byte; `ai:benchmark` cho Δ = 0,0 đúng ở mọi cấu hình.
- Rollout chạy `--temperature 5` (thang belief); encode ghi `bases.f32.bin`
  để PPO dựng lại đúng phân phối cũ.
- Lệnh đầy đủ ở `ai-training/README.md` mục "Residual policy".

### Tách phe: hai phe có tín hiệu ngược dấu

Ba vòng đầu (2026-09-09) cho làng −3 điểm ổn định và sói +2..4. Từ đó, train
residual cho MỘT phe mỗi lần: `rl_loop.py --side wolves|village`, điểm thăng
hạng là Δ của chính phe đó. Phe được lọc theo `meta.wolfPack` do `ai:encode`
ghi — cùng predicate `isWolfPack` mà `--learned-seats` của benchmark dùng.
Kèm `--target-kl 0.01` và `--lr 1e-4` để mỗi bước giữ `agreementWithInit`
≥ 0,97, và `--bench-every` ≥ số vòng để các vòng nối tiếp nhau.

### Ngắt lúc nào cũng được

`--resume` (mặc định bật) đọc `state.json` và bỏ qua mọi vòng đã hoàn tất; trong
một vòng dở dang, từng bước đã xong cũng được bỏ qua theo dấu `.done`. Dấu chỉ
được ghi sau khi tiến trình con thoát 0 — một tiến trình bị giết giữa lúc ghi để
lại file cụt, và một file cụt được "bỏ qua" là cách im lặng nhất để hỏng cả đêm.

Thời gian: ~10 phút/vòng khi không benchmark, ~16 phút ở vòng có benchmark →
20 vòng ≈ **3,5 giờ**.

**ĐỪNG đưa rollout lên GitHub Actions**: runner 2 lõi mỗi shard, và repo đã gỡ
`role-power.yml` vì đúng lý do đó.

### Đọc kết quả

| Số | Ở đâu | Nghĩa |
|---|---|---|
| điểm mỗi vòng | stdout, `state.json` → `scores` | Δ trung bình so với baseline heuristic |
| `agreementWithInit` | `iter-*/model/metrics.json` | % argmax còn giống champion — MỎ NEO |
| `approxKl` | cùng file, `history` | Lệch policy mỗi epoch; vọt lên là bước quá dài |
| `clipFraction` | cùng file | Tỉ lệ mẫu bị clip cắt |

`agreementWithInit` là mỏ neo chứ không phải mục tiêu: rơi xuống 0,3 sau MỘT
vòng nghĩa là update đã quăng model đi quá xa khỏi thứ đã biết chơi được, và
điểm benchmark gần như chắc chắn sẽ tệ hơn.

### Baseline của advantage — đọc `baselineMse` cạnh `constantMse`

`metrics.json` ghi hai số cạnh nhau. **`baselineMse` lớn hơn `constantMse` nghĩa
là baseline đang LÀM HẠI**: `A = R − b` với `b` tệ hơn một hằng số là phép trừ
cộng thêm phương sai, tức baseline làm đúng điều ngược lại với việc nó sinh ra
để làm. `train_ppo` in thẳng chữ `hại` / `có ích` ở dòng cuối.

Đã xảy ra thật với `--baseline value` (value head thừa kế từ behavior cloning):
tương quan với kết quả ván chỉ **0,03**, std 0,32, `MSE` **1,11** so với **0,99**
của hằng số. Nó không lệch — bước chuẩn hoá triệt tiêu mọi hằng số — nó NHIỄU
theo từng hàng: hai quyết định trong cùng một ván thắng nhận advantage lệch nhau
tới ±0,6 chỉ vì value head đoán khác nhau ở hai thế cờ nó không hiểu.

Ba lựa chọn (`train_ppo.baseline_for`):

| `--baseline` | `b` | Khi nào |
|---|---|---|
| `role` (mặc định) | TB reward theo từng vai | Luôn. Theo cấu tạo không tệ hơn hằng số |
| `mean` | một hằng số | Khi muốn mốc đối chứng đơn giản nhất |
| `value` | value head của policy | CHỈ khi `baselineMse < constantMse` |

Gom theo VAI chứ không theo phe: cột `roles` đã có sẵn từ encoder nên Python
không cần biết vai nào là Sói — §39 cấm dựng lại luật game ở tầng train, và
"phe" là luật game. Vai cũng mịn hơn phe.

**Nhưng baseline không phải chỗ có đòn bẩy.** `role` chỉ bớt 0,04–0,62% phương
sai, và đó là TRẦN chứ không phải kết quả kém: `R = ±1` có phương sai ≈ 0,99 còn
chênh lệch tỉ lệ thắng giữa các vai chỉ cỡ ±0,15, nên một baseline theo vai hoàn
hảo cũng chỉ gỡ được ~2%. Phần lớn phương sai nằm ở "ván này thắng hay thua", và
thứ gỡ được nó là reward trung gian có nguồn từ luật game — xem `reports/`.

**Kỳ vọng trung thực — và đã đo được (2026-09-09).** Hai cấu hình baseline × 5
vòng độc lập = **mười phép đo, không lần nào challenger vượt champion +2 điểm.**
Điểm dao động 1,1–4,2 quanh champion +2,6, tức trong nhiễu của chính benchmark.

**Đừng tăng số vòng.** Nút thắt là credit assignment: reward ±1 cấp-ván gán đều
cho ~35 quyết định mỗi ván, nên một nước đêm quyết định thắng thua và một câu
nói vô thưởng vô phạt nhận cùng một tín hiệu. Việc đáng làm là reward trung gian
có nguồn từ luật game (ở TypeScript, §39), rồi cắt train theo loại quyết định —
chi tiết và số liệu ở `reports/train-policy-0002.md`.

---

## Giới hạn đã biết

1. ~~**Thước đo `agreement` chấm oan các nước hoà điểm.**~~ ĐÃ SỬA:
   `agreementTieAware` là thước đo chính, xem phần trần ở đầu file. `agreement`
   vẫn được in ra để so với các bảng cũ.
2. **Thám Tử chọn HAI người** (`secondaryTargetId`); nhãn hiện chỉ giữ người
   thứ nhất. Kết quả soi của Thám Tử và Sói Pháp Sư cũng chưa vào observation.
   Đo được: cấp `informationValue` cho nó chỉ nâng agreement +0,002, vì một nửa
   quyết định của nó nằm ngoài không gian hành động.
3. **`FINAL_VOTE` và `SPEECH` chưa có không gian hành động** — cần làm khi tới lượt.
4. **RL mới có ĐƯỜNG ỐNG, chưa có kết quả.** Bước 8 chạy trọn vòng
   rollout → PPO → benchmark → thăng hạng, nhưng bao nhiêu vòng thì bot mạnh
   hơn heuristic là câu hỏi chưa ai trả lời được. Điểm đi ngang nghĩa là nút
   thắt nằm ở reward hoặc observation, không nằm ở số vòng.
5. **Nước heuristic trong ván rollout không vào tập PPO.** Thám Tử (chọn hai
   người), mọi lần rơi về nước lui, và mọi lần `selectVote` ghi đè policy bằng
   hysteresis hoặc cổng "không treo ai" — đúng như phải thế, vì PPO chỉ cập
   nhật được theo hành động chính policy đã sinh ra. Hệ quả: policy không nhận
   được gradient nào cho những tình huống ấy.
6. **Ghế chính tắc là sort-rồi-xoay**, chưa phải ghế ngồi thật của phòng.
7. **Validator cho phép biết vai người đã chết bất kể `revealRoleOnDeath`.**
   Dataset self-play hiện luôn bật tiết lộ; nếu sinh dữ liệu từ phòng tắt tiết
   lộ, phải siết luật này trước.

---

## Bảng lệnh nhanh

| Việc | Lệnh |
|---|---|
| Sinh trajectory | `npm run ai:dataset -- --games N --players 8 --preset --defense --seed S --trajectories DIR --trace-games N --no-jitter` |
| Kiểm rò rỉ + trần | `npm run ai:validate-dataset -- DIR/trajectories.jsonl` |
| Encode | `npm run ai:encode -- --in DIR/trajectories.jsonl --out ENC` |
| Train (BC) | `python -m masoi_training.train_bc --data ENC --out MODEL` |
| Benchmark | `npm run ai:benchmark -- --model MODEL/model.weights.json --games 300 --repeat 3 --seed bench` |
| Rollout RL | `npx tsx apps/server/scripts/selfplay.ts --games N --players 8 --preset --defense --seed S --policy W.json --temperature 1 --learned-seats all --trajectories DIR --trace-games N --quiet` |
| Encode rollout | `npm run ai:encode -- --in DIR/trajectories.jsonl --out ENC --rollout` |
| Train (PPO) | `python -m masoi_training.train_ppo --data ENC --init W.json --out MODEL` |
| Vòng lặp RL | `python rl_loop.py --champion W.json --iterations 20 --games 3000 --bench-every 5 --out .tmp/rl` |
| Champion residual | `python -m masoi_training.init_residual --from W.json --out R.json --beta 10` rồi `rl_loop.py --champion R.json --temperature 5` |
| RL một phe | `python rl_loop.py --champion R.json --side wolves --lr 1e-4 --target-kl 0.01 --bench-every 5 --iterations 5` |
| Self-check Python | `python tests/test_data.py && python tests/test_train_smoke.py && python tests/test_ppo.py` |
| Test TS | `npm test` |

Chi tiết kiến trúc và lý do từng quyết định: [BOT_SELF_LEARNING_AUDIT.md](BOT_SELF_LEARNING_AUDIT.md).
