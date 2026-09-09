import { type QuestionType } from "../analysis/chat-analysis";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import type { BotBrainState, BotDecisionContext, BotMemory } from "../types";
import { hasReplied } from "./speech-memory";

/**
 * Từ chat đã-được-parse tới "có gì đáng nói lại không".
 *
 * Module này KHÔNG đọc raw text. Nó chỉ đọc `BotMemory` mà `chat-analysis` đã
 * sinh ra - tức những gì parser bảo thủ dám khẳng định. Ranh giới đó là lý do
 * một câu chat không thể lái được hành vi của BOT: thứ duy nhất đi qua là loại
 * mệnh đề, người nói, người bị nhắc, và ID của câu.
 *
 * THUẦN: không RNG (planner mới rút số), không thời gian, không I/O.
 */

export type ConversationTriggerKind =
  | "ACCUSED_ME"
  | "COUNTER_CLAIM_ON_ME"
  | "QUESTIONED_ME"
  | "ADDRESSED_ME"
  | "ACCUSED_MY_TRUSTED"
  | "DEFENDED_MY_SUSPECT"
  | "ROLE_CLAIM_HEARD"
  | "SHARED_SUSPICION";

export interface ConversationTrigger {
  kind: ConversationTriggerKind;
  /** Câu chat đã sinh ra móc treo này. Luôn có thật trong `visibleChat`. */
  messageId: string;
  /** Người đã nói câu đó. */
  actorId: string;
  /** Người mà câu đó nói VỀ. Bằng `actorId` khi mệnh đề nói về chính người nói. */
  subjectId: string;
  /** Cao hơn thì được xét trước. Xem bảng trong spec §5.3. */
  priority: number;
  /**
   * Chỉ `QUESTIONED_ME`: câu hỏi đang hỏi về chuyện gì (COMMUNICATION §13).
   *
   * Đến từ `memory.data.questionType` mà `chat-analysis` đã chốt lúc parse -
   * module này KHÔNG đọc raw text, và ranh giới đó không được nới ra vì một
   * cái nhãn. Vắng mặt với mọi kind khác, và với memory cũ chưa có nhãn.
   */
  questionType?: QuestionType;
}

/**
 * Thang ưu tiên.
 *
 * Bị tấn công trực diện đứng trên mọi thứ khác: ngoài đời, im lặng khi bị chỉ
 * mặt là hành vi đáng ngờ nhất một người chơi có thể làm. Nhóm "người tôi tin /
 * người tôi nghi" đứng giữa, và những móc treo chung chung đứng cuối.
 */
const PRIORITY: Record<ConversationTriggerKind, number> = {
  ACCUSED_ME: 100,
  QUESTIONED_ME: 95,
  COUNTER_CLAIM_ON_ME: 90,
  ADDRESSED_ME: 70,
  ACCUSED_MY_TRUSTED: 60,
  DEFENDED_MY_SUSPECT: 55,
  ROLE_CLAIM_HEARD: 50,
  SHARED_SUSPICION: 45,
};

/** Người mình nghi nhất, hoặc `null` khi chưa nghi ai. Deterministic khi hoà. */
function topSuspectOf(state: BotBrainState): string | null {
  let best: string | null = null;
  let bestScore = 0;
  for (const id of Object.keys(state.suspicion).sort()) {
    const score = state.suspicion[id]?.score ?? 0;
    if (score > bestScore) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Mọi lý do để nói lại, đã sắp xếp.
 *
 * Sắp theo `(ưu tiên giảm dần, messageId tăng dần)`. Không dùng thứ tự chèn của
 * mảng memory: nó phụ thuộc vào thứ tự BOT quan sát chat, mà thứ tự đó lại phụ
 * thuộc vào lịch của scheduler. Một chuỗi quyết định phụ thuộc vào lịch là một
 * chuỗi không replay được.
 */
export function findConversationTriggers(
  context: BotDecisionContext,
  state: BotBrainState,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): ConversationTrigger[] {
  const { triggerFreshnessRounds, agreeTrustThreshold, disagreeSuspicionThreshold } =
    weights.conversation;
  if (triggerFreshnessRounds <= 0) return [];

  const me = state.playerId;
  const round = context.knowledge.round;
  const alive = new Map(context.knowledge.players.map((player) => [player.id, player.alive]));
  const visible = new Set(context.visibleChat.map((message) => message.id));
  const suspect = topSuspectOf(state);

  const triggers: ConversationTrigger[] = [];
  const add = (
    kind: ConversationTriggerKind,
    memory: BotMemory,
    subjectId: string,
  ): void => {
    const questionType = memory.data.questionType;
    triggers.push({
      kind,
      messageId: memory.sourceId,
      actorId: memory.actorId,
      subjectId,
      priority: PRIORITY[kind],
      ...(typeof questionType === "string"
        ? { questionType: questionType as QuestionType }
        : {}),
    });
  };

  for (const memory of state.memories) {
    // Chỉ những memory ĐẾN TỪ CHAT mới là móc treo hội thoại. Một recap phiếu
    // hay một cái chết không phải là câu để trả lời.
    if (!visible.has(memory.sourceId)) continue;
    if (memory.actorId === me) continue;
    if (alive.get(memory.actorId) !== true) continue;
    if (hasReplied(state, memory.sourceId)) continue;
    if (round - memory.round >= triggerFreshnessRounds) continue;

    switch (memory.type) {
      case "ACCUSE":
        if (memory.targetId === me) {
          add("ACCUSED_ME", memory, me);
        } else if (memory.targetId !== undefined) {
          if ((state.trust[memory.targetId]?.score ?? 0) >= agreeTrustThreshold) {
            add("ACCUSED_MY_TRUSTED", memory, memory.targetId);
          }
          if (memory.targetId === suspect) {
            add("SHARED_SUSPICION", memory, memory.targetId);
          }
        }
        break;

      case "DEFEND":
        if (
          memory.targetId !== undefined &&
          memory.targetId !== me &&
          (state.suspicion[memory.targetId]?.score ?? 0) >= disagreeSuspicionThreshold
        ) {
          add("DEFENDED_MY_SUSPECT", memory, memory.targetId);
        }
        break;

      case "COUNTER_CLAIM":
        if (memory.targetId === me) add("COUNTER_CLAIM_ON_ME", memory, me);
        break;

      case "ROLE_CLAIM":
        add("ROLE_CLAIM_HEARD", memory, memory.actorId);
        break;

      case "DIRECT_QUESTION":
        if (memory.targetId === me) add("QUESTIONED_ME", memory, me);
        break;

      case "DIRECT_ADDRESS":
        if (memory.targetId === me) add("ADDRESSED_ME", memory, me);
        break;

      default:
        break;
    }
  }

  return triggers.sort(
    (left, right) =>
      right.priority - left.priority || left.messageId.localeCompare(right.messageId),
  );
}
