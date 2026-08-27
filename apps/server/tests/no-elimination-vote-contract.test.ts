import { describe, expect, it } from "vitest";
import { votePayload } from "@masoi/shared";

describe("no-elimination vote contract", () => {
  it("nhận player id hoặc null nhưng giữ payload nghiêm ngặt", () => {
    expect(votePayload.parse({ targetId: "player-id" })).toEqual({ targetId: "player-id" });
    expect(votePayload.parse({ targetId: null })).toEqual({ targetId: null });

    // null là lựa chọn "không treo ai" có chủ đích, nên nới lỏng schema chỉ được
    // nới đúng chỗ đó: thiếu field, chuỗi rỗng và field thừa vẫn phải bị chặn.
    expect(votePayload.safeParse({}).success).toBe(false);
    expect(votePayload.safeParse({ targetId: "" }).success).toBe(false);
    expect(votePayload.safeParse({ targetId: null, extra: true }).success).toBe(false);
  });
});
