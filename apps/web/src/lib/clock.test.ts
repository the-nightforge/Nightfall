import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { recordServerTime, resetClock, serverNow, serverOffset } from "./clock";

describe("clock", () => {
  beforeEach(() => resetClock());

  it("chưa đo được mẫu nào thì offset là 0: y hệt hành vi cũ", () => {
    assert.equal(serverOffset(), 0);
  });

  it("máy chạy chậm 40 giây so với server thì offset dương bù lại đúng chừng đó", () => {
    recordServerTime(1_000_000, 960_000);
    assert.equal(serverOffset(), 40_000);
  });

  it("máy chạy nhanh hơn server thì offset âm", () => {
    recordServerTime(960_000, 1_000_000);
    assert.equal(serverOffset(), -40_000);
  });

  it("một mẫu lệch do tab bị treo không kéo được trung vị", () => {
    for (const receivedAt of [900, 901, 899, 900]) recordServerTime(1_000, receivedAt);
    // Snapshot này về trễ 5 giây vì tab ngủ; nó chỉ là một mẫu trong bảy.
    recordServerTime(1_000, 5_900);
    assert.equal(serverOffset(), 100);
  });

  it("chỉ giữ 7 mẫu gần nhất nên đồng hồ máy được chỉnh lại sẽ hội tụ về giá trị mới", () => {
    for (let i = 0; i < 7; i++) recordServerTime(1_000, 900);
    assert.equal(serverOffset(), 100);
    // Người chơi bật lại giờ tự động giữa ván: mẫu cũ phải trôi hết đi.
    for (let i = 0; i < 7; i++) recordServerTime(1_000, 1_000);
    assert.equal(serverOffset(), 0);
  });

  it("server cũ chưa gửi serverNow thì bỏ qua chứ không ghi mẫu rác", () => {
    recordServerTime(1_000, 900);
    recordServerTime(undefined, 900);
    recordServerTime(Number.NaN, 900);
    assert.equal(serverOffset(), 100);
  });

  it("serverNow cộng offset vào giờ máy", () => {
    recordServerTime(1_000_000, 960_000);
    const before = Date.now() + 40_000;
    const value = serverNow();
    assert.ok(value >= before && value <= Date.now() + 40_000 + 50);
  });
});
