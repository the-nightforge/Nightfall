import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canSendMessage } from "./chat-draft";

describe("canSendMessage", () => {
  it("có chữ thì gửi được", () => {
    assert.equal(canSendMessage("chào cả phòng"), true);
  });

  it("chuỗi rỗng thì không", () => {
    assert.equal(canSendMessage(""), false);
  });

  it("toàn dấu cách thì không - nút phải tắt chứ không gửi một dòng trắng", () => {
    assert.equal(canSendMessage("   "), false);
  });

  it("tab và xuống dòng cũng là rỗng", () => {
    assert.equal(canSendMessage("\t\n  \r\n"), false);
  });

  /*
   * Bàn phím iOS chèn U+00A0 khi gõ hai dấu cách liền, và người dán chữ từ nơi
   * khác cũng hay kéo theo nó. Nhìn giống hệt dấu cách thường nên nếu lọt thì
   * người chơi thấy một bong bóng chat rỗng không hiểu ai gửi.
   */
  it("khoảng trắng không ngắt (U+00A0) vẫn là rỗng", () => {
    assert.equal(canSendMessage("  "), false);
  });

  it("chữ có dấu cách hai đầu vẫn gửi được", () => {
    assert.equal(canSendMessage("  ai là sói  "), true);
  });

  it("một ký tự cũng đủ", () => {
    assert.equal(canSendMessage("?"), true);
  });

  it("emoji đứng một mình là một tin nhắn hợp lệ", () => {
    assert.equal(canSendMessage("🐺"), true);
  });
});
