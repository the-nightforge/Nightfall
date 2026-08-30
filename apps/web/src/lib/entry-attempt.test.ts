import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EntryAttemptManager, isAbortError } from "./entry-attempt";

describe("EntryAttemptManager", () => {
  it("lượt mới đang chạy và signal chưa bị abort", () => {
    const manager = new EntryAttemptManager();
    const attempt = manager.begin();

    assert.equal(attempt.isActive(), true);
    assert.equal(attempt.signal.aborted, false);
    assert.equal(manager.activeId, attempt.id);
  });

  it("cancelActive abort signal, chạy cleanup và đóng lượt", () => {
    const manager = new EntryAttemptManager();
    const attempt = manager.begin();
    let cleanups = 0;
    attempt.setCleanup(() => {
      cleanups += 1;
    });

    manager.cancelActive();

    assert.equal(attempt.signal.aborted, true);
    assert.equal(cleanups, 1);
    assert.equal(attempt.isActive(), false);
    assert.equal(manager.activeId, null);
  });

  it("gọi cancelActive nhiều lần vẫn an toàn và cleanup chỉ chạy một lần", () => {
    const manager = new EntryAttemptManager();
    const attempt = manager.begin();
    let cleanups = 0;
    attempt.setCleanup(() => {
      cleanups += 1;
    });

    manager.cancelActive();
    manager.cancelActive();
    manager.cancelActive();

    assert.equal(cleanups, 1);
  });

  it("cleanup nhìn thấy lượt đã chết ngay tại thời điểm nó chạy", () => {
    // Quan trọng: cleanup có thể kéo theo callback chạy đồng bộ, và callback
    // đó phải thấy isActive() === false chứ không phải một lượt nửa sống.
    const manager = new EntryAttemptManager();
    const attempt = manager.begin();
    let seenActive: boolean | null = null;
    attempt.setCleanup(() => {
      seenActive = attempt.isActive();
    });

    manager.cancelActive();

    assert.equal(seenActive, false);
  });

  it("setCleanup trên lượt đã huỷ thì chạy ngay thay vì cất đi", () => {
    // Xảy ra thật: enterRoom chốt xong kết quả ngay trong lời gọi của nó, nên
    // dòng gán cleanup chạy sau khi lượt đã đóng. Cất vào lượt chết là rò
    // listener vĩnh viễn.
    const manager = new EntryAttemptManager();
    const attempt = manager.begin();
    manager.cancelActive();

    let cleanups = 0;
    attempt.setCleanup(() => {
      cleanups += 1;
    });

    assert.equal(cleanups, 1);
  });

  it("begin lần sau huỷ lượt trước, id tăng dần", () => {
    const manager = new EntryAttemptManager();
    const first = manager.begin();
    let firstCleanups = 0;
    first.setCleanup(() => {
      firstCleanups += 1;
    });

    const second = manager.begin();

    assert.equal(firstCleanups, 1);
    assert.equal(first.signal.aborted, true);
    assert.equal(first.isActive(), false);
    assert.equal(second.isActive(), true);
    assert.equal(second.id > first.id, true);
    assert.equal(second.signal.aborted, false);
  });

  it("finish đóng lượt mà KHÔNG chạy cleanup", () => {
    // Đường thành công: socket đã sang tay trang phòng, Home không được gỡ
    // listener của trang đó.
    const manager = new EntryAttemptManager();
    const attempt = manager.begin();
    let cleanups = 0;
    attempt.setCleanup(() => {
      cleanups += 1;
    });

    attempt.finish();

    assert.equal(cleanups, 0);
    assert.equal(attempt.isActive(), false);
    assert.equal(manager.activeId, null);
  });

  it("sau finish thì cancelActive không chạy cleanup nữa", () => {
    const manager = new EntryAttemptManager();
    const attempt = manager.begin();
    let cleanups = 0;
    attempt.setCleanup(() => {
      cleanups += 1;
    });

    attempt.finish();
    manager.cancelActive();
    manager.cancelActive();

    assert.equal(cleanups, 0);
  });

  describe("lượt cũ không được đụng vào lượt mới", () => {
    it("finish của lượt cũ không đóng lượt mới", () => {
      const manager = new EntryAttemptManager();
      const stale = manager.begin();
      const fresh = manager.begin();

      stale.finish();

      assert.equal(fresh.isActive(), true);
      assert.equal(manager.activeId, fresh.id);
    });

    it("setCleanup của lượt cũ không ghi đè cleanup của lượt mới", () => {
      const manager = new EntryAttemptManager();
      const stale = manager.begin();
      const fresh = manager.begin();

      let freshCleanups = 0;
      let staleCleanups = 0;
      fresh.setCleanup(() => {
        freshCleanups += 1;
      });
      // Lượt cũ gắn cleanup muộn -> phải tự chạy ngay, không được chen vào
      // chỗ của lượt mới.
      stale.setCleanup(() => {
        staleCleanups += 1;
      });

      assert.equal(staleCleanups, 1);
      assert.equal(freshCleanups, 0);

      manager.cancelActive();

      assert.equal(freshCleanups, 1);
      assert.equal(staleCleanups, 1);
    });
  });

  describe("dọn lúc unmount", () => {
    it("huỷ lượt đang chạy: abort signal, gỡ listener, đóng lượt", () => {
      const manager = new EntryAttemptManager();
      const attempt = manager.begin();
      let cleanups = 0;
      attempt.setCleanup(() => {
        cleanups += 1;
      });

      manager.cancelActive();

      assert.equal(attempt.signal.aborted, true);
      assert.equal(attempt.isActive(), false);
      assert.equal(cleanups, 1);
    });

    it("mount lại sau khi đã dọn thì lượt mới chạy bình thường", () => {
      /*
       * Hồi quy cho một lỗi thật đã gặp. Bản đầu giữ cờ `destroyed` ngay trong
       * manager, mà manager thì nằm trong `useRef` nên sống sót qua chu kỳ
       * mount -> cleanup -> mount của `reactStrictMode` ở dev. Cờ bật ở lần
       * cleanup đầu không bao giờ tắt, và mọi lượt sau đó chết ngay lúc sinh:
       * bấm "Tạo phòng mới" thì fetch bay đi, về, rồi bị bỏ lặng lẽ - nút kẹt
       * ở "Đang mở phòng..." mà không một dòng lỗi nào.
       */
      const manager = new EntryAttemptManager();
      manager.cancelActive();

      const attempt = manager.begin();

      assert.equal(attempt.isActive(), true);
      assert.equal(attempt.signal.aborted, false);
      assert.equal(manager.activeId, attempt.id);
    });
  });
});

describe("isAbortError", () => {
  it("nhận ra DOMException do AbortController ném ra", () => {
    const controller = new AbortController();
    controller.abort();
    assert.equal(isAbortError(controller.signal.reason), true);
  });

  it("không nhận nhầm lỗi mạng hay giá trị rỗng", () => {
    assert.equal(isAbortError(new TypeError("Failed to fetch")), false);
    assert.equal(isAbortError(new Error("boom")), false);
    assert.equal(isAbortError(null), false);
    assert.equal(isAbortError(undefined), false);
    assert.equal(isAbortError("AbortError"), false);
  });
});
