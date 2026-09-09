# BOT SELF-LEARNING — Audit & Phase 1

Đối chiếu `BOT_SELF_LEARNING.md` với code THẬT của repo, rồi thực hiện đúng
Phase 1 mà §55 cho phép: Environment + Observation + Action Mask + Trajectory
Export, kèm test và một dataset nhỏ đã qua leak validation.

Nguyên tắc §3/§56 được giữ nguyên: **không rebuild bot hiện tại**. Bot heuristic
tiếp tục là baseline, teacher và opponent pool.

---

## 1. Phase 0 — Hiện trạng

### 1.1 Kiến trúc bot hiện tại

```text
GameEngine  ──botKnowledgeFor()──►  BotKnowledgeView  ──►  BotRuntime
                                                              │
                     belief / memory / analysis / planning ◄───┤
                                                              │
                                    scorer  →  StrategicPlanner  →  PolicyModel
                                                                        │
                                                                     Action
                                                                        │
                                                              GameEngine (trọng tài)
```

| Thành phần | Vị trí | Trạng thái |
|---|---|---|
| Game engine | `packages/game-engine/src/engine.ts` | Trọng tài duy nhất, validate mọi nước |
| Knowledge boundary | `src/bot/knowledge.ts` + `engine.botKnowledgeFor` | Có, lọc theo quyền từng bot |
| Bot runtime | `src/bot/BotRuntime.ts` | Heuristic đầy đủ (belief, memory, personality, planner) |
| Seam chính sách | `src/bot/policy/policy-model.ts` | `PolicyModel.selectAction`, cắm qua `BotRuntime({ votePolicy })` |
| Hybrid policy | `src/bot/policy/hybrid.ts` | `alpha·heuristic + beta·learned`, mặc định `beta = 0` |
| Self-play | `src/bot/evaluation/selfplay.ts` | Nhân thuần, dùng engine thật, `runSelfPlay`/`replayGame`/`runBatch` |
| RNG tất định | `src/bot/rng.ts` | Counter-based, khôi phục bằng `cursor` |
| Trace | `src/bot/trace/trace.ts` | Có, kèm invariant `trace ⊆ knowledge view` |
| Trajectory export | `src/bot/evaluation/trajectory.ts` | Có, JSONL, `reward = ±1` |
| Benchmark | `src/bot/evaluation/{metrics,report,invariants}.ts` | Có, fixed-seed, scenario benchmarks |

### 1.2 Ánh xạ spec ↔ hiện trạng (trước phiên này)

| Yêu cầu spec | Đã có | Thiếu |
|---|---|---|
| §4/§5 Environment headless | `runSelfPlay` (agent nằm TRONG vòng lặp) | `reset/step/legalActions` (agent nằm NGOÀI) |
| §6 Information boundary | ✅ `BotKnowledgeView` | — |
| §7 Leak validator | ❌ | **Đã làm ở phiên này** |
| §8-§11 Observation encoder | ❌ | **Đã làm** |
| §12/§13 Action encoder + mask | ❌ | **Đã làm** |
| §14 Trajectory dataset | ✅ `gameToTrajectories` | Tập hợp lệ SAI cho NIGHT — **đã sửa** |
| §15 Game-level split | ❌ | **Đã làm** |
| §17 Behavior cloning | ❌ | Phase 2 (§55 Step 8) |
| §20/§21 Reward | ✅ `±1` theo `roleWonOutcome` | — |
| §25/§26 Fixed-seed + thống kê | ✅ `runBatch` + `buildReport` | — |
| §30 Hybrid policy | ✅ `hybridPolicyModel` | Chưa có learned model thật |
| §45/§46 Replay + versioning | ✅ `seed`/`weightsVersion`/`commit` | `modelVersion` khi có model |

### 1.3 Quyết định kiến trúc: KHÔNG dựng `reset/step/legalActions`

§4 mô tả environment kiểu Gym (agent gọi `step`). Repo này đã có dạng NGƯỢC
LẠI, và nó tương đương về chức năng:

```text
Gym:            agent  →  env.step(action)  →  observation
Repo hiện tại:  env (runSelfPlay)  →  PolicyModel.selectAction(...)  →  action
```

