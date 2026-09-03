import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROOM_CONFIG,
  ROLES,
  ROLE_META,
  roleTeam,
  roomConfigSchema,
  validateRoomConfig,
} from "@masoi/shared";

describe("Contract của Kẻ Nguyền Rủa", () => {
  it("có metadata công khai và thuộc phe làng lúc chia bài", () => {
    expect(ROLES).toContain("CURSED");
    expect(ROLE_META.CURSED.name).toBe("Kẻ Nguyền Rủa");
    expect(roleTeam("CURSED")).toBe("village");
    // Không có lượt riêng ban đêm.
    expect(ROLE_META.CURSED.nightOrder).toBeUndefined();
  });

  it("mặc định tắt và bật/tắt được qua roomConfigSchema", () => {
    expect(DEFAULT_ROOM_CONFIG.cursed).toBe(false);
    expect(roomConfigSchema.parse({ ...DEFAULT_ROOM_CONFIG, cursed: true }).cursed).toBe(true);
    expect(roomConfigSchema.parse({ ...DEFAULT_ROOM_CONFIG }).cursed).toBe(false);
  });

  it("được tính vào cân bằng vai trò như các role đặc biệt khác", () => {
    // Mọi mốc dời lên 8: `MIN_PLAYERS_TO_START` lên 8 từ 2026-09-04, và dưới
    // ngưỡng đó `validateRoomConfig` trả lỗi số người trước khi tới được phép
    // đếm ghế. Hình dạng của test giữ nguyên - một ca thừa ghế, một ca vừa khít,
    // một ca thừa ghế trở lại.
    const base = { ...DEFAULT_ROOM_CONFIG, werewolves: 2, seer: true, guard: true, witch: true };
    expect(validateRoomConfig({ ...base, hunter: false, cursed: false }, 8)).toBeNull();
    // 2 Sói + 6 vai đặc biệt = 8 vai cho đúng 8 người: hết chỗ cho Dân Làng.
    expect(
      validateRoomConfig({ ...base, hunter: true, cursed: true, mayor: true }, 8),
    ).toBe("Phải còn chỗ cho Dân Làng");
    expect(validateRoomConfig({ ...base, hunter: true, cursed: true }, 8)).toBeNull();
  });
});
