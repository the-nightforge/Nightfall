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

## Giới hạn đã biết

1. **Thước đo `agreement` chấm oan các nước hoà điểm.** Xem phần trần ở đầu
   file. Việc đáng làm trước mọi nỗ lực nâng lượt đêm là đổi sang "lựa chọn của
   model có nằm trong nhóm hoà đỉnh của teacher không"; nếu không, mọi thay đổi
   sau sẽ đuổi theo một con số bị nhiễu bởi cách phá hoà tuỳ tiện.
2. **Thám Tử chọn HAI người** (`secondaryTargetId`); nhãn hiện chỉ giữ người
   thứ nhất. Kết quả soi của Thám Tử và Sói Pháp Sư cũng chưa vào observation.
   Đo được: cấp `informationValue` cho nó chỉ nâng agreement +0,002, vì một nửa
   quyết định của nó nằm ngoài không gian hành động.
3. **`FINAL_VOTE` và `SPEECH` chưa có không gian hành động** — cần làm khi tới lượt.
4. **Chưa có RL, chưa có champion/challenger.** §55 chặn cả hai cho tới khi
   behavior cloning đạt. Khi cắm model vào runtime, `decodeAction` trả (loại,
   mục tiêu) — `hybridPolicyModel` hiện chỉ nhận điểm theo mục tiêu ban ngày,
   nên phần đêm cần một seam mới.
4. **Ghế chính tắc là sort-rồi-xoay**, chưa phải ghế ngồi thật của phòng.
5. **Validator cho phép biết vai người đã chết bất kể `revealRoleOnDeath`.**
   Dataset self-play hiện luôn bật tiết lộ; nếu sinh dữ liệu từ phòng tắt tiết
   lộ, phải siết luật này trước.

---

## Bảng lệnh nhanh

| Việc | Lệnh |
|---|---|
| Sinh trajectory | `npm run ai:dataset -- --games N --players 8 --preset --defense --seed S --trajectories DIR --trace-games N --no-jitter` |
| Kiểm rò rỉ + trần | `npm run ai:validate-dataset -- DIR/trajectories.jsonl` |
| Encode | `npm run ai:encode -- --in DIR/trajectories.jsonl --out ENC` |
| Train | `python -m masoi_training.train_bc --data ENC --out MODEL` |
| Self-check Python | `python tests/test_data.py && python tests/test_train_smoke.py` |
| Test TS | `npm test` |

Chi tiết kiến trúc và lý do từng quyết định: [BOT_SELF_LEARNING_AUDIT.md](BOT_SELF_LEARNING_AUDIT.md).
