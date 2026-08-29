# Thiết kế Cảnh báo Cân bằng & Hệ thống Sự kiện Mở rộng 15 Events (Balance Warning & Events v2)

> **Ngày tạo:** 2026-08-30  
> **Trạng thái:** Đã duyệt thiết kế — chờ viết kế hoạch triển khai  
> **Phạm vi:** `packages/shared`, `packages/game-engine`, `apps/server`, `apps/web`  
> **Tiền thân:** `2026-08-29-roles-and-events-balance-design.md` (12 roles, 9 events) — migrate cứng 9→15

---

## 1. Mục tiêu

1. **Cảnh báo cân bằng lobby:** Phát hiện cấu hình role mất cân bằng theo số người chơi (preset chuẩn 6–15), hiển thị `BalanceScore 0–100` + banner cảnh báo; chặn `room:start` ở mode `RANKED` khi lệch nặng, cho phép ở `CHAOS/CUSTOM` chỉ warning.
2. **Mở rộng Event Pool 9→15:** Migrate cứng `SHROUDED_ECLIPSE → WOLF_SHADOW`, thêm 6 event mới (`LAST_STAND`, `DAY_OF_TRUTH`, `HOWL_OF_THE_PACK`, `BLOOD_MOON`, `MORNING_REPORT`, `DEAD_CAN_SPEAK`) với 2 state xuyên round (`pendingLastStand`, `bloodMoonArmed`).
3. **Tối ưu cân bằng động:** Thống nhất công thức `FactionPower` cho cả `BalanceScore` (warning) và `Momentum` (event balancer), tránh double source of truth.

---

## 2. Kiến trúc & File Structure

```
packages/shared/
  src/balance.ts              # NEW: ROLE_POWER table, FactionPower, BalanceScore, PRESET_DECKS 6–15, generateWarnings()
  src/events.ts               # MODIFY: GameEventId 9→15 (xóa SHROUDED_ECLIPSE, thêm 6 mới)
  src/snapshot.ts             # ADD: BalanceWarningView {score, warnings[], blocking}, LastStandView, DayOfTruthClaims

packages/game-engine/
  src/balance/analyzer.ts     # NEW: calculateFactionPower(state), calculateBalanceScore(state), generateWarnings(config, playerCount)
  src/balance/presets.ts      # NEW: PRESET_DECKS 6–15 (từ spec §4)
  src/events/eventManager.ts  # REWRITE: 15 defs, pending flags, broadcast logic
  src/events/momentum.ts      # MODIFY: dùng analyzer thay vì weights hardcode
  src/types.ts / engine.ts    # ADD: pendingLastStandVictim, bloodMoonArmed, deadCanSpeakUsed, dayOfTruthClaims, howlBonusDay

apps/server/
  src/rooms/snapshot.ts       # EXPOSE: balanceWarning, pendingLastStand vào RoomSnapshot
  src/rooms/service.ts        # VALIDATE: chặn room:start nếu blocking && mode===RANKED
  src/bots/*                  # Cập nhật context.activeEvent, giảm trust SEER khi WOLF_SHADOW

apps/web/
  src/lib/balance.ts          # NEW: client preview (re-export shared/balance)
  src/components/RoleDeckPanel.tsx  # ADD: BalanceMeter, WarningBanner, nút Áp dụng preset
  src/components/EventBanner.tsx    # EXTEND: 15 icons + announcement
  src/components/DayViews.tsx / NightPanel.tsx  # HANDLE: LAST_STAND badge, DAY_OF_TRUTH modal, MORNING_REPORT, DEAD_CAN_SPEAK input
```

Tất cả tính toán balance là pure function, test độc lập, dùng chung client/server.

---

## 3. Cảnh báo cân bằng (Balance Warning)

### 3.1 Công thức

