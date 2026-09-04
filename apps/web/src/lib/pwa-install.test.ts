import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DISMISS_KEY,
  detectIOS,
  detectStandalone,
  inviteMode,
  loadDismissed,
  markSessionDismissed,
  readSessionDismissed,
  SESSION_DISMISS_KEY,
  saveDismissed,
  type InviteInputs,
} from "./pwa-install";

/** `matchMedia` giả: khớp đúng những display-mode được liệt kê. */
function mediaFor(...modes: string[]) {
  return (query: string) => ({ matches: modes.some((m) => query.includes(m)) });
}

describe("detectStandalone", () => {
  it("tab trình duyệt bình thường thì không phải standalone", () => {
    assert.equal(detectStandalone({ matchMedia: mediaFor("browser") }), false);
  });

  it("cửa sổ ứng dụng đã cài trên Chromium", () => {
    assert.equal(detectStandalone({ matchMedia: mediaFor("standalone") }), true);
  });

  it("minimal-ui và fullscreen cũng tính là đã cài", () => {
    assert.equal(detectStandalone({ matchMedia: mediaFor("minimal-ui") }), true);
    assert.equal(detectStandalone({ matchMedia: mediaFor("fullscreen") }), true);
  });

  it("Safari iOS chỉ có navigator.standalone, không có display-mode", () => {
    assert.equal(
      detectStandalone({ matchMedia: mediaFor("browser"), navigator: { standalone: true } }),
      true,
    );
  });

  it("navigator.standalone false không được lấn át display-mode", () => {
    assert.equal(
      detectStandalone({ matchMedia: mediaFor("standalone"), navigator: { standalone: false } }),
      true,
    );
  });

  it("không có matchMedia thì trả false chứ không ném", () => {
    assert.equal(detectStandalone({}), false);
  });

  it("matchMedia ném với media query lạ thì coi như không khớp", () => {
    assert.equal(
      detectStandalone({
        matchMedia: () => {
          throw new Error("SyntaxError");
        },
      }),
      false,
    );
  });
});

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD_OS13 =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

describe("detectIOS", () => {
  it("iPhone", () => {
    assert.equal(detectIOS({ userAgent: IPHONE, platform: "iPhone", maxTouchPoints: 5 }), true);
  });

  it("Android không phải iOS", () => {
    assert.equal(detectIOS({ userAgent: ANDROID, platform: "Linux armv8l", maxTouchPoints: 5 }), false);
  });

  it("iPad từ iPadOS 13 khai mình là Macintosh - nhận ra bằng số điểm chạm", () => {
    assert.equal(
      detectIOS({ userAgent: IPAD_OS13, platform: "MacIntel", maxTouchPoints: 5 }),
      true,
    );
  });

  it("Mac thật cùng user agent đó thì không phải iOS: maxTouchPoints là 0", () => {
    assert.equal(
      detectIOS({ userAgent: IPAD_OS13, platform: "MacIntel", maxTouchPoints: 0 }),
      false,
    );
  });

  it("thiếu maxTouchPoints thì coi như không có cảm ứng", () => {
    assert.equal(detectIOS({ userAgent: IPAD_OS13, platform: "MacIntel" }), false);
  });
});

const BASE: InviteInputs = { standalone: false, ios: false, hasPrompt: false, dismissed: false };

describe("inviteMode", () => {
  it("Chromium đã bắn beforeinstallprompt thì hiện nút cài", () => {
    assert.equal(inviteMode({ ...BASE, hasPrompt: true }), "prompt");
  });

  it("desktop chưa đủ điều kiện cài thì không hiện gì cả", () => {
    assert.equal(inviteMode(BASE), "hidden");
  });

  it("iOS không có sự kiện nào nên chỉ còn hướng dẫn bằng tay", () => {
    assert.equal(inviteMode({ ...BASE, ios: true }), "ios-guide");
  });

  it("đã chạy standalone thì im lặng, kể cả khi vẫn bắt được sự kiện cài", () => {
    assert.equal(inviteMode({ ...BASE, standalone: true, hasPrompt: true }), "hidden");
  });

  it("đã cài rồi thì iOS cũng không hiện hướng dẫn nữa", () => {
    assert.equal(inviteMode({ ...BASE, standalone: true, ios: true }), "hidden");
  });

  it("đã đóng lời mời thì không hiện lại, cả nút lẫn hướng dẫn", () => {
    assert.equal(inviteMode({ ...BASE, dismissed: true, hasPrompt: true }), "hidden");
    assert.equal(inviteMode({ ...BASE, dismissed: true, ios: true }), "hidden");
  });

  it("nút thật thắng hướng dẫn: nếu một trình duyệt iOS nào đó bắn được sự kiện thật", () => {
    assert.equal(inviteMode({ ...BASE, ios: true, hasPrompt: true }), "prompt");
  });
});

