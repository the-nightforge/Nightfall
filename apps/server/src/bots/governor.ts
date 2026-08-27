interface RoomBudget {
  calls: number;
}

/** Nghỉ bao lâu sau 429 khi Google không nói rõ retryDelay. */
const DEFAULT_BACKOFF_MS = 30_000;
/** Chặn trên: một retryDelay dài bất thường không được làm bot câm cả ván. */
const MAX_BACKOFF_MS = 120_000;
const MIN_BACKOFF_MS = 1_000;

/**
 * Giữ ngân sách gọi Gemini theo từng phòng. Vì free tier không công bố giới hạn,
 * ta tự đặt trần của mình thay vì dò bằng cách đâm vào tường.
 *
 * Hai cơ chế tách bạch, vì chúng có phạm vi khác nhau:
 *  - Trần số lượt gọi: theo phòng, để một ván dài không đốt hết quota.
 *  - Nghỉ sau 429: TOÀN CỤC, vì quota là của API key chứ không của phòng. Tắt
 *    riêng phòng gặp lỗi sẽ để các phòng còn lại tiếp tục đâm vào cùng bức tường.
 */
export class BotGovernor {
  private readonly budgets = new Map<string, RoomBudget>();
  private cooldownUntil = 0;

  /** now tiêm được để test không phải chờ đồng hồ thật. */
  constructor(
    private readonly maxCalls: number,
    private readonly now: () => number = Date.now,
  ) {}

  private budget(roomCode: string): RoomBudget {
    let b = this.budgets.get(roomCode);
    if (!b) {
      b = { calls: 0 };
      this.budgets.set(roomCode, b);
    }
    return b;
  }

  canCall(roomCode: string): boolean {
    if (this.now() < this.cooldownUntil) return false;
    return this.budget(roomCode).calls < this.maxCalls;
  }

  recordCall(roomCode: string): void {
    this.budget(roomCode).calls += 1;
  }

  /**
   * Gặp 429: nghỉ một lúc rồi cho gọi lại, thay vì tắt tới hết ván. Rate limit
   * theo phút của free tier tự hồi trong vòng một phút, nên tắt vĩnh viễn biến
   * một lần chạm trần thoáng qua thành bot câm suốt ván - không có đường quay lại.
   * Chỉ nới dài thêm, không bao giờ rút ngắn hạn nghỉ đang có.
   */
  backOff(retryAfterMs?: number): void {
    const raw = retryAfterMs ?? DEFAULT_BACKOFF_MS;
    const ms = Math.min(Math.max(raw, MIN_BACKOFF_MS), MAX_BACKOFF_MS);
    this.cooldownUntil = Math.max(this.cooldownUntil, this.now() + ms);
  }

  /** Chỉ để log/test: còn phải nghỉ bao nhiêu ms nữa. */
  cooldownRemainingMs(): number {
    return Math.max(0, this.cooldownUntil - this.now());
  }

  reset(roomCode: string): void {
    // Cố ý không đụng cooldownUntil: nó phản ánh trạng thái quota của API key,
    // ván mới bắt đầu không làm quota hồi lại.
    this.budgets.delete(roomCode);
  }
}

/** Chạy công việc với hạn chót cứng. Quá hạn hoặc lỗi đều trả null. */
export async function withTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  ms: number,
): Promise<T | null> {
  const controller = new AbortController();
  let timer!: NodeJS.Timeout;
  const timeoutPromise = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      resolve(null);
      controller.abort();
    }, ms);
  });
  try {
    return await Promise.race([work(controller.signal), timeoutPromise]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
