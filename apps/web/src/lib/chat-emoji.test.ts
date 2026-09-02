import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMOJI_GROUPS, insertEmoji } from "./chat-emoji";

const MAX = 300;

describe("insertEmoji", () => {
  it("chèn vào đúng chỗ con trỏ chứ không nối vào cuối", () => {
    const result = insertEmoji("X là sói", "🐺", 4, 4, MAX);
    assert.deepEqual(result, { text: "X là🐺 sói", caret: 6 });
  });

  it("thay vùng đang bôi đen, giống gõ một ký tự thường", () => {
    const result = insertEmoji("chắc chắn là sói", "🤔", 0, 9, MAX);
    assert.equal(result?.text, "🤔 là sói");
  });

  it("đặt con trỏ ngay sau biểu tượng vừa chèn", () => {
    const result = insertEmoji("", "👍", 0, 0, MAX);
    assert.equal(result?.caret, 2);
    assert.equal(result?.caret, result?.text.length);
  });

  it("từ chối thay vì cắt cụt khi chạm trần", () => {
    const full = "a".repeat(MAX - 1);
    assert.equal(insertEmoji(full, "👍", full.length, full.length, MAX), null);
  });

  it("vừa khít trần thì vẫn cho chèn", () => {
    const room = "a".repeat(MAX - 2);
    const result = insertEmoji(room, "👍", room.length, room.length, MAX);
    assert.equal(result?.text.length, MAX);
  });

  it("biểu tượng có ký tự biến thể vẫn đếm theo UTF-16 như <input>", () => {
    // "❤️" là U+2764 U+FE0F - hai đơn vị, đúng bằng thứ maxLength của trình
    // duyệt đếm. Lệch chỗ này thì ô nhập lặng lẽ xén mất chữ cuối.
    assert.equal(insertEmoji("", "❤️", 0, 0, MAX)?.text.length, 2);
    const full = "a".repeat(MAX - 1);
    assert.equal(insertEmoji(full, "❤️", full.length, full.length, MAX), null);
  });

  it("chịu được vị trí con trỏ vô nghĩa mà trình duyệt trả về", () => {
    // selectionStart là number | null, và ô nhập chưa từng được focus thì các
    // giá trị này không đáng tin. Chèn vào cuối còn hơn ném lỗi giữa lúc gõ.
    assert.equal(insertEmoji("abc", "👍", -5, -5, MAX)?.text, "👍abc");
    assert.equal(insertEmoji("abc", "👍", 99, 99, MAX)?.text, "abc👍");
    assert.equal(insertEmoji("abc", "👍", Number.NaN, Number.NaN, MAX)?.text, "abc👍");
  });

  it("vùng bôi đen ngược đầu đuôi vẫn chèn được", () => {
    assert.equal(insertEmoji("abc", "👍", 2, 0, MAX)?.text, "ab👍c");
  });
});

describe("EMOJI_GROUPS", () => {
  it("mỗi nhóm vừa đúng hai hàng sáu ô", () => {
    for (const group of EMOJI_GROUPS) {
      assert.equal(group.emojis.length, 12, group.label);
    }
  });

  it("không có biểu tượng nào lặp lại giữa các nhóm", () => {
    const all = EMOJI_GROUPS.flatMap((group) => group.emojis);
    assert.equal(new Set(all).size, all.length);
  });
});