Cả hai đều cho: seed tất định, tập hành động hợp lệ do engine cấp, một policy
cắm được, và trajectory ghi ra. Viết lại `runSelfPlay` (1.500 dòng, 97 file test
phụ thuộc) thành coroutine để đảo chiều điều khiển sẽ tạo ra một bản sao thứ hai
của vòng lặp ván — thứ §1/§40 cấm ("Do not create unnecessary duplicate
packages", "Không duplicate game rules").

**Hệ quả thực tế:** behavior cloning (§17) và PPO đều train từ trajectory đã ghi,
nên không cần `step`. Learned policy chơi được ván đầy đủ (§54 "Learned bot can
play full games") bằng cách cắm vào `BotRuntime({ votePolicy })`.

Đây là chỗ lệch spec duy nhất và có chủ đích. Nếu cần đúng chữ `reset/step`,
nói một câu là làm — nhưng nên làm sau khi có model thật để biết nó cần gì.

**Quyết định thứ hai, 2026-09-09: không nạp ONNX ở runtime.** `game-engine`
phải thuần (không I/O, có test canh), `onnxruntime-node` chỉ có API bất đồng
bộ trong khi `BotRuntime.decide*` đồng bộ, và model là MLP ~94k tham số. Trọng
số xuất ra JSON `masoi-mlp-1`, forward pass viết thuần TypeScript
(`bot/learning/mlp.ts`), có fixture parity với torch. ONNX vẫn xuất cho consumer
khác.

---

## 2. Phase 1 — Báo cáo thực hiện (§55)

### Changed files

```text
packages/game-engine/src/bot/learning/observation.ts   (mới)
packages/game-engine/src/bot/learning/dataset.ts       (mới)
packages/game-engine/tests/bot-learning.test.ts        (mới)
apps/server/scripts/ai-validate-dataset.ts             (mới)
packages/game-engine/src/bot/trace/trace.ts            (sửa: +nightLegalTargets, +hunterLegalTargets)
packages/game-engine/src/bot/BotRuntime.ts             (sửa: snapshotKnowledge chép hai trường trên)
packages/game-engine/src/bot/evaluation/trajectory.ts  (sửa: legalActions đúng theo loại quyết định)
packages/game-engine/src/index.ts                      (sửa: export module learning)
package.json                                           (sửa: ai:dataset, ai:validate-dataset, ai:encode)
```

Phase 2 (đã CHUẨN BỊ, chưa chạy — xem §4):

```text
apps/server/scripts/ai-encode.ts        (mới) JSONL → tensor .bin cho tầng train
ai-training/masoi_training/data.py      (mới) loader .bin, không parse trajectory
ai-training/masoi_training/model.py     (mới) MLP policy + value head
ai-training/masoi_training/train_bc.py  (mới) behavior cloning + export ONNX
ai-training/tests/test_data.py          (mới) self-check loader
ai-training/{README.md,requirements.txt}(mới)
docs/BOT_SELF_LEARNING_TRAINING.md      (mới) hướng dẫn train từng bước
.gitignore                              (sửa: .venv, .tmp, ai-training/{data,models})
```

### Existing components reused

- `BotKnowledgeView` + `TraceKnowledgeSnapshot` — nguồn DUY NHẤT của observation.
- `gameToTrajectories` — không viết lại export.
- `PHASES`, `ROLES`, `ROLE_META`, `isRole`, `isWolfPack` của `@masoi/shared` —
  §11 cấm chép tay danh sách pha; §10 lấy role embedding từ bộ bài thật.
- `createSeededRng` — dùng luôn cho việc trộn bit của game-level split.
- `runSelfPlay` + `--trajectories` — sinh dataset, không thêm runner mới.

### New components

**`observation.ts`** — encoder tất định `BotTrajectory → number[]`.

- Đầu vào duy nhất là một line trajectory. Encoder KHÔNG nhận `GameState`,
  `SelfPlayGame` hay bảng `roles`: rò rỉ bị chặn bằng CẤU TRÚC (§6), không bằng
  kỷ luật.
- Ghế chính tắc (§9): sort theo id rồi xoay để chính bot ở ghế 0. Không có
  "player-1 luôn quan trọng"; với UUID thì sort chỉ còn là một hoán vị tất định.
  Kiểm chứng: phân phối lớp hành động trên 200 ván ra 4.0–4.4% đều khắp ghế 1–7.
- Chiều: 47 global (round, aliveShare, 12 pha, 5 loại quyết định, 20 vai,
  7 tính cách, 1 cờ NO_ELIMINATION) + 16 ghế × 9 = 191.
- Action space: `maxSeats + 1` (mỗi ghế + "không treo ai"). Không hard-code số
  người mỗi ván (§12); vượt trần thì NÉM chứ không cắt bớt người chơi.
- `maskLogits` (§13): hành động bất hợp lệ về `-Infinity` → xác suất 0.
- `actionIndex` chỉ có giá trị cho VOTE/NIGHT/HUNTER_SHOT. `FINAL_VOTE`
  (treo/tha) và `SPEECH` có `targetId` nhưng targetId đó không phải một nước đi
  trong không gian này — ánh xạ chúng vào ghế sẽ sinh nhãn nói "bot đã bầu người
  này" cho một lượt bot chỉ vừa nhắc tên người đó.

**`dataset.ts`** — leak validator + stats + game-level split.

- `validateTrajectoryLine(unknown)`: nhận `unknown` có chủ đích (nguồn thật là
  file trên đĩa). Chỉ BÁO CÁO, không sửa line — §7 cấm âm thầm xoá trường rồi
  train tiếp, vì làm vậy là giấu đi chính con bug đã tạo ra rò rỉ.
- Luật rò rỉ suy từ ĐÚNG `GameEngine.botKnowledgeFor`, và kiểm được chỉ bằng bản
  thân line (không cần ground truth):
  1. `observation` chỉ được có 6 khoá whitelist — một trường MỚI lọt vào là tình
     huống nguy hiểm nhất, và blacklist chỉ chặn được cái tên đã nghĩ ra trước.
  2. Biết vai người khác CÒN SỐNG chỉ hợp lệ khi: mình là Sói trong bầy còn sống
     và người đó cũng trong bầy, hoặc mình là Tiên Tri Tập Sự còn sống và người
     đó là Tiên Tri. Người đã chết thì ai cũng có thể biết (sổ tang /
     `revealRoleOnDeath`).
  3. `seerResult` chỉ hợp lệ với SEER / APPRENTICE_SEER (đúng cổng `case "SEE"`).
  4. `reward ∈ {+1, −1}`; hành động của VOTE/NIGHT/HUNTER_SHOT phải nằm trong
     `legalActions` (§42).
- `summarizeDataset`: games / episodes / timesteps / invalid observations /
  invalid actions / leak violations / phân phối vai, pha, loại quyết định, lớp
  hành động (§43) / reward.
- `splitOf` (§15): băm `gameId`, nên MỌI line của một ván rơi cùng một phần —
  không có đường nào để state của ván train lọt vào test.

**`apps/server/scripts/ai-validate-dataset.ts`** — vỏ I/O, exit code ≠ 0 khi có
bất kỳ vi phạm nào. Dataset bẩn phải làm đỏ CI, không chỉ in ra một dòng.

### Bug đã sửa (root cause, không phải triệu chứng)

`snapshotKnowledge` chỉ chép `legalVoteChoices` — tập hợp lệ BAN NGÀY. Ban đêm
tập đó rỗng, nên **mọi** trajectory NIGHT trước phiên này ghi
`legalActions: []` cạnh một `targetId` khác null: dữ liệu train nói bot đã đi
một nước ngoài luật, ở 4.794/32.337 dòng (14,8%).

Sửa tại nguồn (`TraceKnowledgeSnapshot` + `snapshotKnowledge`) chứ không vá ở
validator: cả trace lẫn trajectory lẫn mọi consumer sau này đều dùng chung một
tập hợp lệ đúng. Hai trường mới vẫn chép từ `BotKnowledgeView`, nên ranh giới
"trace ⊆ knowledge view" không đổi.

### Tests

```text
packages/game-engine/tests/bot-learning.test.ts   19 tests
  encoder: ghế 0 = chính bot, chiều cố định, tất định, mask đúng ô,
           actionIndex null khi ngoài tập hợp lệ, vượt trần thì ném
  leak:    TỪ CHỐI dân biết vai người sống / seerResult ở vai không soi được /
           trường lạ trong observation / hành động ngoài tập hợp lệ / reward ≠ ±1
           CHO PHÉP Sói biết đồng bọn, ai cũng biết vai người đã chết
  dataset: đếm ván/episode/timestep, đếm rò rỉ mà KHÔNG sửa line,
           split theo ván, split bám 70/15/15 trên seed thật của một batch
```

Toàn bộ suite:

```text
@masoi/shared        215 tests   passed
@masoi/game-engine  4766 tests   passed  (97 file)
@masoi/server       1095 tests   passed  (132 file)
lint (shared, game-engine, server)       passed
```

`@masoi/web` lint fail trong worktree này vì `apps/web/node_modules` chưa được
cài ở worktree (thiếu `@types/react`) — môi trường, không phải thay đổi này.

### Dataset stats

```bash
npm run ai:dataset -- --games 200 --players 8 --preset --defense --seed ai-phase1 --trajectories <dir> --trace-games 200
npm run ai:validate-dataset -- <dir>/trajectories.jsonl
```

```text
games                 200
episodes              1600
timesteps             32337
dòng JSON hỏng        0
split (theo ván)      train 23061 / val 3537 / test 5739
reward                win 17545 / loss 14792

vai      WEREWOLF 25.8%  WITCH 16.2%  HUNTER 13.0%  VILLAGER 12.5%
         DETECTIVE 12.2%  SEER 10.4%  GUARD 9.9%
pha      VOTING 19263  DEFENSE 5762  NIGHT 4794  FINAL_VOTE 2395  HUNTER_SHOT 123
quyết định  SPEECH 13517  FINAL_VOTE 7185  VOTE 6718  NIGHT 4794  HUNTER_SHOT 123
lớp hành động (ghế 1–7)  4.0% – 4.4% mỗi ghế   ← không có thiên lệch ghế (§9)
```

### Leak validation

```text
invalid observations  0
invalid actions       0
leak violations       0
KẾT LUẬN: dataset SẠCH — train được.
```

Validator được kiểm ngược bằng test: cấy rò rỉ (dân biết vai Sói còn sống, nhãn
kết cục lọt vào observation) thì nó TỪ CHỐI. Một validator chưa từng nói "không"
là một validator chưa được chứng minh.

### Benchmark / Baseline / New model

Chưa có model. Phase 1 chỉ dựng đường ống; baseline vẫn là bot heuristic
(`weightsVersion 21.0.0`), và batch 200 ván ở trên chạy **0 invariant violation**.
So sánh champion/challenger chỉ có nghĩa khi §55 Step 8 (behavior cloning) xong.

### Known limitations

1. **Không có `reset/step/legalActions`.** Xem §1.3 — quyết định có chủ đích.
2. **Observation nghèo hơn §8.** Mới có `suspicion`/`trust`; chưa có
   `wolfProbability`, `threat`, `credibility`, `influence` — chúng sống trong
   belief state nhưng chưa được `BotDecisionTrace` chụp lại. Mở rộng khi behavior
   cloning cho thấy vector hiện tại không đủ để tái lập bot.
3. **Ghế chính tắc là sort-rồi-xoay**, chưa phải ghế ngồi thật của phòng
   (knowledge view không phơi ra `seatIndex`). Đã đánh dấu `ponytail:` trong code.
4. **Không gian hành động chỉ mô tả VOTE/NIGHT/HUNTER_SHOT** (36% số quyết định).
   `FINAL_VOTE` (treo/tha) và `SPEECH` cần không gian riêng — làm khi tới lượt.
   Runtime đã cắm được cho VOTE/NIGHT (kế hoạch
   `2026-09-09-learned-policy-runtime`); Thám Tử luôn theo heuristic vì cần hai
   mục tiêu.
5. **Thang belief chuẩn hoá cứng `/100`.** Đúng với dải điểm hiện tại; nếu weights
   đổi dải thì phải đo lại.
6. **Dataset 200 ván là dataset KIỂM ĐƯỜNG ỐNG**, không phải dataset train. §16
   cần 10.000 ván cho baseline và 100.000 cho behavior cloning.

---

## 3. Bước kế tiếp (§55 Step 8)

Chỉ được bắt đầu khi leak validation xanh — đã xanh. Thứ tự:

```text
1. Sinh 10.000 ván  →  ai:validate-dataset  →  dataset-0001      ✅ XONG
2. Behavior cloning (§17/§18): MLP nhỏ, policy head + value head  ✅ XONG (policy-0004)
3. Đo "learned bot ≈ current bot" — chưa đạt thì KHÔNG sang RL    ✅ XONG (tie-aware 0,940)
4. Self-play + opponent pool (§22/§23)  →  PPO (§38)              ✅ ĐƯỜNG ỐNG (rl_loop.py)
5. Champion/challenger trên seed cố định (§24/§25/§26)            ✅ ĐƯỜNG ỐNG (ai:benchmark)
```

Bước 3 chỉ đọc được sau khi thước đo được sửa: `agreement` chấm oan 28% nước
hoà điểm (48% ở đêm), nên `agreementTieAware` mới là con số trả lời câu hỏi
"model có tái lập được chính sách của bot không". policy-0004 đạt 0,940 tổng
thể, 0,959 ở lượt đêm — đủ để mở cổng sang RL.

Bước 4 và 5 có ĐƯỜNG ỐNG chạy được, chưa có KẾT QUẢ: `rl_loop.py` chạy trọn
vòng rollout → PPO → benchmark → thăng hạng và tự chạy tiếp được sau khi ngắt,
nhưng bao nhiêu vòng thì bot vượt heuristic là câu hỏi chưa ai trả lời.

`hybridPolicyModel` vẫn sẵn cho bước 5 với `alpha = 1, beta = 0` (§30).

---

## 3b. Cập nhật 2026-09-09 — sau lần train đầu tiên

Lần chạy `train_bc.py` đầu tiên trên bộ 200 ván ra test agreement **0,22**
(5 epoch) và **0,33** (60 epoch, còn đang tăng). Đối chiếu với dữ liệu cho ra
bốn nguyên nhân cấu trúc, đã sửa ở nhánh `feat/ai-training-fixes`:

| Phát hiện | Số đo trên bộ 200 ván | Sửa |
|---|---|---|
| Term `jitter` (RNG) quyết định nước đi | argmax(điểm − jitter) chỉ trùng nước bot đi ở **60%** → trần của mọi model | `selfplay --no-jitter` (teacher tất định, `weightsVersion` đuôi `+nojitter`); `ai:validate-dataset` in **trần độ khớp**; `train_bc` báo thêm `top2Agreement` |
| Observation thiếu term lớn nhất của scorer | `threat` TB 47 điểm, `teammateProtection` 43, `bussingJoin` 48; `belief` chỉ 1,9. 38% dòng có suspicion = 0 với mọi mục tiêu | `BeliefSnapshot` chụp thêm `wolfProbability/threat/credibility/influence` từ `assessPlayers`; trace chụp thêm nạn nhân bầy, bình thuốc, người Bảo Vệ canh, người chết đêm qua, phiếu, người bị xử. Vector 191 → 365 chiều |
| Không gian hành động mất LOẠI hành động đêm | HEAL/POISON cùng ghế = cùng nhãn; 924 lượt Phù Thuỷ giữ thuốc (35%) bị bỏ vì không nhãn | Không gian (loại × ô) = 11 × 17 = 187; `SKIP:none` là nhãn thật; `decodeAction` cho runtime; validator kiểm cặp (loại, mục tiêu) |
| Mặc định train và bảng đọc kết quả sai hướng | value head MAE 0,95 ≈ đoán 0; epoch cuối ≠ epoch tốt nhất | `--value-weight 0`, 40 epoch, giữ checkpoint theo val agreement, `agreementByDecision`; tài liệu đọc agreement so với trần |

Kết quả sau sửa, bộ 20 ván `--no-jitter` (788 mẫu train): trần **97,3%**, test
agreement **0,49** (top-2 0,67) — so với 0,33 trên 6.700 mẫu có jitter trước đó.
Bộ 10.000 ván chưa chạy.

**Cập nhật cùng ngày, sau policy-0002/0003** (`reports/train-policy-0002.md`):
dataset `--no-jitter` 10.000 ván cho trần 97,4% và test agreement 0,840 (h128)
/ 0,849 (h256) — cổng §17 mở. Gấp đôi sức chứa không đổi VOTE một phần vạn,
nên nút thắt là observation. Đo term của scorer đêm thấy ba đầu vào còn thiếu:
`informationValue` (Tiên Tri/Thám Tử), nhánh "đã khai vai quyền lực" của
`wolfThreatScore` (observation trùng nước Sói 100% khi không ai khai, 71% khi
có), và `repeatPenalty` của Bảo Vệ. Ba đặc trưng đó vào `BeliefSnapshot` qua
đúng hàm/predicate scorer dùng (`powerRoleClaimOf` tách từ wolf-team-plan.ts);
vector 365 → 413, `dataset-0003`. Kiểm trên 40 ván: argmax observation trùng
nước Sói và Tiên Tri/Thám Tử đã đi 100%.

**Kết quả sau khi bổ sung** (policy-0004, cùng 10.000 ván, cùng cấu hình train,
chỉ khác vector 365 → 413): test agreement 0,840 → **0,861**; NIGHT 0,713 →
**0,767**; WEREWOLF 0,758 → **0,806**. 48 chiều đúng chỗ hơn hẳn việc gấp đôi
sức chứa: h128/413 chiều (0,861) vượt h256/365 chiều (0,849) với một nửa tham số.

**Cảnh báo về thước đo**, phát hiện cùng lúc: trần mà validator in ra phá hoà
điểm bằng `targetId` thô, trong khi §9 cố tình xoá ý nghĩa tuyệt đối của id khỏi
observation. 28% nước đi hoà điểm ở đỉnh (lượt đêm là 48%), nên một model mù id
đoán đều trong nhóm hoà chỉ đạt 75,3% (đêm 62,6%) so với trần in ra 97,3%. Với
nước hoà điểm, chọn ứng viên nào cũng tái lập đúng chính sách của bot, nên
`agreement` đang chấm oan. Việc cần làm TRƯỚC khi thêm đặc trưng đêm nữa là đổi
thước đo sang "lựa chọn của model có nằm trong nhóm hoà đỉnh của teacher không".

Thêm: `ai-training/tests/test_train_smoke.py` chạy trọn vòng train với torch
thật, và job CI `ai-training` chạy nó khi `ai-training/**` đổi. Hai khe hở
validator còn giữ nguyên và được ghi ở "Giới hạn đã biết" của tài liệu train:
vai người chết bất kể `revealRoleOnDeath`, và Thám Tử chỉ có nhãn người thứ nhất.

---

## 4. Phase 2 — Đã chuẩn bị, CHƯA chạy

Toàn bộ tầng train đã có trong repo; không bước nào được chạy trên máy dev.
Các bước cụ thể nằm ở [BOT_SELF_LEARNING_TRAINING.md](BOT_SELF_LEARNING_TRAINING.md).

**Ranh giới TS/Python (§39).** Observation encoder chỉ có MỘT bản, ở TypeScript,
cạnh knowledge boundary. `ai-encode.ts` ghi ra `.bin` thô + `meta.json`; Python
chỉ `np.fromfile`. Viết lại encoder bằng Python sẽ tạo bản sao thứ hai của đúng
phần mã quyết định "cái gì được nhìn thấy", và hai bản sao sẽ trôi lệch trong im
lặng. Đó cũng là lý do không dùng định dạng `.npy`: một header tự viết là thêm
một thứ nữa có thể sai, còn `np.fromfile(path, dtype).reshape(...)` thì không.

**Đã kiểm:**

```text
ai-encode.ts trên 200 ván    32.337 dòng → 9.414 mẫu có nhãn, 0 từ chối
                             kích thước file khớp chính xác (9.414×191×4, 9.414×17)
lệnh Bước 1 của hướng dẫn    chạy nguyên văn: 20 ván → validate SẠCH → encode 994 mẫu
loader Python trên đúng file .bin đó:
    rows 994, obs 191, act 17          khớp meta.json
    splits 608/219/167                  cộng lại = 994, không ván nào ở hai phần
    dtype float32 / bool / int64        khớp cái model chờ
    masks[i, actions[i]] toàn True      MỌI nhãn là một nước HỢP LỆ theo chính
                                        mask của nó — encoder TS và loader Python
                                        đồng ý với nhau trên dữ liệu thật
    rewards ∈ {−1, +1}                  đúng §20
py_compile 4 file Python     OK
tests/test_data.py           ok  (kể cả nhánh file cụt phải bị TỪ CHỐI)
npm run lint (server)        OK
```

**CHƯA kiểm:** `train_bc.py` chưa từng chạy với PyTorch thật — máy dev chỉ có
Python 3.14 và chưa cài torch. Bước 1 của hướng dẫn (chạy thử 20 ván, ~5 phút)
tồn tại chính vì lý do đó: nó làm mọi lỗi lộ ra trước lần chạy 30 phút.

**Chỉ số quyết định** là `metrics.test.agreement` — độ khớp hành động với bot
heuristic trên ván chưa từng thấy (§17), KHÔNG phải loss. Loss giảm mà agreement
không tăng nghĩa là model đang học phân bố của lớp đông nhất.
