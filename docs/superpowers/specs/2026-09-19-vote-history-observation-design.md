# Dự án con B: lịch sử phiếu trong observation

Ngày: 2026-09-19. Tiền đề: `village-ppo-0001` (spec 2026-09-17, dự án con A).

## Vì sao

Chẩn đoán 2026-09-19 (self-play 1.000 ván, 8 người, cùng seed `diag-0919`,
`.tmp/diag-ppo/`):

| | heuristic | ppo cả bàn | ppo chỉ sói |
|---|---|---|---|
| Sói bỏ phiếu tố đồng bọn | 11,5 % | **0,0 %** | **0,0 %** |
| Sói "đánh nhau giả" | 9,1 % | **0,0 %** | **0,0 %** |

Sói PPO không bao giờ bỏ phiếu chống đồng bọn — một "tell" người chơi thật đọc
được ngay ("hai người này chưa bao giờ vote nhau"). Nó thắng được vì làng bot
KHÔNG thấy lịch sử phiếu: observation 413 chiều chỉ có `voteShare` của vòng
hiện tại và điểm nghi của lõi heuristic. Lõi bot đã có sẵn
`BotKnowledgeView.publicVoteHistory` (công khai); chỉ encoder chưa đưa vào.

Mục tiêu: làng học được đọc lịch sử phiếu và trừng phạt sói "trung thành tuyệt
đối"; sói, gặp làng như vậy, buộc phải học ngụy trang.

Ngoài phạm vi: lời nói có cấu trúc (ai tố ai, ai nhận vai gì), thứ tự chết,
mọi tín hiệu công khai khác (phương án 2/3 của buổi brainstorm) — để sau nếu B
thành công.

## Quyết định

### D1. Chiều mới nối vào CUỐI vector; model cũ đọc tiền tố

`mlp.ts` hiện đòi `featureNames` khớp tuyệt đối. Nếu giữ luật đó, đổi encoder
làm `village-ppo-0001` và `village-bc-0002` hết nạp được: mất rollback
production và không đấu đối đầu được (D5).

- Mọi chiều mới nằm SAU khối theo ghế hiện tại; 413 chiều cũ giữ nguyên tên,
  thứ tự, ý nghĩa.
- Luật nạp mới: model hợp lệ khi `featureNames` của nó là TIỀN TỐ của
  `observationFeatureNames()` hiện tại (vẫn ném khi lệch ở bất kỳ vị trí nào
  trong phần tiền tố, hoặc dài hơn encoder).
- Suy luận đưa vào model `features.slice(0, inputSize)`. Một chỗ duy nhất làm
  việc cắt (nơi policy chạy forward), không rải ở các tầng gọi.
- Encoder vẫn một bản; không có "encoder v1/v2".

### D2. Chiều mới (phương án 3 của brainstorm: tóm tắt theo ghế + một ma trận)

Nguồn duy nhất: `publicVoteHistory: DayVoteRecap[]` (ngày đã XONG; ngày đang
diễn ra đã có ở `voteCounts`) cộng `knownRoles` cho "vai đã lộ". Ghế theo
`canonicalSeats` (xoay để bot ở ghế 0), ghế trống = 0, như khối hiện tại.

Tóm tắt theo ghế, `maxSeats × 8`, tên `hist:seat{i}:{feature}`, mỗi chiều ∈ [0, 1]:

| feature | nghĩa | mẫu số |
|---|---|---|
| `votesCast` | số phiếu ban ngày chốt (`finalBallots`, choice PLAYER) | số ngày đã xong |
| `votedRevealedWolf` | phiếu trúng người mà observation biết là phe sói | `votesCast` thô |
| `votedRevealedVillage` | phiếu trúng người biết là phe làng | `votesCast` thô |
| `votedWithMajority` | phiếu trúng người bị đưa ra toà (`nomination.TRIAL`) | `votesCast` thô |
| `voteChanges` | `mutations` có `previousChoice ≠ null` của ghế này | số ngày đã xong |
| `guiltyBallots` | phiếu Treo ở `finalJudgment` | số phiên toà ghế này đã bỏ phiếu |
| `innocentBallots` | phiếu Tha ở `finalJudgment` | như trên |
| `maxMutualAvoidance` | max trên các ghế j còn sống ≠ i của: số ngày cả i và j cùng bỏ phiếu PLAYER mà không ai vote người kia, chia số ngày đã xong | số ngày đã xong |

