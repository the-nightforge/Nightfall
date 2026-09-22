# Model cho bàn 8–12 người (dự án M)

Ngày: 2026-09-22. Tiền đề: `village-ppo-0001` (spec 2026-09-17), sửa bàn lớn
(PR the-nightforge/Nightfall#118), hạ tầng của dự án B (spec 2026-09-19).

## Vì sao

Mọi model đã ship chỉ train trên preset 8 người, nên từ PR #118 model chỉ chạy
ở bàn 8 người (`LEARNED_TABLE_SIZE`); bàn khác là heuristic. Người duyệt cho biết
phần lớn phòng production là bàn 9–12+, tức model gần như không giúp được ai.

Đo 2026-09-22 (`village-ppo-0001`, T=0,5, 3 × 200 ván mỗi cỡ, so heuristic):

| Cỡ | Làng dùng model | Sói dùng model | Làng thắng cả bàn bot: heuristic → model |
|---|---|---|---|
| 9 | −3,0 ± 1,0 | +16,2 | 48,0 % → 38,7 % |
| 10 | −1,3 ± 1,7 | +10,0 | 49,8 % → 42,0 % |
| 11 | −0,5 ± 1,0 | +12,7 | 43,8 % → 40,0 % |
| 12 | −2,2 ± 2,2 | +6,5 | 38,8 % → 27,3 % |

Model chưa từng thấy bàn lớn: làng không hơn heuristic, sói mạnh vượt trội và
phá cân bằng mà preset hiệu chỉnh bằng heuristic self-play. Preset 9–12 có năm
vai bàn 8 không có: Sói Con, Kẻ Bị Nguyền, Kẻ Phản Bội, Truy Vết, Thị Trưởng.

Mục tiêu: một model mạnh hơn heuristic ở mọi cỡ 8–12 mà KHÔNG phá cân bằng.

Ngoài phạm vi: bàn 13–20 (lượt sau, cùng quy trình; 17–20 cần encoder > 16
ghế), train riêng lượt đêm, server nạp hai model cùng lúc (làm khi D8 cần).

## Quyết định

### D1. Cỡ bàn được phép nằm trong file model

Đổi thẳng `LEARNED_TABLE_SIZE` thành 8–12 sẽ bật `village-ppo-0001` ở bàn 9–12 —
đúng thứ PR #118 vừa chặn. Thay vào đó:

- `MlpWeightsJson.tableSizes?: number[]`; `LearnedPolicy.tableSizes: readonly number[]`.
- Vắng → `[8]` (mọi model cũ: bc-0002, ppo-0001 giữ nguyên hành vi, không sửa file).
- Loader ném khi `tableSizes` rỗng, có phần tử không phải số nguyên, < 1 hoặc
  > `DEFAULT_MAX_SEATS`.
- `BotRuntime.learnedFor` hỏi `policy.tableSizes.includes(số người)` thay cho
  `=== LEARNED_TABLE_SIZE`; hằng `LEARNED_TABLE_SIZE` bỏ đi.
- `train_bc` / `train_ppo` / `export.py` ghi `tableSizes` từ `meta.json` của
  dataset (danh sách cỡ bàn đã sinh); script đóng gói ghi đè bằng tập cỡ ĐẠT
  confirm (D7).

### D2. Dataset-0006: trộn 8–12 người

- `make_dataset.py --players 8,9,10,11,12` (mặc định `8`): mỗi cỡ một nhóm shard
  `p{n}-shard-{i}`, seed `{seed}-p{n}-{i}`, resume từng shard như hiện nay.
- Mặc định 2 shard × 1.000 ván mỗi cỡ = 10.000 ván, công thức dataset-0004
  (`--preset --defense --no-jitter`).
- `ai-encode` ghi `tableSizes` (các `playerCount` thấy trong trajectory, sort)
  vào `meta.json`; `datasetVersion` = `dataset-0006`.
- Kiểm: `ai:validate-dataset` sạch; có dòng NIGHT của `TRACK`, và có lượt của
  WOLF_CUB, CURSED, TRAITOR, MAYOR.

### D3. BC → `village-bc-0004`

Cờ P0 của `train_bc_local.ipynb`, chỉ đổi đường dẫn. Cổng (mọi cỡ 8–12):

1. `test.agreementTieAware` ≥ 0,92 ở MỖI cỡ (`metrics.byTableSize`, mới).
2. So heuristic ở mỗi cỡ (T=0, 3 × 200 ván): mỗi phe trong ±2 điểm — BC là bản
   sao teacher, không mạnh hơn cũng không yếu hơn.
3. Bàn 8, đối đầu với bc-0003 (`--opponent`, 5 seed): mỗi phe ≥ −1.

`train_bc` thêm `metrics.byTableSize` (tieAware theo cỡ); cỡ đọc từ một cột
`table_sizes` mà `ai-encode` ghi cùng tensor (`tableSize.u8.bin`).

### D4. RL: rollout rải theo cỡ bàn

- `rl_loop --players 8,9,10,11,12` (mặc định `8` — hành vi cũ byte một).
- Mỗi vòng `--games` ván chia đều 3 nhóm ghế × các cỡ; seed
  `rl-{vòng}-{ghế}-p{n}`; phần rollout `roll-{ghế}-p{n}`, gộp như hiện nay.
- `--opponent` giữ nguyên nghĩa (chỉ rollout phe đang train).
- PPO không đổi.

### D5. Chấm điểm theo cỡ bàn

- Mỗi lần chấm: `ai:benchmark --players n` cho TỪNG cỡ, `--games 200 --repeat 3`,
  4 setup. File `bench-p{n}.json`.
- `BenchRead` theo cỡ; điểm tổng = TRUNG BÌNH điểm các cỡ.
- Thăng hạng khi ĐỦ:
  1. điểm tổng > champion + 2 trên MỌI bộ seed (luật cũ);
  2. không cỡ nào: điểm cỡ đó < điểm champion ở cỡ đó − 2 (bộ seed chính);
  3. cổng phe kia như cũ, trên điểm tổng (bộ seed chính);
  4. cân bằng (chỉ khi `--balance-per-size` bật): ở mọi cỡ,
     `imbalance(model) ≤ imbalance(heuristic) + 2` — cả hai đọc từ CÙNG file
     bench (setup `all` và `baseline`), không so khác bộ seed.
- Champion lưu điểm theo cỡ trong `state.json` (`championBySize`).

### D6. Stage (`rl_stages --project m`)

| Stage | Từ | Cờ thêm |
|---|---|---|
| `m-village` 20 vòng | bc-0004 | `--players 8,9,10,11,12 --side village`, cờ D11 |
| `m-wolves` 20 vòng | champion `m-village` | như trên, `--side wolves --shaping-decisions vote --balance-per-size` |
| `confirm` | champion xa nhất | D7 |

Cờ D11 (`--bench-every 10 --balance-slack -1`) giữ nguyên; `--balance-slack -1`
tắt cổng cân bằng TỔNG, `--balance-per-size` là cổng riêng ở stage sói — làng
mạnh lên ở bàn 9–12 là cân bằng TỐT lên (heuristic cho làng 39–50 %), sói mạnh
lên là thứ đã phá ppo-0001.

### D7. Confirm và đóng gói

Seed `confirm-0922`, T=0,5, 5 × 200 ván mỗi cỡ, 4 setup; bàn 8 thêm đối đầu với
ppo-0001. Một cỡ ĐẠT khi đủ:

1. không phe nào < heuristic − 1;
2. ít nhất một phe ≥ heuristic + 2;
3. `imbalance(all) ≤ imbalance(baseline) + 2` (cùng file);
4. 0 vi phạm;
5. (chỉ bàn 8) đối đầu với ppo-0001: làng ≥ −1 và sói ≥ −1.

`confirm` in bảng đạt/trượt theo cỡ và dòng `tableSizes: [...]` = các cỡ đạt.
Đóng gói `village-ppo-0002` với đúng `tableSizes` đó:

- đạt cả 8 → ship, `BOT_POLICY_FILE` trỏ ppo-0002;
- trượt 8 nhưng đạt ≥ 1 cỡ 9–12 → cần server nạp hai model (D8), chưa ship;
- không cỡ nào đạt → không ship; ghi kết quả vào spec này.

### D8. Rollback và rủi ro

- Rollback = `BOT_POLICY_FILE` về `village-ppo-0001` (vẫn chỉ bàn 8 nhờ `[8]`).
- Nếu ppo-0002 trượt bàn 8: thêm `BOT_POLICY_FILES` (danh sách, model đầu tiên
  có cỡ bàn trong `tableSizes` thắng). Không làm trước khi cần.
- Sói lại mạnh vượt trội: cổng D5.4 chặn thăng hạng; champion làng vẫn dùng được.

## Thời gian (ước lượng, đo lại ở lần chạy thử)

| Bước | Máy người dùng | Kaggle |
|---|---|---|
| Dataset-0006 + encode | ~1,5–2 giờ | ~2,5–3 giờ |
| BC + benchmark theo cỡ | ~2 giờ | ~3 giờ |
| Một stage RL (20 vòng + chấm) | ~7–9 giờ | ~11–15 giờ (1–2 phiên) |
| Confirm | ~2 giờ | ~3 giờ |

Kaggle CHẬM hơn máy người dùng (đo trước: ~16 so với ~10 phút/vòng 3.000 ván bàn
8); lợi ích là chạy không cần mở máy. `train_rl_kaggle.ipynb` cập nhật cho
project `m` (một stage mỗi phiên, 11 giờ, chạy tiếp từ output phiên trước), kèm
hướng dẫn từng bước.

## Kiểm chứng

- `mlp`: `tableSizes` vắng → `[8]`; `[8..12]` nạp được; rỗng / không nguyên /
  > 16 → ném.
- `BotRuntime`: model `[8..12]` chạy ở bàn 10, không chạy ở bàn 13; model không
  `tableSizes` chỉ chạy ở bàn 8. Benchmark ppo-0001 bàn 8 và 12 y hệt trước/sau.
- `ai-encode`: `meta.tableSizes` đúng; `tableSize.u8.bin` khớp số dòng.
- `train_bc`: `metrics.byTableSize` có mỗi cỡ; `export.py` ghi `tableSizes`.
- `make_dataset --players`: shard theo cỡ, resume bỏ shard xong.
- `rl_loop`: `rollout_cmd`/`bench_cmd` sinh đúng `--players` và seed; cổng D5
  (trung bình, không cỡ tụt > 2, cân bằng theo cỡ bật/tắt); `--players 8` sinh
  lệnh như trước.
- `rl_stages --project m`: tên thư mục, cờ; `confirm_m` in đạt/trượt theo cỡ và
  `tableSizes`.
- Kaggle: phiên thử 2 vòng × 300 ván trước phiên thật.
