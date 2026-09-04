import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { createContext, runInContext } from "node:vm";

/**
 * Service worker, CHẠY THẬT trong một worker environment giả.
 *
 * Bản test trước chỉ đi tìm chuỗi trong mã nguồn, và đó là loại test tệ nhất
 * cho đúng file này: `BYPASS` vẫn có thể chứa đủ `"/api/"` trong khi vòng lặp
 * đọc nó đã bị sửa hỏng, hoặc `event.respondWith` bị gọi nhầm cho một request
 * mà ta thề là không đụng vào - và mọi assertion `includes()` vẫn xanh.
 *
 * Ở đây `public/sw.js` được nạp vào một context `node:vm` với `self`, `caches`
 * và `fetch` giả, rồi ta gọi thẳng vào các handler mà nó đăng ký và xem nó
 * thực sự LÀM gì. Cái giá phải trả là một bộ Cache API rút gọn ở dưới; đổi lại
 * mọi luật quan trọng của service worker đều được chứng minh bằng hành vi.
 */

const SW_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "sw.js");
const ORIGIN = "https://masoi.example";

/* --- Cache API giả -------------------------------------------------------- */

interface CacheKey {
  url: string;
}
type CacheRequest = string | { url: string };

/** Chuẩn hoá khoá cache đúng cách spec làm: chuỗi được giải theo base của worker. */
function keyOf(request: CacheRequest): string {
  return typeof request === "string" ? new URL(request, ORIGIN).href : request.url;
}

class FakeCache {
  readonly entries = new Map<string, unknown>();
  /** Đặt khác null để `put` ném - dùng để dựng lại lỗi hết quota. */
  putError: Error | null = null;
  /** Số ms `put` phải chờ, để đo xem lời gọi có được `await` hay không. */
  putDelayMs = 0;
  putSettled = 0;

  async match(request: CacheRequest): Promise<unknown> {
    return this.entries.get(keyOf(request));
  }

  async put(request: CacheRequest, response: unknown): Promise<void> {
    if (this.putDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.putDelayMs));
    }
    if (this.putError) throw this.putError;
    this.entries.set(keyOf(request), response);
    this.putSettled += 1;
  }

  /**
   * `addAll` của spec: tự đi tải rồi ghi từng mục.
   *
   * Bản thiết kế hiện tại không dùng hàm này, nhưng bộ giả phải có nó - thiếu
   * đi thì một service worker dùng `addAll` sẽ ngã ngay ở `install` và mọi
   * assertion về routing bên dưới đều hỏng vì cùng một lý do vô nghĩa, thay vì
   * chỉ ra đúng chỗ hành vi khác đi.
   */
  async addAll(urls: string[]): Promise<void> {
    for (const url of urls) {
      await this.put(url, new Response(`nội dung của ${url}`, { status: 200 }));
    }
  }

  async keys(): Promise<CacheKey[]> {
    return [...this.entries.keys()].map((url) => ({ url }));
  }

  async delete(request: CacheRequest): Promise<boolean> {
    return this.entries.delete(keyOf(request));
  }
}

class FakeCacheStorage {
  readonly opened = new Map<string, FakeCache>();

  constructor(existing: string[] = []) {
    for (const name of existing) this.opened.set(name, new FakeCache());
  }

  async open(name: string): Promise<FakeCache> {
    let cache = this.opened.get(name);
    if (!cache) {
      cache = new FakeCache();
      this.opened.set(name, cache);
    }
    return cache;
  }

  async keys(): Promise<string[]> {
    return [...this.opened.keys()];
  }

  async delete(name: string): Promise<boolean> {
    return this.opened.delete(name);
  }
}

/* --- Sự kiện giả ---------------------------------------------------------- */

interface FakeRequest {
  method: string;
  url: string;
  mode: string;
  headers: { get(name: string): string | null };
}

function request(
  path: string,
  {
    method = "GET",
    mode = "no-cors",
    headers = {},
    origin = ORIGIN,
  }: { method?: string; mode?: string; headers?: Record<string, string>; origin?: string } = {},
): FakeRequest {
  return {
    method,
    url: new URL(path, origin).href,
    mode,
    headers: {
      get: (name) => headers[name] ?? headers[name.toLowerCase()] ?? null,
    },
  };
}

/** Điều hướng - `mode` là thứ duy nhất phân biệt nó với một subresource. */
function navigation(path: string, extra: Record<string, unknown> = {}) {
  return request(path, { mode: "navigate", ...extra });
}

