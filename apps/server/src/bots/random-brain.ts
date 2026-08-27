import type { RoomSnapshot } from "@masoi/shared";
import type { BotBrain, DayDecision, NightDecision } from "./types";
import { legalNightTargets, legalVoteTargets, soloNightAction, witchActions } from "./targets";

function randomOf<T>(arr: T[]): T | undefined {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Bot ngẫu nhiên. Vừa là chế độ mặc định khi tắt AI, vừa là fallback khi Gemini hỏng. */
class RandomBrain implements BotBrain {
  readonly name = "random";

  async decideNight(view: RoomSnapshot): Promise<NightDecision | null> {
    if (!view.night?.canAct || !view.you?.alive) return null;

    if (view.you.role === "WITCH") {
      const actions = witchActions(view);
      // Giữ nguyên hành vi cũ: ưu tiên cứu, không tự ý dùng bình độc
      if (actions.includes("HEAL")) return { action: "HEAL", targetId: null };
      return null;
    }

    const action = soloNightAction(view.you.role);
    if (!action) return null;

    const targetId = randomOf(legalNightTargets(view, action));
    return targetId ? { action, targetId } : null;
  }

  async decideDay(view: RoomSnapshot): Promise<DayDecision | null> {
    if (!view.you?.alive) return null;
    const voteTargetId = randomOf(legalVoteTargets(view)) ?? null;
    return { chat: null, voteTargetId };
  }
}

export const randomBrain = new RandomBrain();
