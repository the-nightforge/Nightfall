import { describe, expect, it } from "vitest";
import { DEFAULT_ROOM_CONFIG, LAST_LETTER_MAX_LENGTH } from "../src/phases";
import { lastLetterSetPayload, roomConfigSchema } from "../src/schemas";
import { CLIENT_EVENTS } from "../src/events";

/**
 * Hợp đồng ở BIÊN của add-on "Phong thư sau cùng".
 *
 * Ba thứ được khoá ở đây và chỉ ở đây: hình dạng cấu hình phòng, hình dạng
 * payload socket, và cái trần độ dài. Trần phải là MỘT hằng số dùng chung -
 * web chặn ở ô nhập, schema chặn ở biên socket, server chặn lần cuối; ba con số
 * rời nhau thì tầng lỏng nhất mới là luật thật.
 */

describe("RoomConfig với add-on phong thư", () => {
  it("nhận cấu hình có lastLetter bật", () => {
    const parsed = roomConfigSchema.parse({ ...DEFAULT_ROOM_CONFIG, lastLetter: true });
    expect(parsed.lastLetter).toBe(true);
  });

  it("nhận cấu hình có lastLetter tắt", () => {
    const parsed = roomConfigSchema.parse({ ...DEFAULT_ROOM_CONFIG, lastLetter: false });
    expect(parsed.lastLetter).toBe(false);
  });

  /**
   * Điều kiện sống còn của mọi snapshot Redis đã ghi trước bản này: thiếu hẳn
   * trường mới vẫn phải hợp lệ. Bắt buộc nó là giết sạch các ván đang chạy ngay
   * lúc deploy.
   */
  it("cấu hình cũ không có lastLetter vẫn hợp lệ", () => {
    const parsed = roomConfigSchema.parse({ ...DEFAULT_ROOM_CONFIG });
    expect(parsed.lastLetter).toBeUndefined();
  });

  it("mặc định là tắt", () => {
    expect(DEFAULT_ROOM_CONFIG.lastLetter).toBeUndefined();
  });

  it("từ chối lastLetter không phải boolean", () => {
    expect(() => roomConfigSchema.parse({ ...DEFAULT_ROOM_CONFIG, lastLetter: "yes" })).toThrow();
  });
});

describe("lastLetterSetPayload", () => {
  it("nhận chuỗi hợp lệ và cắt khoảng trắng hai đầu", () => {
    const parsed = lastLetterSetPayload.parse({ text: "  Tôi nghi Bình  " });
    expect(parsed.text).toBe("Tôi nghi Bình");
  });

  it("nhận null - đó là lệnh XOÁ thư, không phải payload thiếu", () => {
    expect(lastLetterSetPayload.parse({ text: null }).text).toBeNull();
  });

  it("từ chối chuỗi rỗng", () => {
    expect(() => lastLetterSetPayload.parse({ text: "" })).toThrow();
  });

  it("từ chối chuỗi chỉ có khoảng trắng - trim rồi mới đo", () => {
    expect(() => lastLetterSetPayload.parse({ text: "     " })).toThrow();
  });

  it(`nhận đúng ${LAST_LETTER_MAX_LENGTH} ký tự`, () => {
    const text = "a".repeat(LAST_LETTER_MAX_LENGTH);
    expect(lastLetterSetPayload.parse({ text }).text).toBe(text);
  });

  it("từ chối chuỗi quá dài", () => {
    expect(() =>
      lastLetterSetPayload.parse({ text: "a".repeat(LAST_LETTER_MAX_LENGTH + 1) }),
    ).toThrow();
  });

  /**
   * Đo SAU khi trim: một chuỗi 100 ký tự thật cộng hai dấu cách vẫn là một lá
   * thư hợp lệ, còn 101 ký tự thật thì không.
   */
  it("đo độ dài sau khi trim", () => {
    const padded = ` ${"a".repeat(LAST_LETTER_MAX_LENGTH)} `;
    expect(lastLetterSetPayload.parse({ text: padded }).text).toHaveLength(LAST_LETTER_MAX_LENGTH);
  });

  it("từ chối khoá lạ - strict", () => {
    expect(() => lastLetterSetPayload.parse({ text: "xin chào", round: 2 })).toThrow();
  });

  it("từ chối payload thiếu text", () => {
    expect(() => lastLetterSetPayload.parse({})).toThrow();
  });

  it("từ chối text không phải chuỗi hay null", () => {
    expect(() => lastLetterSetPayload.parse({ text: 12 })).toThrow();
  });
});

describe("hằng số dùng chung", () => {
  it("trần độ dài là 100", () => {
    expect(LAST_LETTER_MAX_LENGTH).toBe(100);
  });

  it("có sự kiện client cho việc lưu thư", () => {
    expect(CLIENT_EVENTS.GAME_LAST_LETTER_SET).toBe("game:last-letter-set");
  });
});