class FakeFetchEvent {
  response: Promise<unknown> | null = null;
  readonly waits: Promise<unknown>[] = [];
  constructor(readonly request: FakeRequest) {}
  respondWith(value: Promise<unknown> | unknown) {
    this.response = Promise.resolve(value);
  }
  waitUntil(value: Promise<unknown>) {
    this.waits.push(value);
  }
  /** Service worker có nhận trả lời thay cho request này không. */
  get intercepted(): boolean {
    return this.response !== null;
  }
}

class FakeLifecycleEvent {
  readonly waits: Promise<unknown>[] = [];
  waitUntil(value: Promise<unknown>) {
    this.waits.push(value);
  }
  /** Chờ đúng thứ mà handler đã hứa - và để lỗi nổi lên nếu có. */
  settled(): Promise<unknown[]> {
    return Promise.all(this.waits);
  }
}

/* --- Nạp worker ----------------------------------------------------------- */

interface FetchCall {
  input: unknown;
  init: Record<string, unknown> | undefined;
}

interface Worker {
  listeners: Map<string, (event: unknown) => void>;
  caches: FakeCacheStorage;
  fetchCalls: FetchCall[];
  claimed: number;
  skipWaitingCalls: number;
  install(): Promise<unknown[]>;
  activate(): Promise<unknown[]>;
  dispatchFetch(req: FakeRequest): FakeFetchEvent;
}

function loadWorker({
  network = async () => new Response("ok", { status: 200 }),
  existingCaches = [] as string[],
}: {
  network?: (input: unknown, init?: Record<string, unknown>) => Promise<unknown>;
  existingCaches?: string[];
} = {}): Worker {
  const source = readFileSync(SW_PATH, "utf8");
  const listeners = new Map<string, (event: unknown) => void>();
  const cacheStorage = new FakeCacheStorage(existingCaches);
  const fetchCalls: FetchCall[] = [];
  const counters = { claimed: 0, skipWaiting: 0 };

  const self = {
    addEventListener(type: string, handler: (event: unknown) => void) {
      listeners.set(type, handler);
    },
    location: new URL("/sw.js", ORIGIN),
    clients: {
      async claim() {
        counters.claimed += 1;
      },
    },
    registration: {},
    skipWaiting() {
      counters.skipWaiting += 1;
    },
  };

  const context = createContext({
    self,
    caches: cacheStorage,
    fetch: (input: unknown, init?: Record<string, unknown>) => {
      fetchCalls.push({ input, init });
      return network(input, init);
    },
    Response,
    Request,
    URL,
    console,
    setTimeout,
    clearTimeout,
  });
  runInContext(source, context, { filename: "sw.js" });

  const fire = (type: string, event: unknown) => {
    const handler = listeners.get(type);
    assert.ok(handler, `sw.js phải đăng ký handler "${type}"`);
    handler(event);
  };

  return {
    listeners,
    caches: cacheStorage,
    fetchCalls,
    get claimed() {
      return counters.claimed;
    },
    get skipWaitingCalls() {
      return counters.skipWaiting;
    },
    install() {
      const event = new FakeLifecycleEvent();
      fire("install", event);
      return event.settled();
    },
    activate() {
      const event = new FakeLifecycleEvent();
      fire("activate", event);
      return event.settled();
    },
    dispatchFetch(req: FakeRequest) {
      const event = new FakeFetchEvent(req);
      fire("fetch", event);
      return event;
    },
  } as Worker;
}

/** Worker đã cài xong và đã activate - trạng thái thật lúc phục vụ người chơi. */
async function readyWorker(options: Parameters<typeof loadWorker>[0] = {}): Promise<Worker> {
  const worker = loadWorker(options);
  await worker.install();
  await worker.activate();
  return worker;
}

/* --- Những request KHÔNG được đụng vào ------------------------------------ */

