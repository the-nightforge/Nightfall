import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./audio-settings";

function useStorage(store: Map<string, string>, failing = false) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => {
        if (failing) throw new Error("bị chặn");
        return store.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        if (failing) throw new Error("bị chặn");
        store.set(key, value);
      },
    },
  });
}

describe("audio settings", () => {
  beforeEach(() => useStorage(new Map()));

  it("chưa lưu gì thì trả mặc định", () => {
    assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
  });

  it("mặc định là nhạc nhỏ hơn hiệu ứng rõ rệt", () => {
    assert.equal(DEFAULT_SETTINGS.musicVolume, 0.4);
    assert.equal(DEFAULT_SETTINGS.sfxVolume, 0.8);
    assert.equal(DEFAULT_SETTINGS.muted, false);
  });

  it("ghi rồi đọc lại khớp", () => {
    saveSettings({ musicVolume: 0.1, sfxVolume: 0.9, muted: true });
    assert.deepEqual(loadSettings(), { musicVolume: 0.1, sfxVolume: 0.9, muted: true });
  });

  it("dùng đúng khoá masoi.audio", () => {
    const store = new Map<string, string>();
    useStorage(store);
    saveSettings({ musicVolume: 0.5, sfxVolume: 0.5, muted: false });
    assert.ok(store.has("masoi.audio"));
  });

  it("kẹp giá trị ra ngoài khoảng 0..1", () => {
    const store = new Map<string, string>();
    store.set("masoi.audio", JSON.stringify({ musicVolume: 5, sfxVolume: -3, muted: false }));
    useStorage(store);
    assert.deepEqual(loadSettings(), { musicVolume: 1, sfxVolume: 0, muted: false });
  });

  it("giá trị hỏng thì quay về mặc định của riêng trường đó", () => {
    const store = new Map<string, string>();
    store.set("masoi.audio", JSON.stringify({ musicVolume: "to lên", muted: true }));
    useStorage(store);
    assert.deepEqual(loadSettings(), {
      musicVolume: DEFAULT_SETTINGS.musicVolume,
      sfxVolume: DEFAULT_SETTINGS.sfxVolume,
      muted: true,
    });
  });

  it("JSON hỏng thì trả mặc định chứ không ném", () => {
    const store = new Map<string, string>();
    store.set("masoi.audio", "{ không phải json");
    useStorage(store);
    assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
  });

  it("localStorage bị chặn thì đọc trả mặc định và ghi không ném", () => {
    useStorage(new Map(), true);
    assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
    assert.doesNotThrow(() => saveSettings(DEFAULT_SETTINGS));
  });
});
