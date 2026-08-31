import { describe, expect, it, vi } from "vitest";

// `http.ts` kéo theo prisma và redis ở tầng module; test này chỉ quan tâm phép
// chuyển đổi thuần nên chặn hai thứ đó lại.
vi.mock("../src/db", () => ({ prisma: {} }));
vi.mock("../src/redis", () => ({ redis: { status: "ready" } }));

const { toHistoryEntry } = await import("../src/http");

function row(playerRoles: unknown) {
  return {
    roomCode: "ABCDE",
    winner: "village",
    round: 4,
    durationSec: 620,
    playerRoles,
    createdAt: new Date("2026-08-31T10:00:00Z"),
  };
}

describe("toHistoryEntry", () => {
  it("rút đúng vai và kết cục của người đang hỏi", () => {
    const entry = toHistoryEntry(
      row([
        { id: "me", name: "Tôi", role: "SEER", alive: false },
        { id: "other", name: "Người khác", role: "WEREWOLF", alive: true },
      ]),
      "me",
    );

    expect(entry.myRole).toBe("SEER");
    expect(entry.mySurvived).toBe(false);
    expect(entry.roomCode).toBe("ABCDE");
    expect(entry.rounds).toBe(4);
    expect(entry.endedAt).toBe(new Date("2026-08-31T10:00:00Z").getTime());
  });

  it("trả toàn bộ vai: ván đã xong thì không còn gì để giấu", () => {
    const entry = toHistoryEntry(
      row([
        { id: "me", name: "Tôi", role: "VILLAGER", alive: true },
        { id: "w", name: "Sói", role: "WEREWOLF", alive: false },
      ]),
      "me",
    );

    expect(entry.players).toHaveLength(2);
    expect(entry.players[1].role).toBe("WEREWOLF");
  });

  it("ván cũ chưa lưu id người chơi: đọc được, chỉ thiếu phần của riêng mình", () => {
    // Đây là dữ liệu đã nằm sẵn trong production trước khi `id` được thêm vào.
    // Làm hỏng cả trang vì mấy ván này là cách chắc chắn nhất để tính năng
    // trông như bị lỗi ngay hôm phát hành.
    const entry = toHistoryEntry(
      row([{ name: "Tôi", role: "SEER", alive: false }]),
      "me",
    );

    expect(entry.myRole).toBeNull();
    expect(entry.mySurvived).toBeNull();
    expect(entry.players).toHaveLength(1);
  });

  it("playerRoles hỏng hoặc không phải mảng thì trả danh sách rỗng, không ném", () => {
    for (const bad of [null, undefined, {}, "[]", 42]) {
      const entry = toHistoryEntry(row(bad), "me");
      expect(entry.players).toEqual([]);
      expect(entry.myRole).toBeNull();
    }
  });
});
