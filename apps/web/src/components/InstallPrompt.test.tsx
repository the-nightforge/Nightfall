import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  DISMISS_KEY,
  INSTALL_CAPTURE_SCRIPT,
  PROMPT_BUFFER_KEY,
  SESSION_DISMISS_KEY,
} from "@/lib/pwa-install";

/**
 * Lời mời cài ứng dụng, MOUNT COMPONENT THẬT.
 *
 * Luật thuần đã nằm ở `lib/pwa-install.test.ts`. Ở đây chỉ giữ những thứ chỉ
 * nhìn thấy được khi component thực sự chạy trong một DOM:
 *
 *   - HTML server dựng ra phải RỖNG và lượt hydrate đầu phải khớp với nó, rồi
 *     mới hiện lên sau khi effect chạy - đây là chỗ duy nhất bắt được hydrate
 *     lệch, và chỉ bắt được khi thực sự đi qua `renderToString` + `hydrateRoot`;
 *   - `beforeinstallprompt` phải được `preventDefault()`, nếu không thì
 *     `prompt()` sau đó ném và cái nút thành nút chết;
 *   - bấm đóng phải ghi vào localStorage chứ không chỉ ẩn đi trong phiên này -
 *     và khi localStorage bị chặn thì vẫn phải nhớ được hết document này.
 *
 * Mọi thứ một ca thử động vào (`matchMedia`, `navigator`, localStorage, kho sự
 * kiện và cờ phiên trên `window`) đều được trả về nguyên trạng trong `finally`,
 * kể cả khi assertion ném giữa chừng. Cả file dùng chung một `window`, và một
 * ca để lại dấu vết là mọi ca sau đều đo sai.
 */

GlobalRegistrator.register({ url: "http://localhost:3000/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * Chạy CHÍNH đoạn script mà `layout.tsx` nhúng vào HTML - và chạy ĐÚNG MỘT LẦN.
 *
 * Không viết lại một bản giả tương đương: nửa còn lại của tính năng này nằm
 * trong chuỗi đó, và một bản chép tay trong test sẽ vẫn xanh sau khi bản thật
 * hỏng.
 *
 * Một lần, vì script gắn listener lên `window` mà không có cách gỡ - đúng như
 * trong trang thật, nơi nó chỉ được nhúng một lần. Bản đầu chạy lại nó ở mỗi
 * lần mount, nên tới ca thứ N mỗi sự kiện được bắt N lần.
 */
new Function(INSTALL_CAPTURE_SCRIPT)();

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36";
const IPHONE_SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 CriOS/126.0 Mobile/15E148 Safari/604.1";

/**
 * Ghi đè một thuộc tính, trả về hàm trả nó về đúng descriptor cũ.
 *
 * "Đúng descriptor cũ" chứ không phải "gán lại giá trị cũ": `navigator.userAgent`
 * của happy-dom là getter trên prototype, không phải own property. Gỡ own
 * property đi là getter đó tự hiện lại; còn gán một giá trị chết lên trên thì
 * là để lại một dấu vết khác.
 */
function override(target: object, key: PropertyKey, value: unknown): () => void {
  const original = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, writable: true, value });
  return () => {
    if (original) Object.defineProperty(target, key, original);
    else Reflect.deleteProperty(target, key);
  };
}

/**
 * Thay `globalThis.localStorage` bằng một getter ném `SecurityError`.
 *
 * Ném ngay ở GETTER, trước khi có cơ hội gọi phương thức nào - đúng kiểu Chrome
 * khi người dùng chặn cookie, Safari ở một số cấu hình riêng tư, và WebView
 * doanh nghiệp bị khoá storage.
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

/** Trả `window` về trạng thái của một document vừa mở: kho rỗng, chưa đóng. */
function resetDocumentMemory(): void {
  window[PROMPT_BUFFER_KEY] = null;
  Reflect.deleteProperty(window, SESSION_DISMISS_KEY);
}

interface EnvOptions {
  /** display-mode mà `matchMedia` sẽ báo là khớp. */
  displayMode?: string;
  userAgent?: string;
  maxTouchPoints?: number;
  /** Đã đóng ở một phiên trước, tức có sẵn trong localStorage. */
  dismissed?: boolean;
}

/** Những root đang gắn, để `withEnv` gỡ hết kể cả khi ca thử ném giữa chừng. */
const liveRoots = new Set<() => Promise<void>>();

/**
 * Dựng môi trường của một ca thử, chạy ca đó, rồi dọn sạch bất kể kết quả.
 *
 * happy-dom không dựng `display-mode`, và `navigator` của nó là thuộc tính chỉ
 * đọc. Ghi đè bằng defineProperty cho đúng cặp giá trị của từng ca - đây chính
 * là những đầu vào mà component không thể tự bịa ra được.
 */
