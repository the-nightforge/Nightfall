import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeJoinCode } from "./join-code";

/*
 * Mã phòng đến từ query string, nghĩa là đến từ người lạ.
 *
 * Trang phòng tự chuyển về `/?code=XXXXX` khi thiếu danh tính, nên đường này là
 * một luồng thật chứ không phải tiện ích: mã phải về đúng ô nhập, viết hoa, và
 * mọi thứ không phải mã phải rơi xuống null thay vì đổ rác vào ô.
 */
describe("normalizeJoinCode", () => {
  it("trả nguyên mã 5 ký tự hợp lệ", () => {
    assert.equal(normalizeJoinCode("ABCDE"), "ABCDE");
  });

  it("viết hoa mã người dùng gõ thường", () => {
    assert.equal(normalizeJoinCode("abcde"), "ABCDE");
  });

  it("cắt khoảng trắng hai đầu - dán từ chat hay dính dấu cách", () => {
    assert.equal(normalizeJoinCode("  ABCDE  "), "ABCDE");
  });

  it("nhận cả mã có chữ số", () => {
    assert.equal(normalizeJoinCode("A2B3C"), "A2B3C");
  });

  it("bỏ qua khi thiếu tham số", () => {
    assert.equal(normalizeJoinCode(null), null);
    assert.equal(normalizeJoinCode(undefined), null);
  });

  it("bỏ qua chuỗi rỗng", () => {
    assert.equal(normalizeJoinCode(""), null);
    assert.equal(normalizeJoinCode("   "), null);
  });

  it("bỏ qua mã sai độ dài", () => {
    assert.equal(normalizeJoinCode("ABCD"), null);
    assert.equal(normalizeJoinCode("ABCDEF"), null);
  });

  /*
   * Ô mã phòng có maxLength=5 và người dùng không gõ được ký tự lạ vào đó, nên
   * chốt này chỉ dành cho URL bịa: `/?code=<b>x` mà lọt vào state thì nó đi
   * thẳng vào `router.push("/room/...")`.
   */
  it("bỏ qua mã chứa ký tự ngoài bảng chữ và số", () => {
    assert.equal(normalizeJoinCode("AB-DE"), null);
    assert.equal(normalizeJoinCode("<b>xy"), null);
    assert.equal(normalizeJoinCode("AB DE"), null);
  });
});
