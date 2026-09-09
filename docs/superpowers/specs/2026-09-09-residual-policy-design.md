# Residual Policy — Thiết kế

Ngày: 2026-09-09. Phụ thuộc: `2026-09-09-rl-self-play-design.md` (PR #83/#85,
đã merge) và ba commit distill trên `feat/rl-self-play`. Bối cảnh đo:
`reports/train-policy-0002.md`.

## Vấn đề

Bản sao behavior cloning (policy-0004) khớp teacher 94 % theo `agreementTieAware`
nhưng khi cả bàn dùng nó, làng thắng 53,8 % so với 60,4 % của chính teacher nó
chép (t = −4,95). Nguyên nhân gốc đã kiểm ở `vote-decision.ts:355-405`: điểm
bầu là tổng 8 số hạng, observation 413 chiều chỉ mang đầu vào của 2 (`belief`,
`trustDamping`); 6 số hạng còn lại model phải đoán. RL 5 vòng và distill theo
điểm đều không thêm được bit thông tin nào — đã thử, đừng lặp lại.

Cách xoá hẳn lớp vấn đề: **model không thay teacher, nó hiệu chỉnh teacher.**

```
adjusted_i = score_i + β · net(obs)[ô hành động của ứng viên i]
```

Residual khởi tạo bằng 0 → policy = heuristic đúng byte. Tệ nhất = heuristic.
PPO chỉ học phần *hơn* heuristic.

## Quyết định

### D1. Điểm nền là điểm THẬT đã dùng — GIỮ jitter

`score_i` là điểm planner/strategy đã chấm, **kể cả term `jitter`**. Lý do:

- Champion-0000 (residual 0, T=0) khi đó là production hôm nay đúng byte, và
  `ai:benchmark` cho Δ `village`/`wolves`/`all` so với `baseline` = 0,0 đúng
  nghĩa đen — tiêu chí xong đo được bằng đẳng thức, không phải "trong nhiễu".
- Cắm lên production sau này không kéo theo quyết định "bỏ jitter" — đó là một
  thay đổi hành vi riêng, ngoài phạm vi PR này.
- PPO vẫn đúng: jitter là một số đã rút và đã ghi; ratio của PPO dùng CÙNG điểm
  nền cho policy cũ và mới nên jitter triệt tiêu trong gradient. Nó chỉ là
  nhiễu thêm vào trạng thái, không phải sai lệch.
- `replayGame` không đổi: dòng RNG = các lần rút jitter (như hôm nay) + đúng
  một lần rút lấy mẫu mỗi quyết định khi T>0. Cùng seed, cùng ván.

Hệ quả: encode rollout phải xuất **điểm có jitter** theo ô hành động
(`bases.f32.bin`) — `scores.f32.bin` (bỏ jitter, nhãn distill) giữ nguyên.
Python dựng lại phân phối cũ từ `bases`, β, τ — không phải từ `scores`.

Nguồn đa dạng trong rollout: jitter (±3, có sẵn) + nhiệt độ τ của lấy mẫu
softmax. Thang điểm là belief 0..100 nên τ phải cùng thang: mặc định khuyến
nghị τ = 5 (chênh 5 điểm → tỉ lệ e⁻¹; chênh 20 → e⁻⁴). τ = 1 gần như argmax.

### D2. β và loại policy nằm TRONG file model

`MlpWeightsJson` thêm trường tuỳ chọn `residual: { beta: number }`. Có nó thì
`loadMlpPolicy` trả `LearnedPolicy.residual = { beta }` và `BotRuntime` tự đi
đường residual; không có thì đi đường logits như hôm nay (policy-0004 vẫn bench
được). Không có cờ `--policy-kind`: một model residual bench với β khác β lúc
train là một con số vô nghĩa, và cờ CLI là chỗ dễ quên nhất. `train_ppo` chép
`residual` từ init sang output; `init_residual.py` tạo champion-0000.

β mặc định 10: net xuất 0,3 dịch ứng viên 3 điểm — thang jitter. Zero-init lớp
`policyHead` nên đầu ra ban đầu là 0 với mọi obs; trunk và value head chép từ
policy-0004 để giữ đặc trưng đã học (tuỳ chọn `--fresh` cho trunk ngẫu nhiên).

### D3. Seam đêm: `NightPolicyModel` cắm vào `rankNightTargets`

Ngày đã có seam (`PolicyModel` nhận bảng đã chấm). Đêm chưa: strategy trả một
intention. Nhưng 7 vai có bảng đều đi qua `rankNightTargets` rồi lấy
`scored[0]` — đó là chỗ đặt seam.

