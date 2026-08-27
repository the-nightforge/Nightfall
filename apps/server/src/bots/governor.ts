interface RoomBudget {
  calls: number;
}

/** Nghỉ bao lâu sau 429 khi nhà cung cấp không nói rõ thời gian chờ. */
const DEFAULT_BACKOFF_MS = 30_000;
/** Chặn trên: một retryDelay dài bất thường không được làm bot câm cả ván. */
const MAX_BACKOFF_MS = 120_000;
const MIN_BACKOFF_MS = 1_000;

/**
 * Hạn nghỉ sau khi bị 429, RIÊNG cho từng nhà cung cấp.
 *
 * Quota thuộc về một API key cụ thể, nên phạm vi phải là nhà cung cấp: rộng hơn
 * thì hết quota ở OpenAI sẽ khoá luôn Google - hai hạn mức chẳng liên quan gì
 * nhau - và cả chuỗi dự phòng sập theo một lần 429 duy nhất. Hẹp hơn (theo
 * phòng) thì các phòng khác vẫn tiếp tục đâm vào đúng bức tường vừa dựng.
 */
export class Cooldown {
  private until = 0;

  /** now tiêm được để test không phải chờ đồng hồ thật. */
  constructor(private readonly now: () => number = Date.now) {}

  active(): boolean {
    return this.now() < this.until;
  }

  /**
   * Nghỉ một lúc rồi cho gọi lại, thay vì tắt tới hết ván: rate limit theo phút
   * tự hồi trong vòng một phút, còn tắt vĩnh viễn biến một lần chạm trần thoáng
   * qua thành bot câm suốt ván. Chỉ nới dài, không bao giờ rút ngắn hạn đang có.
   */
  backOff(retryAfterMs?: number): void {
    const raw = retryAfterMs ?? DEFAULT_BACKOFF_MS;
    const ms = Math.min(Math.max(raw, MIN_BACKOFF_MS), MAX_BACKOFF_MS);
    this.until = Math.max(this.until, this.now() + ms);
  }

  remainingMs(): number {
    return Math.max(0, this.until - this.now());
  }
}

/**
 * Trần số lượt gọi theo từng phòng, dùng CHUNG cho mọi nhà cung cấp: nó nói về
 * chi phí của một ván, nên chuỗi dự phòng không được lách bằng cách gọi tiếp
 * nhà cung cấp khác sau khi ván đã tiêu hết ngân sách.
 */
export class BotGovernor {
  private readonly budgets = new Map<string, RoomBudget>();

  constructor(private readonly maxCalls: number) {}

  private budget(roomCode: string): RoomBudget {
    let b = this.budgets.get(roomCode);
    if (!b) {
      b = { calls: 0 };
      this.budgets.set(roomCode, b);
    }
    return b;
  }

  canCall(roomCode: string): boolean {
    return this.budget(roomCode).calls < this.maxCalls;
  }

  recordCall(roomCode: string): void {
    this.budget(roomCode).calls += 1;
  }

  reset(roomCode: string): void {
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
