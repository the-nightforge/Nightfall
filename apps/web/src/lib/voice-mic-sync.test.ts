import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMicSync } from "./voice-mic-sync";

function deferred() {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function harness() {
  const calls: boolean[] = [];
  const results: boolean[] = [];
  const errors: unknown[] = [];
  let pending = deferred();

  const sync = createMicSync({
    setMic: (on) => {
      calls.push(on);
      pending = deferred();
      return pending.promise;
    },
    onResult: (open) => void results.push(open),
    onError: (error) => void errors.push(error),
  });

  return {
    sync,
    calls,
    results,
    errors,
    finish: () => pending.resolve(),
    fail: (err: unknown) => pending.reject(err),
  };
}

const tick = () => new Promise((r) => setImmediate(r));

describe("createMicSync", () => {
  it("không làm gì khi đã đúng trạng thái", () => {
    const h = harness();
    h.sync.reconcile(false, false);
    h.sync.reconcile(true, true);
    assert.deepEqual(h.calls, []);
  });

  it("mở mic khi cần và báo kết quả về", async () => {
    const h = harness();
    h.sync.reconcile(true, false);
    assert.deepEqual(h.calls, [true]);

    h.finish();
    await tick();
    assert.deepEqual(h.results, [true]);
  });

  it("không gọi chồng khi lời gọi trước còn đang chạy", () => {
    const h = harness();
    h.sync.reconcile(true, false);
    h.sync.reconcile(true, false);
    h.sync.reconcile(true, false);
    assert.deepEqual(h.calls, [true]);
    assert.equal(h.sync.busy, true);
  });
});

describe("bất biến 1: kết quả không bao giờ bị nuốt", () => {
  /**
   * Đây chính là lỗi đã lên production: một cờ `cancelled` trong cleanup của
   * useEffect nuốt mất `mic_opened`, và nút ở lại màu xám dù mic đã mở thật.
   * Không có đường nào huỷ kết quả nữa - test này khoá điều đó lại.
   */
  it("báo kết quả kể cả khi đã có hàng loạt vòng đối chiếu xen vào", async () => {
    const h = harness();
    h.sync.reconcile(true, false);

    // Mô phỏng những dispatch chẳng liên quan gì tới mic vẫn kéo effect chạy lại.
    for (let i = 0; i < 5; i++) h.sync.reconcile(true, false);

    h.finish();
    await tick();
    assert.deepEqual(h.results, [true], "kết quả phải tới nơi, không bị huỷ");
  });

  it("người dùng nhả nút giữa chừng: vẫn báo mở, rồi vòng sau tự đóng lại", async () => {
    const h = harness();
    h.sync.reconcile(true, false);
    h.finish();
    await tick();
    assert.deepEqual(h.results, [true]);

    // Máy trạng thái giờ nói KHÔNG nên mở nữa, mà mic đang mở.
    h.sync.reconcile(false, true);
    assert.deepEqual(h.calls, [true, false]);
    h.finish();
    await tick();
    assert.deepEqual(h.results, [true, false]);
  });
});

describe("bất biến 2: cờ bận nhả trước khi báo kết quả", () => {
  /**
   * Báo kết quả sẽ kéo theo một vòng đối chiếu mới. Cờ còn bật lúc đó thì vòng
   * ấy thoát sớm, và không còn gì đánh thức nó nữa - mic kẹt sai trạng thái.
   */
  it("đối chiếu lại ngay trong lúc nhận kết quả vẫn chạy được", async () => {
    const calls: boolean[] = [];
    let pending = deferred();
    let sync!: ReturnType<typeof createMicSync>;

    sync = createMicSync({
      setMic: (on) => {
        calls.push(on);
        pending = deferred();
        return pending.promise;
      },
      // Ngay khi biết mic đã mở, máy trạng thái nói "thôi đóng lại đi".
      onResult: () => sync.reconcile(false, true),
      onError: () => undefined,
    });

    sync.reconcile(true, false);
    assert.deepEqual(calls, [true]);

    pending.resolve();
    await tick();
    assert.deepEqual(calls, [true, false], "vòng đối chiếu lồng bên trong phải chạy được");
  });
});

describe("lỗi không được im lặng", () => {
  it("setMic hỏng thì báo lỗi ra ngoài", async () => {
    const h = harness();
    h.sync.reconcile(true, false);
    h.fail(new Error("NotAllowedError"));
    await tick();

    assert.equal(h.errors.length, 1);
    assert.deepEqual(h.results, []);
  });

  it("hỏng xong vẫn thử lại được, không kẹt cờ bận", async () => {
    const h = harness();
    h.sync.reconcile(true, false);
    h.fail(new Error("hỏng"));
    await tick();
    assert.equal(h.sync.busy, false);

    h.sync.reconcile(true, false);
    assert.deepEqual(h.calls, [true, true]);
  });
});