```ts
export interface NightPolicyModel {
  readonly name: string;
  /** Bảng ĐÃ CHẤM của một loại hành động; trả targetId thuộc bảng, hoặc null = giữ thứ tự heuristic. */
  selectTarget(action: NightActionKind, candidates: ReadonlyArray<{ targetId: string; score: number }>): string | null;
}
```

- `BotRoleStrategy.decideNight(context, state, rng, probe?, policy?)` — tham số
  thứ 5 tuỳ chọn; vai không dùng thì bỏ qua, byte một.
- `rankNightTargets(candidates, { …, action, policy })`: chấm, sort như cũ, rồi
  nếu `policy` trả một id khác `ranked[0]` thì **đưa id đó lên đầu**, phần còn
  lại giữ thứ tự. `scored[0]` vẫn là người thắng, `scored[1]` vẫn là dự bị
  (mục tiêu phụ của sự kiện, mục tiêu thứ hai của Thám Tử) — không vai nào đổi
  code đọc kết quả.
- Vai đi qua seam: Sói (+Sói Con, Alpha), Tiên Tri (+Tập Sự), Bảo Vệ, Pháp Sư,
  Sát Nhân, Theo Dõi, Thám Tử (residual chọn người thứ nhất, người thứ hai là
  tốt nhất còn lại — không còn lý do loại Thám Tử như `selectLearnedNight`).
- **Phù Thuỷ giữ heuristic**: HEAL/POISON/SKIP chọn theo ngưỡng, không có bảng
  ứng viên nhiều người để hiệu chỉnh. Ghi rõ, không vá.
- Cổng phía sau vẫn thuộc vai: Sát Nhân "đêm yên" đọc `best.score <= 0` với
  `best` là lựa chọn của residual; nếu nó rẽ sang SKIP thì `run.finish` thấy
  nước đi ≠ nước đề xuất và **không ghi `learned`** — đúng luật hiện hành.

### D4. `residualPolicyModel` cho VOTE và NIGHT — một lõi, hai vỏ

File mới `policy/residual-policy.ts`:

- `residualVotePolicy(policy, weights, options, onPick): PolicyModel<VoteScoringFrame>`
  — dựng observation như `learnedPolicyModel` (cùng `beliefAfter`), ánh xạ mỗi
  ứng viên → ghế → `actionIndexOf("CHOOSE", ghế)`, cộng `β·logits[ô]`.
- `residualNightPolicy(policy, weights, context, state, rng, options, onPick): NightPolicyModel`
  — observation "NIGHT" dựng LƯỜI ở lần `selectTarget` đầu (strategy có thể
  không chấm bảng), ô = `actionIndexOf(action, ghế)`.
- Lõi chung `pickResidual(rows, temperature, rng)`:
  - T = 0: argmax theo `adjusted` giảm dần, hoà thì `targetId.localeCompare`
    tăng dần — **đúng tie-break của heuristic**, không phải theo thứ tự ghế
    (ghế xếp theo `localeCompare` rồi xoay về self nên hai thứ tự khác nhau;
    "p10" < "p2"). `logProb` tính ở τ = 1 (cùng quy ước `sampleMasked`).
  - T > 0: lấy mẫu softmax(adjusted/τ) qua `rng` của bot (đã đi qua
    `wrapRngForTrace`), `logProb` của chính phân phối đó. Đúng MỘT lần rút.
  - Phân phối CHỈ trên tập ứng viên (không phải toàn mask encoder): ô "không
    treo ai" và các loại đêm khác không thuộc bảng nên không có xác suất.
- `LearnedPick` thêm `beta?: number`; residual luôn điền. Encode đọc nó để biết
  tập là residual. `value` vẫn từ value head.
- Tận dụng `LearnedPolicy.logits` (187 chiều) làm residual; không kiến trúc mới;
  observation 413 / hành động 187 không đổi.

`BotRuntime`: `learnedPolicy.residual` có mặt → `decideVote` dùng
`residualVotePolicy` (vẫn sau `votePolicy` tường minh), `decideNight` truyền
`residualNightPolicy` vào `strategy.decideNight(...)`; không có → đường cũ.
`learnedDecisions` (vote/night/both) áp dụng như cũ. Luật "chỉ ghi `learned`
khi nước đề xuất CHÍNH LÀ nước đã đi" giữ nguyên.

### D5. Rollout → encode: đủ để Python dựng lại phân phối cũ

