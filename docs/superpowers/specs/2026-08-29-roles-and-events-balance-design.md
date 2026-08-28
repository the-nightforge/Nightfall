# Thiết kế Hệ thống Role Mở Rộng và Sự Kiện Cân Bằng Động (Roles & Dynamic Events Balance)

> **Ngày tạo:** 2026-08-29  
> **Trạng thái:** Chờ duyệt kế hoạch triển khai  
> **Phạm vi:** `@masoi/shared`, `@masoi/game-engine`, `apps/server`, `apps/web`

---

## 1. Mục tiêu và Bối cảnh

Hệ thống hiện tại của Ma Sói Online hỗ trợ 7 vai trò cốt lõi (`WEREWOLF`, `SEER`, `GUARD`, `WITCH`, `HUNTER`, `CURSED`, `VILLAGER`).
Mục tiêu của thiết kế này là:
1. Mở rộng danh mục vai trò lên **12 Roles** phù hợp cho các phòng từ 6 đến 15 người chơi.
2. Xây dựng **Hệ thống Sự Kiện (Event System)** và **Bộ đo lường thế trận (Momentum Engine)** giúp tự động điều tiết, chống hiện tượng snowball một chiều mà vẫn giữ nguyên tính công bằng và tính suy luận xã hội (social deduction).
3. Hỗ trợ 2 chế độ: **Ranked Mode** (Cân bằng nghiêm ngặt, Event chỉ kích hoạt khi lệch thế trận) và **Chaos Mode** (Sự kiện ngẫu nhiên, bất ngờ).

---

## 2. Chi tiết 12 Vai trò trong Game Engine

### 2.1. Bảng Tổng hợp Roles

| ID Role | Tên hiển thị | Phe | Night Order | Số lần dùng | Mô tả năng lực & Quy tắc |
| :--- | :--- | :---: | :---: | :---: | :--- |
| `WEREWOLF` | Ma Sói | `wolves` | 2 | Mỗi đêm | Tham gia cùng bầy chọn 1 nạn nhân để cắn. |
| `WOLF_CUB` | Sói Con | `wolves` | 2 | Bị động | Cùng thức dậy với Sói. Khi Sói Con chết (bất kể ban đêm hay ban ngày), đêm kế tiếp bầy Sói được **cắn 2 mục tiêu**. |
| `SEER` | Tiên Tri | `village` | 1 | Mỗi đêm | Soi 1 người/đêm để biết phe (`wolves` hay `village`). |
| `APPRENTICE_SEER` | Tiên Tri Tập Sự | `village` | 1 (khi thức tỉnh) | Bị động $\rightarrow$ Mỗi đêm | Ban đầu không có kỹ năng. Khi Tiên Tri chết, Tiên Tri Tập Sự thức tỉnh từ đêm kế tiếp và thừa kế kỹ năng soi của Tiên Tri. |
| `DETECTIVE` | Thám Tử | `village` | 1.5 | Mỗi đêm | Chọn 2 người chơi còn sống để kiểm tra xem họ **Cùng phe** hay **Khác phe**. |
| `GUARD` | Bảo Vệ | `village` | 0 | Mỗi đêm | Bảo vệ 1 người/đêm chống Sói cắn (không được chọn cùng 1 người 2 đêm liên tiếp). |
| `GUARDIAN_ANGEL` | Thiên Thần Hộ Mệnh | `village` | 0.5 | Tối đa 2 lần | Ban đêm chọn 1 người để bảo vệ khỏi đòn cắn của Sói. Tối đa 2 lần cả ván, không bảo vệ cùng 1 người 2 đêm liên tiếp. |
| `PRIEST` | Linh Mục | `village` | 2.5 | 1 bình Nước thánh | Ban đêm ném Nước thánh vào 1 người: Nếu mục tiêu là **Sói** $\rightarrow$ Sói chết; Nếu mục tiêu là **Dân** $\rightarrow$ Linh mục chết do phản phệ. |
| `WITCH` | Phù Thủy | `village` | 3 | 1 Cứu + 1 Độc | 1 bình cứu và 1 bình độc cả ván, dùng trong cửa sổ riêng sau khi Sói chốt cắn. |
| `HUNTER` | Thợ Săn | `village` | Không | Khi chết | Khi bị loại bỏ, được bắn 1 phát súng vào bất kỳ người sống nào hoặc bỏ qua. |
| `MAYOR` | Thị Trưởng | `village` | Không | Thường trực | Phiếu biểu quyết ban ngày (cả vòng đề cử và vòng treo cổ) có trọng số **x2 phiếu**. |
| `CURSED` | Kẻ Nguyền Rủa | `village`* | Không | Bị động | Ban đầu là Dân. Nếu bị Sói cắn thành công lần đầu $\rightarrow$ không chết mà biến thành `WEREWOLF`. |
| `VILLAGER` | Dân Làng | `village` | Không | Không | Thảo luận và biểu quyết vào ban ngày. |

