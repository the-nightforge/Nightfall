import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GIVE_UP_AFTER_MS,
  GIVE_UP_MESSAGE,
  SLOW_AFTER_MS,
  WakeWatch,
  prewakeServer,
  wakeStatusText,
  type WakeTimers,
} from "./server-wake";

/** Đồng hồ giả: chỉ chạy khi test bảo chạy. */
function clock() {
  let now = 0;
  let seq = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: WakeTimers = {
    setTimeout: (fn, ms) => {
      const id = (seq += 1);
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (handle) => void pending.delete(handle as number),
  };
  return {
    timers,
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...pending]) {
        if (t.at <= now) {
          pending.delete(id);
          t.fn();
        }
      }
    },
    get armed() {
      return pending.size;
    },
  };
}

function watch(c = clock()) {
  const calls = { slow: 0, gaveUp: 0 };
  const w = new WakeWatch(
    { onSlow: () => void (calls.slow += 1), onGiveUp: () => void (calls.gaveUp += 1) },
    c.timers,
  );
  return { w, c, calls };
}

describe("WakeWatch", () => {
  it("trả lời nhanh thì không báo gì", () => {
    const { w, c, calls } = watch();
    w.start();
    c.advance(SLOW_AFTER_MS - 1);
    w.stop();
    c.advance(GIVE_UP_AFTER_MS);
    assert.deepEqual(calls, { slow: 0, gaveUp: 0 });
    assert.equal(c.armed, 0);
  });

  it("qua ngưỡng chậm thì báo chậm đúng một lần", () => {
    const { w, c, calls } = watch();
    w.start();
    c.advance(SLOW_AFTER_MS);
    c.advance(SLOW_AFTER_MS);
    assert.equal(calls.slow, 1);
    assert.equal(calls.gaveUp, 0);
  });

  it("quá hạn thì bỏ cuộc, sau khi đã báo chậm", () => {
    const { w, c, calls } = watch();
    w.start();
    c.advance(GIVE_UP_AFTER_MS);
    assert.deepEqual(calls, { slow: 1, gaveUp: 1 });
  });

  it("stop sau khi đã báo chậm thì không còn bỏ cuộc nữa", () => {
    const { w, c, calls } = watch();
    w.start();
    c.advance(SLOW_AFTER_MS);
    w.stop();
    c.advance(GIVE_UP_AFTER_MS);
    assert.deepEqual(calls, { slow: 1, gaveUp: 0 });
  });

  it("start lần nữa thì đặt lại từ đầu, không cộng dồn hẹn giờ", () => {
    const { w, c, calls } = watch();
    w.start();
    c.advance(SLOW_AFTER_MS - 1);
    w.start();
    c.advance(1);
    assert.equal(calls.slow, 0);
    assert.equal(c.armed, 2);
  });

  it("stop gọi nhiều lần vẫn an toàn", () => {
    const { w } = watch();
    w.stop();
    w.start();
    w.stop();
    w.stop();
  });
});

describe("wakeStatusText", () => {
  it("nói rõ vì sao chậm và đã chờ bao lâu", () => {
    const text = wakeStatusText(12);
    assert.match(text, /thức dậy/);
    assert.match(text, /12 giây/);
  });
  it("thông điệp bỏ cuộc mời thử lại", () => {
    assert.match(GIVE_UP_MESSAGE, /thử lại/i);
  });
});

describe("prewakeServer", () => {
  it("gọi đúng /api/health và nuốt lỗi", async () => {
    const urls: string[] = [];
    await prewakeServer("http://s", async (url) => {
      urls.push(String(url));
      throw new Error("down");
    });
    assert.deepEqual(urls, ["http://s/api/health"]);
  });
});
