import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Socket } from "socket.io-client";
import {
  attachRoomSocketSession,
  runWhenSocketConnected,
} from "./room-socket-session";

type Listener = (...args: unknown[]) => void;

class FakeSocket {
  connected: boolean;
  connectCalls = 0;
  emitted: Array<{ event: string; payload: unknown }> = [];
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(connected: boolean) {
    this.connected = connected;
  }

  on(event: string, listener: Listener) {
    const listeners = this.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  once(event: string, listener: Listener) {
    const wrapper: Listener = (...args) => {
      this.off(event, wrapper);
      listener(...args);
    };
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

  trigger(event: string, payload?: unknown) {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }

  listenerCount(event: string) {
    return this.listeners.get(event)?.size ?? 0;
  }
}

function handlers() {
  const calls = { connected: 0, disconnected: 0, snapshots: 0 };
  return {
    calls,
    value: {
      onConnect: () => { calls.connected += 1; },
      onDisconnect: () => { calls.disconnected += 1; },
      onError: () => undefined,
      onSnapshot: () => { calls.snapshots += 1; },
      onChat: () => undefined,
    },
  };
}

describe("attachRoomSocketSession", () => {
  it("yêu cầu lại snapshot ngay khi socket đã kết nối trước lúc trang phòng mount", () => {
    const socket = new FakeSocket(true);
    const callbacks = handlers();

    attachRoomSocketSession(socket as unknown as Socket, "EKR4G", callbacks.value);

    assert.equal(callbacks.calls.connected, 1);
    assert.equal(socket.connectCalls, 0);
    assert.deepEqual(socket.emitted, [
      { event: "room:join", payload: { code: "EKR4G" } },
    ]);
  });

  it("đợi connect rồi mới yêu cầu snapshot và đồng bộ lại sau reconnect", () => {
    const socket = new FakeSocket(false);
    const callbacks = handlers();

    attachRoomSocketSession(socket as unknown as Socket, "ABCDE", callbacks.value);

    assert.equal(socket.connectCalls, 1);
    assert.deepEqual(socket.emitted, []);

    socket.trigger("connect");
    socket.trigger("disconnect");
    socket.trigger("connect");

    assert.equal(callbacks.calls.connected, 2);
    assert.equal(callbacks.calls.disconnected, 1);
    assert.deepEqual(socket.emitted, [
      { event: "room:join", payload: { code: "ABCDE" } },
      { event: "room:join", payload: { code: "ABCDE" } },
    ]);
  });

  it("gỡ toàn bộ listener khi trang phòng unmount", () => {
    const socket = new FakeSocket(true);
    const callbacks = handlers();

    const cleanup = attachRoomSocketSession(
      socket as unknown as Socket,
      "ABCDE",
      callbacks.value,
    );
    cleanup();

    assert.equal(socket.listenerCount("connect"), 0);
    assert.equal(socket.listenerCount("disconnect"), 0);
    assert.equal(socket.listenerCount("error"), 0);
    assert.equal(socket.listenerCount("room:snapshot"), 0);
    assert.equal(socket.listenerCount("chat:new"), 0);
  });
});

describe("runWhenSocketConnected", () => {
  it("chạy ngay mà không để lại listener khi socket đã kết nối", () => {
    const socket = new FakeSocket(true);
    let calls = 0;

    runWhenSocketConnected(socket as unknown as Socket, () => { calls += 1; });

    assert.equal(calls, 1);
    assert.equal(socket.connectCalls, 0);
    assert.equal(socket.listenerCount("connect"), 0);
  });

  it("chỉ chạy một lần sau khi socket kết nối", () => {
    const socket = new FakeSocket(false);
    let calls = 0;

    runWhenSocketConnected(socket as unknown as Socket, () => { calls += 1; });
    assert.equal(socket.connectCalls, 1);
    assert.equal(calls, 0);

    socket.trigger("connect");
    socket.trigger("connect");

    assert.equal(calls, 1);
    assert.equal(socket.listenerCount("connect"), 0);
  });

  it("huỷ được lượt chờ, và connect tới sau đó không chạy action", () => {
    const socket = new FakeSocket(false);
    let calls = 0;

    const cancel = runWhenSocketConnected(socket as unknown as Socket, () => { calls += 1; });
    cancel();

    socket.trigger("connect");

    assert.equal(calls, 0);
    assert.equal(socket.listenerCount("connect"), 0);
  });
});
