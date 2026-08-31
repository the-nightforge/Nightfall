import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDuration, formatWhen } from "./match-history";

describe("formatDuration", () => {
  it("dưới một phút chỉ nói giây", () => {
    assert.equal(formatDuration(45), "45 giây");
  });

  it("tròn phút thì bỏ phần giây", () => {
    assert.equal(formatDuration(600), "10 phút");
  });

  it("lẻ thì nói cả hai", () => {
    assert.equal(formatDuration(750), "12 phút 30 giây");
  });

  it("số âm hoặc rác không sinh ra chuỗi kỳ dị", () => {
    // durationSec tính từ createdAt của phòng; đồng hồ server nhảy lùi là đủ để
    // ra số âm, và "-3 phút" trong danh sách trông như lỗi hiển thị.
    assert.equal(formatDuration(-5), "0 giây");
  });
});

describe("formatWhen", () => {
  const now = Date.parse("2026-08-31T12:00:00Z");

  it("vừa xong", () => {
    assert.equal(formatWhen(now - 30_000, now), "vừa xong");
  });

  it("theo phút rồi theo giờ", () => {
    assert.equal(formatWhen(now - 25 * 60_000, now), "25 phút trước");
    assert.equal(formatWhen(now - 3 * 3_600_000, now), "3 giờ trước");
  });

  it("theo ngày khi đã quá một ngày", () => {
    assert.equal(formatWhen(now - 5 * 86_400_000, now), "5 ngày trước");
  });

  it("quá một tháng thì quay về ngày tuyệt đối", () => {
    // Mốc tương đối mất hết ý nghĩa ở khoảng này: "47 ngày trước" không giúp
    // ai định vị được gì.
    const old = formatWhen(now - 60 * 86_400_000, now);
    assert.match(old, /\d{1,2}\/\d{1,2}\/\d{4}/);
  });
});
