import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFrameLoop, type FrameLoopHooks } from "./live-trial-loop";

/**
 * Tiêm lỗi vào đúng những chỗ mà `try/catch` của lúc khởi tạo KHÔNG với tới.
 *
 * Bản đầu chỉ bọc chuỗi khởi tạo, nên `renderer.render` ném ở khung hình thứ
 * năm mươi là một lỗi thoát ra ngoài callback `requestAnimationFrame`: vòng vẽ
 * chết, không ai được báo, canvas ở lại với `opacity: 0`, và bản 2D dự phòng
 * không bao giờ hiện ra.
 */

interface Harness {
  hooks: FrameLoopHooks;
  /** Chạy khung hình đang chờ, nếu có. Trả `false` khi vòng vẽ đã dừng. */
  flush(): boolean;
  crashes: unknown[];
  paints: number;
  draws: number;
  cancels: number;
}

function harness(options: { draw?: (n: number) => void; disposed?: () => boolean } = {}): Harness {
  let queued: (() => void) | null = null;
  let handle = 0;
  const state = { crashes: [] as unknown[], paints: 0, draws: 0, cancels: 0 };

  const hooks: FrameLoopHooks = {
    disposed: options.disposed ?? (() => false),
    draw: (nowMs) => {
      state.draws += 1;
      options.draw?.(nowMs);
    },
    now: () => state.draws * 16,
    requestFrame: (callback) => {
      queued = callback;
      handle += 1;
      return handle;
    },
    cancelFrame: () => {
      state.cancels += 1;
      queued = null;
    },
    onFirstPaint: () => {
      state.paints += 1;
    },
    onCrash: (cause) => state.crashes.push(cause),
  };

  return {
    hooks,
    flush() {
      const next = queued;
      queued = null;
      if (!next) return false;
      next();
      return true;
    },
    get crashes() {
      return state.crashes;
    },
    get paints() {
      return state.paints;
    },
    get draws() {
      return state.draws;
    },
    get cancels() {
      return state.cancels;
    },
  };
}

// ---------------------------------------------------------------------------

describe("vòng vẽ chạy bình thường", () => {
  it("vẽ liên tục và báo khung hình đầu tiên đúng một lần", () => {
    const app = harness();
    const loop = createFrameLoop(app.hooks);
    loop.start();
    for (let i = 0; i < 5; i += 1) app.flush();

    assert.equal(app.draws, 5);
    assert.equal(app.paints, 1);
    assert.equal(loop.crashed(), false);
    assert.equal(loop.running(), true);
  });

  it("dừng rồi chạy lại được - đó là đường của tab bị ẩn", () => {
    const app = harness();
    const loop = createFrameLoop(app.hooks);
    loop.start();
    app.flush();
    loop.stop();
    assert.equal(loop.running(), false);
    assert.equal(app.flush(), false, "không còn khung nào chờ");

    loop.start();
    assert.equal(app.flush(), true);
    assert.equal(loop.crashed(), false);
  });

  it("gọi start hai lần không tạo hai vòng vẽ", () => {
    const app = harness();
    const loop = createFrameLoop(app.hooks);
    loop.start();
    loop.start();
    loop.start();
    app.flush();
    assert.equal(app.draws, 1);
  });
});

