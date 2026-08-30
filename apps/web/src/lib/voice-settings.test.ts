import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { DEFAULT_VOICE_SETTINGS, loadVoiceSettings, saveVoiceSettings } from "./voice-settings";

const KEY = "masoi.voice";

function useStore(store: Record<string, string>) {
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => void (store[k] = v),
    },
    configurable: true,
  });
}

function useThrowingStore() {
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem() {
        throw new Error("SecurityError");
      },
      setItem() {
        throw new Error("SecurityError");
      },
    },
    configurable: true,
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: undefined, configurable: true });
});

describe("mặc định", () => {
  /**
   * Push-to-talk là mặc định có chủ ý: người đang chơi không bị đổi hành vi dưới
   * chân, và với một game bí mật thì "phải chủ động giữ mới phát" là lựa chọn an
   * toàn hơn. Latch là thứ người chơi tự chọn.
   */
  it("là push-to-talk", () => {
    assert.equal(DEFAULT_VOICE_SETTINGS.micMode, "ptt");
  });

  it("chưa lưu gì thì trả về mặc định", () => {
    useStore({});
    assert.deepEqual(loadVoiceSettings(), DEFAULT_VOICE_SETTINGS);
  });
});

describe("đọc và ghi", () => {
  it("giữ được chế độ đã chọn", () => {
    const store: Record<string, string> = {};
    useStore(store);
    saveVoiceSettings({ micMode: "toggle" });
    assert.equal(loadVoiceSettings().micMode, "toggle");
    assert.ok(store[KEY], "phải ghi vào đúng khoá");
  });

  it("giá trị lạ thì rơi về mặc định chứ không giữ nguyên", () => {
    useStore({ [KEY]: JSON.stringify({ micMode: "vhf-radio" }) });
    assert.equal(loadVoiceSettings().micMode, "ptt");
  });

  it("JSON hỏng cũng rơi về mặc định", () => {
    useStore({ [KEY]: "{{{" });
    assert.deepEqual(loadVoiceSettings(), DEFAULT_VOICE_SETTINGS);
  });
});

describe("localStorage không dùng được", () => {
  /**
   * Safari chế độ riêng tư ném ngay ở getItem. Mất thiết lập còn hơn vỡ trang -
   * cùng lý do đã ghi trong audio-settings.ts.
   */
  it("đọc bị ném lỗi thì vẫn trả về mặc định", () => {
    useThrowingStore();
    assert.deepEqual(loadVoiceSettings(), DEFAULT_VOICE_SETTINGS);
  });

  it("ghi bị ném lỗi thì nuốt, không làm vỡ trang", () => {
    useThrowingStore();
    assert.doesNotThrow(() => saveVoiceSettings({ micMode: "toggle" }));
  });

  it("không có localStorage (server render) cũng không nổ", () => {
    assert.deepEqual(loadVoiceSettings(), DEFAULT_VOICE_SETTINGS);
    assert.doesNotThrow(() => saveVoiceSettings({ micMode: "toggle" }));
  });
});
