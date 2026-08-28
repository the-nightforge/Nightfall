import type { RoomSnapshot } from "@masoi/shared";
import type { Attempt, BotBrain, DayDecision, HunterShotDecision, NightDecision } from "./types";
import { failed } from "./types";

/**
 * Thử lần lượt từng não, dừng ở não đầu tiên không báo hỏng.
 *
 * Chỉ { ok: false } mới đi tiếp. { ok: true, value: null } là quyết định có chủ
 * đích - bot đã chết, Phù Thuỷ chọn SKIP, không còn mục tiêu hợp lệ - và mang nó
 * sang nhà cung cấp kế tiếp sẽ khiến một người đáng lẽ im lặng lại nói, đồng
 * thời trả tiền cho một lời gọi không ai cần.
 */
export class FallbackBrain implements BotBrain {
  readonly name: string;

  constructor(private readonly brains: BotBrain[]) {
    if (brains.length === 0) throw new Error("FallbackBrain cần ít nhất một não");
    this.name = brains.map((b) => b.name).join("->");
  }

  private async first<T>(
    ask: (brain: BotBrain) => Promise<Attempt<T>>,
  ): Promise<Attempt<T>> {
    let last: Attempt<T> = failed();
    for (const brain of this.brains) {
      // Một não ném lỗi ngoài dự kiến không được chặn đường các não còn lại.
      try {
        last = await ask(brain);
      } catch {
        last = failed();
      }
      if (last.ok) return last;
    }
    return last;
  }

  decideNight(view: RoomSnapshot): Promise<Attempt<NightDecision>> {
    return this.first((b) => b.decideNight(view));
  }

  decideDay(view: RoomSnapshot): Promise<Attempt<DayDecision>> {
    return this.first((b) => b.decideDay(view));
  }

  decideHunterShot(view: RoomSnapshot): Promise<Attempt<HunterShotDecision>> {
    return this.first((b) => b.decideHunterShot(view));
  }
}
