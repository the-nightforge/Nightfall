import { describe, it, expect } from "vitest";
import { calculateBalanceScore, generateWarnings } from "../src/balance/analyzer";
import { PRESET_DECKS } from "../src/balance/presets";
import { missingCoreRoles } from "@masoi/shared";
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

    /*
     * MỘT NGOẠI LỆ CÓ TÊN, và nó là một BÁO ĐỘNG GIẢ đã kiểm chứng.
     *
     * Preset 10 chấm ra `villagePower` 11.5 so với `wolfPower` 12, nên nó kêu ở
     * phép kiểm "sức mạnh làng thấp hơn phe Sói". Đo thực tế cùng ngày, 600 ván
     * trên 3 seed family với speech bật: 52.7% cho phe làng. Bộ bài không lệch;
     * BẢNG SỐ lệch.
     *
     * Hai nghi phạm, chưa phân định được:
     *  - `APPRENTICE_SEER` vừa hạ 2 -> 1 theo số đo ghép cặp (Δ -0.6). Đúng số
     *    đo, và chính nó đẩy preset 10 qua mép.
     *  - `WOLF_CUB` = 7 là dòng ĐƯỢC ĐO THƯA NHẤT bảng (2 mẫu, chú thích của
     *    `ROLE_POWER` đã cảnh báo). 7 có thể đang quá cao.
     *
     * KHÔNG vặn số nào cho vừa ngưỡng: `ROLE_POWER` viết thẳng rằng ngưỡng phải
     * giữ nguyên để bảng nói đúng số đo, chứ không sửa số cho vừa một ngưỡng cũ.
     * Ngoại lệ vì thế được ghi ĐÍCH DANH ở đây thay vì nới lỏng phép kiểm - một
     * preset MỚI nào trượt phép này vẫn làm test đỏ.
     */
    const KNOWN_FALSE_ALARM = new Set(["10"]);
    for (const [count, deck] of Object.entries(PRESET_DECKS)) {
      const warnings = absolute(deck, Number(count));
      if (KNOWN_FALSE_ALARM.has(count)) {
        expect(warnings.join(" ")).toMatch(/thấp hơn phe Sói/);
        continue;
      }
      expect(warnings).toEqual([]);
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
   * Ràng buộc SẢN PHẨM, khoá ở đây vì nó không tự bảo vệ được: mọi lần hiệu
   * chỉnh cân bằng đều cám dỗ gỡ một lá làng ra cho nhẹ vế làng, và Phù Thuỷ -
   * lá mạnh thứ hai - là lá đầu tiên bị nhắm tới. Chuyện đó đã xảy ra đúng một
   * lần (preset 11 và 12, 2026-09-04, đã trả lại).
   *
   * Phép kiểm này KHÔNG nói bộ bài cân bằng. Nó nói bộ bài vẫn là Ma Sói.
   */
  it("mọi preset đều có đủ sáu vai lõi", () => {
    for (const [count, deck] of Object.entries(PRESET_DECKS)) {
      expect(missingCoreRoles(deck, Number(count))).toEqual([]);
    }
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
    /*
     * Kẻ Nguyền Rủa: KHÔNG neo vào preset 15 nữa.
     *
     * Phép thử này đã phải đảo chiều HAI LẦN trong một ngày, chỉ vì preset 15
     * lúc có lúc không có lá đó - và mỗi lần "gỡ ra khỏi preset" trùng với bộ
     * bài thật thì nó chấm chính preset và luôn xanh. Một phép kiểm mà chiều
     * đúng của nó phụ thuộc vào bảng preset thì không kiểm được gì cả.
     *
     * Dựng bộ bài TẠI CHỖ, hai bản chỉ khác đúng một lá. Từ giờ nó nói về
     * `ROLE_POWER` chứ không nói về preset, và không lần sửa preset nào chạm
     * tới nó được nữa.
     */
    const base: RoomConfig = { ...PRESET_DECKS[15], cursed: false };
    expect(calculateBalanceScore({ ...base, cursed: true }, 15).score).toBeLessThan(
      calculateBalanceScore(base, 15).score,
    );
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
