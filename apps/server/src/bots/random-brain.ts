import type { RoomSnapshot } from "@masoi/shared";
import type {
  Always,
  BotBrain,
  DaySpeechDecision,
  DefenseDecision,
  FinalVoteDecision,
  HunterShotDecision,
  NightDecision,
  PlannedVote,
} from "./types";
import { decided, nothingToDo } from "./types";
import {
  derivedFinalVote,
  legalHunterTargets,
  legalNightTargets,
  soloNightAction,
  witchActions,
} from "./targets";

function randomOf<T>(items: T[]): T | undefined {
  return items.length === 0 ? undefined : items[Math.floor(Math.random() * items.length)];
}

/** Thợ Săn bot đôi khi chủ động giữ súng để tránh phát bắn bất lợi cho phe làng. */
const HUNTER_SKIP_CHANCE = 0.1;

/**
 * Lời bào chữa dự phòng. Một bị cáo im lặng trông như màn hình hỏng, mà đây lại
 * là não duy nhất chắc chắn trả lời được.
 */
const DEFENSE_LINES = [
  "Tôi là dân thường, treo tôi là mất một phiếu của làng.",
  "Các bạn đang nhắm nhầm người, tối nay sẽ rõ thôi.",
  "Tôi không có gì để giấu, ai đẩy phiếu tôi mới là đáng ngờ.",
];

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

    const action = soloNightAction(view.you.role, view);
    if (!action) return nothingToDo();

    if (action === "DETECTIVE_CHECK") {
      const targets = legalNightTargets(view, "DETECTIVE_CHECK");
      if (targets.length < 2) return nothingToDo();
      const t1 = randomOf(targets);
      if (!t1) return nothingToDo();
      const remaining = targets.filter((id) => id !== t1);
      const t2 = randomOf(remaining);
      if (!t2) return nothingToDo();
      return decided({ action: "DETECTIVE_CHECK", targetId: t1, secondaryTargetId: t2 });
    }

    const targetId = randomOf(legalNightTargets(view, action));
    return targetId ? decided({ action, targetId }) : nothingToDo();
  }

  /**
   * Não chót KHÔNG tự sinh lời thoại.
   *
   * Ban ngày đã deterministic: mục tiêu do lõi AI chốt, còn câu chữ khi mọi nhà
   * cung cấp hỏng là việc của `renderBotSpeech` với mẫu cố định. Trả về "không
   * có gì để nói" ở đây giữ cho đường lui không bịa ra một câu không nguồn.
   */
  async renderDaySpeech(): Promise<Always<DaySpeechDecision>> {
    return nothingToDo();
  }

  async decideDefense(view: RoomSnapshot): Promise<Always<DefenseDecision>> {
    if (!view.trial?.canSpeak) return nothingToDo();
    return decided({ chat: randomOf(DEFENSE_LINES)! });
  }

  /**
   * Đường lui của phiếu xác nhận. Nhận thêm phiếu sơ bộ đã định của chính bot
   * qua tham số vì snapshot không mang nó: myVote chỉ có id, còn lựa chọn "không
   * treo ai" thì trùng với "chưa vote" ở mức snapshot.
   */
  async decideFinalVote(
    view: RoomSnapshot,
    myNomination?: PlannedVote,
  ): Promise<Always<FinalVoteDecision>> {
    if (!view.trial?.canVote) return nothingToDo();
    return decided({ guilty: derivedFinalVote(view, myNomination) });
  }

  async decideHunterShot(view: RoomSnapshot): Promise<Always<HunterShotDecision>> {
    const targets = legalHunterTargets(view);
    if (targets.length === 0 || Math.random() < HUNTER_SKIP_CHANCE) {
      return decided({ targetId: null });
    }
    return decided({ targetId: randomOf(targets) ?? null });
  }
}

export const randomBrain = new RandomBrain();
