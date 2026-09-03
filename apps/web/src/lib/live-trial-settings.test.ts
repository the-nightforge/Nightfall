import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  DEFAULT_LIVE_TRIAL_SETTINGS,
  loadLiveTrialSettings,
  saveLiveTrialSettings,
} from "./live-trial-settings";
import { stageOwnsCinematic } from "./live-trial";

/**
 * `node:test` không có `localStorage`, nên bộ test tự dựng một cái.
 *
 * Đủ để khẳng định đúng thứ đáng khẳng định ở đây: giá trị rác không được biến
 * thành "bật", và một trình duyệt từ chối cho ghi/đọc không được làm vỡ trang.
 */
type Store = Record<string, string>;

function install(store: Store | "throws"): void {
  const api =
    store === "throws"
      ? {
          getItem() {
            throw new Error("Safari chế độ riêng tư");
          },
          setItem() {
            throw new Error("Safari chế độ riêng tư");
          },
        }
      : {
          getItem: (key: string) => store[key] ?? null,
          setItem: (key: string, value: string) => {
            store[key] = value;
          },
        };
  Object.defineProperty(globalThis, "localStorage", { value: api, configurable: true });
}

const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

afterEach(() => {
  if (original) Object.defineProperty(globalThis, "localStorage", original);
  else Reflect.deleteProperty(globalThis as Record<string, unknown>, "localStorage");
});

describe("thiết lập cá nhân", () => {
  let store: Store;
  beforeEach(() => {
    store = {};
    install(store);
  });

  it("MẶC ĐỊNH TẮT ở bản phát hành đầu", () => {
    assert.equal(DEFAULT_LIVE_TRIAL_SETTINGS.enabled, false);
    assert.equal(loadLiveTrialSettings().enabled, false);
  });

  it("ghi rồi đọc lại ra đúng lựa chọn", () => {
    saveLiveTrialSettings({ enabled: true });
    assert.equal(loadLiveTrialSettings().enabled, true);
    saveLiveTrialSettings({ enabled: false });
    assert.equal(loadLiveTrialSettings().enabled, false);
  });

  it("giá trị rác rơi về TẮT chứ không truthy thành bật", () => {
    for (const raw of ['{"enabled":"yes"}', '{"enabled":1}', "null", "[]", "không-phải-json"]) {
      store["masoi.live-trial"] = raw;
      assert.equal(loadLiveTrialSettings().enabled, false, raw);
    }
  });

  it("khoá RIÊNG, không dùng chung với thiết lập chuyển cảnh", () => {
    saveLiveTrialSettings({ enabled: true });
    assert.ok(Object.keys(store).includes("masoi.live-trial"));
    assert.ok(!Object.keys(store).includes("masoi.cinematic"));
  });

  it("trình duyệt từ chối localStorage thì mất thiết lập, không vỡ trang", () => {
    install("throws");
    assert.doesNotThrow(() => saveLiveTrialSettings({ enabled: true }));
    assert.equal(loadLiveTrialSettings().enabled, false);
  });
});

describe("ai sở hữu cảnh chuyển pha", () => {
  it("bật thì sân khấu sở hữu cả cảnh mở phiên toà lẫn cảnh phán quyết", () => {
    assert.equal(stageOwnsCinematic("TRIAL", true), true);
    assert.equal(stageOwnsCinematic("VERDICT", true), true);
  });

  it("không đụng tới cảnh của những pha khác", () => {
    for (const kind of ["NIGHTFALL", "DAWN", "VILLAGE_WIN", "WOLVES_WIN", "SPIRIT"] as const) {
      assert.equal(stageOwnsCinematic(kind, true), false, kind);
    }
  });

  it("tắt thì trả lại nguyên vẹn cho lớp phủ chuyển cảnh", () => {
    for (const kind of ["TRIAL", "VERDICT", "NIGHTFALL"] as const) {
      assert.equal(stageOwnsCinematic(kind, false), false, kind);
    }
  });
});
