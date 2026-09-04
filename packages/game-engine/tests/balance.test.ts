import { describe, it, expect } from "vitest";
import { calculateBalanceScore, generateWarnings } from "../src/balance/analyzer";
import { PRESET_DECKS } from "../src/balance/presets";
import type { RoomConfig } from "@masoi/shared";

describe("balance", () => {
  /**
   * Mốc TUYỆT ĐỐI, thay cho `preset 6 balanced 45-55` đã gỡ.
   *
   * Test cũ khẳng định preset 6 chấm trong khoảng 45-55. Nó không bao giờ đỏ
   * được: `calculateBalanceScore` chấm bộ bài bằng độ lệch so với preset cùng
   * cỡ phòng, nên MỌI preset đều ra đúng 50 - test đó lặp lại "mọi preset tự
   * chấm mình đúng 50" ngay dưới, bằng một con số yếu hơn. Chính lỗ hổng ấy để
   * lọt bảng preset cũ: cả 9 cỡ phòng đều "Cân bằng" trong khi đo ra 7-47%.
   *
   * Cái đáng khoá là hai phép kiểm KHÔNG đọc `PRESET_DECKS`, vì chỉ chúng mới
   * còn hiệu lực khi chính bảng preset sai.
   */
  it("mốc tuyệt đối im trên preset, và kêu trên bộ bài lệch", () => {
    const absolute = (config: RoomConfig, count: number) =>
      generateWarnings(config, count).warnings.filter((line) =>
        /ca chết cho mỗi Sói|thấp hơn phe Sói/.test(line),
      );

    for (const [count, deck] of Object.entries(PRESET_DECKS)) {
      expect(absolute(deck, Number(count))).toEqual([]);
    }

    // Đúng preset 12 người CŨ (3 Sói + Sói Con), đo ra 7.3% cho phe làng. Ngân
    // sách sai lầm của làng khi đó là 1.00 ca chết cho mỗi Sói phải treo.
    const old12: RoomConfig = {
      ...PRESET_DECKS[12],
      werewolves: 3,
      wolfCub: true,
    };
    expect(absolute(old12, 12).join(" ")).toMatch(/ca chết cho mỗi Sói/);
    // Cảnh báo THÔI, không chặn: đây là hàng rào chống bảng preset trôi lệch,
    // không phải một luật mới cho bộ bài tuỳ chỉnh.
    expect(generateWarnings({ ...PRESET_DECKS[15] }, 15).blocking).toBe(false);
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
    // Bản cũ THÊM vào bằng cách gỡ Sói Con khỏi preset 15. Từ 2026-09-04 preset
    // 15 không còn Sói Con, nên phép thử đó đang chấm chính preset và luôn xanh.
    // Đảo chiều để nó lại đo đúng thứ nó muốn đo: NHÉT Sói Con vào phải kéo cán
    // cân về phe Sói đủ mạnh để bị chặn.
    expect(generateWarnings({ ...PRESET_DECKS[15], wolfCub: true }, 15).blocking).toBe(true);
    // Kẻ Nguyền Rủa cũng phải đảo chiều, và vì ĐÚNG lý do trên: preset 15 hết
    // Kẻ Nguyền Rủa từ lần hiệu chỉnh sau đó, nên "gỡ nó ra" giờ chấm chính
    // preset và luôn ra 50. NHÉT nó vào phải kéo cán cân về phe Sói.
    expect(calculateBalanceScore({ ...PRESET_DECKS[15], cursed: true }, 15).score).toBeLessThan(50);
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
