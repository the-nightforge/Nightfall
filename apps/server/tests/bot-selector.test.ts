import { describe, expect, it } from "vitest";
import { chooseBrain } from "../src/bots/index";
import { randomBrain } from "../src/bots/random-brain";

const base = { enabled: true, maxCalls: 60 };

describe("chooseBrain", () => {
  it("dùng random khi không cấu hình nhà cung cấp nào", () => {
    expect(chooseBrain(base)).toBe(randomBrain);
  });

  it("dùng random khi bị tắt bằng cờ, dù có đủ key", () => {
    expect(
      chooseBrain({
        ...base,
        enabled: false,
        primaryBaseUrl: "https://x/v1",
        primaryApiKey: "k",
        primaryModel: "m",
      }),
    ).toBe(randomBrain);
  });

  // Thiếu một mảnh thì cả chặng đó bị bỏ, không được dựng brain nửa vời trỏ vào
  // URL rỗng rồi hỏng ở mọi lời gọi.
  it("bỏ qua chặng thiếu mảnh cấu hình", () => {
    expect(chooseBrain({ ...base, primaryBaseUrl: "https://x/v1", primaryApiKey: "k" })).toBe(
      randomBrain,
    );
  });

  it("một nhà cung cấp thì không bọc thêm lớp fallback", () => {
    const b = chooseBrain({ ...base, openaiApiKey: "k", openaiModel: "gpt" });
    expect(b.name).toBe("openai:gpt");
  });

  it("xếp chuỗi đúng thứ tự: proxy trước, OpenAI sau, Gemini cuối", () => {
    const b = chooseBrain({
      ...base,
      primaryBaseUrl: "https://x/v1",
      primaryApiKey: "k",
      primaryModel: "gemini-3.7-flash",
      openaiApiKey: "k2",
      openaiModel: "gpt-5.6-luna",
      geminiApiKey: "k3",
      geminiModel: "gemini-3.5-flash-lite",
    });
    expect(b.name).toBe("primary:gemini-3.7-flash->openai:gpt-5.6-luna->gemini");
  });

  it("cắt dấu / thừa ở cuối base URL", () => {
    const b = chooseBrain({
      ...base,
      primaryBaseUrl: "https://x/v1//",
      primaryApiKey: "k",
      primaryModel: "m",
    });
    expect(b.name).toBe("primary:m");
  });
});
