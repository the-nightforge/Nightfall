# Hướng dẫn train — Behavior Cloning (BOT_SELF_LEARNING §17)

Mọi thứ cần thiết đã nằm trong repo. File này là các bước bạn chạy, theo đúng
thứ tự, kèm con số cần nhìn ở mỗi bước.

**Phần TypeScript đã chạy thật và xanh** (sinh trajectory → kiểm rò rỉ → encode),
và loader Python đã đọc được đúng file `.bin` đó bằng numpy. Thứ **chưa** chạy
được là `train_bc.py`, vì máy chưa cài PyTorch. Vì vậy Bước 0 là bước duy nhất
còn rủi ro, và Bước 1 rút gọn còn một lệnh.

Đường ống:

```text
self-play (TS)  →  trajectory JSONL  →  leak validator  →  encoder (TS)
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

## Bước 0 — Cài PyTorch

```bash
cd ai-training && python -m venv .venv && ./.venv/Scripts/python.exe -m pip install -r requirements.txt
```

`.venv` đã tồn tại sẵn với `numpy` — lệnh trên chỉ bổ sung `torch`. Bản CPU nhẹ
hơn nhiều (~250 MB thay vì ~2,5 GB) và đủ cho MLP này:

```bash
cd ai-training && ./.venv/Scripts/python.exe -m pip install torch --index-url https://download.pytorch.org/whl/cpu
```

Kiểm:

```bash
cd ai-training && ./.venv/Scripts/python.exe -c "import torch; print(torch.__version__)"
```

> Máy đang chạy Python 3.14. Nếu pip báo không tìm thấy bản torch phù hợp, tạo
> venv bằng Python 3.12 hoặc 3.13 rồi lặp lại — phần còn lại không đổi.

Self-check của tầng dữ liệu (không cần torch, chạy trong 1 giây):

```bash
cd ai-training && ./.venv/Scripts/python.exe tests/test_data.py
```

Kết quả mong đợi: `ok`.

---

## Bước 1 — Chạy thử vòng train (1 phút)

Dataset thử **đã có sẵn** ở `.tmp/smoke-enc` (20 ván → 994 mẫu, đã kiểm rò rỉ
SẠCH và đã được loader Python đọc thành công). Chỉ còn một lệnh:

```bash
cd ai-training && ./.venv/Scripts/python.exe -m masoi_training.train_bc --data ../.tmp/smoke-enc --out ../.tmp/smoke-model --epochs 3
```

Nếu `.tmp/smoke-enc` không còn, dựng lại bằng ba lệnh này (đã chạy thật, ra
`dataset SẠCH` và `994 mẫu`):

```bash
npm run ai:dataset -- --games 20 --players 8 --preset --defense --seed smoke --trajectories .tmp/smoke --trace-games 20 --quiet
```

```bash
npm run ai:validate-dataset -- .tmp/smoke/trajectories.jsonl
```

```bash
npm run ai:encode -- --in .tmp/smoke/trajectories.jsonl --out .tmp/smoke-enc
```

Với 20 ván thì độ khớp sẽ rất thấp và **điều đó là bình thường** — bước này chỉ
trả lời một câu hỏi: đường ống có chạy hết từ đầu tới cuối không. Nếu nó in ra
`epoch 1 ... epoch 3` rồi `Đã ghi ...` thì xong.

---

## Bước 2 — Sinh dataset 10.000 ván (~30 phút, ~2,7 GB)

Chạy theo shard 250 ván. Lý do: runner giữ toàn bộ ván trong RAM tới lúc ghi
file, nên một lần chạy 10.000 ván sẽ hết bộ nhớ trước khi ghi được dòng nào.

Git Bash:

```bash
mkdir -p .tmp/dataset-0001 && : > .tmp/dataset-0001/trajectories.jsonl && for i in $(seq 0 39); do npx tsx apps/server/scripts/selfplay.ts --games 250 --players 8 --preset --defense --seed "bc-$i" --trajectories .tmp/shard --trace-games 250 --quiet > /dev/null && cat .tmp/shard/trajectories.jsonl >> .tmp/dataset-0001/trajectories.jsonl && echo "shard $i: $(wc -l < .tmp/dataset-0001/trajectories.jsonl) dòng"; done
```

PowerShell:

```powershell
New-Item -ItemType Directory -Force .tmp\dataset-0001 | Out-Null; Set-Content .tmp\dataset-0001\trajectories.jsonl ""; 0..39 | ForEach-Object { npx tsx apps/server/scripts/selfplay.ts --games 250 --players 8 --preset --defense --seed "bc-$_" --trajectories .tmp\shard --trace-games 250 --quiet > $null; Get-Content .tmp\shard\trajectories.jsonl | Add-Content .tmp\dataset-0001\trajectories.jsonl; Write-Host "shard $_ xong" }
```

Ý nghĩa từng cờ:

| Cờ | Vì sao |
|---|---|
| `--preset` | Dùng bộ bài THẬT của ván 8 người, không phải bộ bài mặc định của runner |
| `--defense` | Bật vòng bào chữa thật; không có nó thì pha DEFENSE không sinh dữ liệu nào |
| `--trace-games 250` | Bằng số ván mỗi shard — không có trace thì không có trajectory |
| `--seed "bc-$i"` | Seed khác nhau mỗi shard; trùng seed là 250 ván giống hệt nhau |

Muốn nhanh hơn để thử trước: đổi `0..39` thành `0..3` (1.000 ván, ~3 phút).
Đủ để pipeline chạy, chưa đủ để kết luận model tái lập được bot (§16).

---

## Bước 3 — Kiểm rò rỉ (BẮT BUỘC, §7)

```bash
npm run ai:validate-dataset -- .tmp/dataset-0001/trajectories.jsonl
```

Phải thấy:

```text
invalid observations  0
invalid actions       0
leak violations       0
KẾT LUẬN: dataset SẠCH — train được.
```

**Khác 0 thì dừng lại, đừng train.** Con số đó nghĩa là có bug trong knowledge
boundary, và train tiếp chỉ dạy model khai thác đúng bug đó. Lệnh in ra tối đa
10 lý do vi phạm kèm số lần — đọc lý do đầu tiên trước.

Tham chiếu: batch 200 ván đã chạy ra 0/0/0.

---

## Bước 4 — Encode ra tensor

```bash
npm run ai:encode -- --in .tmp/dataset-0001/trajectories.jsonl --out .tmp/enc-0001
```

Kết quả mong đợi (con số theo tỉ lệ của batch 200 ván):

```text
Đã đọc      ~1.600.000 dòng (10.000 ván)
TỪ CHỐI     0
không nhãn  ~1.130.000
mẫu train   ~470.000  (train ~70% / val ~11% / test ~18%)
vector      191 chiều, 17 hành động
```

`không nhãn` cao là ĐÚNG, không phải lỗi: không gian hành động hiện tại chỉ mô
tả VOTE/NIGHT/HUNTER_SHOT. `SPEECH` và `FINAL_VOTE` (treo/tha) có `targetId`
nhưng đó không phải một nước đi trong không gian này, nên chúng bị bỏ thay vì
được gán một nhãn bịa ra.

Chia train/val/test làm theo VÁN (§15), quyết ở tầng TS, nên không có state nào
của một ván train lọt sang test.

---

## Bước 5 — Behavior cloning

```bash
cd ai-training && ./.venv/Scripts/python.exe -m masoi_training.train_bc --data ../.tmp/enc-0001 --out ../.tmp/model-v001 --epochs 20
```

Tham số đáng chỉnh:

| Cờ | Mặc định | Khi nào đổi |
|---|---|---|
| `--epochs` | 20 | Val agreement còn tăng ở epoch cuối → tăng lên 40 |
| `--lr` | 1e-3 | Loss nhảy loạn → giảm còn 3e-4 |
| `--hidden` | 128 | Chỉ tăng khi val agreement chững mà train agreement cũng chững (thiếu sức chứa, không phải overfit) |
| `--batch-size` | 512 | Máy hết RAM → giảm |
| `--value-weight` | 0.5 | Value head lấn policy → giảm về 0.1 |
| `--seed` | 12345 | Đổi để kiểm model có ổn định không, không phải để "chọn kết quả đẹp" |

Toàn bộ tập train được nạp lên device một lần (~360 MB float32). Trên CPU thì
ổn; nếu dùng GPU nhỏ mà OOM, đó là chỗ cần sửa đầu tiên.

---

## Bước 6 — Đọc kết quả

Số duy nhất quyết định được: **`metrics.test.agreement`** — tỉ lệ model chọn
đúng hành động mà bot heuristic đã chọn, trên các ván model chưa từng thấy.

```bash
cd ai-training && ./.venv/Scripts/python.exe -c "import json;m=json.load(open('../.tmp/model-v001/metrics.json'));print(json.dumps(m['metrics'],indent=2,ensure_ascii=False))"
```

Cách đọc:

| test agreement | Nghĩa là | Làm gì |
|---|---|---|
| < 0,30 | Model chưa học được gì đáng kể | Kiểm lại observation có đủ đặc trưng không — xem "Giới hạn đã biết" ở dưới |
| 0,30 – 0,60 | Học được xu hướng, chưa tái lập bot | Tăng epochs/hidden; nếu vẫn chững thì phải làm giàu observation |
| > 0,70 | Tái lập baseline khá tốt | Đủ điều kiện §17 để tính tới RL |

**Đừng nhìn loss để kết luận.** §17 nói rõ: chưa tái lập được bot thì chưa được
sang RL. Loss giảm mà agreement không tăng nghĩa là model đang học phân bố của
lớp đông nhất, không phải học chơi.

`metrics.*.agreementByRole` cho thấy vai nào model bám kém — thường là vai hiếm
trong dataset (§43, mất cân bằng lớp). Bảng `trainActionDistribution` trong cùng
file nói tần suất từng lớp hành động; xem nó TRƯỚC khi nghĩ tới việc cân lớp.

`metrics.json` cũng ghi `modelId`, `gitCommit`, `datasetVersion`, `trainingSeed`
và toàn bộ `trainingConfig` (§46) — một model không truy ngược được về dataset
và commit đã sinh ra nó là một model không tái lập được.

---

## Train trên Google Colab (khuyến nghị)

Colab đã cài sẵn PyTorch và cho GPU T4 miễn phí, nên bỏ qua được Bước 0 hoàn toàn.
Notebook: [`ai-training/colab/train_bc_colab.ipynb`](../ai-training/colab/train_bc_colab.ipynb).

Chia việc theo đúng ranh giới §39: **máy bạn sinh và encode dữ liệu (TypeScript),
Colab chỉ train (Python)**. Colab không parse trajectory và không có bản sao nào của
observation encoder, nên ranh giới thông tin không đổi khi đưa lên máy khác.

### 1. Ở máy bạn — sinh dữ liệu và đóng gói

Chạy Bước 2 → 3 → 4 ở trên, rồi nén hai thứ Colab cần vào một file:

```powershell
Compress-Archive -Path ai-training\masoi_training, .tmp\enc-0001 -DestinationPath .tmp\bc-package.zip -Force
```

Zip gồm `masoi_training/` (3 file Python) và `enc-0001/` (tensor `.bin` + `meta.json`).

**Không tải trajectory JSONL 2,7 GB lên.** Tensor đã encode nhỏ hơn nhiều
(~370 MB cho 10.000 ván) và nén rất tốt vì phần lớn đặc trưng là one-hot — thực tế
còn khoảng vài chục MB.

### 2. Tải lên Google Drive

Đặt `bc-package.zip` vào `MyDrive` (gốc Drive). Nếu để chỗ khác thì sửa biến `ZIP`
trong cell thứ hai của notebook.

### 3. Mở notebook trên Colab

Tải `train_bc_colab.ipynb` lên [colab.research.google.com](https://colab.research.google.com)
(`File → Upload notebook`), rồi `Runtime → Change runtime type → T4 GPU`.

CPU cũng chạy được — MLP 128×128 trên ~470.000 mẫu không nặng — chỉ chậm hơn vài lần.

### 4. Chạy các cell theo thứ tự

| Cell | Việc |
|---|---|
| 1 | In phiên bản torch + GPU |
| 2 | Mount Drive, giải nén vào `/content/bc` |
| 3 | **Kiểm dữ liệu**: file khớp `meta.json`, ba phần cộng lại đúng, và MỌI nhãn là nước hợp lệ theo chính mask của nó |
| 4 | Chạy thử 2 epoch (~30 giây) |
| 5 | Train thật (30 epoch) |
| 6-7 | In `test agreement` theo vai + vẽ đường loss/agreement |
| 8 | Chép `model.pt` / `model.onnx` / `metrics.json` về Drive |

Cell 3 là cell đáng giá nhất: nó ném lỗi ngay nếu zip thiếu file hoặc dataset lệch,
thay vì để bạn phát hiện sau 30 phút GPU.

### Lưu ý Colab

- **Session ngắt là mất `/content`.** Cell cuối chép model về Drive; đừng bỏ qua nó.
- **Giữ tab mở.** Colab free ngắt runtime khi tab đóng lâu.
- Đừng tách `metrics.json` khỏi `model.pt`/`model.onnx`: nó là thứ duy nhất truy được
  model về `datasetVersion`, `gitCommit` và `trainingSeed` (§46).

---

## Giới hạn đã biết (đọc trước khi thất vọng vì con số)

1. **Observation còn nghèo so với §8.** Hiện chỉ có `suspicion`/`trust` cho mỗi
   ghế; chưa có `wolfProbability`, `threat`, `credibility`, `influence` — chúng
   có trong belief state của bot nhưng chưa được trace chụp lại. Nếu agreement
   chững quanh 0,3–0,5, đây gần như chắc chắn là nguyên nhân, chứ không phải
   model quá nhỏ.
2. **Không gian hành động chỉ phủ 36% số quyết định** (VOTE/NIGHT/HUNTER_SHOT).
   `FINAL_VOTE` và `SPEECH` cần không gian riêng.
3. **Chưa có RL, chưa có champion/challenger.** §55 chặn cả hai cho tới khi
   behavior cloning đạt.
4. **`train_bc.py` chưa từng chạy với torch thật.** Bước 1 tồn tại chính vì lý
   do này.

---

## Bảng lệnh nhanh

| Việc | Lệnh |
|---|---|
| Sinh trajectory | `npm run ai:dataset -- --games N --players 8 --preset --defense --seed S --trajectories DIR --trace-games N` |
| Kiểm rò rỉ | `npm run ai:validate-dataset -- DIR/trajectories.jsonl` |
| Encode | `npm run ai:encode -- --in DIR/trajectories.jsonl --out ENC` |
| Train | `python -m masoi_training.train_bc --data ENC --out MODEL` |
| Self-check dữ liệu | `python tests/test_data.py` |
| Test TS | `npm test` |

Chi tiết kiến trúc và lý do từng quyết định: [BOT_SELF_LEARNING_AUDIT.md](BOT_SELF_LEARNING_AUDIT.md).