---

### 2.2. Pipeline Xử lý Ban Đêm (Night Action Resolution Order)

Thứ tự xử lý tuần tự và tất định (Deterministic) trong `engine.resolveNight()`:

```
[1. Shields Phase]
    ├── GUARD: guardTarget
    └── GUARDIAN_ANGEL: guardianTarget (nếu còn lượt)
          └── Ghi nhận danh sách người được bảo vệ miễn nhiễm Sói

[2. Information Phase]
    ├── SEER / APPRENTICE_SEER (thức tỉnh): Kiểm tra 1 mục tiêu -> trả về 'wolves' | 'village'
    │     └── Nếu có Event "Màn sương tan": Cho phép chọn 2 mục tiêu
    │     └── Nếu có Event "Đêm không trăng": Bị khóa không thể soi
    │     └── Nếu có Event "Bóng tối bao phủ": Trả về "UNKNOWN"
    └── DETECTIVE: Kiểm tra 2 mục tiêu -> trả về 'SAME_TEAM' | 'DIFFERENT_TEAMS'

[3. Offensive Actions Phase]
    ├── WEREWOLF & WOLF_CUB:
    │     └── Mục tiêu 1: wolfTarget (đồng thuận của bầy Sói)
    │     └── Mục tiêu 2: wolfSecondaryTarget (nếu Sói Con chết ở vòng trước hoặc do Event "Cuộc săn đẫm máu")
    │     └── Nếu có Event "Đêm bình yên": Hủy lượt cắn chính của Sói
    └── PRIEST:
          └── priestTarget (nếu sử dụng Nước thánh)
          └── Target là Sói -> Sói chết (cause: 'priest')
          └── Target là Dân -> Linh mục chết (cause: 'priest_backfire')

[4. Witch Reaction Phase]
    └── WITCH: Cửa sổ 15s để dùng bình cứu (healTarget) hoặc bình độc (poisonTarget)

[5. Impact Resolution & Conversion Phase]
    ├── Xử lý đòn cắn của Sói lên mục tiêu:
    │     ├── Nếu mục tiêu có Shield (Guard/GuardianAngel) hoặc được Witch cứu -> Sống sót
    │     ├── Nếu mục tiêu là CURSED (và không có shield/heal) -> Không chết, chuyển đổi role thành WEREWOLF (cursedTurned = true)
    │     └── Trường hợp còn lại -> Chết (cause: 'wolf')
    ├── Xử lý đòn độc của Witch:
    │     └── Luôn tử vong bỏ qua bảo vệ (cause: 'poison')
    └── Tổng hợp toàn bộ danh sách tử vong: deaths = [wolf, poison, priest, priest_backfire]

[6. Post-Night Triggers Phase]
    ├── Nếu HUNTER nằm trong danh sách deaths -> Đưa vào hàng đợi HUNTER_SHOT
    ├── Nếu SEER chết và APPRENTICE_SEER còn sống -> Đánh dấu thức tỉnh (apprenticeAwakened = true)
    ├── Nếu WOLF_CUB nằm trong danh sách deaths -> Đánh dấu kích hoạt đòn cắn kép ở đêm kế tiếp (wolfCubRageNextNight = true)
    └── Cập nhật lastNightDeaths và lưu recap vào nightHistory
```

---

## 3. Hệ thống Sự kiện (Game Events) & Bộ Cân bằng Động (Momentum Engine)

### 3.1. Danh mục 9 Sự kiện (Event Pool)

```typescript
export type GameEventId =
  | "CURFEW"          // Lệnh Giới Nghiêm
  | "SILENT_NIGHT"     // Đêm Tĩnh Lặng
  | "AMNESTY_DAY"      // Ngày Hòa Hoãn
  | "CLEARING_MIST"    // Màn Sương Tan
  | "PEACEFUL_NIGHT"   // Đêm Bình Yên
  | "JUDGMENT_DAY"     // Ngày Phán Xét
  | "MOONLESS_NIGHT"   // Đêm Không Trăng
  | "BLOODY_HUNT"      // Cuộc Săn Đẫm Máu
  | "SHROUDED_ECLIPSE" // Bóng Tối Bao Phủ
;
```