describe("lỗi trong vòng vẽ", () => {
  it("render ném thì BÁO LÊN, không thoát ra ngoài lặng lẽ", () => {
    const boom = new Error("context đã mất");
    const app = harness({
      draw: (n) => {
        if (n >= 32) throw boom;
      },
    });
    const loop = createFrameLoop(app.hooks);
    loop.start();

    assert.doesNotThrow(() => {
      app.flush();
      app.flush();
      app.flush();
    });
    assert.deepEqual(app.crashes, [boom]);
  });

  it("hỏng rồi thì DỪNG HẲN, không thử lại mãi", () => {
    const app = harness({
      draw: () => {
        throw new Error("hỏng");
      },
    });
    const loop = createFrameLoop(app.hooks);
    loop.start();
    app.flush();

    assert.equal(loop.running(), false);
    assert.equal(app.flush(), false, "không được lên lịch khung tiếp theo");
    assert.equal(app.draws, 1, "một context đã hỏng thì khung sau chỉ ném lại đúng lỗi ấy");
  });

  it("báo hỏng ĐÚNG MỘT LẦN dù bị đụng vào nhiều lần nữa", () => {
    const app = harness({
      draw: () => {
        throw new Error("hỏng");
      },
    });
    const loop = createFrameLoop(app.hooks);
    loop.start();
    app.flush();

    loop.start();
    loop.guard(() => {
      throw new Error("hỏng lần nữa");
    });
    loop.guard(() => undefined);

    assert.equal(app.crashes.length, 1, "dọn tài nguyên và rơi về 2D chỉ được làm một lượt");
  });

  it("huỷ khung đang chờ TRƯỚC khi báo lên", () => {
    const order: string[] = [];
    const app = harness({
      draw: () => {
        throw new Error("hỏng");
      },
    });
    const hooks: FrameLoopHooks = {
      ...app.hooks,
      cancelFrame: (handle) => {
        order.push("cancel");
        app.hooks.cancelFrame(handle);
      },
      onCrash: (cause) => {
        order.push("crash");
        app.hooks.onCrash(cause);
      },
    };
    const loop = createFrameLoop(hooks);
    loop.start();
    app.flush();

    // Khung đang chờ đã bị `tick` gỡ ra trước khi vẽ, nên ở ca này không còn gì
    // để huỷ - điều phải đúng là `onCrash` không bao giờ chạy TRƯỚC `cancel`.
    assert.ok(!order.includes("cancel") || order.indexOf("cancel") < order.indexOf("crash"));
    assert.deepEqual(order.filter((x) => x === "crash"), ["crash"]);
  });

  it("lỗi ở khung đầu tiên thì không báo đã vẽ được khung nào", () => {
    const app = harness({
      draw: () => {
        throw new Error("hỏng ngay khung đầu");
      },
    });
    const loop = createFrameLoop(app.hooks);
    loop.start();
    app.flush();
    assert.equal(app.paints, 0, "canvas chưa từng lên hình thì đừng mở độ đục cho nó");
  });
});

describe("lỗi NGOÀI vòng vẽ", () => {
  it("callback đổi cỡ ném thì cũng rơi về cùng một đường lui", () => {
    const boom = new Error("setSize hỏng");
    const app = harness();
    const loop = createFrameLoop(app.hooks);
    loop.start();

    const ok = loop.guard(() => {
      throw boom;
    });

    assert.equal(ok, false);
    assert.deepEqual(app.crashes, [boom]);
    assert.equal(loop.running(), false, "vòng vẽ phải dừng theo");
  });

  it("việc chạy trót lọt thì trả true và không đụng gì tới vòng vẽ", () => {
    const app = harness();
    const loop = createFrameLoop(app.hooks);
    loop.start();
    assert.equal(loop.guard(() => undefined), true);
    assert.equal(loop.crashed(), false);
    assert.equal(loop.running(), true);
  });

  it("sau khi hỏng thì mọi việc mới đều bị từ chối", () => {
    const app = harness();
    const loop = createFrameLoop(app.hooks);
    loop.guard(() => {
      throw new Error("hỏng");
    });
    let ran = false;
    assert.equal(
      loop.guard(() => {
        ran = true;
      }),
      false,
    );
    assert.equal(ran, false, "không tiếp tục vẽ bằng một context đã hỏng");
  });
});

describe("đã dọn tài nguyên", () => {
  it("dọn rồi thì không vẽ nữa và không lên lịch thêm", () => {
    let disposed = false;
    const app = harness({ disposed: () => disposed });
    const loop = createFrameLoop(app.hooks);
    loop.start();
    app.flush();
    disposed = true;
    app.flush();

    assert.equal(app.draws, 1);
    assert.equal(app.flush(), false);
  });

  it("dọn rồi thì start là no-op - không có khung nào chạy sau khi unmount", () => {
    const app = harness({ disposed: () => true });
    const loop = createFrameLoop(app.hooks);
    loop.start();
    assert.equal(loop.running(), false);
    assert.equal(app.flush(), false);
  });

  it("dọn rồi thì guard cũng không chạy và không báo hỏng", () => {
    const app = harness({ disposed: () => true });
    const loop = createFrameLoop(app.hooks);
    let ran = false;
    assert.equal(
      loop.guard(() => {
        ran = true;
      }),
      false,
    );
    assert.equal(ran, false);
    assert.deepEqual(app.crashes, [], "unmount không phải một lỗi");
  });

  it("stop gọi lặp không ném", () => {
    const app = harness();
    const loop = createFrameLoop(app.hooks);
    loop.start();
    assert.doesNotThrow(() => {
      loop.stop();
      loop.stop();
      loop.stop();
    });
  });

  it("phép huỷ khung hỏng cũng không chặn đường dọn dẹp", () => {
    const app = harness({
      draw: () => {
        throw new Error("hỏng");
      },
    });
    const loop = createFrameLoop({
      ...app.hooks,
      cancelFrame: () => {
        throw new Error("cancelAnimationFrame hỏng");
      },
    });
    loop.start();
    assert.doesNotThrow(() => app.flush());
    assert.equal(app.crashes.length, 1, "vẫn phải báo lên để rơi về bản 2D");
  });
});
