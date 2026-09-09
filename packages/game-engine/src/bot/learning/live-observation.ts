import type { BotWeights } from "../config/weights";
import { observationFromTrace, type ObservationInput } from "../evaluation/trajectory";
import { snapshotBelief, snapshotKnowledge } from "../trace/snapshot";
import type { BeliefSnapshot, TraceDecisionKind } from "../trace/trace";
import type { BotBrainState, BotKnowledgeView } from "../types";

/**
 * Observation LÚC CHƠI, cho policy học được.
 *
 * Đi qua đúng hai ảnh chụp mà trace ghi và đúng `observationFromTrace` mà
 * export trajectory dùng, nên vector ở đây bằng vector lúc train theo cấu
 * trúc — test `bot-live-observation.test.ts` là bằng chứng trên 20 ván.
 * Không có `selectedAction`: đây là câu hỏi, không phải nhãn.
 *
 * `belief` là ảnh chụp đã lấy ở CUỐI `observe`, đúng thứ trace ghi vào
 * `beliefAfter`. Truyền vào chứ không tính lại, vì giữa lần `observe` và lúc
 * quyết định thì knowledge đã đổi (người khác vừa bỏ phiếu, bầy Sói vừa khoá
 * nạn nhân) — tính lại ở đây sẽ ra một belief KHÁC belief mà trace ghi, và
 * model sẽ chơi trên một vector nó chưa từng thấy lúc train. Vắng mặt thì
 * tính tại chỗ: đúng cho một lời gọi lẻ trong test, không phải đường của
 * runtime.
 */
export function buildLiveObservation(
  knowledge: BotKnowledgeView,
  state: BotBrainState,
  weights: BotWeights,
  decision: TraceDecisionKind,
  belief?: BeliefSnapshot,
): ObservationInput {
  return observationFromTrace({
    botId: state.playerId,
    round: knowledge.round,
    phase: knowledge.phase,
    decision,
    beliefAfter: belief ?? snapshotBelief(state, knowledge, weights),
    personality: { ...state.personality },
    knowledgeSnapshot: snapshotKnowledge(knowledge),
  });
}
