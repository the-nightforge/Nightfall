import { describe, expect, it } from "vitest";
import { PRESET_DECKS } from "../src/balance";
import { DEFAULT_ROOM_CONFIG, MAX_PLAYERS_PER_ROOM } from "../src/phases";
import { deckSeats, deckSize, deckWolfCount, validateDeckShape, validateRoomConfig } from "../src/schemas";
import type { RoomConfig } from "../src/phases";

/**
 * `validateDeckShape` hỏi "bộ bài này có chơi được không", KHÔNG hỏi "phòng
 * đang có mấy người".
 *
 * Hai câu hỏi đó từng bị gộp làm một trong `validateRoomConfig`, và lối
 * `update-config` gọi nguyên cả cụm. Hệ quả: bảng xếp bài đổi đúng một lá mỗi
 * cú bấm, nên trạng thái ngay sau cú bấm luôn lệch sĩ số đúng một người và
 * luôn bị từ chối - ô Dân Làng, ô Ma Sói và mọi công tắc vai đều không ăn ở
 * phòng đã đủ người. File này là hàng rào cho ranh giới đó.
 */

/** 2 Sói + Tiên Tri + Bảo Vệ + Phù Thuỷ = 5 ghế đặc biệt. */
const BASE: RoomConfig = { ...DEFAULT_ROOM_CONFIG, werewolves: 2, seer: true, guard: true, witch: true };
const SEATS = 5;

describe("deckSeats / deckSize / deckWolfCount", () => {
  it("ghế đếm cả Sói lẫn mọi lá đặc biệt, chưa tính Dân Làng", () => {
    expect(deckSeats(BASE)).toBe(SEATS);
    expect(deckSize({ ...BASE, villagers: 3 })).toBe(SEATS + 3);
  });

  it("vai trung lập và Kẻ Phản Bội cũng chiếm ghế", () => {
    expect(deckSeats({ ...BASE, jester: true, traitor: true })).toBe(SEATS + 2);
  });

  it("Kẻ Phản Bội chiếm ghế nhưng KHÔNG phải một con Sói", () => {
    // Nó không giết ai ban đêm; luật "Sói ít hơn phe làng" đo sức sát thương.
    expect(deckWolfCount({ ...BASE, traitor: true })).toBe(2);
    expect(deckWolfCount({ ...BASE, wolfCub: true })).toBe(3);
  });

  it("Sói Pháp Sư chiếm ghế nhưng KHÔNG phải một con Sói cắn đêm", () => {
    // Cùng cặp với Kẻ Phản Bội ở trên: nó soi dòng Tiên Tri, không cắn.
    expect(deckSeats({ ...BASE, sorcerer: true })).toBe(SEATS + 1);
    expect(deckWolfCount({ ...BASE, sorcerer: true })).toBe(deckWolfCount(BASE));
  });

  it("cấu hình chưa khai villagers thì không có cỡ riêng", () => {
    const legacy: RoomConfig = { ...BASE };
    delete legacy.villagers;
    expect(deckSize(legacy)).toBeNull();
  });
});

describe("validateDeckShape", () => {
  it("bộ bài lệch sĩ số vẫn là bộ bài HỢP LỆ - đó là việc của nút Bắt đầu", () => {
    // Chính là trạng thái ngay sau một cú bấm "+" trên ô Dân Làng.
    const grown: RoomConfig = { ...PRESET_DECKS[11], villagers: (PRESET_DECKS[11].villagers ?? 1) + 1 };
    expect(validateDeckShape(grown)).toBeNull();
    expect(validateRoomConfig(grown, 11)).toBe("Bộ bài cần 12 người, phòng đang có 11");
  });

  it("mọi bước một-lá quanh preset đều qua được", () => {
    const p12 = PRESET_DECKS[12];
    expect(validateDeckShape({ ...p12, villagers: (p12.villagers ?? 1) + 1 })).toBeNull();
    expect(validateDeckShape({ ...p12, villagers: (p12.villagers ?? 1) - 1 })).toBeNull();
    expect(validateDeckShape({ ...p12, werewolves: p12.werewolves + 1 })).toBeNull();
    expect(validateDeckShape({ ...p12, detective: true })).toBeNull();
    expect(validateDeckShape({ ...p12, seer: false })).toBeNull();
  });

  it("không còn Dân Làng nào thì từ chối", () => {
    expect(validateDeckShape({ ...BASE, villagers: 0 })).toBe("Phải còn chỗ cho Dân Làng");
  });

  it("bộ bài lớn hơn phòng đông nhất thì từ chối, và nói ra cả hai con số", () => {
    const huge: RoomConfig = { ...BASE, villagers: MAX_PLAYERS_PER_ROOM };
    expect(validateDeckShape(huge)).toBe(
      `Bộ bài cần ${SEATS + MAX_PLAYERS_PER_ROOM} người, tối đa ${MAX_PLAYERS_PER_ROOM} mỗi phòng`,
    );
  });

  it("Sói không được ít hơn phe làng NGAY TRONG bộ bài", () => {
    // 3 Sói + Tiên Tri + 1 Dân Làng: bầy Sói đã đủ thế thắng từ trước khi chia
    // bài, và không cần biết phòng có bao nhiêu người mới thấy điều đó.
    const wolfHeavy: RoomConfig = {
      ...DEFAULT_ROOM_CONFIG,
      werewolves: 3,
      guard: false,
      witch: false,
      villagers: 1,
    };
    expect(deckSize(wolfHeavy)).toBe(5);
    expect(validateDeckShape(wolfHeavy)).toBe("Số Ma Sói phải ít hơn phe làng");
  });

  it("đường tương thích: chưa khai villagers thì chỉ chặn bộ bài kín cả phòng", () => {
    const legacy: RoomConfig = { ...BASE };
    delete legacy.villagers;
    expect(validateDeckShape(legacy)).toBeNull();
  });

  it("mọi preset đều là bộ bài hợp lệ theo hình dạng", () => {
    for (const [size, config] of Object.entries(PRESET_DECKS)) {
      expect(validateDeckShape(config), `preset ${size}`).toBeNull();
    }
  });
});
