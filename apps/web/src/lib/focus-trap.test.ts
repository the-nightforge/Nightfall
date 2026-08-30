import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { trapIndex } from "./focus-trap";

/**
 * Chỉ phần thứ tự Tab được test ở đây.
 *
 * `focusableWithin` và `inertOutside` đọc DOM thật (getClientRects, thuộc tính
 * `inert`), mà bộ test này chạy trên `node --test` không có trình duyệt - dựng
 * một DOM giả cho chúng thì thứ được test là cái DOM giả đó chứ không phải hành
 * vi thật. `trapIndex` là chỗ chứa toàn bộ luật quay vòng, và đó mới là chỗ đã
 * sai ở mọi bản focus trap tự viết.
 */
describe("trapIndex", () => {
  it("Tab đi tới, và quay về đầu khi chạm cuối", () => {
    assert.equal(trapIndex(3, 0, false), 1);
    assert.equal(trapIndex(3, 1, false), 2);
    assert.equal(trapIndex(3, 2, false), 0);
  });

  it("Shift+Tab đi lui, và vòng về cuối khi chạm đầu", () => {
    assert.equal(trapIndex(3, 2, true), 1);
    assert.equal(trapIndex(3, 1, true), 0);
    assert.equal(trapIndex(3, 0, true), 2);
  });

  it("focus đang ở ngoài bẫy thì đi vào theo đúng chiều vừa ấn", () => {
    // Đây là lúc trình duyệt vừa trả focus về body vì phần tử cũ bị gỡ. Luôn
    // nhảy về phần tử đầu sẽ khiến Shift+Tab đi tới - ngược hẳn phím vừa bấm.
    assert.equal(trapIndex(4, -1, false), 0);
    assert.equal(trapIndex(4, -1, true), 3);
  });

  it("bẫy chỉ có một phần tử thì Tab đứng yên tại đó, không thoát ra ngoài", () => {
    // Chính là CinematicOverlay: cả lớp phủ chỉ có mỗi nút "Bỏ qua".
    assert.equal(trapIndex(1, 0, false), 0);
    assert.equal(trapIndex(1, 0, true), 0);
    assert.equal(trapIndex(1, -1, false), 0);
  });

  it("không có gì focus được thì trả -1, để bên gọi chặn Tab chứ không focus bừa", () => {
    assert.equal(trapIndex(0, -1, false), -1);
    assert.equal(trapIndex(0, 0, true), -1);
  });

  it("kết quả luôn nằm trong danh sách, ở mọi kích cỡ và mọi chiều", () => {
    for (let count = 1; count <= 6; count += 1) {
      for (let current = -1; current < count; current += 1) {
        for (const backwards of [false, true]) {
          const next = trapIndex(count, current, backwards);
          assert.ok(next >= 0 && next < count, `${count}/${current}/${backwards} -> ${next}`);
        }
      }
    }
  });
});
