import type { RoomSnapshot } from "@masoi/shared";
import type { Always, BotBrain, DayDecision, NightDecision } from "./types";
import { decided, nothingToDo } from "./types";
import { legalNightTargets, legalVoteTargets, soloNightAction, witchActions } from "./targets";

function randomOf<T>(items: T[]): T | undefined {
  return items.length === 0 ? undefined : items[Math.floor(Math.random() * items.length)];
}

/**
 * Não dự phòng cuối cùng: chọn ngẫu nhiên trong các nước đi hợp lệ, không gọi
 * mạng nên không bao giờ hỏng. Vì thế nó chỉ trả ok - không có nhánh { ok: false }.
 */
export class RandomBrain implements BotBrain {
  readonly name = "random";

  async decideNight(view: RoomSnapshot): Promise<Always<NightDecision>> {
    if (!view.night?.canAct || !view.you?.alive) return nothingToDo();

    if (view.you.role === "WITCH") {
      const actions = witchActions(view);
      // Ưu tiên bình cứu ngay khi còn dùng được, không tự ý dùng bình độc.
      // Khác code cũ một điểm có chủ ý: code cũ chỉ cứu ở vòng 1, nên nếu Phù Thuỷ
      // không hành động được vòng đó thì bình cứu không bao giờ được dùng.
      if (actions.includes("HEAL")) return decided({ action: "HEAL", targetId: null });
      return nothingToDo();
    }

    const action = soloNightAction(view.you.role);
    if (!action) return nothingToDo();

    const targetId = randomOf(legalNightTargets(view, action));
    return targetId ? decided({ action, targetId }) : nothingToDo();
  }

  async decideDay(view: RoomSnapshot): Promise<Always<DayDecision>> {
    if (!view.you?.alive) return nothingToDo();
    const voteTargetId = randomOf(legalVoteTargets(view)) ?? null;
    return decided({ chat: null, voteTargetId });
  }
}

export const randomBrain = new RandomBrain();