describe("service worker: request phải đi thẳng ra mạng", () => {
  const cases: [string, FakeRequest][] = [
    ["POST không bị chặn", request("/api/players", { method: "POST" })],
    ["PUT không bị chặn", request("/anything", { method: "PUT" })],
    [
      "GET khác origin không bị chặn",
      request("/socket.io/", { origin: "https://server.masoi.example" }),
    ],
    ["Google Fonts không bị chặn", request("/css2", { origin: "https://fonts.googleapis.com" })],
    ["/api chính xác không bị chặn", request("/api")],
    ["/api/* không bị chặn", request("/api/rooms/ABCDE")],
    ["/socket.io chính xác không bị chặn", request("/socket.io")],
    ["/socket.io/* không bị chặn", request("/socket.io/?EIO=4&transport=polling")],
    ["/audio không bị chặn", request("/audio")],
    ["/audio/* không bị chặn", request("/audio/sfx/howl.mp3")],
    ["/cinematics không bị chặn", request("/cinematics")],
    ["/cinematics/* không bị chặn", request("/cinematics/nightfall.mp4")],
    ["RSC theo query không bị chặn", navigation("/room/ABCDE?_rsc=1a2b3")],
    ["RSC theo header không bị chặn", navigation("/room/ABCDE", { headers: { RSC: "1" } })],
  ];

  for (const [name, req] of cases) {
    it(name, async () => {
      const worker = await readyWorker();
      const event = worker.dispatchFetch(req);
      assert.equal(event.intercepted, false, `${req.method} ${req.url} không được respondWith`);
    });
  }

  it("bỏ qua là bỏ qua thật: không gọi fetch, không đụng cache", async () => {
    const worker = await readyWorker();
    const before = worker.fetchCalls.length;
    worker.dispatchFetch(request("/api/rooms/ABCDE"));
    worker.dispatchFetch(request("/socket.io/?EIO=4"));
    worker.dispatchFetch(request("/audio/sfx/howl.mp3", { method: "POST" }));
    assert.equal(worker.fetchCalls.length, before, "worker không được tự đi mạng thay trình duyệt");
    const cache = await worker.caches.open("masoi-offline");
    assert.equal(cache.entries.size, 1, "chỉ trang offline được nằm trong cache");
  });
});

/* --- Tài nguyên tĩnh ------------------------------------------------------ */

describe("service worker: tài nguyên tĩnh không được giữ bản cũ", () => {
  /*
   * Danh sách này gồm cả `/_next/static/` (có hash) lẫn `/icons/`, `/characters/`
   * (không hash). Cả hai đều phải đi thẳng ra mạng: nhóm có hash đã được Next
   * gắn `Cache-Control: immutable` một năm nên một lớp cache nữa là thừa, còn
   * nhóm không hash mà cache-first thì người chơi giữ ảnh cũ vô thời hạn.
   */
  const paths = [
    "/_next/static/chunks/abc123.js",
    "/_next/static/media/font.woff2",
    "/icons/icon-192.png",
    "/characters/hood.webp",
    "/images/anything.png",
    "/favicon.ico",
  ];

  for (const path of paths) {
    it(`${path} đi thẳng ra mạng`, async () => {
      const worker = await readyWorker();
      const event = worker.dispatchFetch(request(path));
      assert.equal(event.intercepted, false);
    });
  }

  it("không có tài nguyên nào tích lại trong cache sau nhiều lượt tải", async () => {
    const worker = await readyWorker();
    for (let round = 0; round < 3; round += 1) {
      for (const path of paths) worker.dispatchFetch(request(path));
      worker.dispatchFetch(navigation("/"));
    }
    const names = await worker.caches.keys();
    assert.deepEqual(names, ["masoi-offline"], "chỉ được có đúng một cache");
    const cache = await worker.caches.open("masoi-offline");
    assert.equal(cache.entries.size, 1, "cache không được phình ra theo lượt truy cập");
  });
});

/* --- Điều hướng ----------------------------------------------------------- */