"Biết là phe sói/làng" = `knownRoles` của CHÍNH bot (vai lộ khi chết, đồng bọn
của sói, kết quả soi đã vào knownRoles) — không phải vai thật. Mẫu số 0 → 0.

Ma trận, `maxSeats × maxSeats`, tên `hist:vote:{i}>{j}`: (số ngày i chốt phiếu
ban ngày vào j + số phiên toà i bỏ phiếu Treo khi j là bị cáo) / (2 × số ngày
đã xong), kẹp [0, 1].

Tổng: 16 × 8 + 16 × 16 = 384 chiều → observation 797 (maxSeats 16).

### D3. Dữ liệu đi qua đúng một đường

- `TraceKnowledgeSnapshot` thêm `publicVoteHistory?: DayVoteRecap[]` (optional:
  trace cũ thiếu → lịch sử rỗng → 384 chiều bằng 0), chép từ knowledge view
  bằng `copyDayVoteRecap` sẵn có.
- `observationFromTrace` đưa nó vào `ObservationInput.observation`. Đây là hàm
  DUY NHẤT dựng observation cho cả trajectory lẫn `buildLiveObservation` — train
  và runtime không thể lệch nhau.
- Không đọc `GameState`; chỉ knowledge view đã lọc quyền (ràng buộc §6).

### D4. Bàn trộn: mỗi phe một model

- `SelfPlayInput.opponentPolicy?: LearnedPolicy`: ghế KHÔNG thuộc `learnedSeats`
  dùng `opponentPolicy` thay cho heuristic. `learnedSeats = "all"` kèm
  `opponentPolicy` → ném (không còn ghế nào cho đối thủ).
- Nhiệt độ và `learnedDecisions` dùng chung.
- Record replay thêm `opponentPolicyId`; replay đòi đúng model đó, như
  `learnedPolicyId`.
- Trajectory chỉ ghi từ ghế dùng `learnedPolicy` (policy đang train). Ghế đối
  thủ không sinh dòng train — PPO không được học từ logProb của model khác.
- `selfplay.ts --opponent-policy <file>`.

### D5. Benchmark đối đầu

`ai-benchmark.ts --opponent <file>` và ba setup, cùng seed:

| setup | làng | sói |
|---|---|---|
| `h2h-village` | model | đối thủ |
| `h2h-wolves` | đối thủ | model |
| `opponent` | đối thủ | đối thủ |

In hai hiệu ghép theo seed: **Δ làng đối đầu** = `h2h-village − opponent`;
**Δ sói đối đầu** = `opponent − h2h-wolves`. Setup `h2h-*`/`opponent` thiếu
`--opponent` → ném.

### D6. Pipeline train

1. **Dataset-0005**: công thức dataset-0004 (README: 10.000 ván, 8 người,
   `--preset --defense --no-jitter`, seed `bc`) trên encoder mới.
   `ai:validate-dataset` phải cho 0 lỗi và 384 chiều `hist:*` khác 0 ở ≥ 1 dòng
   (kiểm dây dẫn dữ liệu).
2. **BC → `village-bc-0003`**: cờ P0 của `train_bc_local.ipynb`. Cổng:
   `test.agreementTieAware` ≥ 0,923 (bc-0002 là 0,928, trừ 0,005) và benchmark
   `all − teacher` không tệ hơn bc-0002 quá 1 điểm. Teacher là heuristic, vốn
   không dùng lịch sử phiếu trực tiếp: BC gần như bỏ qua chiều mới — nó chỉ là
   điểm xuất phát ngang bc-0002, cải thiện phải đến từ RL.