```
FactionPower = 0.20*population + 0.20*rolePower + 0.20*info + 0.20*kill + 0.10*protect + 0.10*control + eventPower
VillageAdv   = FactionPower_village - FactionPower_wolves
BalanceScore = clamp(50 + VillageAdv*10, 0, 100) // 50 = cân
ROLE_POWER: WEREWOLF 5.0, SEER 5.0, WITCH 5.0, VILLAGER 0.5 ... (từ spec §1)
```

### 3.2 Ngưỡng & Hành vi

| Score | Trạng thái | Màu | Chặn Start (RANKED)? |
|-------|------------|-----|----------------------|
| 45–55 | Balanced | xanh | Không |
| 40–44 / 56–60 | Warning | vàng | Không, hiện gợi ý |
| <40 / >60 hoặc |wolfRatio - presetRatio|>0.15 hoặc infoPower lệch ≥3 | Blocking | đỏ | **Có**, trả `BALANCE_UNSTABLE` |

Gợi ý sinh tự động: diff giữa `config` hiện tại và `PRESET_DECKS[playerCount]` → list “Thay 1 VILLAGER bằng GUARDIAN_ANGEL”, “Thêm 1 WOLF_CUB”, “Bớt 1 WITCH”.

### 3.3 Flow

1. Client `RoleDeckPanel` mỗi toggle/đổi playerCount → gọi `calculateBalanceScore(config, playerCount)` → render `BalanceMeter` + `WarningBanner` + nút “Áp dụng preset chuẩn”.
2. Server `roomService.updateConfig` và `roomService.start` gọi `validateBalance(config, playerCount, mode)` — nếu `mode===RANKED && blocking` → throw `BALANCE_UNSTABLE`; `CHAOS/CUSTOM` chỉ warning.

---

## 4. Event Pool 15

### 4.1 Danh mục

| ID | Tên | Phe | Power | Phase | Hiệu ứng | Non-stack |
|----|-----|-----|-------|-------|----------|-----------|
| `CLEARING_MIST` | Màn Sương Tan | village | 3 | NIGHT | Seer/Apprentice soi 2, cần seer alive | — |
| `PEACEFUL_NIGHT` | Đêm Bình Yên | village | 4 | NIGHT | Hủy kill chính sói, 1 lần/ván | — |
| `JUDGMENT_DAY` | Ngày Phán Xét | village | 3 | DAY | Broadcast `detectiveResults.last` | — |
| `LAST_STAND` | Tử Thủ | village | 3 | NIGHT→DAY | Nạn nhân sói cắn sống tới hết ngày sau, `pendingLastStandVictim={id, dieAtEndOfDay}`; heal không kéo dài | — |
| `DAY_OF_TRUTH` | Ngày Sự Thật | village | 2 | DAY | Claim role công khai (không xác thực) | — |
| `MOONLESS_NIGHT` | Đêm Không Trăng | wolves | 3 | NIGHT | Khóa SEER/APPRENTICE, không khóa Detective | — |
| `BLOODY_HUNT` | Cuộc Săn Đẫm Máu | wolves | 4 | NIGHT | Thêm phụ 50% chết, 1 lần/ván, không stack với `wolfCubRage` | mutex với Cub |
| `HOWL_OF_THE_PACK` | Tiếng Hú Bầy Sói | wolves | 3 | DAY | +1 hidden vote cho sói ngày kế tiếp, lưu `howlBonusDay` | — |
| `BLOOD_MOON` | Trăng Máu | wolves | 3 | NIGHT | Nếu đêm hiện tại 0 death do sói cắn, arm `bloodMoonArmed`; đêm sau 20% xuyên 1 shield | 1 lần/ván |
| `WOLF_SHADOW` | Bóng Sói | wolves | 3 | NIGHT | Đảo 30% kết quả seer (`isWolf = !true`), không ảnh hưởng Detective | thay SHROUDED |
| `CURFEW` | Lệnh Giới Nghiêm | neutral | 1 | DAY | Giảm 50% discussion | — |
| `SILENT_NIGHT` | Đêm Tĩnh Lặng | neutral | 1 | NIGHT | Sói không chat, chỉ vote | — |
| `AMNESTY_DAY` | Ngày Hòa Hoãn | neutral | 2 | DAY | Skip VOTING → NIGHT, không liên tiếp | — |
| `MORNING_REPORT` | Bản Tin Bình Minh | neutral | 2 | DAY_START | Broadcast 1–2 dòng thật từ `nightHistory.at(-1)` (không lộ role) | — |
| `DEAD_CAN_SPEAK` | Tiếng Vọng Người Chết | neutral | 2 | DAY_START | 1 dead gửi 1 msg 120 ký tự ẩn danh, 1 lần/game | `deadCanSpeakUsed` |

