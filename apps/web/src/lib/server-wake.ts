/**
 * Máy chủ trên Render gói miễn phí ngủ sau chừng 15 phút vắng người, và lần
 * gọi đầu tiên sau đó treo 30 đến 60 giây trong lúc nó thức dậy. Với người
 * chơi, đó là một cái nút "Đang vào..." quay mãi mà không nói gì - và họ
 * bấm lại, tải lại, rồi bỏ đi.
 *
 * Module này làm hai việc quanh chuyện đó:
 *
 *   - `WakeWatch` đếm giờ cho một lượt chờ: qua `SLOW_AFTER_MS` thì bảo bên
 *     gọi "chậm rồi, nói cho người ta biết", qua `GIVE_UP_AFTER_MS` thì bảo
 *     "bỏ cuộc". Bên gọi quyết định hiện gì; ở đây chỉ có đồng hồ.
 *   - `prewakeServer` gọi một phát `/api/health` ngay khi trang chủ mở, để
 *     máy chủ bắt đầu thức trong lúc người chơi còn gõ tên.
 *
 * Đồng hồ bơm vào để test chạy không cần chờ thật.
 */

/** Sau ngần này chưa có phản hồi thì coi là máy chủ đang thức dậy. */
export const SLOW_AFTER_MS = 3_000;
/** Render thức trong khoảng một phút; quá gấp rưỡi mức đó thì không phải ngủ. */
export const GIVE_UP_AFTER_MS = 90_000;

export const GIVE_UP_MESSAGE =
  "Máy chủ không phản hồi sau 90 giây. Kiểm tra mạng rồi thử lại.";

export interface WakeTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface WakeHandlers {
  onSlow(): void;
  onGiveUp(): void;
}

const realTimers: WakeTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class WakeWatch {
  private slow: unknown = null;
  private giveUp: unknown = null;

  constructor(
    private readonly handlers: WakeHandlers,
    private readonly timers: WakeTimers = realTimers,
  ) {}

  /** Bắt đầu đếm. Gọi lại thì đếm lại từ đầu. */
  start(): void {
    this.stop();
    this.slow = this.timers.setTimeout(() => {
      this.slow = null;
      this.handlers.onSlow();
    }, SLOW_AFTER_MS);
    this.giveUp = this.timers.setTimeout(() => {
      this.giveUp = null;
      this.handlers.onGiveUp();
    }, GIVE_UP_AFTER_MS);
  }

  /** Có phản hồi rồi, hoặc lượt bị huỷ. An toàn gọi nhiều lần. */
  stop(): void {
    if (this.slow !== null) this.timers.clearTimeout(this.slow);
    if (this.giveUp !== null) this.timers.clearTimeout(this.giveUp);
    this.slow = null;
    this.giveUp = null;
  }
}

/** Dòng trạng thái dưới nút, cập nhật mỗi giây. */
export function wakeStatusText(elapsedSec: number): string {
  return `Máy chủ đang thức dậy sau lúc vắng người, thường mất 30 đến 60 giây. Đã chờ ${elapsedSec} giây.`;
}

/**
 * Đánh thức máy chủ trước. Không quan tâm kết quả: mục đích là để request
 * ĐẾN nơi, còn nó trả gì hay có trả không thì lượt vào phòng sau sẽ tự biết.
 */
export async function prewakeServer(
  serverUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  try {
    await fetchFn(`${serverUrl}/api/health`, { method: "GET", cache: "no-store" });
  } catch {
    // Máy chủ ngủ hay mất mạng đều không phải việc của bước này.
  }
}
