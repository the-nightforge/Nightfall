import { describe, it, expect } from "vitest";
import { calculateBalanceScore, generateWarnings } from "../src/balance/analyzer";
import { PRESET_DECKS } from "../src/balance/presets";

describe("balance", () => {
  it("preset 6 balanced 45-55", () => {
    const r = calculateBalanceScore(PRESET_DECKS[6], 6);
    expect(r.score).toBeGreaterThanOrEqual(45);
    expect(r.score).toBeLessThanOrEqual(55);
  });

  /**
   * Preset LÀ mốc chuẩn, nên nó phải chấm đúng 50 dù `ROLE_POWER` mang giá trị
   * nào - điểm số dựng trên HIỆU giữa bộ bài và preset của nó. Một preset lệch
   * khỏi 50 nghĩa là bộ chấm và bộ chia bài đang đọc hai bộ bài khác nhau, và
   * bảng cân bằng ở sảnh chờ đang nói dối về ván sắp chơi.
   */
  it("mọi preset tự chấm mình đúng 50", () => {
    for (const [count, deck] of Object.entries(PRESET_DECKS)) {
      expect(calculateBalanceScore(deck, Number(count)).score).toBe(50);
      expect(generateWarnings(deck, Number(count)).blocking).toBe(false);
    }
  });

  /**
   * Hai dấu của bảng `ROLE_POWER` đã hiệu chỉnh bằng self-play, và cả hai đều
   * ngược với bảng đoán tay trước đó. Khoá lại để một lần "dọn dẹp" sau này
   * không lặng lẽ trả chúng về chỗ cũ.
   */
  it("Sói Con là lá nặng nhất, và Kẻ Nguyền Rủa là lá có hại cho làng", () => {
    // Gỡ Sói Con khỏi preset 15 làm phe làng khoẻ hẳn lên -> phải bị chặn.
    expect(generateWarnings({ ...PRESET_DECKS[15], wolfCub: false }, 15).blocking).toBe(true);
    // Gỡ Kẻ Nguyền Rủa cũng làm làng khoẻ lên, không phải yếu đi.
    expect(calculateBalanceScore({ ...PRESET_DECKS[15], cursed: false }, 15).score).toBeGreaterThan(50);
  });
  it("blocking when too many wolves", () => {
    const w = generateWarnings({ ...PRESET_DECKS[8], werewolves: 4 } as any, 8);
    expect(w.blocking).toBe(true);
    expect(w.warnings.length).toBeGreaterThan(0);
  });
  it("warning when score out of 40-60", () => {
    const w = generateWarnings(
      {
        werewolves: 1,
        seer: false,
        guard: false,
        witch: false,
        hunter: false,
        cursed: false,
        wolfCub: false,
        apprenticeSeer: false,
        detective: false,
        guardianAngel: false,
        priest: false,
        mayor: false,
      } as any,
      8,
    );
    expect(w.blocking).toBe(true);
  });
});
