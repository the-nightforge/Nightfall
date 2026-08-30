import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RoomSnapshot } from "@masoi/shared";
import type { Socket } from "socket.io-client";
import { CONNECT_FAILED_MESSAGE, enterRoom, type RoomEntryRequest } from "./room-entry";

type Listener = ((...args: unknown[]) => void) & { fn?: (...args: unknown[]) => void };

/**
 * Socket giả, bắt chước đúng Emitter của socket.io-client.
 *
 * Điểm bắt buộc phải giống: `off(event, fn)` gỡ được cả listener đã gắn bằng
 * `once`, vì Emitter thật giữ hàm gốc ở thuộc tính `.fn` của wrapper. Một fake
 * so sánh bằng identity đơn thuần sẽ báo "không gỡ được" ở chỗ code thật gỡ
 * được, và ngược lại - test sẽ đo nhầm thứ khác.
 */
class FakeSocket {
  connected: boolean;
  connectCalls = 0;
  emitted: Array<{ event: string; payload: unknown }> = [];
  private readonly listeners = new Map<string, Listener[]>();

  constructor(connected: boolean) {
    this.connected = connected;
  }

  on(event: string, listener: Listener) {
    const bucket = this.listeners.get(event) ?? [];
    bucket.push(listener);
    this.listeners.set(event, bucket);
    return this;
  }

  off(event: string, listener: Listener) {
    const bucket = this.listeners.get(event);
    if (!bucket) return this;
    const next = bucket.filter((l) => l !== listener && l.fn !== listener);
    this.listeners.set(event, next);
    return this;
  }

  once(event: string, listener: Listener) {
    const wrapper: Listener = (...args) => {
      this.off(event, wrapper);
      listener(...args);
    };
    wrapper.fn = listener;
    return this.on(event, wrapper);
  }

  emit(event: string, payload?: unknown) {
    this.emitted.push({ event, payload });
    return this;
  }

  connect() {
    this.connectCalls += 1;
    return this;
  }

  /** Giả lập server/transport bắn event xuống client. */
  trigger(event: string, payload?: unknown) {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(payload);
  }

  listenerCount(event: string) {
    return this.listeners.get(event)?.length ?? 0;
  }

  /** Tổng listener còn sót của MỌI event mà enterRoom có thể đã gắn. */
  totalTrackedListeners() {
    return (
      this.listenerCount("connect") +
      this.listenerCount("connect_error") +
      this.listenerCount("error") +
      this.listenerCount("room:snapshot")
    );
  }
}

function recorder() {
  const entered: string[] = [];
  const failed: string[] = [];
  return {
    entered,
    failed,
    handlers: {
      onEntered: (code: string) => {
        entered.push(code);
      },
      onFailed: (message: string) => {
        failed.push(message);
      },
    },
  };
}

const snapshot = (code: string) => ({ code }) as RoomSnapshot;

const CASES: Array<{ label: string; request: RoomEntryRequest; event: string; payload: unknown }> = [
  { label: "create", request: { kind: "create" }, event: "room:create", payload: {} },
  {
    label: "join",
    request: { kind: "join", code: "ABCDE" },
    event: "room:join",
    payload: { code: "ABCDE" },
  },
];

