import { describe, expect, it } from "vitest";
import { generateWarnings, PRESET_DECKS } from "../src/balance";
import { DEFAULT_ROOM_CONFIG } from "../src/phases";
import type { RoomConfig } from "../src/phases";

/**
 * `generateWarnings` chỉ gác preset 19: hai phép kiểm dùng `wolfCount` - ngân
 * sách sai lầm (`budgetPerWolf`) và tỉ lệ Sói so với preset (`wolfRatio`) -
 * phải dùng CÙNG phép đếm sát thương đêm với `validateRoomConfig` (Task 2),
 * nếu không hai nơi đếm khác nhau thì sảnh chờ và server kể hai câu chuyện
 * khác nhau về cùng một bộ bài.
 */

/** 8 người: 2 Sói thường + Tiên Tri + Bảo Vệ + Phù Thuỷ + 2 Dân. */
function eightPlayers(overrides: Partial<RoomConfig>): { config: RoomConfig; count: number } {
  return {
    config: { ...DEFAULT_ROOM_CONFIG, werewolves: 2, villagers: 2, ...overrides },
    count: 8,
  };
}

describe("generateWarnings và wolfCount", () => {
  it("preset 19 không tự tố tỉ lệ của chính nó", () => {
    // Hai vế của phép so phải dùng CÙNG phép đếm: deck-side và preset-side
    // lệch nhau thì chính preset cũng lệch 1/19 với chính nó.
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