async function withEnv(
  {
    displayMode = "browser",
    userAgent = ANDROID_UA,
    maxTouchPoints = 5,
    dismissed = false,
  }: EnvOptions,
  run: () => Promise<void>,
): Promise<void> {
  resetDocumentMemory();
  localStorage.clear();
  if (dismissed) localStorage.setItem(DISMISS_KEY, "1");

  const restores = [
    override(window, "matchMedia", (query: string) => ({ matches: query.includes(displayMode) })),
    override(navigator, "userAgent", userAgent),
    override(navigator, "maxTouchPoints", maxTouchPoints),
  ];
  try {
    await run();
  } finally {
    for (const unmount of Array.from(liveRoots)) await unmount();
    for (const restore of restores.reverse()) restore();
    localStorage.clear();
    resetDocumentMemory();
  }
}

/**
 * Nạp React và component SAU khi happy-dom đã đăng ký `window`.
 *
 * Import động thay vì import tĩnh ở đầu file: import tĩnh được nâng lên chạy
 * trước `GlobalRegistrator.register`, và react-dom đọc `window` ngay lúc nạp.
 */
async function loadReact() {
  const React = await import("react");
  const { hydrateRoot } = await import("react-dom/client");
  const { renderToString } = await import("react-dom/server");
  const { InstallPrompt } = await import("./InstallPrompt");
  return { React, act: React.act, hydrateRoot, renderToString, InstallPrompt };
}

/**
 * Mount đúng như production: server dựng HTML, client hydrate lên trên đó.
 *
 * Không phải `createRoot`: với `createRoot` thì đọc `innerHTML` ngay sau
 * `render()` chỉ thấy chuỗi rỗng vì React đồng thời chưa commit, và một
 * assertion trên chuỗi rỗng đó luôn xanh dù component có đọc `window` trong
 * lúc render hay không. `hydrateRoot` mới là thứ thực sự so lượt render đầu
 * của client với HTML của server, và báo lệch qua `onRecoverableError`.
 */
async function mountInvite() {
  const { React, act, hydrateRoot, renderToString, InstallPrompt } = await loadReact();
  const element = React.createElement(InstallPrompt);

  const serverHtml = renderToString(element);
  const host = document.createElement("div");
  host.innerHTML = serverHtml;
  document.body.append(host);

  const hydrationErrors: unknown[] = [];
  let root!: ReturnType<typeof hydrateRoot>;
  await act(async () => {
    root = hydrateRoot(host, element, {
      onRecoverableError: (error) => void hydrationErrors.push(error),
    });
  });

  const unmount = async () => {
    if (!liveRoots.delete(unmount)) return;
    await act(async () => root.unmount());
    host.remove();
  };
  liveRoots.add(unmount);

  return {
    serverHtml,
    hydrationErrors,
    act,
    section: () => host.querySelector("section"),
    text: () => host.textContent ?? "",
    button: (label: string) =>
      Array.from(host.querySelectorAll("button")).find(
        (b) => b.textContent?.includes(label) || b.getAttribute("aria-label")?.includes(label),
      ),
    unmount,
  };
}

/** `beforeinstallprompt` giả, đủ phần mà component đụng tới. */
function fireInstallEvent(outcome: "accepted" | "dismissed" = "accepted") {
  const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
    platforms: string[];
    userChoice: Promise<{ outcome: string; platform: string }>;
    prompt: () => Promise<void>;
    prompted: boolean;
  };
  event.platforms = ["web"];
  event.prompted = false;
  event.prompt = async () => {
    event.prompted = true;
  };
  event.userChoice = Promise.resolve({ outcome, platform: "web" });
  window.dispatchEvent(event);
  return event;
}