for (const scenario of CASES) {
  describe(`enterRoom - ${scenario.label}`, () => {
    it("phát action đúng một lần khi socket đã kết nối sẵn", () => {
      const socket = new FakeSocket(true);
      const rec = recorder();

      enterRoom(socket as unknown as Socket, scenario.request, rec.handlers);

      assert.equal(socket.connectCalls, 0);
      assert.deepEqual(socket.emitted, [{ event: scenario.event, payload: scenario.payload }]);
    });

    it("đợi connect rồi mới phát action, và chỉ phát một lần", () => {
      const socket = new FakeSocket(false);
      const rec = recorder();

      enterRoom(socket as unknown as Socket, scenario.request, rec.handlers);
      assert.equal(socket.connectCalls, 1);
      assert.deepEqual(socket.emitted, []);

      socket.trigger("connect");
      socket.trigger("connect");

      assert.deepEqual(socket.emitted, [{ event: scenario.event, payload: scenario.payload }]);
    });

    it("vào phòng xong thì gọi onEntered và không để lại listener nào", () => {
      const socket = new FakeSocket(true);
      const rec = recorder();

      enterRoom(socket as unknown as Socket, scenario.request, rec.handlers);
      socket.trigger("room:snapshot", snapshot("QWERT"));

      assert.deepEqual(rec.entered, [
        scenario.request.kind === "join" ? scenario.request.code : "QWERT",
      ]);
      assert.deepEqual(rec.failed, []);
      assert.equal(socket.totalTrackedListeners(), 0);
    });

    /*
     * Đây là lỗi P1, viết ra thành test.
     *
     * Bản cũ chỉ nghe app event "error" của server. Khi handshake hoặc
     * transport hỏng, socket.io bắn "connect_error" chứ không bắn "error", nên
     * không có gì hạ cờ bận xuống: nút "Tạo phòng mới" mờ vĩnh viễn cho tới khi
     * người dùng tự tải lại trang.
     */
    it("connect_error thì báo lỗi tiếng Việt và gỡ sạch listener", () => {
      const socket = new FakeSocket(false);
      const rec = recorder();

      enterRoom(socket as unknown as Socket, scenario.request, rec.handlers);
      socket.trigger("connect_error", new Error("xhr poll error"));

      assert.deepEqual(rec.failed, [CONNECT_FAILED_MESSAGE]);
      assert.deepEqual(rec.entered, []);
      assert.deepEqual(socket.emitted, []);
      assert.equal(socket.totalTrackedListeners(), 0);
    });

    /*
     * Nửa sau của cùng một lỗi. Socket được cấu hình reconnect vô hạn, nên sau
     * connect_error nó vẫn tự thử lại ngầm. Nếu callback của lần thao tác ĐÃ
     * THẤT BẠI còn nằm lại, một lần connect muộn sẽ lặng lẽ tạo ra một phòng
     * mà người dùng không hề bấm nút lần nữa.
     */
    it("connect đến muộn sau connect_error không phát lại action cũ", () => {
      const socket = new FakeSocket(false);
      const rec = recorder();

      enterRoom(socket as unknown as Socket, scenario.request, rec.handlers);
      socket.trigger("connect_error", new Error("timeout"));
      socket.connected = true;
      socket.trigger("connect");

      assert.deepEqual(socket.emitted, []);
      assert.deepEqual(rec.failed, [CONNECT_FAILED_MESSAGE]);
    });

    it("lỗi ứng dụng từ server cũng gỡ sạch listener", () => {
      const socket = new FakeSocket(true);
      const rec = recorder();

      enterRoom(socket as unknown as Socket, scenario.request, rec.handlers);
      socket.trigger("error", { message: "Phòng không tồn tại" });

      assert.deepEqual(rec.failed, ["Phòng không tồn tại"]);
      assert.equal(socket.totalTrackedListeners(), 0);
    });

    it("chỉ báo kết quả một lần dù server bắn thêm event sau đó", () => {
      const socket = new FakeSocket(true);
      const rec = recorder();

      enterRoom(socket as unknown as Socket, scenario.request, rec.handlers);
      socket.trigger("error", { message: "Phòng đã đầy" });
      socket.trigger("room:snapshot", snapshot("LATER"));
      socket.trigger("connect_error", new Error("late"));

      assert.deepEqual(rec.failed, ["Phòng đã đầy"]);
      assert.deepEqual(rec.entered, []);
    });

    it("huỷ thủ công thì không còn listener và không báo kết quả", () => {
      const socket = new FakeSocket(false);
      const rec = recorder();

      const cancel = enterRoom(socket as unknown as Socket, scenario.request, rec.handlers);
      cancel();
      socket.trigger("connect");
      socket.trigger("room:snapshot", snapshot("NOPE"));

      assert.deepEqual(socket.emitted, []);
      assert.deepEqual(rec.entered, []);
      assert.deepEqual(rec.failed, []);
      assert.equal(socket.totalTrackedListeners(), 0);
    });
  });
}

describe("enterRoom - thử lại sau lỗi", () => {
  it("lần thứ hai vào được phòng và không tích luỹ listener", () => {
    // Cùng một socket cho cả hai lần: nếu lần hỏng để sót listener thì lần sau
    // sẽ thấy ngay ở tổng số listener và ở số action phát ra.
    const socket = new FakeSocket(false);
    const rec = recorder();
    const request: RoomEntryRequest = { kind: "join", code: "ABCDE" };

    enterRoom(socket as unknown as Socket, request, rec.handlers);
    socket.trigger("connect_error", new Error("xhr poll error"));
    assert.equal(socket.totalTrackedListeners(), 0);

    enterRoom(socket as unknown as Socket, request, rec.handlers);
    socket.connected = true;
    socket.trigger("connect");
    socket.trigger("room:snapshot", snapshot("ABCDE"));

    assert.deepEqual(socket.emitted, [{ event: "room:join", payload: { code: "ABCDE" } }]);
    assert.deepEqual(rec.failed, [CONNECT_FAILED_MESSAGE]);
    assert.deepEqual(rec.entered, ["ABCDE"]);
    assert.equal(socket.totalTrackedListeners(), 0);
  });

  it("ba lần hỏng liên tiếp vẫn không để sót listener nào", () => {
    const socket = new FakeSocket(false);
    const rec = recorder();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      enterRoom(socket as unknown as Socket, { kind: "create" }, rec.handlers);
      socket.trigger("connect_error", new Error("boom"));
    }

    assert.equal(rec.failed.length, 3);
    assert.equal(socket.totalTrackedListeners(), 0);
    assert.deepEqual(socket.emitted, []);
  });
});
