import { describe, expect, it } from "vitest";
import { DEFAULT_ROOM_CONFIG, PHASES, finalVotePayload, roomConfigSchema } from "@masoi/shared";

describe("Schema phiên toà", () => {
  it("chèn hai pha mới đúng giữa VOTING và ELIMINATION", () => {
    const order = [...PHASES];
    expect(order.indexOf("DEFENSE")).toBe(order.indexOf("VOTING") + 1);
    expect(order.indexOf("FINAL_VOTE")).toBe(order.indexOf("DEFENSE") + 1);
    expect(order.indexOf("ELIMINATION")).toBe(order.indexOf("FINAL_VOTE") + 1);
  });

  it("nhận hai mốc thời gian mới trong khoảng hợp lệ", () => {
    const config = roomConfigSchema.parse({
      ...DEFAULT_ROOM_CONFIG,
      defenseSeconds: 30,
      finalVoteSeconds: 15,
    });
    expect(config.defenseSeconds).toBe(30);
    expect(config.finalVoteSeconds).toBe(15);
  });

  it("từ chối mốc thời gian ngoài khoảng", () => {
    expect(() => roomConfigSchema.parse({ ...DEFAULT_ROOM_CONFIG, defenseSeconds: 5 })).toThrow();
    expect(() => roomConfigSchema.parse({ ...DEFAULT_ROOM_CONFIG, defenseSeconds: 90 })).toThrow();
    // Cận dưới của finalVoteSeconds là 15 chứ không phải 10: chuỗi não bot mất
    // tới 13 giây ở trường hợp xấu nhất.
    expect(() => roomConfigSchema.parse({ ...DEFAULT_ROOM_CONFIG, finalVoteSeconds: 10 })).toThrow();
    expect(() => roomConfigSchema.parse({ ...DEFAULT_ROOM_CONFIG, finalVoteSeconds: 90 })).toThrow();
  });

  it("mặc định hạ thảo luận xuống 60 giây", () => {
    expect(DEFAULT_ROOM_CONFIG.discussionSeconds).toBe(60);
    expect(DEFAULT_ROOM_CONFIG.defenseSeconds).toBe(25);
    expect(DEFAULT_ROOM_CONFIG.finalVoteSeconds).toBe(20);
  });

  it("phiếu xác nhận chỉ nhận đúng một boolean", () => {
    expect(finalVotePayload.parse({ guilty: true })).toEqual({ guilty: true });
    expect(finalVotePayload.parse({ guilty: false })).toEqual({ guilty: false });
    expect(() => finalVotePayload.parse({ guilty: null })).toThrow();
    expect(() => finalVotePayload.parse({})).toThrow();
    expect(() => finalVotePayload.parse({ targetId: "p1" })).toThrow();
    expect(() => finalVotePayload.parse({ guilty: true, targetId: "p1" })).toThrow();
  });
});