describe("InstallPrompt", () => {
  it("chưa có sự kiện cài nào thì không vẽ gì cả, và hydrate khớp server", async () => {
    await withEnv({}, async () => {
      const view = await mountInvite();
      assert.equal(view.serverHtml, "", "server không có gì để dựng");
      assert.deepEqual(view.hydrationErrors, [], "lượt render đầu của client phải khớp server");
      assert.equal(view.section(), null, "Chromium chưa mời cài thì ta cũng không mời");
    });
  });

  it("sự kiện bắn TRƯỚC khi component gắn vào vẫn phải hiện được nút", async () => {
    /*
     * Đây là ca thật của Chrome: đo trên bản build này nó bắn
     * `beforeinstallprompt` ở ~35ms, sớm hơn lúc React gắn listener. Nếu
     * component chỉ ngồi nghe sự kiện thì ca này im lặng vĩnh viễn.
     *
     * Và đây cũng là ca duy nhất hydrate CÓ THỂ lệch: kho đã đầy từ trước lượt
     * render đầu, nên nếu component đọc kho trong lúc render thay vì trong
     * effect thì client dựng ra một thẻ mà server không có.
     */
    await withEnv({}, async () => {
      fireInstallEvent();
      const view = await mountInvite();

      assert.equal(view.serverHtml, "", "server không biết gì về sự kiện");
      assert.deepEqual(view.hydrationErrors, [], "kho đầy sẵn cũng không được làm lượt hydrate đầu lệch");
      assert.ok(view.section(), "sự kiện tới sớm phải được kho giữ lại");
    });
  });

  it("bắt được beforeinstallprompt thì hiện nút cài, và giữ sự kiện lại", async () => {
    await withEnv({}, async () => {
      const view = await mountInvite();
      let event!: ReturnType<typeof fireInstallEvent>;
      await view.act(async () => {
        event = fireInstallEvent();
      });

      assert.ok(event.defaultPrevented, "không preventDefault thì prompt() sau đó sẽ ném");
      assert.ok(view.section(), "phải hiện thẻ mời");
      assert.ok(view.button("Cài ứng dụng"), "phải có nút cài");
    });
  });

  it("bấm nút cài thì mở hộp thoại thật rồi thu lời mời lại", async () => {
    await withEnv({}, async () => {
      const view = await mountInvite();
      let event!: ReturnType<typeof fireInstallEvent>;
      await view.act(async () => {
        event = fireInstallEvent("accepted");
      });
      await view.act(async () => {
        view.button("Cài ứng dụng")?.click();
      });

      assert.ok(event.prompted, "phải gọi prompt() của trình duyệt");
      assert.equal(view.section(), null, "cài xong thì lời mời biến mất");
      assert.equal(localStorage.getItem(DISMISS_KEY), "1", "cài xong là không mời nữa");
    });
  });

  it("từ chối trong hộp thoại hệ thống thì KHÔNG ghi vào localStorage", async () => {
    // Đó là câu trả lời cho lần này, không phải "đừng hỏi nữa".
    await withEnv({}, async () => {
      const view = await mountInvite();
      await view.act(async () => {
        fireInstallEvent("dismissed");
      });
      await view.act(async () => {
        view.button("Cài ứng dụng")?.click();
      });

      assert.equal(localStorage.getItem(DISMISS_KEY), null);
    });
  });

  it("bấm đóng là tắt hẳn: ẩn ngay, bỏ sự kiện đang giữ, và nhớ sang phiên sau", async () => {
    await withEnv({}, async () => {
      const view = await mountInvite();
      await view.act(async () => {
        fireInstallEvent();
      });
      await view.act(async () => {
        view.button("Đóng lời mời")?.click();
      });

      assert.equal(view.section(), null);
      assert.equal(localStorage.getItem(DISMISS_KEY), "1");
      assert.equal(window[PROMPT_BUFFER_KEY], null, "sự kiện cũ không được nằm lại trong kho");
    });

    // Phiên sau, localStorage còn nhớ: kho có sẵn sự kiện cũng không mời lại.
    await withEnv({ dismissed: true }, async () => {
      const view = await mountInvite();
      await view.act(async () => {
        fireInstallEvent();
      });
      assert.equal(view.section(), null, "đã đóng rồi thì không được mọc lại");
    });
  });

  it("iOS Safari: hướng dẫn bằng chữ, không có nút cài giả", async () => {
    await withEnv({ userAgent: IPHONE_SAFARI_UA }, async () => {
      const view = await mountInvite();
      assert.ok(view.section(), "iPhone phải thấy hướng dẫn");
      assert.match(view.text(), /Chia sẻ/);
      assert.match(view.text(), /Thêm vào Màn hình chính/);
      assert.equal(view.button("Cài ứng dụng"), undefined, "Safari không cho tự mở hộp thoại cài");
    });
  });

  it("hướng dẫn iOS không chỉ vào một thanh công cụ cụ thể", async () => {
    /*
     * `detectIOS` nhận cả Chrome và Firefox trên iOS, và cả iPad. Ở Chrome iOS
     * nút Chia sẻ nằm trong menu ba chấm, còn trên iPad thanh công cụ ở TRÊN.
     * Câu "ở thanh dưới Safari" của bản đầu sai với phần lớn số đó, và một
     * hướng dẫn chỉ sai chỗ thì tệ hơn là không có hướng dẫn.
     */
    await withEnv({ userAgent: IPHONE_CHROME_UA }, async () => {
      const view = await mountInvite();
      const text = view.text();
      assert.doesNotMatch(text, /Safari/, "đừng gọi tên một trình duyệt cụ thể");
      assert.doesNotMatch(text, /thanh dưới|thanh trên|góc dưới|góc trên/, "đừng chỉ vị trí");
      assert.match(text, /Chia sẻ/);
      assert.match(text, /Thêm vào Màn hình chính/);
    });
  });

  it("localStorage hỏng: bấm đóng vẫn ẩn lời mời ngay trong phiên này", async () => {
    /*
     * Ném ngay ở GETTER `localStorage` - lỗi mà bản đầu không chống được. Nếu
     * `saveDismissed` để lỗi lọt ra thì `setMode("hidden")` đứng ngay sau nó
     * không bao giờ chạy: người dùng bấm đóng mà thẻ vẫn nằm nguyên đó.
     */
    await withEnv({}, async () => {
      const view = await mountInvite();
      await view.act(async () => {
        fireInstallEvent();
      });
      assert.ok(view.section(), "phải đang hiện trước đã");

      const restore = withThrowingLocalStorage();
      try {
        await view.act(async () => {
          view.button("Đóng lời mời")?.click();
        });
        assert.equal(view.section(), null, "không lưu được vẫn phải ẩn đi");
      } finally {
        restore();
      }

      // Descriptor gốc phải về đúng chỗ, nếu không mọi ca sau đều thừa hưởng lỗi.
      assert.doesNotThrow(() => globalThis.localStorage.getItem("bất kỳ"));
    });
  });

  it("localStorage bị chặn: đóng một lần là im cả document, kể cả khi mount lại", async () => {
    /*
     * Đây là ca đi vào phòng rồi quay ra trang chủ khi localStorage bị chặn.
     *
     * `saveDismissed` nuốt lỗi đúng cách nhưng không có chỗ nào khác nhớ lần
     * đóng, còn kho trên `window` thì vẫn giữ nguyên sự kiện cũ: component
     * mount lại đọc kho và mọc lại đúng thứ người ta vừa đóng. Đo được trước
     * khi sửa: firstVisible=true, afterDismissVisible=false,
     * afterRemountVisible=true.
     *
     * Chỉ dọn kho là chưa đủ - Chromium có thể bắn một `beforeinstallprompt`
     * mới trong cùng document - nên ca này bắn thêm sự kiện mới ở cả lần mount
     * cũ lẫn lần mount mới.
     */
    await withEnv({}, async () => {
      const first = await mountInvite();
      await first.act(async () => {
        fireInstallEvent();
      });
      const firstVisible = first.section() !== null;

      const restore = withThrowingLocalStorage();
      try {
        await first.act(async () => {
          first.button("Đóng lời mời")?.click();
        });
        const afterDismissVisible = first.section() !== null;
        await first.act(async () => {
          fireInstallEvent();
        });
        const afterNewEventSameMountVisible = first.section() !== null;
        await first.unmount();

        const second = await mountInvite();
        const afterRemountVisible = second.section() !== null;
        await second.act(async () => {
          fireInstallEvent();
        });
        const afterNewEventVisible = second.section() !== null;
        await second.unmount();

        assert.deepEqual(
          {
            firstVisible,
            afterDismissVisible,
            afterNewEventSameMountVisible,
            afterRemountVisible,
            afterNewEventVisible,
          },
          {
            firstVisible: true,
            afterDismissVisible: false,
            afterNewEventSameMountVisible: false,
            afterRemountVisible: false,
            afterNewEventVisible: false,
          },
        );
      } finally {
        restore();
      }
    });
  });

  it("document mới, chưa đóng lần nào: nút cài vẫn hiện bình thường", async () => {
    /*
     * Chạy ngay sau ca trên là có chủ ý: cờ phiên của lần đóng trước phải đã
     * được dọn, và quan trọng hơn - cách sửa lỗi kia không được biến thành
     * "tắt vĩnh viễn lời mời" với người chưa từng bấm đóng.
     */
    await withEnv({}, async () => {
      const view = await mountInvite();
      await view.act(async () => {
        fireInstallEvent();
      });
      assert.ok(view.button("Cài ứng dụng"), "chưa đóng bao giờ thì phải được mời");
    });
  });

  it("đang chạy standalone thì im lặng, kể cả trên iPhone", async () => {
    await withEnv({ displayMode: "standalone", userAgent: IPHONE_SAFARI_UA }, async () => {
      const view = await mountInvite();
      assert.equal(view.section(), null, "đã cài rồi mà vẫn mời cài là lỗi khó chịu nhất ở đây");
    });
  });

  it("appinstalled thu lời mời lại ngay, không đợi mở lại app, kể cả khi storage bị chặn", async () => {
    await withEnv({}, async () => {
      const view = await mountInvite();
      await view.act(async () => {
        fireInstallEvent();
      });
      assert.ok(view.section());

      // Cài xong không cần ghi gì cả, nên storage bị chặn cũng không được ném.
      const restore = withThrowingLocalStorage();
      try {
        await view.act(async () => {
          window.dispatchEvent(new Event("appinstalled"));
        });
      } finally {
        restore();
      }
      assert.equal(view.section(), null);
      assert.equal(window[PROMPT_BUFFER_KEY], null, "kho phải được dọn");
    });
  });
});