### 4.2 Pipeline & State

- `GameState` thêm: `pendingLastStandVictim: {playerId, dieRound} | null`, `bloodMoonArmed: boolean`, `bloodMoonUsed: boolean`, `deadCanSpeakUsed: boolean`, `dayOfTruthClaims: Record<string, Role|null>`, `howlBonusDay: number | null`.
- `emptyNight()` khởi `pendingLastStandVictim` giữ nguyên qua round, `bloodMoonArmed` tiêu thụ sau 1 đêm.
- `startNight`/`startDay` gọi `selectEvent(state, phase)` → push `eventHistory` → gán `activeEvent`; resolver đọc `activeEvent.id` để modifier (`resolveNight` check `LAST_STAND`, `BLOOD_MOON`; `tallyVotes` check `HOWL`).
- `MORNING_REPORT`/`DEAD_CAN_SPEAK` broadcast vào `log` + `activeEvent.announcement` ở `beginDiscussion`.

---

## 5. Momentum & Cân bằng động

```
Momentum = 0.35*ΔPop + 0.25*ΔInfo + 0.20*ΔKill + 0.20*ΔProt // -1..1
ΔPop = wolves/alive - 0.30
ΔInfo/ΔKill/ΔProt từ ROLE_POWER
```

- **Ranked:** Chỉ kích hoạt khi `|Momentum| ≥0.35`; lọc candidate theo `beneficiary` khớp hướng; `power≥4` ≤1 lần/ván; `total≤3` ; `AMNESTY/MORNING_REPORT` không liên tiếp.
- **Chaos:** Mỗi round `rng<0.6` bốc ngẫu nhiên 1/15 theo `targetPhase`, bỏ qua momentum.
- Analyzer dùng chung cho warning và momentum → một nguồn sự thật.

---

## 6. UI / Bot AI / Kiểm thử

**UI:**
- `RoleDeckPanel`: BalanceMeter (gradient đỏ–xanh), banner vàng/đỏ + `warnings[]`, nút preset.
- `EventBanner`: 15 icons.
- `LAST_STAND` badge trên nạn nhân, `DAY_OF_TRUTH` modal, `MORNING_REPORT` auto-log, `DEAD_CAN_SPEAK` input 120 char.

**Bot:**
- Mở rộng `BotDecisionContext` với `activeEvent`, `balanceScore`, `pendingLastStand`.
- Không cần chiến thuật mới phức tạp; chỉ giảm trust SEER khi `WOLF_SHADOW`.

**Test:**
- `balance.test.ts`: score 0–100, threshold 40/60, preset 6–15.
- `events.test.ts`: 15 events + `LAST_STAND` delayed death, `BLOOD_MOON` 20% pierce, `HOWL` +1 hidden, `WOLF_SHADOW` 30% flip.
- Integration `roomService.test.ts`: block Start khi unbalanced Ranked, bypass Chaos.

---

## 7. Self-Review

- Không còn placeholder/TBD; mọi `TBD` đã thay bằng giá trị cụ thể (15 events, power, phase).
- Migrate cứng `SHROUDED→WOLF_SHADOW` không để lại dead code.
- `LAST_STAND`/`BLOOD_MOON` có lifecycle rõ ràng, không rò rỉ qua nhiều round.
- File structure tách biệt `balance/analyzer` khỏi `eventManager` để test độc lập.
