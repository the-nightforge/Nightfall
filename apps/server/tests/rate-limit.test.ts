import { beforeEach, describe, expect, it } from "vitest";
import { allowAction, rateLimitEntryCount, resetRateLimit } from "../src/rate-limit";

beforeEach(() => {
  resetRateLimit();
});

describe("allowAction", () => {
  it("cho qua đúng `limit` lần rồi chặn", () => {
    const t = 1_000_000;
    for (let i = 0; i < 5; i++) {
      expect(allowAction("k", 5, 1_000, t)).toBe(true);
    }
    expect(allowAction("k", 5, 1_000, t)).toBe(false);
  });

  it("mở lại khi các lần gọi cũ đã trôi khỏi cửa sổ", () => {
    const t = 1_000_000;
    for (let i = 0; i < 5; i++) allowAction("k", 5, 1_000, t);
    expect(allowAction("k", 5, 1_000, t)).toBe(false);

    // Vừa đủ ra khỏi cửa sổ 1s.
    expect(allowAction("k", 5, 1_000, t + 1_000)).toBe(true);
  });

  it("mỗi khoá đếm riêng", () => {
    const t = 1_000_000;
    for (let i = 0; i < 5; i++) allowAction("a", 5, 1_000, t);
    expect(allowAction("a", 5, 1_000, t)).toBe(false);
    expect(allowAction("b", 5, 1_000, t)).toBe(true);
  });
});

describe("không rò rỉ bộ nhớ", () => {
  it("dọn entry của những khoá đã ngưng thao tác", () => {
    const t = 1_000_000;
    // 500 người chơi khác nhau, mỗi người thao tác một lần rồi biến mất.
    for (let i = 0; i < 500; i++) {
      allowAction(`act:player-${i}`, 5, 1_000, t);
    }
    expect(rateLimitEntryCount()).toBe(500);

    // Quá mốc quét (60s) và quá cửa sổ: lượt gọi kế phải cuốn sạch đám cũ.
    allowAction("act:someone-else", 5, 1_000, t + 61_000);
    expect(rateLimitEntryCount()).toBe(1);
  });

  it("KHÔNG dọn người vẫn đang thao tác", () => {
    const t = 1_000_000;
    allowAction("act:idle", 5, 1_000, t);
    allowAction("act:active", 5, 1_000, t);

    // "active" vừa gọi ngay trước mốc quét nên phải được giữ lại.
    allowAction("act:active", 5, 1_000, t + 60_999);
    allowAction("act:trigger", 5, 1_000, t + 61_000);

    expect(rateLimitEntryCount()).toBe(2); // active + trigger, idle bị dọn
  });

  it("nối lại KHÔNG reset được giới hạn", () => {
    // Đây là lý do không dọn theo sự kiện disconnect: nếu dọn, người chơi chỉ
    // cần F5 là spam tiếp được.
    const t = 1_000_000;
    for (let i = 0; i < 5; i++) allowAction("chat:kẻ-spam", 5, 5_000, t);
    expect(allowAction("chat:kẻ-spam", 5, 5_000, t)).toBe(false);

    // Ngắt rồi nối lại tức thì: vẫn cùng playerId, vẫn trong cửa sổ.
    expect(allowAction("chat:kẻ-spam", 5, 5_000, t + 100)).toBe(false);
  });
});
