import { describe, expect, it } from "vitest";
import { PRESET_DECKS, specialRoleList } from "../src/balance";
import { ROLES, ROLE_META, type Role } from "../src/roles";

/**
 * MỌI vai phe làng và phe Sói phải nằm trong ít nhất một preset.
 *
 * Một vai không có mặt ở preset nào là một vai không ai gặp: preset là bộ bài
 * mặc định của phòng xếp hạng, và người chơi phải TỰ tay bật một lá lên mới
 * thấy nó. Nó cũng là một vai không được ĐO - `role-power.ts` chấm sức mạnh
 * bằng cách so cặp trên chính `PRESET_DECKS`, nên `ROLE_POWER` của một lá vắng
 * mặt sẽ mãi là con số đoán lúc thiết kế.
 *
 * Test này là hàng rào cho lần thêm vai TIẾP THEO: thêm một `Role` mới mà quên
 * xếp nó vào bàn nào thì chỗ này đỏ ngay, thay vì lá bài nằm im trong `ROLES`
 * cho tới khi có người tình cờ nhận ra.
 *
 * Vai TRUNG LẬP cố ý đứng ngoài: `preset()` khai `jester`/`serialKiller`/
 * `executioner: false` tường minh để `isPresetDeck` không bao giờ nhận một bộ
 * bài có chúng là "preset chuẩn". Vắng mặt ở đây là luật, không phải chỗ sót.
 */

/** Vai -> danh sách cỡ phòng có nó. Dân Làng là phần lấp chỗ nên tính riêng. */
function presetsContaining(): Map<Role, number[]> {
  const found = new Map<Role, number[]>(ROLES.map((role) => [role, []]));
  for (const [size, config] of Object.entries(PRESET_DECKS)) {
    const n = Number(size);
    const deck = specialRoleList(config);
    for (const role of new Set(deck)) found.get(role)!.push(n);
    // `specialRoleList` không sinh ra Dân Làng: engine lấp phần ghế còn lại.
    if (n - deck.length > 0) found.get("VILLAGER")!.push(n);
  }
  return found;
}

const NON_NEUTRAL = ROLES.filter((role) => ROLE_META[role].team !== "neutral");

describe("Phủ vai trong PRESET_DECKS", () => {
  it("mọi vai phe làng và phe Sói đều có mặt ở ít nhất một preset", () => {
    const found = presetsContaining();
    /*
     * NGOẠI LỆ TẠM THỜI: TRACKER. Vai đang được dựng theo plan nhiều task
     * (2026-09-07-tracker-role) - Task 1 chỉ làm vai TỒN TẠI, Task 7 mới đổi 9
     * preset đang có GUARDIAN_ANGEL sang tracker: true. Loại nó khỏi phép kiểm
     * này ở ĐÚNG một task, không phải một chỗ sót - gỡ dòng lọc khi Task 7 xong,
     * cùng tinh thần với `ALLOWED_OVERFLOW` ở balance.ts.
     */
    const missing = NON_NEUTRAL.filter((role) => role !== "TRACKER" && found.get(role)!.length === 0);

    // So với mảng rỗng chứ không phải `toHaveLength(0)`: khi đỏ, thông báo phải
    // NÓI RA tên vai bị bỏ quên chứ không chỉ nói "0 !== 1".
    expect(missing).toEqual([]);
  });

  it("vai trung lập cố ý KHÔNG nằm trong preset nào", () => {
    const found = presetsContaining();
    for (const role of ROLES.filter((r) => ROLE_META[r].team === "neutral")) {
      expect(found.get(role)).toEqual([]);
    }
  });

  it("mỗi preset còn ít nhất một ghế Dân Làng", () => {
    // `validateRoomConfig` từ chối một bộ bài không còn chỗ cho Dân Làng, nên
    // một preset vi phạm là một preset không mở được ván nào.
    for (const [size, config] of Object.entries(PRESET_DECKS)) {
      expect(Number(size) - specialRoleList(config).length).toBeGreaterThan(0);
    }
  });

  it("số Dân Làng không vượt quá số ghế phe Sói (trừ 14/16 hậu xóa Linh Mục)", () => {
    /*
     * Luật thiết kế của bảng preset, không phải luật của engine.
     *
     * Ghế phe Sói đếm CẢ Kẻ Phản Bội: nó không cắn ai nhưng `checkWin` đếm nó
     * vào thế cân bằng, nên nó chiếm một ghế của phe đó theo đúng nghĩa quyết
     * định ván. Đây là cùng phép đếm mà `checkWin` dùng, không phải phép đếm
     * sát thương ban đêm của `validateRoomConfig`. Sói Pháp Sư/Sói Alpha cũng
     * vào đây vì `team: "wolves"` (bầy thắng chung), nên 17-20 vẫn giữ luật.
     *
     * NGOẠI LỆ 14/16 (+1 Dân): ghế Linh Mục trả về Dân sau xóa cứng, mà spec
     * chỉ thêm sói mới ở 17-20 nên hai preset này không có lá thay thế. Không
     * nhét bừa một vai chưa đo vào để giữ luật - Task 9 đo lại rồi chốt có bù
     * gì không. Map này phải RỖNG dần chứ không được dài thêm: preset mới nào
     * cũng phải giữ luật gốc.
     */
    const ALLOWED_OVERFLOW: Record<string, number> = { "14": 1, "16": 1 };
    for (const [size, config] of Object.entries(PRESET_DECKS)) {
      const deck = specialRoleList(config);
      const wolfSeats = deck.filter((r) => ROLE_META[r].team === "wolves").length;
      const villagers = Number(size) - deck.length;
      expect(
        { size, villagers, wolfSeats },
        `preset ${size} vượt luật Dân<=Sói quá mức cho phép`,
      ).toEqual({
        size,
        villagers: Math.min(villagers, wolfSeats + (ALLOWED_OVERFLOW[size] ?? 0)),
        wolfSeats,
      });
    }
  });
});