| ID Event | Tên tiếng Việt | Phe hưởng lợi | Power | Target Phase | Hiệu ứng cụ thể |
| :--- | :--- | :---: | :---: | :---: | :--- |
| `CURFEW` | Lệnh Giới Nghiêm | `neutral` | 1 | `DAY_DISCUSSION` | Thời lượng thảo luận ban ngày giảm 50% (ví dụ 60s $\rightarrow$ 30s). |
| `SILENT_NIGHT` | Đêm Tĩnh Lặng | `neutral` | 1 | `NIGHT` | Kênh chat ban đêm của phe Sói bị tắt; Sói chỉ biểu quyết bằng vote mục tiêu. |
| `AMNESTY_DAY` | Ngày Hòa Hoãn | `neutral` | 2 | `DAY_DISCUSSION` | Bỏ qua phiên biểu quyết `VOTING` ban ngày; sau thảo luận chuyển thẳng sang Đêm. |
| `CLEARING_MIST` | Màn Sương Tan | `village` | 3 | `NIGHT` | Tiên Tri (hoặc Apprentice đã thức tỉnh) được soi 2 người trong 1 đêm. |
| `PEACEFUL_NIGHT` | Đêm Bình Yên | `village` | 4 | `NIGHT` | Phe Sói bị tước lượt cắn chính trong đêm đó (tối đa 1 lần/ván). |
| `JUDGMENT_DAY` | Ngày Phán Xét | `village` | 3 | `DAY_DISCUSSION` | Công khai kết quả soi gần nhất của Thám Tử cho toàn bộ người chơi ở đầu ngày. |
| `MOONLESS_NIGHT` | Đêm Không Trăng | `wolves` | 3 | `NIGHT` | Tiên Tri và Tiên Tri Tập Sự bị khóa kỹ năng soi trong đêm đó. |
| `BLOODY_HUNT` | Cuộc Săn Đẫm Máu | `wolves` | 4 | `NIGHT` | Sói được chọn thêm 1 mục tiêu phụ với 50% tỉ lệ thành công (tối đa 1 lần/ván). |
| `SHROUDED_ECLIPSE`| Bóng Tối Bao Phủ | `wolves` | 2 | `NIGHT` | Lần soi đầu tiên của Tiên Tri / Thám Tử nhận kết quả "UNKNOWN". |

---

### 3.2. Công thức Tính Momentum Score

Đầu mỗi vòng (`round`), Game Engine tính toán thế trận:

$$\text{Momentum} = 0.35 \times \Delta_{\text{Pop}} + 0.25 \times \Delta_{\text{Info}} + 0.20 \times \Delta_{\text{Kill}} + 0.20 \times \Delta_{\text{Prot}}$$

Trong đó:
- $\Delta_{\text{Pop}} = \frac{N_{\text{wolves}}}{N_{\text{alive}}} - \text{BaselineRatio}$ (độ lệch tương quan số lượng Sói vs Dân).
- $\Delta_{\text{Info}} = \text{Power}(\text{InfoAlive}_{\text{wolves}}) - \text{Power}(\text{InfoAlive}_{\text{village}})$.
- $\Delta_{\text{Kill}} = \text{Power}(\text{KillAlive}_{\text{wolves}}) - \text{Power}(\text{KillAlive}_{\text{village}})$.
- $\Delta_{\text{Prot}} = - \text{Power}(\text{ProtAlive}_{\text{village}})$.

**Quy chuẩn điều phối (Event Selection Rules):**
1. **$\text{Momentum} \le -0.35$ (Dân đang lấn lướt Sói)**:
   - Ưu tiên chọn Event thuộc nhóm `wolves` (`MOONLESS_NIGHT`, `BLOODY_HUNT`, `SHROUDED_ECLIPSE`).
2. **$\text{Momentum} \ge +0.35$ (Sói đang áp đảo Dân)**:
   - Ưu tiên chọn Event thuộc nhóm `village` (`CLEARING_MIST`, `PEACEFUL_NIGHT`, `JUDGMENT_DAY`).
3. **$-0.35 < \text{Momentum} < +0.35$ (Thế trận cân bằng)**:
   - Ưu tiên nhóm `neutral` (`CURFEW`, `SILENT_NIGHT`, `AMNESTY_DAY`) hoặc không có Event.

---

## 4. Presets Phân Bổ Deck Chuẩn 6–15 Người

Cấu hình mặc định trong `assignRoles.ts`:

