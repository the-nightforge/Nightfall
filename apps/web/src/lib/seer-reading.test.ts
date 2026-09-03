import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { seerReading } from "./seer-reading";

describe("seerReading", () => {
  it("nói đúng ba phe, mỗi phe một câu và một màu", () => {
    assert.equal(seerReading("wolves", true).label, "Ma Sói!");
    assert.equal(seerReading("village", false).label, "Phe làng");
    assert.equal(seerReading("neutral", false).label, "Phe trung lập");

    const colors = new Set(
      (["wolves", "village", "neutral"] as const).map((team) => seerReading(team, false).className),
    );
    assert.equal(colors.size, 3);
  });

  it("kết quả trung lập KHÔNG mang màu xanh của phe làng", () => {
    // Đây là cả điểm của phe thứ ba ở màn này: một Tiên Tri thấy màu xanh sẽ
    // đem uy tín của mình ra bảo lãnh cho người không chơi cho làng.
    assert.notEqual(
      seerReading("neutral", false).className,
      seerReading("village", false).className,
    );
  });

  it("server cũ không gửi team thì đọc lại đúng thứ bản build kia biết", () => {
    // Ở server cũ chưa có vai trung lập nào, nên "không phải Sói" ở đó đúng
    // bằng "phe làng" - đường lui này không đoán bừa.
    assert.equal(seerReading(undefined, true).label, "Ma Sói!");
    assert.equal(seerReading(undefined, false).label, "Phe làng");
    assert.equal(seerReading(undefined, undefined).label, "Phe làng");
  });
});
