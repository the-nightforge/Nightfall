import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import type { BotSpeechStyle } from "../personality/speech-style";
import type { DecisionProbeCollector } from "../trace/trace";
import type {
  BotBrainState,
  BotDecisionContext,
  BotRng,
  BotSpeechIntention,
  BotSpeechKind,
  BotSpeechTone,
  BotVoteIntention,
} from "../types";
import { speechSemanticFingerprint } from "./fingerprint";
import { hasRecentSemantic } from "./speech-memory";
import { findConversationTriggers, type ConversationTrigger } from "./triggers";

/**
 * Chốt xem BOT nói gì lượt này - hoặc không nói gì.
 *
 * Đây là chỗ DUY NHẤT quyết định speech act, mục tiêu, câu được trả lời và
 * bằng chứng. Nhà cung cấp nhận kết quả của hàm này ở đầu vào và chỉ được trả
 * về một chuỗi; không có đường nào để đọc ngược một quyết định từ output.
 *
 * Hai đường đi, theo đúng thứ tự:
 *
 * 1. **Có ai đang nói với mình không.** Trigger đã sắp xếp tất định; với mỗi
 *    cái, sinh ứng viên theo tính cách rồi rút RNG xem có đáp hay không.
 * 2. **Không thì tự mở lời**, đúng bậc thang của Phase 3.
 *
 * Về tính tương thích: khi `conversation.triggerFreshnessRounds = 0` (cấu hình
 * v1/v2), đường 1 bị bỏ qua *trước khi rút bất kỳ số ngẫu nhiên nào*, và đường
 * 2 tiêu thụ đúng một lượt rút như Phase 3. Nhờ vậy hai mốc lịch sử tái lập
 * từng bit, và bảng win-rate của Phase 3 vẫn còn giá trị so sánh.
 */

/** Trigger nhắm THẲNG vào BOT; chỉ nhóm này được hưởng sàn xác suất trả lời. */
const DIRECT_TRIGGERS: ReadonlySet<ConversationTrigger["kind"]> = new Set([
  "ACCUSED_ME",
  "QUESTIONED_ME",
  "ADDRESSED_ME",
  "COUNTER_CLAIM_ON_ME",
]);

function toneFor(kind: BotSpeechKind, style: BotSpeechStyle): BotSpeechTone {
  switch (kind) {
    case "ACCUSE":
    case "CHALLENGE":
    case "DISAGREE":
      return style.harshness >= 0.6 ? "TENSE" : "FIRM";
    case "QUESTION":
    case "ASK_EVIDENCE":
      return "CURIOUS";
    case "AGREE":
    case "DEFEND":
      return style.warmth === "WARM" ? "SOFT" : "NEUTRAL";
    case "CHANGE_MIND":
      return "SOFT";
    case "HUMOR":
      return "PLAYFUL";
    case "REPLY":
      return style.humor >= 0.7 ? "PLAYFUL" : "NEUTRAL";
    default:
      return "NEUTRAL";
  }
}

/**
 * Ứng viên cho một trigger, xếp theo tính cách.
 *
 * Không rút RNG: thứ tự ở đây là tính cách, không phải may rủi. Một người gay
 * gắt phản ứng bằng cách chất vấn; một người thích phân tích đòi bằng chứng;
 * người còn lại chỉ phản đối rồi thôi. Cùng một tình huống, ba con BOT khác
 * nhau đáp khác nhau - và đáp *giống nhau qua các ván*, vì tính cách không đổi.
 *
 * Ứng viên từ trigger KHÔNG mang bằng chứng. Chúng là phản ứng với lời người
 * khác, không phải một luận điểm mới; và giữ chúng rỗng nghĩa là không có
 * đường nào để một `sourceId` ngoài tầm nhìn lọt vào ý định.
 */
