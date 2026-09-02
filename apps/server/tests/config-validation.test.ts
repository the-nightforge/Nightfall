import { describe, expect, it } from "vitest";
import { resolveCorsOrigin, resolvePositiveInt } from "../src/config";

/*
 * `config.ts` đã có kỷ luật này cho PORT, LiveKit và object storage, kèm nguyên
 * một đoạn chú thích ở đầu file về việc nuốt im lặng cấu hình hỏng là cái bẫy
 * gì. Năm biến CHAT và SIGNUP thì lại đi qua `Number(...)` trần: chuỗi rỗng ra
 * 0, chuỗi rác ra NaN - và cả hai đều làm `allowAction` chặn sạch mọi lượt mà
 * không log lấy một dòng.
 */
describe("resolvePositiveInt", () => {
  it("dùng mặc định khi chưa đặt", () => {
    expect(resolvePositiveInt({}, "CHAT_MAX_LENGTH", 300)).toBe(300);
  });

  it("đọc được số hợp lệ", () => {
    expect(resolvePositiveInt({ CHAT_MAX_LENGTH: "500" }, "CHAT_MAX_LENGTH", 300)).toBe(500);
  });

  it("chuỗi RỖNG là hỏng, không phải chưa đặt - `?? ` không bắt được nó", () => {
    expect(() => resolvePositiveInt({ CHAT_MAX_LENGTH: "" }, "CHAT_MAX_LENGTH", 300)).toThrow(
      /CHAT_MAX_LENGTH/,
    );
  });

  it.each(["abc", "0", "-5", "1.5"])("từ chối giá trị vô nghĩa: %s", (bad) => {
    expect(() => resolvePositiveInt({ CHAT_RATE_LIMIT_COUNT: bad }, "CHAT_RATE_LIMIT_COUNT", 5)).toThrow(
      /CHAT_RATE_LIMIT_COUNT/,
    );
  });
});

/*
 * CORS_ORIGIN mặc định "*", và `isProd` cho tới nay chỉ được dùng đúng một chỗ:
 * tắt request logger. Quên đặt biến này khi dựng lại service trên Render là
 * chuyện im lặng tuyệt đối - đúng kiểu hỏng mà `resolveVoiceConfig` đã chọn
 * cách ném ngay lúc khởi động thay vì bỏ qua.
 */
describe("resolveCorsOrigin", () => {
  it("ngoài production thì `*` là bình thường", () => {
    expect(resolveCorsOrigin({ NODE_ENV: "development" })).toBe("*");
  });

  it("production mà vẫn `*` thì ném ngay lúc khởi động", () => {
    expect(() => resolveCorsOrigin({ NODE_ENV: "production" })).toThrow(/CORS_ORIGIN/);
    expect(() => resolveCorsOrigin({ NODE_ENV: "production", CORS_ORIGIN: "*" })).toThrow(
      /CORS_ORIGIN/,
    );
  });

  it("production với origin thật thì qua", () => {
    expect(resolveCorsOrigin({ NODE_ENV: "production", CORS_ORIGIN: "https://a.vercel.app" })).toBe(
      "https://a.vercel.app",
    );
  });
});
