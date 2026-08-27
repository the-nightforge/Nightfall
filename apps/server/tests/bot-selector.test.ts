import { describe, expect, it } from "vitest";
import { chooseBrain } from "../src/bots/index";
import { randomBrain } from "../src/bots/random-brain";

describe("chooseBrain", () => {
  it("dùng random khi không có API key", () => {
    expect(chooseBrain({ enabled: true, apiKey: "", model: "m", maxCalls: 60 })).toBe(randomBrain);
  });

  it("dùng random khi bị tắt bằng cờ", () => {
    expect(chooseBrain({ enabled: false, apiKey: "k", model: "m", maxCalls: 60 })).toBe(randomBrain);
  });

  it("dùng Gemini khi đủ điều kiện", () => {
    expect(chooseBrain({ enabled: true, apiKey: "k", model: "m", maxCalls: 60 }).name).toBe("gemini");
  });
});