3. **RL** (`rl_stages.py`, cờ v3/D11 của spec 2026-09-17 giữ nguyên):
   - `rl_loop --opponent <model>`: rollout của phe đang train (`--learned-seats
     village`/`wolves`) gặp đối thủ ở phe kia thay cho heuristic. Rollout `all`
     không đổi.
   - Stage `b-village`: từ `village-bc-0003`, `--opponent village-ppo-0001`
     (sói có "tell" để học cách bắt).
   - Stage `b-wolves`: từ champion `b-village`, KHÔNG `--opponent` — rollout
     `all` đã cho sói gặp làng B đọc được phiếu.
   - Cổng thăng hạng trong vòng lặp vẫn so với heuristic như A, để model không
     chỉ học đánh ppo-0001.
   - `rl_stages`: `CHAMPION0` và tên thư mục thành tham số theo dự án
     (`--project b`), không nhân bản file.

### D7. Confirm ở nhiệt độ production

Chẩn đoán cho thấy argmax (T=0) làm méo cân bằng: ppo-0001 cả bàn cho làng
57,8 % ở T=0 nhưng 54,3 % ở T=0,5 (bc-0002: 54,4 %). Confirm của B chạy
`--temperature 0.5` (= `DEFAULT_BOT_POLICY_TEMPERATURE`), seed mới
`confirm-0919`, 5 × 300 ván, cả hai model.

## Tiêu chí thành công

Trên confirm D7, đóng gói `village-ppo-0002` khi ĐỦ:

1. **Đối đầu**: Δ làng đối đầu (B so với ppo-0001, cùng gặp sói ppo-0001) ≥ +2.
2. **Không thụt lùi**: so với heuristic, mỗi phe của B ≥ phe tương ứng của
   ppo-0001 − 1.
3. **Cân bằng**: `imbalance(all)` của B ≤ của ppo-0001 + 1 (cùng T=0,5, cùng seed).
4. 0 vi phạm luật.

Theo dõi, không chặn: `wolfSelfSabotage` và `wolfFakeFightRate` của sói B (kỳ
vọng > 0), Δ sói đối đầu.

Không đạt → production giữ `village-ppo-0001`. Rollback sau deploy = đổi
`BOT_POLICY_FILE` (mọi model cũ vẫn nạp được nhờ D1).

## Kiểm chứng

- `mlp`: model 413 chiều nạp được trên encoder 797 chiều và cho ĐÚNG cùng hành
  động như trước thay đổi trên một bộ observation cố định (khoá rollback);
  `featureNames` lệch trong phần tiền tố hoặc dài hơn encoder → ném.
- `observation`: lịch sử rỗng → 384 chiều 0; một lịch sử dựng tay cho đúng từng
  chiều D2 (gồm `maxMutualAvoidance`, mẫu số 0, ghế trống, xoay ghế); không đọc
  vai thật (vai chưa lộ không vào `votedRevealed*`).
- `trajectory`: trace cũ thiếu `publicVoteHistory` vẫn đọc được; live và trace
  cho cùng vector.
- Self-play: bàn trộn — ghế đúng policy id trong trace, trajectory chỉ từ ghế
  `learnedPolicy`, replay tất định có `opponentPolicy`, `"all"` + đối thủ ném.
- Benchmark: parse `--opponent`; `h2h-*` thiếu `--opponent` ném.
- `rl_loop`: `rollout_cmd` truyền `--opponent-policy` chỉ cho rollout phe;
  `rl_stages --project b` ra đúng CHAMPION0/thư mục.

## Kế hoạch chạy (người dùng chạy)

| Bước | Ước lượng (local) |
|---|---|
| Dataset-0005 + encode + validate | ~1–2 giờ |
| BC `village-bc-0003` + benchmark | ~1–2 giờ |
| `b-village` 20 vòng | ~6 giờ |
| `b-wolves` 20 vòng | ~6 giờ |
| Confirm (D7) | ~1–2 giờ |
