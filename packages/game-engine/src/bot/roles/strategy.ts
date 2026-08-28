import type { Role } from "@masoi/shared";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import type {
  BotBrainState,
  BotDecisionContext,
  BotEvidence,
  BotNightIntention,
  BotRng,
} from "../types";

/**
 * Chiến lược riêng của một vai.
 *
 * Tách khỏi `vote-decision` vì hai thứ khác nhau về bản chất: `selectVote` chấm
 * điểm từ bằng chứng CÔNG KHAI mà ai cũng thấy, còn strategy dùng thông tin
 * RIÊNG của vai. Trộn chúng lại sẽ khiến mọi vai cùng chạy qua một hàm có tám
 * nhánh `if (role === ...)`, và mỗi vai mới lại thêm một nhánh nữa.
 *
 * Strategy KHÔNG được tự dựng danh sách mục tiêu hợp lệ - nó chỉ chọn trong
 * `knowledge.night.legalTargets` mà engine đã tính. Một bản sao luật ở tầng AI
 * là thứ sẽ trôi lệch khỏi luật thật rồi sinh ra nước đi bị engine từ chối.
 */
export interface BotRoleStrategy {
  readonly role: Role;

  /**
   * Nước đi đêm, hoặc `null` để chủ động bỏ lượt.
   *
   * `null` là kết quả hợp lệ và tái lập được. Không bao giờ ném, và không bao
   * giờ trả về mục tiêu ngoài `legalTargets` - hai điều đó biến một quyết định
   * tồi thành một lượt đêm mất trắng.
   */
  decideNight(
    context: BotDecisionContext,
    state: BotBrainState,
    rng: BotRng,
  ): BotNightIntention | null;

  /**
   * Điều chỉnh điểm bỏ phiếu ban ngày theo hiểu biết riêng của vai.
   *
   * Trả về delta theo `playerId`; khoá vắng mặt nghĩa là không điều chỉnh. Phe
   * làng thường trả object rỗng: họ không có thông tin riêng nào để thiên vị.
   */
  voteBias(context: BotDecisionContext, state: BotBrainState): Record<string, number>;
}

/** Chiến lược nền: không hành động đêm, không thiên vị. */
export function passiveStrategy(role: Role): BotRoleStrategy {
  return {
    role,
    decideNight: () => null,
    voteBias: () => ({}),
  };
}

/**
 * Bằng chứng cho một nước đi đêm.
 *
 * Nước đi đêm không sinh ra từ một sự kiện công khai nào, nên nó cần source ID
 * riêng do lõi phát ra. Khoá theo `{vai}:{vòng}:{mục tiêu}` để cùng một suy
 * luận trong cùng một vòng luôn là cùng một nguồn.
 */
export function nightEvidence(
  kind: BotEvidence["kind"],
  round: number,
  actorId: string,
  summary: string,
  weight = 0,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotEvidence {
  return {
    id: `night:${round}:${actorId}:${kind}`,
    kind,
    sourceId: `night-plan:${round}:${actorId}`,
    actorId,
    weight,
    confidence: weights.nightConfidence.nightEvidence,
    round,
    summary,
  };
}