| Số người | Phe Sói | Phe Dân | Chi tiết Deck gợi ý |
| :---: | :---: | :---: | :--- |
| **6** | 2 Sói | 4 Dân | `WEREWOLF` ×2, `SEER`, `GUARD`, `HUNTER`, `VILLAGER` |
| **7** | 2 Sói | 5 Dân | `WEREWOLF` ×2, `SEER`, `WITCH`, `HUNTER`, `MAYOR`, `VILLAGER` |
| **8** | 2 Sói | 6 Dân | `WEREWOLF` ×2, `SEER`, `WITCH`, `GUARD`, `HUNTER`, `DETECTIVE`, `VILLAGER` |
| **9** | 3 Sói | 6 Dân | `WEREWOLF` ×2, `WOLF_CUB`, `SEER`, `WITCH`, `GUARD`, `DETECTIVE`, `HUNTER`, `VILLAGER` |
| **10** | 3 Sói | 7 Dân | `WEREWOLF` ×2, `WOLF_CUB`, `CURSED`, `SEER`, `APPRENTICE_SEER`, `WITCH`, `GUARD`, `HUNTER`, `VILLAGER` |
| **11** | 3 Sói | 8 Dân | `WEREWOLF` ×2, `WOLF_CUB`, `SEER`, `WITCH`, `GUARD`, `DETECTIVE`, `HUNTER`, `MAYOR`, `VILLAGER` ×2 |
| **12** | 4 Sói | 8 Dân | `WEREWOLF` ×3, `WOLF_CUB`, `SEER`, `WITCH`, `GUARD`, `DETECTIVE`, `HUNTER`, `MAYOR`, `VILLAGER` ×2 |
| **13** | 4 Sói | 9 Dân | `WEREWOLF` ×3, `WOLF_CUB`, `SEER`, `WITCH`, `GUARD`, `DETECTIVE`, `HUNTER`, `MAYOR`, `GUARDIAN_ANGEL`, `VILLAGER` |
| **14** | 4 Sói | 10 Dân | `WEREWOLF` ×3, `WOLF_CUB`, `SEER`, `WITCH`, `GUARD`, `DETECTIVE`, `HUNTER`, `MAYOR`, `GUARDIAN_ANGEL`, `PRIEST`, `VILLAGER` |
| **15** | 4 Sói | 11 Dân | `WEREWOLF` ×3, `WOLF_CUB`, `CURSED`, `SEER`, `APPRENTICE_SEER`, `WITCH`, `GUARD`, `DETECTIVE`, `HUNTER`, `MAYOR`, `GUARDIAN_ANGEL`, `PRIEST`, `VILLAGER` |

---

## 5. Tích Hợp Giao Diện & Bot AI

### 5.1. Cập nhật Shared Schema & Snapshot
- `packages/shared/src/roles.ts`: Cập nhật `ROLES`, `ROLE_META`, `Team`.
- `packages/shared/src/snapshot.ts`: Thêm `activeEvent`, `activeShields`, `apprenticeAwakened`, `detectiveResult`, `priestHolyWaterUsed`, `guardianAngelCharges`.
- `packages/shared/src/events.ts`: Bổ sung event types nếu cần.

### 5.2. Bot AI Intelligence (`apps/server/src/bots/`)
- Mở rộng `BotDecisionContext` và prompt templates để Bot nhận biết vai trò mới và Event đang diễn ra.
- Cập nhật logic đánh giá mục tiêu (`targets.ts`):
  - Detective bot: Ưu tiên bắt cặp người khả nghi và người đã xác thực.
  - Priest bot: Phân tích kỹ trước khi dùng Nước thánh.
  - Guardian Angel bot: Phân bổ 2 lượt khiên hợp lý cho các role cốt lõi.

### 5.3. Web UI (`apps/web/`)
- `role-art.ts` & `RoleViews.tsx`: SVG icon & artwork cho 6 role mới.
- `RoleDeckPanel.tsx`: Toggle roles mới + hiển thị Balance Indicator và chọn mode Ranked / Chaos.
- `NightPanel.tsx`: Form chọn mục tiêu riêng cho Detective (2 người), Guardian Angel và Priest.
- `EventBanner.tsx`: Hiển thị banner thông báo sự kiện sinh động đầu mỗi Ngày/Đêm.

---

## 6. Kế hoạch Kiểm Thử (Testing & Verification)
1. **Unit Test Engine (`packages/game-engine/tests/`)**:
   - Test logic Sói con chết $\rightarrow$ kích hoạt cắn kép đêm sau.
   - Test Tiên tri tập sự thức tỉnh khi Tiên tri chết.
   - Test Thám tử soi cùng phe / khác phe.
   - Test Thiên thần hộ mệnh (tối đa 2 lần dùng, không lặp 2 đêm liền).
   - Test Linh mục dùng Nước thánh (thành công diệt Sói vs thất bại bị phản phệ).
   - Test Thị trưởng x2 trọng số vote ngày.
   - Test các modifier của 9 Event (Curfew, Silent Night, Amnesty Day, Clearing Mist, Moonless Night, v.v.).
2. **Integration Test Server (`apps/server/tests/`)**:
   - Snapshot contract test & bot simulation test với các setup 6–15 người.
3. **End-to-End Test Build**:
   - `npm run test` & `npm run build` toàn repo.
