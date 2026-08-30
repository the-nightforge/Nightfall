import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Socket } from "socket.io-client";
import { EntryAttemptManager } from "./entry-attempt";
import {
  runEntryAttempt,
  SERVER_UNREACHABLE_MESSAGE,
  type CreatePlayerOutcome,
  type EntryPorts,
} from "./home-entry";
import type { Identity } from "./identity";
import { CONNECT_FAILED_MESSAGE, type RoomEntryRequest } from "./room-entry";

type Listener = ((...args: unknown[]) => void) & { fn?: (...args: unknown[]) => void };

/** Socket giả, cùng ngữ nghĩa Emitter với bản trong room-entry.test.ts. */
class FakeSocket {
  connected = false;
  connectCalls = 0;
  disconnectCalls = 0;
  emitted: Array<{ event: string; payload: unknown }> = [];
  private readonly listeners = new Map<string, Listener[]>();

  on(event: string, listener: Listener) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  off(event: string, listener: Listener) {
    const bucket = this.listeners.get(event);
    if (bucket) {
      this.listeners.set(
        event,
        bucket.filter((l) => l !== listener && l.fn !== listener),
      );
    }
    return this;
  }

  emit(event: string, payload?: unknown) {
    this.emitted.push({ event, payload });
    return this;
  }

  connect() {
    this.connectCalls += 1;
    return this;
  }

  disconnect() {
    this.disconnectCalls += 1;
    return this;
  }

  trigger(event: string, payload?: unknown) {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(payload);
  }

  /** Tổng listener của mọi event mà enterRoom có thể đã gắn. */
  trackedListeners() {
    return ["connect", "connect_error", "error", "room:snapshot"].reduce(
      (total, event) => total + (this.listeners.get(event)?.length ?? 0),
      0,
    );
  }
}

const IDENTITY: Identity = { playerId: "p1", token: "t1", nickname: "Thợ săn đêm" };

interface Harness {
  ports: EntryPorts;
  socket: FakeSocket;
  calls: {
    stored: Identity[];
    identityStored: number;
    failed: string[];
    entered: string[];
    socketsOpened: number;
    createPlayerSignals: AbortSignal[];
  };
  /** Cho phép test quyết định lúc nào POST /api/players trả lời. */
  resolvePlayer: (outcome: CreatePlayerOutcome) => void;
  rejectPlayer: (error: unknown) => void;
  /** Cho phép test quyết định lúc nào socket sẵn sàng. */
  resolveSocket: () => void;
}

function harness(options: { storedIdentity?: Identity | null; autoResolve?: boolean } = {}): Harness {
  const socket = new FakeSocket();
  const calls: Harness["calls"] = {
    stored: [],
    identityStored: 0,
    failed: [],
    entered: [],
    socketsOpened: 0,
    createPlayerSignals: [],
  };

  let resolvePlayer!: (outcome: CreatePlayerOutcome) => void;
  let rejectPlayer!: (error: unknown) => void;
  const playerPromise = new Promise<CreatePlayerOutcome>((resolve, reject) => {
    resolvePlayer = resolve;
    rejectPlayer = reject;
  });

  let resolveSocket!: () => void;
  const socketGate = new Promise<void>((resolve) => {
    resolveSocket = resolve;
  });

  const ports: EntryPorts = {
    readStoredIdentity: () => options.storedIdentity ?? null,
    storeIdentity: (identity) => calls.stored.push(identity),
    createPlayer: (_nickname, signal) => {
      calls.createPlayerSignals.push(signal);
      // Abort thật sự phải làm promise reject, đúng như `fetch` hành xử.
      return new Promise<CreatePlayerOutcome>((resolve, reject) => {
        const onAbort = () => reject(signal.reason);
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
        playerPromise.then(resolve, reject);
      });
    },
    openSocket: async (_identity) => {
      calls.socketsOpened += 1;
      if (!options.autoResolve) await socketGate;
      return socket as unknown as Socket;
    },
    onIdentityStored: () => {
      calls.identityStored += 1;
    },
    onFailed: (message) => calls.failed.push(message),
    onEntered: (code) => calls.entered.push(code),
  };

  return { ports, socket, calls, resolvePlayer, rejectPlayer, resolveSocket };
}

