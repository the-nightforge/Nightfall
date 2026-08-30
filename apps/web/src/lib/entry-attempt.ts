/**
 * Vòng đời một "lượt vào phòng", tách khỏi React để test được.
 *
 * Một lượt kéo dài qua ba đoạn chờ nối nhau: POST /api/players, `import()`
 * động module socket, rồi chờ socket bắt tay. Người dùng có thể bấm "Xoá phiên"
 * hoặc rời trang ở BẤT KỲ đoạn nào, và mỗi đoạn lại cần một cách dừng khác
 * nhau - abort fetch, gỡ listener, hoặc chỉ đơn giản là đừng chạy tiếp.
 *
 * Ba lớp bảo vệ, cố ý chồng lên nhau:
 *
 * 1. `AbortController` cắt fetch đang bay. Nhưng nó KHÔNG cắt được một promise
 *    đã resolve xong đang nằm chờ tới lượt trên microtask queue.
 * 2. Số thứ tự lượt (`id`) là chốt chặn cuối. Callback nào cũng phải hỏi
 *    `isActive()` trước khi chạm vào state, vào localStorage hay vào router;
 *    lượt cũ trả về false và trở thành no-op.
 * 3. Hàm cleanup gỡ listener socket, giữ ngay trong lượt nên không thể gỡ nhầm
 *    listener của lượt khác.
 *
 * Chỉ dùng AbortController là không đủ, và đó chính là lý do có lớp 2.
 *
 * Lớp này CỐ Ý không biết component còn mounted hay không. Đã thử nhét một cờ
 * `destroyed` vào đây và nó hỏng ngay ở dev: `reactStrictMode` chạy effect hai
 * lần - mount, cleanup, rồi mount lại - còn manager thì nằm trong `useRef` nên
 * sống sót qua cả chu kỳ đó. Cờ bật ở lần cleanup thứ nhất không bao giờ tắt,
 * và mọi lượt sau khi mount lại đều chết ngay lúc sinh ra: bấm "Tạo phòng mới"
 * thì fetch bay đi, về, rồi bị bỏ lặng lẽ. Việc theo dõi mounted thuộc về
 * component, chỗ mà mỗi lần mount đều bật lại được cờ.
 */

/** Một lượt cụ thể. Mọi callback bất đồng bộ cầm object này để tự kiểm tra. */
export interface EntryAttempt {
  /** Số thứ tự, tăng dần. Chủ yếu để đọc log và để test khẳng định. */
  readonly id: number;
  /** Truyền thẳng vào `fetch` để huỷ được request đang bay. */
  readonly signal: AbortSignal;
  /** Lượt này còn là lượt đang chạy không. False sau khi huỷ hoặc đã xong. */
  isActive(): boolean;
  /**
   * Gắn hàm gỡ listener socket cho lượt này.
   *
   * Gọi khi lượt ĐÃ chết thì chạy hàm đó ngay lập tức thay vì cất đi: tình
   * huống này xảy ra thật - `enterRoom` có thể chốt xong kết quả ngay trong
   * lời gọi của nó (socket đã nối sẵn), nên dòng gán cleanup chạy sau khi
   * lượt đã đóng. Cất vào một lượt đã chết là để rò listener vĩnh viễn.
   */
  setCleanup(cleanup: () => void): void;
  /**
   * Đóng lượt mà KHÔNG chạy cleanup.
   *
   * Dùng ở hai chỗ: khi vào phòng thành công - socket lúc này thuộc về trang
   * phòng, `Home` không được đụng vào nữa - và khi lượt đã thất bại xong xuôi,
   * vì `enterRoom` tự gỡ listener của nó rồi.
   */
  finish(): void;
}

interface ActiveEntry {
  id: number;
  controller: AbortController;
  cleanup: (() => void) | null;
}

/**
 * Giữ đúng MỘT lượt đang chạy tại một thời điểm.
 *
 * `cancelActive()` gọi bao nhiêu lần cũng được, và không bao giờ chạm vào một
 * lượt mới hơn: mọi thao tác đều so `id` với lượt đang giữ.
 */
export class EntryAttemptManager {
  private seq = 0;
  private current: ActiveEntry | null = null;

  /** Số thứ tự lượt đang chạy, hoặc null. Để test và log. */
  get activeId(): number | null {
    return this.current?.id ?? null;
  }

  /** Mở lượt mới. Lượt cũ (nếu còn) bị huỷ trước, không để hai lượt chồng nhau. */
  begin(): EntryAttempt {
    this.cancelActive();
    const id = (this.seq += 1);
    const controller = new AbortController();
    this.current = { id, controller, cleanup: null };
    return this.wrap(id, controller);
  }

  /**
   * Huỷ lượt đang chạy: abort fetch, gỡ listener, vô hiệu hoá mọi callback cũ.
   *
   * Thứ tự trong đây quan trọng. Xoá `current` TRƯỚC khi abort và trước khi
   * chạy cleanup: cả hai đều có thể kích hoạt callback chạy đồng bộ, và callback
   * đó phải nhìn thấy `isActive() === false` chứ không phải một lượt nửa sống.
   */
  cancelActive(): void {
    const entry = this.current;
    if (!entry) return;
    this.current = null;
    entry.controller.abort();
    entry.cleanup?.();
  }

  private wrap(id: number, controller: AbortController): EntryAttempt {
    const isActive = () => this.current !== null && this.current.id === id;
    return {
      id,
      signal: controller.signal,
      isActive,
      setCleanup: (cleanup) => {
        if (!isActive()) {
          cleanup();
          return;
        }
        this.current!.cleanup = cleanup;
      },
      finish: () => {
        // `isActive` là thứ giữ cho lượt CŨ không xoá được lượt mới.
        if (!isActive()) return;
        this.current = null;
      },
    };
  }
}

/**
 * Ngoại lệ này có phải do chính ta abort không.
 *
 * `fetch` bị abort ném ra `DOMException` tên "AbortError". Nếu để nó rơi vào
 * nhánh catch chung thì người dùng vừa bấm "Xoá phiên" xong lại thấy hiện lên
 * "Không kết nối được server" - một lỗi họ không gây ra và cũng không sửa được.
 */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}