describe("service worker: điều hướng luôn network-first", () => {
  it("mạng tốt thì trả đúng phản hồi của mạng", async () => {
    const fromNetwork = new Response("<html>trang thật</html>", { status: 200 });
    const worker = await readyWorker({ network: async () => fromNetwork });
    const event = worker.dispatchFetch(navigation("/room/ABCDE"));
    assert.equal(await event.response, fromNetwork);
  });

  it("không cache HTML của phòng chơi", async () => {
    const worker = await readyWorker({
      network: async () => new Response("<html>phòng ABCDE</html>", { status: 200 }),
    });
    await worker.dispatchFetch(navigation("/room/ABCDE")).response;
    await worker.dispatchFetch(navigation("/")).response;

    const cache = await worker.caches.open("masoi-offline");
    const urls = (await cache.keys()).map((k) => new URL(k.url).pathname);
    assert.deepEqual(urls, ["/offline.html"], "chỉ trang offline, không có HTML nào khác");
  });

  it("mất mạng thì trả trang offline đã precache", async () => {
    let offlineNow = false;
    const worker = await readyWorker({
      network: async (input) => {
        if (offlineNow) throw new TypeError("Failed to fetch");
        return new Response(`nội dung ${String(input)}`, { status: 200 });
      },
    });

    offlineNow = true;
    const event = worker.dispatchFetch(navigation("/"));
    const response = (await event.response) as Response;
    assert.ok(response, "điều hướng lúc mất mạng phải được trả lời");
    assert.match(await response.text(), /offline\.html/);
  });

  it("mất mạng mà cache cũng trống thì vẫn ra một phản hồi, không phải lỗi", async () => {
    // Cài hỏng (hết quota chẳng hạn) rồi mới mất mạng: đường xấu nhất.
    const worker = loadWorker({
      network: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await worker.install().catch(() => {});
    await worker.activate();

    const response = (await worker.dispatchFetch(navigation("/")).response) as Response;
    assert.equal(response.status, 503);
    assert.match(response.headers.get("Content-Type") ?? "", /text\/plain/);
  });
});

/* --- Vòng đời cache ------------------------------------------------------- */

describe("service worker: vòng đời cache", () => {
  it("install lấy trang offline bằng cache: reload", async () => {
    // Không có "reload" thì bản offline.html cũ trong HTTP cache được đóng đinh
    // vào cache của worker - đúng thứ lỗi mà cả thiết kế này đang tránh.
    const worker = loadWorker();
    await worker.install();
    const call = worker.fetchCalls.at(-1);
    assert.ok(call);
    assert.match(String(call.input), /offline\.html/);
    assert.equal(call.init?.cache, "reload");
  });

  it("cache.put được await: install chưa xong khi ghi chưa xong", async () => {
    const worker = loadWorker();
    const cache = await worker.caches.open("masoi-offline");
    cache.putDelayMs = 30;

    let installDone = false;
    const installing = worker.install().then(() => {
      installDone = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(installDone, false, "install không được kết thúc trước khi ghi cache xong");
    assert.equal(cache.putSettled, 0);

    await installing;
    assert.equal(cache.putSettled, 1, "ghi cache phải hoàn tất trước khi install kết thúc");
  });

  it("hết quota lúc install: lỗi nổi lên qua waitUntil, không thành unhandled", async () => {
    const worker = loadWorker();
    const cache = await worker.caches.open("masoi-offline");
    cache.putError = new DOMException("Quota exceeded.", "QuotaExceededError");

    await assert.rejects(() => worker.install(), /Quota/);
  });

  it("hết quota không làm hỏng phản hồi mạng đang thành công", async () => {
    const fromNetwork = new Response("<html>vẫn chạy</html>", { status: 200 });
    const worker = loadWorker({ network: async () => fromNetwork });
    const cache = await worker.caches.open("masoi-offline");
    cache.putError = new DOMException("Quota exceeded.", "QuotaExceededError");
    await worker.install().catch(() => {});
    await worker.activate();

    const event = worker.dispatchFetch(navigation("/"));
    assert.equal(await event.response, fromNetwork, "cache hỏng không được đụng tới phản hồi mạng");
  });

  it("activate chỉ xoá cache của chính app này", async () => {
    const worker = await readyWorker({
      existingCaches: [
        "masoi-shell-v1",
        "masoi-assets-v1",
        "workbox-precache-v2",
        "google-fonts",
        "some-other-app",
      ],
    });

    const remaining = await worker.caches.keys();
    assert.ok(!remaining.includes("masoi-shell-v1"), "cache của bản thiết kế cũ phải bị dọn");
    assert.ok(!remaining.includes("masoi-assets-v1"), "cache của bản thiết kế cũ phải bị dọn");
    for (const foreign of ["workbox-precache-v2", "google-fonts", "some-other-app"]) {
      assert.ok(remaining.includes(foreign), `${foreign} không phải của ta, không được xoá`);
    }
    assert.ok(remaining.includes("masoi-offline"));
  });

  it("activate nhận quyền kiểm soát nhưng KHÔNG gọi skipWaiting", async () => {
    // skipWaiting tráo service worker dưới chân một trang đang chạy; trong một
    // ván Ma Sói đó là cắt ngang giữa pha bỏ phiếu.
    const worker = await readyWorker();
    assert.equal(worker.claimed, 1, "phải claim để lần vào đầu tiên đã có trang offline");
    assert.equal(worker.skipWaitingCalls, 0, "không bao giờ được gọi skipWaiting");
  });

  it("tên cache không mang số version phải sửa tay", async () => {
    const worker = await readyWorker();
    const names = await worker.caches.keys();
    for (const name of names.filter((n) => n.startsWith("masoi-"))) {
      assert.doesNotMatch(
        name,
        /v\d+$/,
        `"${name}" mang version thủ công - thiết kế này không được cần tới nó`,
      );
    }
  });
});
