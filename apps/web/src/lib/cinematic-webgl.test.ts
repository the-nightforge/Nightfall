import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_RENDER_SCALE,
  canUseWebgl,
  hasWebglScene,
  renderScale,
} from "./cinematic-webgl";

describe("hasWebglScene", () => {
  it("chỉ NIGHTFALL có scene 3D ở bản thử nghiệm", () => {
    assert.equal(hasWebglScene("NIGHTFALL"), true);
    assert.equal(hasWebglScene("DAWN"), false);
    assert.equal(hasWebglScene("WOLVES_WIN"), false);
  });
});

describe("renderScale", () => {
  it("chặn TRẦN chứ không đặt cứng", () => {
    // Màn thường DPR 1 phải render ở 1, không bị kéo lên 1.5.
    assert.equal(renderScale(1), 1);
    assert.equal(renderScale(1.25), 1.25);
  });

  it("điện thoại DPR cao bị chặn lại", () => {
    // 1080x2400 ở DPR 3 là 7,7 triệu pixel mỗi khung; chặn ở 1.5 giảm ~4 lần.
    assert.equal(renderScale(3), MAX_RENDER_SCALE);
    assert.equal(renderScale(2), MAX_RENDER_SCALE);
  });

  it("giá trị vô lý không làm vỡ", () => {
    assert.equal(renderScale(0), 1);
    assert.equal(renderScale(-2), 1);
    assert.equal(renderScale(Number.NaN), 1);
  });
});

describe("canUseWebgl", () => {
  const ok = { mode: "video" as const, saveData: false, webgl2: true };

  it("máy đủ điều kiện thì cho chạy", () => {
    assert.equal(canUseWebgl(ok), true);
  });

  it("không có WebGL2 thì không", () => {
    assert.equal(canUseWebgl({ ...ok, webgl2: false }), false);
  });

  it("Save-Data thì không - người dùng đã nói là đừng tải hộ", () => {
    assert.equal(canUseWebgl({ ...ok, saveData: true }), false);
  });

  it('mode "none" thì không: đó là reduced-motion hoặc công tắc trong game', () => {
    assert.equal(canUseWebgl({ ...ok, mode: "none" }), false);
  });

  it('mode "css" thì không: máy đã bị hạ bậc vì một lý do nào đó', () => {
    assert.equal(canUseWebgl({ ...ok, mode: "css" }), false);
  });
});
