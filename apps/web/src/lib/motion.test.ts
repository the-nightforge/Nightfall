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

  it("thứ tự luôn tăng dần", () => {
    for (const count of [2, 5, 15]) {
      for (let i = 1; i < count; i += 1) {
        assert.ok(staggerDelay(i, count) > staggerDelay(i - 1, count));
      }
    }
  });

  it("đầu vào vô lý không làm vỡ", () => {
    assert.equal(staggerDelay(0, 0), 0);
    assert.equal(staggerDelay(-3, 10), 0);
    assert.ok(staggerDelay(99, 10) <= STAGGER_TOTAL_MS);
  });
});