`ai:encode --rollout`, khi line `learned` đầu tiên có `beta`:

- ghi thêm `bases.f32.bin` (N × 187): `candidate.score` **có jitter** đặt vào ô
  hành động của ứng viên, NaN ở ô khác — hàm mới `candidateBases` cạnh
  `candidateScores` trong `learning/dataset.ts`, chỉ khác ở chỗ không trừ term
  jitter;
- `meta.policyKind = "residual"`, `meta.beta`, `meta.temperature`;
- TỪ CHỐI line có `beta` hoặc `temperature` khác line đầu (tập trộn hai policy
  là một tập PPO sai; hôm nay τ trộn cũng đã lọt qua — vá luôn);
- TỪ CHỐI (như cũ) khi nhãn encoder lệch `learned.actionIndex`.

Bằng chứng ở tầng engine: test dựng rollout T>0 với policy giả có logits biết
trước, tính lại `log softmax((bases + β·logits)/τ)[a]` từ đúng dữ liệu encode
xuất, so bằng `learned.logProb` (sai số 1e-9). Đó là điều kiện để
`approxKl` batch đầu ≈ 0 trên dữ liệu thật, kiểm được trước khi chạy 900 ván.

### D6. PPO cho residual

`data.py`: `bases` tuỳ chọn (như `scores`), cùng kiểm kích thước.
`train_ppo.py`, khi `d.bases is not None`:

```
cand   = ~isnan(bases)                      # mask = tập ứng viên
adj    = (nan_to_num(bases) + β·net(x)) / τ
logp   = log_softmax(adj.masked_fill(~cand, MASK_FILL))
```

ratio, clip, entropy đều trên `logp` này; `agreementWithInit` cũng đo argmax
của `adj`. β đọc từ `meta.beta` và phải bằng `init.residual.beta` (assert). τ từ
`meta.temperature`. Khẳng định mọi hàng có `bases[a]` hữu hạn; không thì tập
không nhất quán, dừng. Không parse trajectory, không luật game — vẫn gom
baseline theo `roles`.

`export.py`: `residual` đi kèm payload khi có. `init_residual.py` (mới):
`--from <model.weights.json> --out <path> --beta 10 --model-id residual-0000
[--fresh]` — chép trunk/value/tên đặc trưng, zero `policyHead`.

`test_ppo.py` thêm ca residual tổng hợp: bases ngẫu nhiên có NaN ngoài ứng
viên, β, τ; `logprobs` tính bằng đúng công thức từ init; kiểm `approxKl` epoch
1 < 1e-4, xác suất hành động thắng tăng, ô NaN giữ xác suất 0.

### D7. `rl_loop.py`

Chạy nguyên vẹn với champion residual (model tự khai). Đổi: benchmark mỗi vòng
`--setups baseline,village,wolves,all`; `--temperature` truyền như cũ (chạy
thật với 5). `score_of` giữ `(Δvillage + Δwolves)/2` — `all` chỉ để đọc cân
bằng, không thăng hạng theo nó.

### D8. Không đổi ở production

`session-registry.ts` không đổi. Rollout chạy cục bộ 16 lõi, không lên CI.

## Ngoài phạm vi

- Residual cho Phù Thuỷ, FINAL_VOTE, SPEECH, Thợ Săn.
- Residual đổi LOẠI hành động đêm (SKIP thay KILL…): chỉ đổi thứ tự trong
  bảng của loại heuristic đã chọn.
- Bỏ jitter ở production; opponent pool; GPU.

## Tiêu chí xong

- Engine: residual 0, T=0 → `runSelfPlay` cho `actions`/`winner`/`events`
  byte-identical với heuristic cùng seed, cả VOTE lẫn NIGHT, ở 20 seed.
- Rollout: T=1 ghi `learned` cho cả VOTE và NIGHT; `replayGame` tái lập;
  `ai:encode --rollout` TỪ CHỐI 0; `logProb` tái tính từ `bases` khớp.
- `ai:benchmark` champion-0000 `--setups baseline,village,wolves,all`: Δ = 0,0
  đúng ở cả ba.
- `test_ppo`: `approxKl` epoch 1 ≈ 0 với dữ liệu residual tổng hợp.
- `rl_loop` ≥ 3 vòng thật (900 ván/vòng, bench 3×300), bảng
  `village`/`wolves`/`all` ± SE theo vòng vào `reports/train-policy-0002.md`
  mục mới và comment PR.
- `npm run build`, `npm run lint` mã thoát 0; vitest engine + server xanh; 4
  test Python `ok`.