/** Nhường vài vòng microtask để chuỗi await bên trong luồng chạy hết. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const CREATE: RoomEntryRequest = { kind: "create" };
const JOIN: RoomEntryRequest = { kind: "join", code: "ABCDE" };

describe("runEntryAttempt - huỷ giữa lúc API player đang chờ", () => {
  it("abort thì không lưu identity, không dựng socket, không điều hướng, không báo lỗi", async () => {
    const manager = new EntryAttemptManager();
    const h = harness();
    const attempt = manager.begin();
    const running = runEntryAttempt(attempt, CREATE, "Thợ săn đêm", h.ports);
    await settle();

    // Đúng cái signal của lượt này được truyền xuống fetch.
    assert.equal(h.calls.createPlayerSignals.length, 1);
    assert.equal(h.calls.createPlayerSignals[0], attempt.signal);
    assert.equal(h.calls.createPlayerSignals[0].aborted, false);

    manager.cancelActive();
    assert.equal(attempt.signal.aborted, true);

    // Response về muộn sau khi đã huỷ: không được có tác dụng gì.
    h.resolvePlayer({ ok: true, identity: IDENTITY });
    await running;
    await settle();

    assert.deepEqual(h.calls.stored, []);
    assert.equal(h.calls.identityStored, 0);
    assert.equal(h.calls.socketsOpened, 0);
    assert.deepEqual(h.calls.entered, []);
    assert.deepEqual(h.calls.failed, []);
  });

  it("AbortError không bị biến thành lỗi kết nối máy chủ", async () => {
    const manager = new EntryAttemptManager();
    const h = harness();
    const attempt = manager.begin();
    const running = runEntryAttempt(attempt, CREATE, "Thợ săn đêm", h.ports);
    await settle();

    manager.cancelActive();
    await running;
    await settle();

    assert.deepEqual(h.calls.failed, []);
  });

  it("lỗi mạng thật của lượt đang chạy VẪN được báo ra", async () => {
    // Mặt còn lại của test trên: bịt AbortError không được bịt luôn lỗi thật.
    const manager = new EntryAttemptManager();
    const h = harness();
    const attempt = manager.begin();
    const running = runEntryAttempt(attempt, CREATE, "Thợ săn đêm", h.ports);
    await settle();

    h.rejectPlayer(new TypeError("Failed to fetch"));
    await running;

    assert.deepEqual(h.calls.failed, [SERVER_UNREACHABLE_MESSAGE]);
    assert.equal(attempt.isActive(), false);
  });

  it("API từ chối thì báo đúng câu của server và đóng lượt", async () => {
    const manager = new EntryAttemptManager();
    const h = harness();
    const attempt = manager.begin();
    const running = runEntryAttempt(attempt, CREATE, "Thợ săn đêm", h.ports);
    await settle();

    h.resolvePlayer({ ok: false, message: "Biệt danh đã có người dùng" });
    await running;

    assert.deepEqual(h.calls.failed, ["Biệt danh đã có người dùng"]);
    assert.deepEqual(h.calls.stored, []);
    assert.equal(h.calls.socketsOpened, 0);
    assert.equal(attempt.isActive(), false);
  });
});

describe("runEntryAttempt - unmount giữa lúc API player đang chờ", () => {
  it("không lưu identity, không dựng socket, không điều hướng, không báo lỗi", async () => {
    const manager = new EntryAttemptManager();
    const h = harness();
    const attempt = manager.begin();
    const running = runEntryAttempt(attempt, JOIN, "Thợ săn đêm", h.ports);
    await settle();

    manager.cancelActive(); // Home unmount
    h.resolvePlayer({ ok: true, identity: IDENTITY });
    await running;
    await settle();

    assert.deepEqual(h.calls.stored, []);
    assert.equal(h.calls.identityStored, 0);
    assert.equal(h.calls.socketsOpened, 0);
    assert.deepEqual(h.calls.entered, []);
    assert.deepEqual(h.calls.failed, []);
  });
});

describe("runEntryAttempt - huỷ giữa lúc socket đang chờ", () => {
  for (const [label, request] of [
    ["create", CREATE],
    ["join", JOIN],
  ] as const) {
    it(`${label}: cleanup chạy đúng một lần, listener gỡ sạch, callback muộn thành no-op`, async () => {
      const manager = new EntryAttemptManager();
      const h = harness({ storedIdentity: IDENTITY, autoResolve: true });
      const attempt = manager.begin();
      await runEntryAttempt(attempt, request, "Thợ săn đêm", h.ports);

      // Socket chưa connected -> enterRoom đang chờ, listener đã gắn.
      assert.equal(h.socket.trackedListeners() > 0, true);
      assert.deepEqual(h.socket.emitted, []);

      // Người dùng bấm "Xoá phiên" hoặc rời trang ngay lúc này.
      manager.cancelActive();

      assert.equal(h.socket.trackedListeners(), 0);
      assert.equal(attempt.isActive(), false);

      // Socket kết nối muộn / server trả lời muộn: không được làm gì cả.
      h.socket.connected = true;
      h.socket.trigger("connect");
      h.socket.trigger("room:snapshot", { code: "LATE1" });
      h.socket.trigger("connect_error", new Error("muộn"));

      assert.deepEqual(h.socket.emitted, []);
      assert.deepEqual(h.calls.entered, []);
      assert.deepEqual(h.calls.failed, []);
      // Không được ngắt socket ở đây - việc đó là của handleLogout, không phải
      // của cơ chế huỷ lượt.
      assert.equal(h.socket.disconnectCalls, 0);
    });
  }

  it("unmount giữa lúc socket đang chờ cũng gỡ sạch listener", async () => {
    const manager = new EntryAttemptManager();
    const h = harness({ storedIdentity: IDENTITY, autoResolve: true });
    const attempt = manager.begin();
    await runEntryAttempt(attempt, CREATE, "Thợ săn đêm", h.ports);

    manager.cancelActive(); // Home unmount

    assert.equal(h.socket.trackedListeners(), 0);
    h.socket.connected = true;
    h.socket.trigger("connect");
    h.socket.trigger("connect_error", new Error("muộn"));
    assert.deepEqual(h.socket.emitted, []);
    assert.deepEqual(h.calls.failed, []);
    assert.equal(attempt.isActive(), false);
  });

  it("huỷ trong lúc openSocket còn đang chờ thì không gắn listener nào", async () => {
    const manager = new EntryAttemptManager();
    const h = harness({ storedIdentity: IDENTITY });
    const attempt = manager.begin();
    const running = runEntryAttempt(attempt, CREATE, "Thợ săn đêm", h.ports);
    await settle();

    assert.equal(h.calls.socketsOpened, 1);
    manager.cancelActive();
    h.resolveSocket();
    await running;
    await settle();

    assert.equal(h.socket.trackedListeners(), 0);
    assert.deepEqual(h.socket.emitted, []);
    assert.deepEqual(h.calls.entered, []);
    assert.deepEqual(h.calls.failed, []);
  });
});

describe("runEntryAttempt - đăng xuất giữa chừng", () => {
  it("đang tạo phòng: không tự tạo phòng sau đó", async () => {
    const manager = new EntryAttemptManager();
    const h = harness({ storedIdentity: IDENTITY, autoResolve: true });
    await runEntryAttempt(manager.begin(), CREATE, "Thợ săn đêm", h.ports);

    manager.cancelActive(); // handleLogout
    h.socket.connected = true;
    h.socket.trigger("connect");

    assert.deepEqual(h.socket.emitted, []);
    assert.equal(manager.activeId, null);
  });

  it("đang vào phòng: không tự vào phòng sau đó", async () => {
    const manager = new EntryAttemptManager();
    const h = harness({ storedIdentity: IDENTITY, autoResolve: true });
    await runEntryAttempt(manager.begin(), JOIN, "Thợ săn đêm", h.ports);

    manager.cancelActive();
    h.socket.connected = true;
    h.socket.trigger("connect");
    h.socket.trigger("room:snapshot", { code: "ABCDE" });

    assert.deepEqual(h.socket.emitted, []);
    assert.deepEqual(h.calls.entered, []);
    assert.equal(manager.activeId, null);
  });
});

describe("runEntryAttempt - thử lại sau khi huỷ", () => {
  it("lượt mới chạy bình thường và callback lượt cũ không chạm vào nó", async () => {
    const manager = new EntryAttemptManager();
    const first = harness({ storedIdentity: IDENTITY, autoResolve: true });
    const firstAttempt = manager.begin();
    await runEntryAttempt(firstAttempt, CREATE, "Thợ săn đêm", first.ports);
    manager.cancelActive();

    const second = harness({ storedIdentity: IDENTITY, autoResolve: true });
    const secondAttempt = manager.begin();
    await runEntryAttempt(secondAttempt, JOIN, "Thợ săn đêm", second.ports);

    // Socket của lượt CŨ bắn event muộn: lượt mới phải không hề hấn gì.
    first.socket.connected = true;
    first.socket.trigger("connect");
    first.socket.trigger("room:snapshot", { code: "OLD01" });
    first.socket.trigger("connect_error", new Error("muộn"));

    assert.deepEqual(first.calls.entered, []);
    assert.deepEqual(first.calls.failed, []);
    assert.equal(secondAttempt.isActive(), true);

    // Lượt mới vẫn chạy trọn vẹn.
    second.socket.connected = true;
    second.socket.trigger("connect");
    assert.deepEqual(second.socket.emitted, [
      { event: "room:join", payload: { code: "ABCDE" } },
    ]);
    second.socket.trigger("room:snapshot", { code: "ABCDE" });
    assert.deepEqual(second.calls.entered, ["ABCDE"]);
  });

  it("ba lần huỷ liên tiếp không tích luỹ listener", async () => {
    const manager = new EntryAttemptManager();
    const h = harness({ storedIdentity: IDENTITY, autoResolve: true });

    for (let i = 0; i < 3; i += 1) {
      await runEntryAttempt(manager.begin(), CREATE, "Thợ săn đêm", h.ports);
      manager.cancelActive();
    }

    assert.equal(h.socket.trackedListeners(), 0);
    assert.deepEqual(h.socket.emitted, []);
  });
});

describe("runEntryAttempt - đường thành công không bị phá", () => {
  it("tạo phòng: điều hướng theo mã trong snapshot", async () => {
    const manager = new EntryAttemptManager();
    const h = harness({ storedIdentity: IDENTITY, autoResolve: true });
    const attempt = manager.begin();
    await runEntryAttempt(attempt, CREATE, "Thợ săn đêm", h.ports);

    h.socket.connected = true;
    h.socket.trigger("connect");
    assert.deepEqual(h.socket.emitted, [{ event: "room:create", payload: {} }]);

    h.socket.trigger("room:snapshot", { code: "QWERT" });

    assert.deepEqual(h.calls.entered, ["QWERT"]);
    assert.deepEqual(h.calls.failed, []);
    assert.equal(attempt.isActive(), false);
  });

  it("vào phòng: điều hướng đúng mã người dùng nhập", async () => {
    const manager = new EntryAttemptManager();
    const h = harness({ storedIdentity: IDENTITY, autoResolve: true });
    await runEntryAttempt(manager.begin(), JOIN, "Thợ săn đêm", h.ports);

    h.socket.connected = true;
    h.socket.trigger("connect");
    h.socket.trigger("room:snapshot", { code: "ABCDE" });

    assert.deepEqual(h.calls.entered, ["ABCDE"]);
  });

  it("sau khi vào phòng, cleanup của Home không ngắt socket của trang phòng", async () => {
    const manager = new EntryAttemptManager();
    const h = harness({ storedIdentity: IDENTITY, autoResolve: true });
    await runEntryAttempt(manager.begin(), CREATE, "Thợ săn đêm", h.ports);

    h.socket.connected = true;
    h.socket.trigger("connect");
    h.socket.trigger("room:snapshot", { code: "QWERT" });

    const listenersAfterSuccess = h.socket.trackedListeners();
    // Home unmount vì router.push đã rời trang.
    manager.cancelActive(); // Home unmount

    assert.equal(h.socket.disconnectCalls, 0);
    assert.equal(h.socket.trackedListeners(), listenersAfterSuccess);
    assert.deepEqual(h.calls.entered, ["QWERT"]);
  });

  it("connect_error của lượt đang chạy vẫn báo lỗi như cũ", async () => {
    const manager = new EntryAttemptManager();
    const h = harness({ storedIdentity: IDENTITY, autoResolve: true });
    const attempt = manager.begin();
    await runEntryAttempt(attempt, CREATE, "Thợ săn đêm", h.ports);

    h.socket.trigger("connect_error", new Error("xhr poll error"));

    assert.deepEqual(h.calls.failed, [CONNECT_FAILED_MESSAGE]);
    assert.equal(attempt.isActive(), false);
    assert.equal(h.socket.trackedListeners(), 0);
  });

  it("phiên đã lưu và không đổi tên thì không gọi API lần nữa", async () => {
    const manager = new EntryAttemptManager();
    const h = harness({ storedIdentity: IDENTITY, autoResolve: true });
    await runEntryAttempt(manager.begin(), CREATE, "Thợ săn đêm", h.ports);

    assert.deepEqual(h.calls.createPlayerSignals, []);
    assert.deepEqual(h.calls.stored, []);
    assert.equal(h.calls.socketsOpened, 1);
  });

  it("đổi biệt danh thì gọi API và lưu phiên mới", async () => {
    const manager = new EntryAttemptManager();
    const h = harness({ storedIdentity: IDENTITY, autoResolve: true });
    const running = runEntryAttempt(manager.begin(), CREATE, "Tên khác", h.ports);
    await settle();

    const fresh: Identity = { playerId: "p2", token: "t2", nickname: "Tên khác" };
    h.resolvePlayer({ ok: true, identity: fresh });
    await running;

    assert.deepEqual(h.calls.stored, [fresh]);
    assert.equal(h.calls.identityStored, 1);
  });
});
