import { describe, expect, it } from "vitest";
import { ROLES, ROLE_META, TEAM_LABELS, isPowerRole, roleTeam } from "../src/roles";
import { DEFAULT_ROOM_CONFIG, type RoomConfig } from "../src/phases";
import { roomConfigSchema, validateRoomConfig } from "../src/schemas";
import {
  PRESET_DECKS,
  ROLE_POWER,
  calculateBalanceScore,
  specialRoleList,
} from "../src/balance";
import { PERSONAL_WIN_CONDITIONS, PERSONAL_WIN_LABELS, isPersonalWinCondition } from "../src/snapshot";

describe("Thằng Hề - metadata vai", () => {
  it("có mặt trong ROLES với đủ meta và thuộc phe trung lập", () => {
    expect(ROLES).toContain("JESTER");
    expect(ROLE_META.JESTER.name).toBe("Thằng Hề");
    expect(ROLE_META.JESTER.description.length).toBeGreaterThan(0);
    expect(roleTeam("JESTER")).toBe("neutral");
  });

  it("KHÔNG có hành động đêm", () => {
    // `hasNightAction` của engine suy ra từ đúng trường này, nên đây là chỗ
    // duy nhất quyết định việc Hề có thức dậy hay không.
    expect(ROLE_META.JESTER.nightOrder).toBeUndefined();
  });

  it("không phải vai quyền lực - Sói không có lý do phải cắn nó khi lộ mặt", () => {
    expect(isPowerRole("JESTER")).toBe(false);
  });

  it("ba phe đều có tên hiển thị", () => {
    expect(TEAM_LABELS.neutral).toBe("Trung lập");
    expect(new Set(Object.values(TEAM_LABELS)).size).toBe(3);
  });
});

describe("Thằng Hề - cấu hình phòng", () => {
  it("schema chấp nhận cờ jester, và nó là tuỳ chọn", () => {
    const base = { ...DEFAULT_ROOM_CONFIG };
    expect(roomConfigSchema.safeParse({ ...base, jester: true }).success).toBe(true);
    // Vắng mặt vẫn hợp lệ: cấu hình phòng ghi trước bản này không có trường đó.
    expect(roomConfigSchema.safeParse(base).success).toBe(true);
  });

  it("là boolean nên tối đa một Hề mỗi ván, theo chính kiểu dữ liệu", () => {
    const deck = specialRoleList({ ...DEFAULT_ROOM_CONFIG, jester: true } as RoomConfig);
    expect(deck.filter((role) => role === "JESTER")).toHaveLength(1);
  });

  it("KHÔNG preset mặc định nào chứa Thằng Hề", () => {
    // Host phải tự bật trong bộ bài tuỳ chỉnh; không ván ranked chuẩn nào tự
    // dưng có thêm một vai trung lập.
    for (const [count, preset] of Object.entries(PRESET_DECKS)) {
      expect(preset.jester, `preset ${count}`).toBeFalsy();
      expect(specialRoleList(preset), `preset ${count}`).not.toContain("JESTER");
    }
  });

  it("Hề được tính vào số người KHÔNG phải Sói khi chặn cấu hình", () => {
    // Cùng phép đếm mà `checkWin` dùng. Hai phép đếm khác nhau ở hai chỗ sẽ cho
    // phép mở một ván mà Sói đã thắng ngay từ đêm đầu.
    const config: RoomConfig = {
      ...DEFAULT_ROOM_CONFIG,
      werewolves: 3,
      seer: false,
      guard: false,
      witch: false,
      jester: true,
      // 3 Sói + Hề + 4 Dân Làng = 8 ghế. `villagers` giờ do host đặt, nên bộ
      // bài phải tự khớp số người chứ không co giãn theo nữa.
      villagers: 4,
    };
    // 8 người, không phải 7: `MIN_PLAYERS_TO_START` lên 8 từ 2026-09-04, và
    // dưới ngưỡng đó `validateRoomConfig` trả về lỗi số người TRƯỚC khi tới
    // được phép đếm phe mà test này muốn khẳng định.
    expect(validateRoomConfig(config, 8)).toBeNull();
    // Bớt một Dân Làng để bộ bài vẫn dày đúng 8: nếu để lệch cỡ thì
    // `validateRoomConfig` trả về lỗi SỐ NGƯỜI trước khi tới được phép đếm phe
    // mà test này muốn khẳng định.
    expect(validateRoomConfig({ ...config, werewolves: 4, villagers: 3 }, 8)).toBe(
      "Số Ma Sói phải ít hơn phe làng",
    );
  });
});

describe("Thằng Hề - chấm cân bằng", () => {
  it("không đóng góp sức mạnh cho phe nào", () => {
    expect(ROLE_POWER.JESTER).toBe(0);
  });

  it("bật Hề LÀM YẾU phe làng đúng bằng một ghế Dân Làng", () => {
    /*
     * Đây là hệ quả duy nhất và đúng của một lá trung lập: nó không giúp làng,
     * nhưng nó lấy mất một chỗ ngồi. Bản cũ của `villageRoles` (mọi thứ không
     * phải Sói) sẽ cộng nó vào sức mạnh của làng - tức bảng cân bằng sẽ tính
     * Thằng Hề như một người sẽ cố giúp làng thắng.
     */
    const without = calculateBalanceScore({ ...PRESET_DECKS[9] }, 9);
    const withJester = calculateBalanceScore({ ...PRESET_DECKS[9], jester: true }, 9);

    expect(withJester.wolfPower).toBe(without.wolfPower);
    expect(withJester.villagePower).toBe(without.villagePower - ROLE_POWER.VILLAGER);
    expect(withJester.score).toBeLessThan(without.score);
  });
});

describe("điều kiện thắng cá nhân", () => {
  it("tập ĐÓNG, và mỗi điều kiện có một nhãn", () => {
    for (const condition of PERSONAL_WIN_CONDITIONS) {
      expect(PERSONAL_WIN_LABELS[condition]).toBeTruthy();
    }
    expect(Object.keys(PERSONAL_WIN_LABELS)).toHaveLength(PERSONAL_WIN_CONDITIONS.length);
  });

  it("nhận ra chuỗi hợp lệ và từ chối mọi thứ khác", () => {
    // Cùng vai trò với `isRole`: dữ liệu đọc từ cột Json của một ván cũ mang
    // hình dạng của bản build đã ghi nó.
    expect(isPersonalWinCondition("JESTER_LYNCHED")).toBe(true);
    expect(isPersonalWinCondition("KHÔNG_CÓ_THẬT")).toBe(false);
    expect(isPersonalWinCondition(undefined)).toBe(false);
    expect(isPersonalWinCondition(3)).toBe(false);
  });
});
