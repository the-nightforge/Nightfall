/**
 * Vòng vẽ của sân khấu phiên toà, và cái lưới hứng lỗi của nó.
 *
 * Tách khỏi component vì một lý do rất cụ thể: lỗi ném ra TRONG callback của
 * `requestAnimationFrame` không rơi vào bất kỳ `try/catch` nào của lúc khởi
 * tạo. Nó thoát ra ngoài, vòng vẽ chết lặng lẽ, và thứ ở lại là một thẻ
 * `<canvas>` trong suốt - không có cảnh 3D, cũng không có bản 2D thay thế, vì
 * chẳng ai được báo là đã hỏng. Người chơi nhìn thấy một ô trống đúng vào lúc
 * họ phải bấm Treo hay Tha.
 *
 * Ở đây thì mọi đường chạm vào cảnh đều đi qua cùng MỘT lưới, và cái lưới ấy
 * kiểm được bằng `node:test`: không cần DOM, không cần GPU, chỉ cần bơm vào một
 * `draw` biết ném.
 *
 * Hai luật:
 *
 *   1. Hỏng MỘT lần là hỏng hẳn. Không lên lịch khung tiếp theo, không thử lại:
 *      một context đã mất thì khung sau chỉ ném lại đúng lỗi ấy, mãi mãi.
 *   2. `onCrash` gọi ĐÚNG một lần. Bên gọi dùng nó để dọn tài nguyên rồi chuyển
 *      sang bản 2D, và cả hai việc đó không được làm hai lượt.
 */

export interface FrameLoopHooks {
  /** Tài nguyên đã bị dọn chưa. Đã dọn thì không vẽ và không lên lịch nữa. */
  disposed(): boolean;
  /** Vẽ MỘT khung hình: cập nhật cảnh rồi render. Ném thì cả vòng vẽ dừng. */
  draw(nowMs: number): void;
  now(): number;
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
  /** Khung hình đầu tiên đã lên màn - để bên gọi mở dần độ đục của canvas. */
  onFirstPaint(): void;
  /** Hỏng không cứu được. Gọi đúng một lần. */
  onCrash(cause: unknown): void;
}

export interface FrameLoop {
  /** Bắt đầu vẽ. Không làm gì nếu đang vẽ, đã dọn, hoặc đã hỏng. */
  start(): void;
  /** Dừng vẽ nhưng chưa hỏng - dùng khi tab bị ẩn. */
  stop(): void;
  /**
   * Chạy một việc chạm vào cảnh NGOÀI vòng vẽ - đổi cỡ, đổi trạng thái.
   *
   * Cùng một đường lui với vòng vẽ: hỏng thì dọn và rơi về 2D, chứ không nuốt
   * lỗi rồi để lại một khung trống. Trả `false` khi không chạy được.
   */
  guard(task: () => void): boolean;
  running(): boolean;
  crashed(): boolean;
}

export function createFrameLoop(hooks: FrameLoopHooks): FrameLoop {
  /** Handle của khung đang chờ; `0` là không có khung nào. */
  let frame = 0;
  let broken = false;
  let painted = false;

  const cancel = (): void => {
    if (frame === 0) return;
    const handle = frame;
    frame = 0;
    // Ngay cả phép huỷ cũng có thể ném (bên gọi tiêm hàm vào), và nó chạy trên
    // đường dọn dẹp - nơi mọi thứ khác đã hỏng sẵn rồi.
    try {
      hooks.cancelFrame(handle);
    } catch {
      /* không còn gì để làm với một phép huỷ hỏng */
    }
  };

  const crash = (cause: unknown): void => {
    if (broken) return;
    broken = true;
    // Dừng TRƯỚC khi báo lên: `onCrash` sẽ dọn tài nguyên, và một khung đã lên
    // lịch sẽ vẽ bằng đúng những thứ vừa bị trả về GPU.
    cancel();
    hooks.onCrash(cause);
  };

  const tick = (): void => {
    frame = 0;
    if (broken || hooks.disposed()) return;
    try {
      hooks.draw(hooks.now());
    } catch (error) {
      crash(error);
      return;
    }
    if (!painted) {
      painted = true;
      // Ngoài khối vẽ: một `setState` của React ném ở đây không phải lỗi của
      // cảnh, và nó không được kéo cả sân khấu xuống bản 2D.
      hooks.onFirstPaint();
    }
    if (broken || hooks.disposed()) return;
    frame = hooks.requestFrame(tick);
  };

  return {
    start() {
      if (broken || frame !== 0 || hooks.disposed()) return;
      frame = hooks.requestFrame(tick);
    },
    stop: cancel,
    guard(task) {
      if (broken || hooks.disposed()) return false;
      try {
        task();
        return true;
      } catch (error) {
        crash(error);
        return false;
      }
    },
    running: () => frame !== 0,
    crashed: () => broken,
  };
}
