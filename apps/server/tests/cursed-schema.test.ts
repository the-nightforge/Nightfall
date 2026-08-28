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
    const base = { ...DEFAULT_ROOM_CONFIG, werewolves: 2, seer: true, guard: true, witch: true };
    expect(validateRoomConfig({ ...base, hunter: false, cursed: false }, 6)).toBeNull();
    // 2 Sói + 4 vai đặc biệt = 6 vai cho đúng 6 người: hết chỗ cho Dân Làng.
    expect(validateRoomConfig({ ...base, hunter: true, cursed: true }, 7)).toBe(
      "Phải còn chỗ cho Dân Làng",
    );
    expect(validateRoomConfig({ ...base, hunter: true, cursed: true }, 8)).toBeNull();
  });
});