function candidatesFor(trigger: ConversationTrigger, style: BotSpeechStyle): BotSpeechKind[] {
  switch (trigger.kind) {
    case "ACCUSED_ME":
      if (style.harshness >= 0.6) return ["CHALLENGE", "DISAGREE", "ASK_EVIDENCE"];
      if (style.inquisitive >= 0.6) return ["ASK_EVIDENCE", "DISAGREE", "REPLY"];
      return ["DISAGREE", "REPLY", "ASK_EVIDENCE"];

    case "COUNTER_CLAIM_ON_ME":
      return style.harshness >= 0.5 ? ["CHALLENGE", "DISAGREE"] : ["DISAGREE", "REPLY"];

    case "QUESTIONED_ME":
      return style.inquisitive >= 0.7 ? ["REPLY", "ASK_EVIDENCE"] : ["REPLY"];

    case "ADDRESSED_ME":
      return style.verbosity === "TERSE" ? ["REACTION", "REPLY"] : ["REPLY", "REACTION"];

    case "ACCUSED_MY_TRUSTED":
      return style.warmth === "COLD" ? ["DISAGREE", "DEFEND"] : ["DEFEND", "DISAGREE"];

    case "DEFENDED_MY_SUSPECT":
      return style.inquisitive >= 0.6 ? ["ASK_EVIDENCE", "DISAGREE"] : ["DISAGREE", "ASK_EVIDENCE"];

    case "ROLE_CLAIM_HEARD":
      if (style.harshness >= 0.7) return ["CHALLENGE", "ASK_EVIDENCE"];
      return style.warmth === "WARM" ? ["AGREE", "ASK_EVIDENCE"] : ["ASK_EVIDENCE", "CHALLENGE"];

    case "SHARED_SUSPICION":
      return ["AGREE"];

    default:
      return [];
  }
}

/**
 * Ai là mục tiêu của câu đáp.
 *
 * Với nhóm "bênh người tôi tin / phản đối người bênh kẻ tôi nghi", mục tiêu là
 * NGƯỜI ĐƯỢC NHẮC chứ không phải người nói - "đừng treo Chi" nói về Chi.
 */
function targetFor(trigger: ConversationTrigger, kind: BotSpeechKind): string {
  if (kind === "DEFEND" || kind === "AGREE") return trigger.subjectId;
  return trigger.actorId;
}

function topicFor(trigger: ConversationTrigger): BotSpeechIntention["topic"] {
  switch (trigger.kind) {
    case "ROLE_CLAIM_HEARD":
    case "COUNTER_CLAIM_ON_ME":
      return "ROLE_CLAIM";
    case "ACCUSED_MY_TRUSTED":
      return "TRUST";
    case "QUESTIONED_ME":
    case "ADDRESSED_ME":
      return "PROCESS";
    default:
      return "SUSPICION";
  }
}

/**
 * Xác suất đáp một trigger.
 *
 * Sàn cho lời nói nhắm thẳng vào mình được NHÂN với `responsiveness` chứ không
 * áp phẳng. Áp phẳng thì người kiệm lời và người hoạt ngôn đáp bằng nhau đúng
 * ở tình huống mà tính cách lẽ ra rõ nhất - và cả bàn lại nghe giống nhau, tức
 * đúng triệu chứng mà Phase 4 phải chữa.
 *
 * Trần luôn `< 1`: không ai trả lời mọi câu nhắm vào mình.
 */
function responseProbability(
  trigger: ConversationTrigger,
  style: BotSpeechStyle,
  weights: BotWeights,
): number {
  const { directReplyFloor, replyCeiling } = weights.conversation;
  const base = style.responsiveness * (trigger.priority / 100);
  const floor = DIRECT_TRIGGERS.has(trigger.kind)
    ? directReplyFloor * (0.5 + style.responsiveness / 2)
    : 0;
  return Math.min(Math.max(base, floor), replyCeiling);
}

export interface SpeechPlanInput {
  context: BotDecisionContext;
  state: BotBrainState;
  vote: BotVoteIntention;
  style: BotSpeechStyle;
  rng: BotRng;
  weights?: BotWeights;
  probe?: DecisionProbeCollector;
}

