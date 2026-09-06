import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyMention,
  mentionCandidates,
  mentionQueryAt,
  mentionsName,
} from "./chat-mention";

describe("mentionQueryAt", () => {
  it("con trỏ ngay sau @ ở đầu câu", () => {
    assert.deepEqual(mentionQueryAt("@", 1), { start: 0, end: 1, query: "" });
  });

  it("đang gõ dở tên sau @", () => {
    assert.deepEqual(mentionQueryAt("nghi @Ho", 8), { start: 5, end: 8, query: "Ho" });
  });

  it("con trỏ đứng giữa tên vẫn lấy phần trước con trỏ", () => {
    assert.deepEqual(mentionQueryAt("@Hoang xong", 3), { start: 0, end: 3, query: "Ho" });
  });

  it("@ dính vào chữ trước (email) thì không phải nhắc tên", () => {
    assert.equal(mentionQueryAt("a@b", 3), null);
  });

  it("đã có dấu cách sau @ thì hết nhắc", () => {
    assert.equal(mentionQueryAt("@An ", 4), null);
  });

  it("không có @ thì null", () => {
    assert.equal(mentionQueryAt("nghi An", 7), null);
  });
});

describe("mentionCandidates", () => {
  const names = ["Hoàng Anh", "Mai Chi", "An", "Đức", "Hà", "Jack", "Ngọc Lan"];

  it("rỗng thì lấy vài tên đầu, giữ nguyên thứ tự", () => {
    assert.deepEqual(mentionCandidates("", names, 3), ["Hoàng Anh", "Mai Chi", "An"]);
  });

  it("khớp không dấu, không phân biệt hoa thường, theo đầu từ", () => {
    assert.deepEqual(mentionCandidates("ho", names), ["Hoàng Anh"]);
    assert.deepEqual(mentionCandidates("duc", names), ["Đức"]);
    assert.deepEqual(mentionCandidates("an", names), ["Hoàng Anh", "An"]);
    assert.deepEqual(mentionCandidates("lan", names), ["Ngọc Lan"]);
  });

  it("gõ có dấu vẫn khớp", () => {
    assert.deepEqual(mentionCandidates("Hà", names), ["Hà"]);
  });

  it("không khớp giữa từ", () => {
    assert.deepEqual(mentionCandidates("oang", names), []);
  });

  it("giới hạn số kết quả", () => {
    assert.equal(mentionCandidates("", names, 5).length, 5);
  });
});

describe("applyMention", () => {
  it("thay đoạn @query bằng @Tên và một dấu cách, con trỏ đứng sau dấu cách", () => {
    const r = applyMention("nghi @Ho lắm", { start: 5, end: 8, query: "Ho" }, "Hoàng Anh");
    assert.ok(r);
    assert.equal(r.text, "nghi @Hoàng Anh lắm");
    assert.equal(r.caret, "nghi @Hoàng Anh ".length);
  });

  it("ở cuối câu thì thêm dấu cách để gõ tiếp", () => {
    const r = applyMention("@", { start: 0, end: 1, query: "" }, "An");
    assert.ok(r);
    assert.equal(r.text, "@An ");
    assert.equal(r.caret, 4);
  });

  it("không vượt trần ký tự", () => {
    const long = "x".repeat(296) + " @";
    const r = applyMention(long, { start: 297, end: 298, query: "" }, "Hoàng Anh", 300);
    assert.equal(r, null);
  });
});

describe("mentionsName", () => {
  it("@Tên ở bất kỳ đâu, không dấu cũng được", () => {
    assert.equal(mentionsName("tôi nghi @Hoàng Anh nhất", "Hoàng Anh"), true);
    assert.equal(mentionsName("tôi nghi @hoang anh nhất", "Hoàng Anh"), true);
  });

  it("tên đứng đầu câu là đang gọi mình", () => {
    assert.equal(mentionsName("An nghĩ sao?", "An"), true);
    assert.equal(mentionsName("an oi sao vote t", "An"), true);
  });

  it("tên nằm giữa câu, không có @, thì không tính", () => {
    assert.equal(mentionsName("tôi thấy An hơi im", "An"), false);
  });

  it("chữ thường trùng một phần tên thì không tính", () => {
    assert.equal(mentionsName("Anh ơi", "An"), false);
    assert.equal(mentionsName("@Anh", "An"), false);
  });
});
