import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { STAGGER_TOTAL_MS, staggerDelay } from "./motion";

describe("staggerDelay", () => {
  it("phần tử đầu không bao giờ phải chờ", () => {
    assert.equal(staggerDelay(0, 15), 0);
    assert.equal(staggerDelay(0, 1), 0);
  });

  it("danh sách dài không được vượt trần tổng thời gian", () => {
    // 15 ghế x 60ms = 900ms: ô cuối hiện ra sau khi người chơi đã nhìn xong
    // cả bàn. Trần này là lý do hàm tồn tại.
    assert.ok(staggerDelay(14, 15) <= STAGGER_TOTAL_MS);
    assert.ok(staggerDelay(199, 200) <= STAGGER_TOTAL_MS);
  });

  it("danh sách ngắn vẫn tách bạch được từng phần tử", () => {
    const gap = staggerDelay(1, 2) - staggerDelay(0, 2);
    assert.ok(gap > 0 && gap <= 70, `khoang cach ${gap}ms nam ngoai khoang de chiu`);
  });

  it("danh sách thực tế luôn tăng dần", () => {
    // Chỉ giữ thứ tự tăng nghiêm ngặt ở kích cỡ thực tế. Với count >= 262,
    // làm tròn mili-giây khiến hai phần tử liền nhau có thể vào cùng một khung hình.
    for (const count of [2, 5, 15]) {
      for (let i = 1; i < count; i += 1) {
        assert.ok(staggerDelay(i, count) > staggerDelay(i - 1, count));
      }
    }
  });

  it("danh sách lớn giữ trần và không lùi lại", () => {
    // Trần được giữ luôn; thứ tự chỉ non-decreasing vì làm tròn mili-giây.
    const count = 1000;
    for (let i = 0; i < count; i += 1) {
      assert.ok(staggerDelay(i, count) <= STAGGER_TOTAL_MS, `Delay at index ${i} exceeds cap`);
      if (i > 0) {
        assert.ok(
          staggerDelay(i, count) >= staggerDelay(i - 1, count),
          `Non-monotonic at index ${i}`
        );
      }
    }
  });

  it("đầu vào vô lý không làm vỡ", () => {
    assert.equal(staggerDelay(0, 0), 0);
    assert.equal(staggerDelay(-3, 10), 0);
    assert.ok(staggerDelay(99, 10) <= STAGGER_TOTAL_MS);
  });
});
