import { describe, expect, it } from "vitest";
import { engineVote } from "../src/bots/targets";
import type { PlannedVote } from "../src/bots/types";

const forPlayer = (targetId: string): PlannedVote => ({ type: "PLAYER", targetId });

// `usablePlannedVote` không còn tồn tại: phiếu ban ngày không được đóng băng từ
// pha thảo luận nữa, nên không có phiếu cũ nào cần kiểm tra lại tính hợp lệ. Ở
// mỗi mốc bỏ phiếu, lõi deterministic chọn lại trong `legalVoteChoices` mà
// chính engine phát ra, và luật hợp lệ chỉ còn đúng một bản.
describe("engineVote", () => {
  it("phiếu cho người chơi giữ nguyên id", () => {
    expect(engineVote(forPlayer("b"))).toBe("b");
  });

  it("phiếu không treo ai thành null, đúng cách engine mã hoá lựa chọn đó", () => {
    expect(engineVote({ type: "NO_ELIMINATION" })).toBeNull();
  });
});
