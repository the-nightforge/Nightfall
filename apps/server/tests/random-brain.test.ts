import { describe, expect, it } from "vitest";
import { randomBrain } from "../src/bots/random-brain";

describe("RandomBrain.renderDaySpeech", () => {
  // Ban ngày đã deterministic. Đường lui cuối cùng không được bịa ra một câu
  // không nguồn - câu chữ khi mọi nhà cung cấp hỏng là việc của renderBotSpeech
  // với mẫu cố định, dựng từ đúng ý định mà lõi AI đã chốt.
  it("không tự sinh lời thoại", async () => {
    expect(await randomBrain.renderDaySpeech()).toEqual({ ok: true, value: null });
  });

  it("không còn quyết định phiếu ban ngày nào", () => {
    expect("decideDay" in randomBrain).toBe(false);
  });
});
