import { describe, expect, it } from "vitest";
import { gameActionPayload } from "@masoi/shared";

describe("schema bỏ qua thuốc của Phù Thủy", () => {
  it("chấp nhận SKIP không có mục tiêu", () => {
    expect(gameActionPayload.safeParse({ type: "SKIP", targetId: null }).success).toBe(true);
    expect(gameActionPayload.safeParse({ type: "SKIP" }).success).toBe(true);
  });
});
