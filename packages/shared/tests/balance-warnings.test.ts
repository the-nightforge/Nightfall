import { describe, expect, it } from "vitest";
import { generateWarnings, PRESET_DECKS } from "../src/balance";
import { DEFAULT_ROOM_CONFIG } from "../src/phases";
import type { RoomConfig } from "../src/phases";

/**
 * Sói Alpha phải được đếm vào `wolfCount` của `generateWarnings`.
 *
 * Alpha cắn cùng bầy mỗi đêm nên nó là một "Sói phải treo" theo đúng nghĩa mà
 * hai phép kiểm dùng `wolfCount` mô hình hoá: ngân sách sai lầm (`budgetPerWolf`)
 * và tỉ lệ Sói so với preset (`wolfRatio`). Đây là cùng phép đếm sát thương đêm
 * của `validateRoomConfig` (Task 2) - hai nơi đếm khác nhau thì sảnh chờ và
 * server kể hai câu chuyện khác nhau về cùng một bộ bài.
 *
 * Ba test dưới đây đều PHÂN BIỆT được (fail trước fix, pass sau fix) vì chúng
 * dựng bộ bài mà thiếu đúng một ghế Alpha là đổi kết luận của phép kiểm.
 */

/** 8 người: 2 Sói thường + Tiên Tri + Bảo Vệ + Phù Thuỷ + 2 Dân. */
function eightPlayers(overrides: Partial<RoomConfig>): { config: RoomConfig; count: number } {
  return {
    config: { ...DEFAULT_ROOM_CONFIG, werewolves: 2, villagers: 2, ...overrides },
    count: 8,
  };
}

describe("generateWarnings đếm Sói Alpha như Sói cắn", () => {
  it("ngân sách sai lầm tính cả Alpha (2 Sói + Alpha ở bàn 8 chỉ chịu được 0.67 ca/Sói)", () => {
    const { config, count } = eightPlayers({ alphaWolf: true });
    const { warnings } = generateWarnings(config, count);
    // Bỏ Alpha ra thì ngân sách là (8-4)/2 = 2.0 - im; đếm Alpha vào thì
    // (8-6)/3 = 0.67 - kêu. Khóa đúng phép tính, không khóa câu chữ.
    expect(warnings.join("\n")).toMatch(/ca chết cho mỗi Sói/);
  });

  it("tỉ lệ Sói so preset tính cả Alpha (3 Sói + Alpha ở bàn 8 lệch 25% so với preset 2/8)", () => {
    const { config, count } = eightPlayers({ werewolves: 3, alphaWolf: true, villagers: 1 });
    const { warnings } = generateWarnings(config, count);
    // Bỏ Alpha ra thì 3/8 so với 2/8 chỉ lệch 12.5% - im; đếm vào thì 4/8
    // lệch 25% - kêu và chặn.
    expect(warnings.join("\n")).toMatch(/Tỉ lệ Sói lệch/);
  });

  it("preset 19 (mang Alpha) không tự tố tỉ lệ của chính nó", () => {
    // Hai vế của phép so phải dùng CÙNG phép đếm: deck-side đếm Alpha mà
    // preset-side thiếu thì chính preset cũng lệch 1/19 với chính nó.
    // (Dùng đúng preset thật chứ không dựng lại - đây cũng là hồi quy cho
    // bảng preset sau mọi lần đổi lá.)
    const { warnings } = generateWarnings(PRESET_DECKS[19], 19);
    expect(warnings.join("\n")).not.toMatch(/Tỉ lệ Sói lệch/);
  });

  it("Sói Pháp Sư KHÔNG vào wolfCount (chiếm ghế nhưng không cắn, như Kẻ Phản Bội)", () => {
    const { config, count } = eightPlayers({ sorcerer: true });
    const { warnings } = generateWarnings(config, count);
    // Ngân sách vẫn (8-4)/2 = 2.0 và tỉ lệ vẫn 2/8 = preset - cả hai phép im.
    expect(warnings.join("\n")).not.toMatch(/ca chết cho mỗi Sói/);
    expect(warnings.join("\n")).not.toMatch(/Tỉ lệ Sói lệch/);
  });
});
