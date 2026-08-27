interface RoomBudget {
  calls: number;
  tripped: boolean;
}

/**
 * Giữ ngân sách gọi Gemini theo từng phòng. Vì free tier không công bố giới hạn,
 * ta tự đặt trần của mình thay vì dò bằng cách đâm vào tường.
 */
export class BotGovernor {
  private readonly budgets = new Map<string, RoomBudget>();

  constructor(private readonly maxCalls: number) {}

  private budget(roomCode: string): RoomBudget {
    let b = this.budgets.get(roomCode);
    if (!b) {
      b = { calls: 0, tripped: false };
      this.budgets.set(roomCode, b);
    }
    return b;
  }

  canCall(roomCode: string): boolean {
    const b = this.budget(roomCode);
    return !b.tripped && b.calls < this.maxCalls;
  }

  recordCall(roomCode: string): void {
    this.budget(roomCode).calls += 1;
  }

  /** Gặp 429 hoặc chạm trần: tắt Gemini cho phòng này tới hết ván. */
  trip(roomCode: string): void {
    this.budget(roomCode).tripped = true;
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
  let timer: NodeJS.Timeout;
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
