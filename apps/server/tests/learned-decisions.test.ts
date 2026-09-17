import { describe, expect, it } from "vitest";
import { parseLearnedDecisions } from "../scripts/learned-decisions";

/**
 * Một parser cho `--learned-decisions` của mọi script (spec 2026-09-17 D2):
 * rollout và benchmark đọc lệch nhau là đo một cấu hình, train một cấu hình
 * khác — và không có dòng log nào than.
 */
describe("parseLearnedDecisions", () => {
  it("both giữ nguyên alias", () => {
    expect(parseLearnedDecisions("both")).toBe("both");
  });

  it("một cờ → chuỗi; nhiều cờ → mảng không trùng, đúng thứ tự", () => {
    expect(parseLearnedDecisions("final")).toBe("final");
    expect(parseLearnedDecisions("vote, night,final,hunter")).toEqual([
      "vote",
      "night",
      "final",
      "hunter",
    ]);
    expect(parseLearnedDecisions("hunter,vote,hunter")).toEqual(["hunter", "vote"]);
  });

  it("rỗng hoặc chỉ dấu phẩy → ném", () => {
    expect(() => parseLearnedDecisions("")).toThrow("--learned-decisions rỗng");
    expect(() => parseLearnedDecisions(" , ")).toThrow("--learned-decisions rỗng");
  });

  it("tên lạ → ném, liệt kê giá trị hợp lệ", () => {
    expect(() => parseLearnedDecisions("vote,speech")).toThrow(
      "vote | night | final | hunter | both",
    );
  });
});