export function planSpeech(input: SpeechPlanInput): BotSpeechIntention | null {
  const { context, state, vote, style, rng, probe } = input;
  const weights = input.weights ?? DEFAULT_BOT_WEIGHTS;
  const round = context.knowledge.round;

  const fresh = (intention: BotSpeechIntention): BotSpeechIntention | null =>
    hasRecentSemantic(state, speechSemanticFingerprint(intention), round, weights)
      ? null
      : intention;

  // ---- 1. Có ai đang nói với mình không ----
  for (const trigger of findConversationTriggers(context, state, weights)) {
    for (const kind of candidatesFor(trigger, style)) {
      const candidate = fresh({
        kind,
        targetId: targetFor(trigger, kind),
        replyToMessageId: trigger.messageId,
        replyToActorId: trigger.actorId,
        topic: topicFor(trigger),
        confidence: vote.confidence,
        evidence: [],
        tone: toneFor(kind, style),
        reason: `phản hồi ${trigger.kind}`,
      });
      if (!candidate) continue;

      if (rng() < responseProbability(trigger, style, weights)) return candidate;
      // Không đáp cái này thì cũng không đáp một ứng viên khác của CÙNG một
      // câu: lượt rút vừa rồi là "có muốn nói về chuyện này không", không phải
      // "có thích cách diễn đạt này không".
      break;
    }
  }

  // ---- 2. Tự mở lời ----
  //
  // Từ đây trở xuống là đúng bậc thang Phase 3, và lượt rút ngay dưới đây là
  // lượt rút DUY NHẤT mà cấu hình v1/v2 thực hiện.
  if (rng() > state.personality.talkativeness) {
    probe?.fallback("không đủ hoạt ngôn để lên tiếng lượt này");
    return null;
  }

  const spoken = new Set(state.speechMemory.flatMap((entry) => entry.sourceIds));

  /**
   * Tiên Tri giữ kín kết quả soi trong những vòng đầu.
   *
   * Soi trúng Sói ngay đêm đầu rồi hô lên ở vòng 1 là cách nhanh nhất để chết ở
   * đêm 2. Lá phiếu vẫn nhắm đúng người - thứ bị giữ lại là LÝ DO.
   */
  const holdSeerEvidence = round < weights.deceptionRisk.seerRevealRound;
  const usable = vote.evidence
    .filter((item) => !spoken.has(item.sourceId))
    .filter(
      (item) =>
        !holdSeerEvidence ||
        (item.kind !== "SEER_RESULT_WOLF" && item.kind !== "SEER_RESULT_CLEAR"),
    )
    .slice(0, weights.limits.intentionEvidence)
    .map((item) => ({ ...item }));

  if (vote.choice.type !== "PLAYER") {
    probe?.fallback("phiếu không nhắm ai nên không có gì để cáo buộc");
    return fresh({
      kind: "WITHHOLD",
      confidence: vote.confidence,
      evidence: [],
      topic: "PROCESS",
      tone: "NEUTRAL",
    });
  }

  const targetId = vote.choice.targetId;
  const conversational = weights.conversation.triggerFreshnessRounds > 0;

  // Đổi ý là một hành vi xã hội, và nói nó ra thành lời là thứ phân biệt một
  // người chơi với một máy chấm điểm. Chỉ mở khi giả thuyết đang giữ THẬT SỰ
  // không còn khớp với lá phiếu, và chỉ với người không quá bướng.
  if (conversational && style.concession >= 0.5 && state.currentTheory !== null) {
    const previous = state.currentTheory.summary;
    if (!previous.includes(targetId)) {
      const changed = fresh({
        kind: "CHANGE_MIND",
        targetId,
        topic: "SUSPICION",
        confidence: vote.confidence,
        evidence: usable,
        tone: "SOFT",
        reason: "giả thuyết cũ không còn khớp với lá phiếu",
      });
      if (changed) return changed;
    }
  }

  if (usable.length > 0) {
    const accuse = fresh({
      kind: "ACCUSE",
      targetId,
      topic: "SUSPICION",
      confidence: vote.confidence,
      evidence: usable,
      tone: toneFor("ACCUSE", style),
    });
    if (accuse) return accuse;
  } else {
    probe?.fallback("mọi luận điểm đã nói rồi; hỏi thay vì lặp lại");
  }

  const question = fresh({
    kind: "QUESTION",
    targetId,
    topic: "SUSPICION",
    confidence: vote.confidence,
    evidence: [],
    tone: "CURIOUS",
  });
  if (question) return question;

  // ---- 3. Hết ý ----
  //
  // Im lặng là kết quả đúng ở đây, và nó phải là kết quả MẶC ĐỊNH. Nếu chỗ này
  // cố nặn ra một câu khác để tránh trùng, chỉ số lặp sẽ đẹp lên trong khi chất
  // lượng hội thoại tệ đi - và không ai nhìn thấy điều đó trong báo cáo.
  if (!conversational) return null;

  if (weights.conversation.reactionChance > 0 && rng() < weights.conversation.reactionChance) {
    const reaction = fresh({
      kind: "REACTION",
      topic: "SMALLTALK",
      confidence: vote.confidence,
      evidence: [],
      tone: "NEUTRAL",
    });
    if (reaction) return reaction;
  }

  if (weights.conversation.humorChance > 0 && rng() < weights.conversation.humorChance * style.humor) {
    const humor = fresh({
      kind: "HUMOR",
      topic: "SMALLTALK",
      confidence: vote.confidence,
      evidence: [],
      tone: "PLAYFUL",
    });
    if (humor) return humor;
  }

  probe?.fallback("mọi ý đã nói gần đây rồi; im lặng còn hơn nói lại");
  return null;
}
