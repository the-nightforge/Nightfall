import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

/**
 * Đăng ký service worker.
 *
 * Ba điều duy nhất đáng kiểm ở đây, và cả ba đều là điều kiện để phần còn lại
 * của PWA tồn tại:
 *
 *   - production thì có đăng ký, dev thì không;
 *   - đăng ký hỏng KHÔNG được ném ra ngoài effect - nó sẽ thành một lỗi React
 *     chưa bắt và giết cả cây component bên dưới;
 *   - đăng ký hỏng phải để lại đúng một dòng cảnh báo, vì bản đầu nuốt sạch và
 *     không còn gì để lần khi có người báo lỗi.
 *
 * Mỗi ca ghi đè `navigator.serviceWorker`, `document.readyState`,
 * `process.env.NODE_ENV` và `console.warn`; tất cả được trả về nguyên trạng
 * trong `finally`, kể cả khi assertion ném. Một `console.warn` bị thay mà
 * không trả lại là mọi cảnh báo của các ca sau biến mất không dấu vết.
 */

GlobalRegistrator.register({ url: "http://localhost:3000/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Đổi `process.env.NODE_ENV`.
 *
 * Next khai thuộc tính này là readonly trong `next-env.d.ts` - đúng cho mã
 * ứng dụng, nơi nó là một hằng số được thay lúc build. Trong test thì nó lại
 * chính là đầu vào cần đổi, nên đi vòng qua chữ ký index của `ProcessEnv`.
 */
function setNodeEnv(value: string | undefined): void {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = value;
}

/**
 * Ghi đè một thuộc tính, trả về hàm trả nó về đúng descriptor cũ.
 *
 * `navigator.serviceWorker` và `document.readyState` của happy-dom đều là
 * getter trên prototype, không phải own property: gỡ own property đi là getter
 * tự hiện lại, còn gán một giá trị chết lên trên thì là để lại một dấu vết khác.
 */
function override(target: object, key: PropertyKey, value: unknown): () => void {
  const original = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, writable: true, value });
  return () => {
    if (original) Object.defineProperty(target, key, original);
    else Reflect.deleteProperty(target, key);
  };
}

interface RegistrarView {
  registered: string[];
  warnings: unknown[][];
}

/** Mount registrar trong môi trường của một ca thử, chạy ca đó, rồi dọn sạch. */
async function withRegistrar(
  { nodeEnv = "production", failWith = null }: { nodeEnv?: string; failWith?: Error | null },
  run: (view: RegistrarView) => Promise<void>,
): Promise<void> {
  const registered: string[] = [];
  const warnings: unknown[][] = [];

  const restores = [
    override(navigator, "serviceWorker", {
      register: async (url: string) => {
        registered.push(url);
        if (failWith) throw failWith;
        return { scope: "/" };
      },
    }),
    // Đăng ký ngay thay vì đợi `load`: happy-dom không bắn sự kiện đó.
    override(document, "readyState", "complete"),
  ];

  /*
   * Nạp React TRƯỚC khi động vào NODE_ENV, và thứ tự này không đổi được.
   *
   * React đọc `NODE_ENV` một lần lúc nạp module và bỏ hẳn `act` khỏi bản
   * production. Đặt biến trước rồi mới import thì `act` không tồn tại và cả
   * file này không chạy nổi. Component thì ngược lại: nó đọc `NODE_ENV` bên
   * trong `useEffect`, nghĩa là lúc render - nên chỉ cần biến đúng ở thời điểm
   * đó là đủ.
   */
  const React = await import("react");
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { ServiceWorkerRegistrar } = await import("./ServiceWorkerRegistrar");

  const originalEnv = process.env.NODE_ENV;
  const originalWarn = console.warn;
  restores.push(() => {
    console.warn = originalWarn;
    setNodeEnv(originalEnv);
  });
  setNodeEnv(nodeEnv);
  console.warn = (...args: unknown[]) => void warnings.push(args);

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(React.createElement(ServiceWorkerRegistrar));
    });
    // Nhường một nhịp cho promise của `register` giải quyết xong.
    await act(async () => {
      await Promise.resolve();
    });
    await run({ registered, warnings });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    for (const restore of restores.reverse()) restore();
  }
}

describe("ServiceWorkerRegistrar", () => {
  it("production thì đăng ký /sw.js và không cảnh báo gì", async () => {
    await withRegistrar({}, async (view) => {
      assert.deepEqual(view.registered, ["/sw.js"]);
      assert.deepEqual(view.warnings, []);
    });
  });

  it("dev thì không đăng ký gì cả", async () => {
    // Ở `next dev` bundle đổi liên tục; một service worker chen vào giữa chỉ
    // tạo ra những lần tải về nội dung cũ không cách nào tái lập.
    await withRegistrar({ nodeEnv: "development" }, async (view) => {
      assert.deepEqual(view.registered, []);
    });
  });

  it("đăng ký hỏng: cảnh báo một dòng, không ném, không dữ liệu nhạy cảm", async () => {
    await withRegistrar({ failWith: new Error("The operation is insecure.") }, async (view) => {
      assert.equal(view.warnings.length, 1, "đúng một dòng, không phải một trận mưa log");
      const line = view.warnings[0].map(String).join(" ");
      assert.match(line, /service worker/i, "phải nói rõ hỏng cái gì");
      assert.match(line, /The operation is insecure\./, "phải mang theo lý do để lần được");
      // Không mã phòng, không biệt danh, không URL - console là nơi mọi tiện ích
      // mở rộng đọc được.
      assert.doesNotMatch(line, /https?:\/\//);
    });
  });
});
