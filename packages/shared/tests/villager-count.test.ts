 import { describe, expect, it } from "vitest";
import { PRESET_DECKS, specialRoleList } from "../src/balance";
import { DEFAULT_ROOM_CONFIG, DEFAULT_VILLAGERS } from "../src/phases";
import { validateRoomConfig } from "../src/schemas";
import type { RoomConfig } from "../src/phases";

/**
 * Số Dân Làng do HOST đặt, không tự lấp chỗ trống.
 *
 * Hệ quả đảo chiều cả mô hình: trước đây số người quyết định số Dân Làng, giờ
 * tổng bộ bài quyết định số người cần. Thêm một người vào phòng vì thế không
 * còn tự thành một Dân Làng - `validateRoomConfig` báo lệch và host tự chỉnh.
 *
 * Phần lớn test của repo dựng cấu hình bằng tay và KHÔNG khai `villagers`, nên
 * chúng đi đường tương thích (vẫn lấp chỗ). File này là hàng rào cho đường
 * CHÍNH - đường mà mọi phòng thật và mọi preset đi qua.
 */

/** 2 Sói + Tiên Tri + Bảo Vệ + Phù Thuỷ = 5 ghế đặc biệt. */
const BASE: RoomConfig = { ...DEFAULT_ROOM_CONFIG, werewolves: 2, seer: true, guard: true, witch: true };
const SEATS = 5;

/** Thêm Thợ Săn + Kẻ Nguyền Rủa + Thị Trưởng = 8 ghế, vừa kín một bàn 8 người. */
const TIGHT: RoomConfig = { ...BASE, hunter: true, cursed: true, mayor: true };

describe("số Dân Làng do host đặt", () => {
  it("bộ bài khớp đúng số người thì hợp lệ", () => {
    expect(validateRoomConfig({ ...BASE, villagers: 3 }, SEATS + 3)).toBeNull();
  });

  it("thiếu người thì câu lỗi nêu CẢ HAI con số", () => {
    // Một câu chỉ nói "không khớp" thì host không biết nên kéo ô nào.
    expect(validateRoomConfig({ ...BASE, villagers: 4 }, SEATS + 3)).toBe(
      `Bộ bài cần ${SEATS + 4} người, phòng đang có ${SEATS + 3}`,
    );
  });

  it("thừa người cũng bị chặn, không âm thầm thành Dân Làng", () => {
    // Đây là vế mà mô hình cũ tự lấp: người thứ 9 từng lặng lẽ thành Dân Làng.
    expect(validateRoomConfig({ ...BASE, villagers: 3 }, SEATS + 4)).toBe(
      `Bộ bài cần ${SEATS + 3} người, phòng đang có ${SEATS + 4}`,
    );
  });

  it("không có Dân Làng nào thì bị từ chối", () => {
    // Luật cũ hơn cả ô này: một bàn mà ai cũng biết một điều gì đó là một bàn
    // không còn ai để đánh lừa.
    //
    // Dùng bộ 8 ghế ở phòng 8 người: dưới `MIN_PLAYERS_TO_START` thì
    // `validateRoomConfig` trả lỗi SỐ NGƯỜI trước khi tới được phép đếm ghế.
    expect(validateRoomConfig({ ...TIGHT, villagers: 0 }, 8)).toBe("Phải còn chỗ cho Dân Làng");
  });

  it("THIẾU trường thì quay về luật lấp chỗ cũ", () => {
    const legacy: RoomConfig = { ...BASE };
    delete legacy.villagers;
    // Lấp được: còn chỗ trống.
    expect(validateRoomConfig(legacy, SEATS + 3)).toBeNull();

    // Kín ghế: không còn chỗ để lấp. Lại dùng bộ 8 ghế ở phòng 8 người, cùng lý
    // do với phép kiểm ngay trên.
    const legacyTight: RoomConfig = { ...TIGHT };
    delete legacyTight.villagers;
    expect(validateRoomConfig(legacyTight, 8)).toBe("Phải còn chỗ cho Dân Làng");
  });

  it("khuôn dùng chung KHÔNG mang sẵn số Dân Làng", () => {
    // Một con số ở đó là làm mọi test, harness và công cụ sai cùng lúc: chúng
    // spread khuôn này ra rồi dùng với đủ loại cỡ bàn.
    expect(DEFAULT_ROOM_CONFIG.villagers).toBeUndefined();
    expect(DEFAULT_VILLAGERS).toBe(3);
  });

  it("mọi preset khai villagers khớp đúng cỡ phòng của nó", () => {
    for (const [size, config] of Object.entries(PRESET_DECKS)) {
      expect({ size, villagers: config.villagers }).toEqual({
        size,
        villagers: Number(size) - specialRoleList(config).length,
      });
      expect(validateRoomConfig(config, Number(size)), `preset ${size}`).toBeNull();
    }
  });
});
