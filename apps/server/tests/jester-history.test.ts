import { describe, expect, it, vi } from "vitest";

// Cùng lý do với `match-history.test.ts`: `http.ts` kéo prisma và redis ở tầng
// module, còn bài test này chỉ quan tâm phép chuyển đổi thuần.
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
    caseFile: null,
    createdAt: new Date("2026-09-03T10:00:00Z"),
  };
}

describe("lịch sử trận - thắng lợi cá nhân", () => {
  it("giữ nguyên thành tích của người đang hỏi và của cả đội hình", () => {
    const entry = toHistoryEntry(
      row([
        {
          id: "me",
          name: "Tôi",
          role: "JESTER",
          alive: false,
          personalWin: { condition: "JESTER_LYNCHED", round: 3 },
        },
        { id: "other", name: "Người khác", role: "WEREWOLF", alive: true },
      ]),
      "me",
    );

    expect(entry.myPersonalWin).toEqual({ condition: "JESTER_LYNCHED", round: 3 });
    expect(entry.players[0].personalWin).toEqual({ condition: "JESTER_LYNCHED", round: 3 });
    expect(entry.players[1].personalWin).toBeUndefined();
  });

  it("ván cũ không có trường này vẫn đọc được, chỉ là không có thành tích", () => {
    // Đây là dữ liệu đã nằm sẵn trong production. Ván trước bản này không có
    // vai trung lập nào, nên "không có thành tích" đúng là sự thật của chúng.
    const entry = toHistoryEntry(
      row([{ id: "me", name: "Tôi", role: "SEER", alive: true }]),
      "me",
    );

    expect(entry.myPersonalWin).toBeNull();
    expect(entry.players[0].personalWin).toBeUndefined();
  });

  it("điều kiện lạ bị bỏ, nhưng người chơi thì KHÔNG bị bỏ theo", () => {
    /*
     * Cột Json giữ nguyên hình dạng của bản build đã ghi nó, nên một điều kiện
     * đã đổi tên hay bị gỡ vẫn nằm trong lịch sử. Tra nó vào bảng nhãn ra
     * `undefined`, và lỗi đó nổ giữa lúc render TRANG CHỦ - chỗ mà nạn nhân gặp
     * lại đúng màn hình hỏng đó mọi lần vào.
     */
    const entry = toHistoryEntry(
      row([
        {
          id: "me",
          name: "Tôi",
          role: "JESTER",
          alive: false,
          personalWin: { condition: "MỘT_ĐIỀU_KIỆN_ĐÃ_BỊ_GỠ", round: 3 },
        },
      ]),
      "me",
    );

    expect(entry.players).toHaveLength(1);
    expect(entry.players[0].role).toBe("JESTER");
    expect(entry.players[0].personalWin).toBeUndefined();
    expect(entry.myPersonalWin).toBeNull();
  });

  it("thành tích thiếu vòng cũng bị coi là méo", () => {
    const entry = toHistoryEntry(
      row([
        {
          id: "me",
          name: "Tôi",
          role: "JESTER",
          alive: false,
          personalWin: { condition: "JESTER_LYNCHED" },
        },
      ]),
      "me",
    );

    expect(entry.players[0].personalWin).toBeUndefined();
  });
});