/** localStorage giả, đủ hai phương thức mà module dùng. */
function fakeStore(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    read: (k: string) => map.get(k) ?? null,
  };
}

describe("ghi nhớ việc đóng lời mời", () => {
  it("máy sạch thì chưa đóng lần nào", () => {
    assert.equal(loadDismissed(fakeStore()), false);
  });

  it("đóng rồi thì đọc lại vẫn thấy", () => {
    const store = fakeStore();
    saveDismissed(store);
    assert.equal(store.read(DISMISS_KEY), "1");
    assert.equal(loadDismissed(store), true);
  });

  it("giá trị lạ trong localStorage không được đọc thành đã đóng", () => {
    assert.equal(loadDismissed(fakeStore({ [DISMISS_KEY]: "false" })), false);
  });

  it("localStorage ném (Safari riêng tư) thì coi như chưa đóng, không vỡ trang", () => {
    const throwing = {
      getItem() {
        throw new Error("SecurityError");
      },
      setItem() {
        throw new Error("SecurityError");
      },
    };
    assert.equal(loadDismissed(throwing), false);
    assert.doesNotThrow(() => saveDismissed(throwing));
  });
});

/**
 * Thay `globalThis.localStorage` bằng một getter ném lỗi, trả về hàm khôi phục.
 *
 * Ném ở GETTER chứ không phải ở `getItem`. Đây là hai lỗi khác nhau và bản đầu
 * chỉ chống được lỗi thứ hai: Safari chế độ riêng tư, Chrome khi người dùng
 * chặn cookie của bên thứ nhất, và một số WebView doanh nghiệp ném ngay lúc
 * ĐỌC thuộc tính `localStorage`, trước khi có cơ hội gọi phương thức nào.
 *
 * Trả về hàm khôi phục chứ không tự dọn: descriptor gốc phải về đúng chỗ sau
 * mỗi ca, kể cả khi assertion ném giữa chừng - nếu không thì mọi test chạy sau
 * trong file này đều thừa hưởng một localStorage hỏng.
 */
function withThrowingLocalStorage(): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new DOMException("The operation is insecure.", "SecurityError");
    },
  });
  return () => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  };
}

/** Gỡ hẳn `localStorage` khỏi globalThis, trả về hàm khôi phục. */
function withoutLocalStorage(): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Reflect.deleteProperty(globalThis, "localStorage");
  return () => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
  };
}

describe("localStorage không dùng được", () => {
  it("getter ném SecurityError: loadDismissed trả false, không ném", () => {
    const restore = withThrowingLocalStorage();
    try {
      assert.equal(loadDismissed(), false);
    } finally {
      restore();
    }
  });

  it("getter ném SecurityError: saveDismissed nuốt lỗi", () => {
    const restore = withThrowingLocalStorage();
    try {
      assert.doesNotThrow(() => saveDismissed());
    } finally {
      restore();
    }
  });

  it("không có localStorage nào cả thì vẫn chạy được", () => {
    const restore = withoutLocalStorage();
    try {
      assert.equal(loadDismissed(), false);
      assert.doesNotThrow(() => saveDismissed());
    } finally {
      restore();
    }
  });

  it("getItem/setItem ném thì cũng vậy - lỗi cũ không được tái diễn", () => {
    const throwing = {
      getItem() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
      setItem() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    };
    assert.equal(loadDismissed(throwing), false);
    assert.doesNotThrow(() => saveDismissed(throwing));
  });

  it("descriptor gốc được trả lại nguyên vẹn sau mỗi ca", () => {
    const before = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    withThrowingLocalStorage()();
    assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, "localStorage"), before);
  });
});

describe("vòng đời đầy đủ: mời -> đóng -> im", () => {
  it("một lần đóng là tắt hẳn lời mời ở mọi lần vào sau", () => {
    const store = fakeStore();
    const probe = () =>
      inviteMode({ standalone: false, ios: true, hasPrompt: true, dismissed: loadDismissed(store) });

    assert.equal(probe(), "prompt");
    saveDismissed(store);
    assert.equal(probe(), "hidden");
  });
});

describe("cờ đóng trong bộ nhớ phiên", () => {
  /*
   * Đây là đường lùi khi localStorage bị chặn: lần đóng phải sống ít nhất
   * hết document này, nếu không đi vào phòng rồi quay ra là thẻ mời mọc lại.
   */
  it("document mới thì chưa đóng", () => {
    assert.equal(readSessionDismissed({}), false);
  });

  it("đánh dấu rồi thì đọc lại thấy", () => {
    const win = {};
    markSessionDismissed(win);
    assert.equal(readSessionDismissed(win), true);
  });

  it("giá trị lạ không được đọc thành đã đóng", () => {
    assert.equal(readSessionDismissed({ [SESSION_DISMISS_KEY]: "1" as unknown as boolean }), false);
  });
});
