import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { playbackMode } from "./cinematic-settings";

const BASE = { reducedSetting: false, prefersReducedMotion: false, saveData: false };

describe("playbackMode", () => {
  it("mặc định thì phát clip", () => {
    assert.equal(playbackMode(BASE), "video");
  });

  it("prefers-reduced-motion là tắt hẳn, không phải hạ xuống bản CSS", () => {
    assert.equal(playbackMode({ ...BASE, prefersReducedMotion: true }), "none");
  });

  it("công tắc trong game cũng tắt hẳn: người chơi nói là không muốn xem", () => {
    assert.equal(playbackMode({ ...BASE, reducedSetting: true }), "none");
  });

  it("Save-Data chỉ cấm tải file, chuyển cảnh vẫn còn bằng CSS", () => {
    assert.equal(playbackMode({ ...BASE, saveData: true }), "css");
  });

  it("lý do sức khoẻ thắng lý do băng thông", () => {
    assert.equal(
      playbackMode({ reducedSetting: false, prefersReducedMotion: true, saveData: true }),
      "none",
    );
  });
});
