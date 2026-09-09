import {
  buildCommunicationProfile,
  type PersuasionStyle,
} from "../belief/communication-profile";
import { credibilityOf } from "../belief/player-assessment";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { decideChatClaim, seerHoldsForHumans } from "../decision/claim-decision";
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
import { buildConversationState, speechUrge, type ConversationState } from "./conversation-state";
import { speechSemanticFingerprint } from "./fingerprint";
import {
  buildNarrative,
  contradictsNarrative,
  liveStanceOn,
  stanceOfKind,
  type NarrativePosition,
} from "./narrative";
import { chooseResponseStrategy, intentionFor } from "./question-policy";
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
 * Ứng viên mà từng kiểu người nghe phản ứng tốt nhất (COMMUNICATION §9).
 *
 * Đây là bảng ƯU TIÊN, không phải bảng SINH: `reorderForListener` chỉ đẩy lên
 * đầu những kind VỐN ĐÃ có trong danh sách của trigger. `candidatesFor` vẫn là
 * nơi duy nhất quyết định cái gì hợp lệ để đáp một trigger - người nghe không
 * được phép mở ra một nước đi mà tình huống không cho phép.
 */
const PREFERRED_FOR: Readonly<Record<PersuasionStyle, readonly BotSpeechKind[]>> =
  Object.freeze({
    EVIDENCE: ["ASK_EVIDENCE", "REPLY"],
    CHALLENGE: ["CHALLENGE", "DISAGREE"],
    CONSENSUS: ["AGREE", "REPLY"],
    CONSISTENCY: ["DISAGREE", "ASK_EVIDENCE"],
  });

/**
 * Xếp lại ứng viên theo kiểu của NGƯỜI NGHE, giữ nguyên tập hợp.
 *
 * Ổn định: những kind không được ưu tiên giữ nguyên thứ tự tương đối của
 * `candidatesFor`, tức vẫn theo tính cách của chính BOT. Người nghe quyết định
 * cái gì lên đầu, tính cách quyết định phần còn lại.
 */
function reorderForListener(
  candidates: BotSpeechKind[],
  style: PersuasionStyle | null,
): BotSpeechKind[] {
  if (style === null) return candidates;
  const preferred = PREFERRED_FOR[style].filter((kind) => candidates.includes(kind));
  if (preferred.length === 0) return candidates;
  return [...preferred, ...candidates.filter((kind) => !preferred.includes(kind))];
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

/**
 * Bằng chứng BOT được phép nói RA lượt này.
 *
 * Ba bộ lọc, theo thứ tự: đã nói rồi thì thôi, bằng chứng soi bị giữ tới lúc
 * khai vai, và trần `limits.intentionEvidence`.
 *
 * Tách thành hàm vì từ PR 4 có HAI chỗ hỏi cùng một câu - đường tự mở lời và
 * câu đáp `ANSWER_WITH_EVIDENCE`. Hai bản sao của luật giữ bằng chứng soi là
 * hai bản sẽ trôi lệch, và chỗ trôi lệch đó là một rò rỉ thông tin vai.
 *
 * THUẦN: không rút số. Gọi ở đâu cũng không lệch chuỗi RNG.
 */
function sayableEvidence(
  context: BotDecisionContext,
  state: BotBrainState,
  vote: BotVoteIntention,
  weights: BotWeights,
): BotSpeechIntention["evidence"] {
  const spoken = new Set(state.speechMemory.flatMap((entry) => entry.sourceIds));

  /**
   * Bằng chứng soi mở khoá theo LỜI KHAI, không theo số vòng.
   *
   * Nói "tôi soi thấy Nam là sói" mà chưa hề nhận mình là Tiên Tri là một câu
   * vô nghĩa: cả làng không biết dựa vào đâu, và bầy Sói thì biết thừa phải cắn
   * ai. Giữ lại tới đúng lúc khai thì cả hai bung ra một lượt, và lời khai
   * thành một khoảnh khắc thay vì một dòng tin rỉ ra dần.
   *
   * Nhánh `else` giữ NGUYÊN luật cũ cho v1/v2/v3. Đổi thẳng sẽ đảo ngược hành
   * vi của chúng: ở đó không BOT nào khai vai bao giờ, nên "chưa khai" luôn
   * đúng và bằng chứng soi sẽ không bao giờ được nói ra — trong khi hôm nay
   * `seerRevealRound = 0` nghĩa là nó LUÔN được nói ra.
   *
   * Bàn có người thật (P2.1) thêm một điều kiện giữ nữa, dùng CHUNG với cổng
   * PROACTIVE của `decideChatClaim`: chưa khai vai VÀ chưa tới
   * `seerRevealRoundHuman` thì kết quả soi không lọt vào lời nào cả. Đã khai
   * rồi (bị dồn, bị mạo danh) thì thả - giấu bằng chứng sau khi đã lộ vai chỉ
   * làm lời khai yếu đi. `0` ở v1..v13 nên biểu thức này rút gọn về luật cũ.
   */
  const holdForHumans = state.myClaim === null && seerHoldsForHumans(context, weights);
  const holdSeerEvidence =
    holdForHumans ||
    (weights.claim.accusationWeight > 0
      ? state.myClaim === null
      : context.knowledge.round < weights.deceptionRisk.seerRevealRound);

  return vote.evidence
    .filter((item) => !spoken.has(item.sourceId))
    .filter(
      (item) =>
        !holdSeerEvidence ||
        (item.kind !== "SEER_RESULT_WOLF" && item.kind !== "SEER_RESULT_CLEAR"),
    )
    .slice(0, weights.limits.intentionEvidence)
    .map((item) => ({ ...item }));
}

/**
 * Câu đáp cho một câu hỏi nhắm thẳng vào BOT (COMMUNICATION §13, §14).
 *
 * Trả về `[]` khi chính sách chọn `IGNORE`. Danh sách rỗng là tín hiệu cho chỗ
 * gọi bỏ qua trigger này mà KHÔNG rút số - né có chủ đích, không phải một lượt
 * rút xui.
 *
 * Luôn tối đa MỘT ứng viên. Bậc thang theo tính cách của Phase 4 đưa ra nhiều
 * ứng viên vì nó không biết câu hỏi nói về chuyện gì; ở đây thì biết, nên một
 * lựa chọn thứ hai chỉ là một cách nói "chính sách chưa chắc" - và chỗ gọi vốn
 * đã bỏ qua ứng viên thứ hai sau lượt rút đầu tiên.
 *
 * THUẦN: không rút số.
 */
function questionDrafts(
  trigger: ConversationTrigger,
  style: BotSpeechStyle,
  state: BotBrainState,
  vote: BotVoteIntention,
  usable: BotSpeechIntention["evidence"],
  conversation: ConversationState,
  weights: BotWeights,
): BotSpeechIntention[] {
  const type = trigger.questionType ?? "GENERAL";
  const strategy = chooseResponseStrategy({
    type,
    pressureOnMe: conversation.pressureOnMe,
    askerCredibility: credibilityOf(state, trigger.actorId, weights),
    unspokenEvidence: usable.length,
    hasClaimedRole: state.myClaim !== null,
    ignoreFloor: weights.conversation.questionIgnoreFloor,
    style,
  });

  const shape = intentionFor(strategy, type, style);
  if (!shape) return [];

  return [
    {
      kind: shape.kind,
      // Câu đáp luôn hướng về NGƯỜI HỎI. Trả lời một câu hỏi mà nhắm vào người
      // thứ ba là đang nói chuyện khác, không phải đang đáp.
      targetId: trigger.actorId,
      replyToMessageId: trigger.messageId,
      replyToActorId: trigger.actorId,
      topic: shape.topic,
      confidence: vote.confidence,
      evidence: shape.withEvidence ? usable : [],
      tone: shape.tone,
      reason: `đáp câu hỏi ${type} bằng ${strategy}`,
    },
  ];
}

/**
 * Vì sao im lặng, cho trace.
 *
 * Hàm riêng chứ không phải một biểu thức tại chỗ: `conversation` chỉ được gán
 * bên trong một closure, nên tại điểm gọi trình biên dịch thu nó về `never` và
 * hai trường bên dưới thành lỗi. Đọc qua tham số là cách nói đúng ý - "cái
 * bảng ấy có thể đã dựng, có thể chưa".
 */
function silenceReason(conversation: ConversationState | null): string {
  if (conversation === null) return "không đủ hoạt ngôn để lên tiếng lượt này";
  return `chưa đáng lên tiếng lượt này (${conversation.floor}, áp lực ${conversation.pressureOnMe.toFixed(2)})`;
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

  // ---- 0. Có đáng khai vai lúc này không ----
  //
  // Đứng TRÊN cả hai đường kia: một lời khai là nước đi nặng nhất mà lời nói
  // làm được, và một con Tiên Tri đang cầm bằng chứng mà lại đi đáp một câu
  // khích bác vặt là một con BOT đọc sai tình thế.
  //
  // `decideChatClaim` tự thoát ra trước khi rút số khi nhóm claim tắt, nên
  // cấu hình v1/v2/v3 đi qua đây mà không lệch một bit nào của chuỗi RNG.
  const voteTargetId = vote.choice.type === "PLAYER" ? vote.choice.targetId : null;
  const claim = decideChatClaim(context, state, rng, voteTargetId, weights);
  if (claim) {
    const intention = fresh({
      kind: claim.kind === "COUNTER" ? "COUNTER_CLAIM" : "CLAIM_ROLE",
      targetId: claim.counterTargetId ?? claim.accusedId ?? undefined,
      claimedRole: claim.role,
      topic: "ROLE_CLAIM",
      confidence: vote.confidence,
      // Bằng chứng soi đi CÙNG lời khai, không đi trước. Xem `holdSeerEvidence`
      // ngay dưới: trước lúc này nó bị giữ lại có chủ ý.
      evidence: vote.evidence
        .filter((item) => item.kind === "SEER_RESULT_WOLF")
        .slice(0, weights.limits.intentionEvidence)
        .map((item) => ({ ...item })),
      tone: toneFor("ACCUSE", style),
      reason: claim.reason,
    });
    if (intention) return intention;
  }

  // Bằng chứng nói ra được lượt này. Thuần, nên tính sớm không lệch chuỗi RNG;
  // cả câu đáp `ANSWER_WITH_EVIDENCE` lẫn đường tự mở lời đều đọc đúng nó.
  const usable = sayableEvidence(context, state, vote, weights);

  // Dựng một lần, dùng chung cho cả hai đường, và CHỈ khi có ai đó thật sự đọc:
  // nó quét cả memory, và một bảng không ai đọc là một vòng lặp trả tiền không.
  let conversation: ConversationState | null = null;
  const socialSituation = (): ConversationState =>
    (conversation ??= buildConversationState(context, state, weights));

  /**
   * Lập trường BOT đã CÔNG KHAI nêu ra, hoặc `null` khi cơ chế tắt (§15).
   *
   * Thuần, nên dựng ở đây không lệch chuỗi RNG. Cả hai đường đọc nó: đường
   * trigger để không tự mâu thuẫn, đường tự mở lời để nói THÀNH LỜI việc mình
   * đổi ý thay vì lặng lẽ quay xe.
   */
  const narrative: Record<string, NarrativePosition> | null =
    weights.conversation.narrativeMemoryRounds > 0 ? buildNarrative(state, weights) : null;

  /** Ý định này có đảo ngược một lập trường còn hiệu lực không. */
  const selfContradicting = (draft: BotSpeechIntention): boolean => {
    if (narrative === null || draft.targetId === undefined) return false;
    const stance = stanceOfKind(draft.kind);
    return (
      stance !== null &&
      contradictsNarrative(narrative, draft.targetId, stance, round, weights)
    );
  };

  // ---- 1. Có ai đang nói với mình không ----
  const { questionIgnoreFloor } = weights.conversation;

  /**
   * Kiểu thuyết phục hợp với NGƯỜI đang nói với mình (§8, §9), hoặc `null`.
   *
   * Nhớ theo người: một trigger loop có thể đi qua nhiều người khác nhau,
   * nhưng cùng một người thì hồ sơ không đổi trong một lượt. Thuần, nên không
   * lệch chuỗi RNG dù có dựng hay không.
   */
  const listenerStyles = new Map<string, PersuasionStyle | null>();
  const persuasionOf = (listenerId: string): PersuasionStyle | null => {
    if (weights.conversation.persuasionMinSamples <= 0) return null;
    const cached = listenerStyles.get(listenerId);
    if (cached !== undefined) return cached;
    const style = buildCommunicationProfile(
      context.knowledge,
      state,
      listenerId,
      weights,
    ).style;
    listenerStyles.set(listenerId, style);
    return style;
  };

  for (const trigger of findConversationTriggers(context, state, weights)) {
    /**
     * Ứng viên cho trigger này, đã là Ý ĐỊNH đầy đủ.
     *
     * Câu hỏi nhắm thẳng vào BOT đi qua `question-policy` khi nút vặn bật; mọi
     * trigger khác giữ nguyên bậc thang theo tính cách của Phase 4. Danh sách
     * RỖNG nghĩa là bỏ qua trigger này mà KHÔNG rút số - đó là `IGNORE`, và né
     * một câu hỏi là một nước đi hợp lệ (spec §28).
     */
    const drafts: BotSpeechIntention[] =
      questionIgnoreFloor > 0 && trigger.kind === "QUESTIONED_ME"
        ? questionDrafts(trigger, style, state, vote, usable, socialSituation(), weights)
        : ((listener) =>
            reorderForListener(candidatesFor(trigger, style), listener).map((kind) => ({
              kind,
              targetId: targetFor(trigger, kind),
              replyToMessageId: trigger.messageId,
              replyToActorId: trigger.actorId,
              topic: topicFor(trigger),
              confidence: vote.confidence,
              evidence: [],
              tone: toneFor(kind, style),
              // Kiểu người nghe đi vào `reason` để trace đọc được cơ chế này có
              // chạy hay không. `reason` là ghi chú NỘI BỘ, không bao giờ gửi
              // cho nhà cung cấp - xem `BotSpeechIntention.reason`.
              reason:
                listener === null
                  ? `phản hồi ${trigger.kind}`
                  : `phản hồi ${trigger.kind} theo kiểu ${listener}`,
            })))(persuasionOf(trigger.actorId));

    for (const draft of drafts) {
      // Bênh một người mình vừa công khai tố (hoặc ngược lại) mà không nói gì
      // về việc đổi ý là đúng thứ §15 gọi là bất nhất. Bỏ ứng viên này và thử
      // ứng viên kế - thường là `DISAGREE`, thứ không nêu lập trường nào.
      if (selfContradicting(draft)) continue;

      const candidate = fresh(draft);
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
  /**
   * Hoạt ngôn là TÍNH CÁCH; "lượt này có đáng nói không" là TÌNH HUỐNG. Ngưỡng
   * là tổng của cả hai.
   *
   * Cộng vào ngưỡng chứ không thêm một lượt rút: `speechUrge` thuần, và với
   * `urgencyBoost = 0` (v1..v22) biểu thức quy về đúng `talkativeness`, nên
   * chuỗi RNG của mọi preset cũ không lệch một bit.
   *
   * `usable.length` chứ không phải số bằng chứng đang CẦM: một kết quả soi còn
   * bị giữ tới lúc khai vai thì lượt này không nói ra được, nên nó không phải
   * một lý do để mở lời.
   */
  const { urgencyBoost } = weights.conversation;
  let threshold = state.personality.talkativeness;
  if (urgencyBoost > 0) {
    threshold = Math.min(
      1,
      state.personality.talkativeness +
        urgencyBoost * speechUrge(socialSituation(), usable.length, weights),
    );
  }

  if (rng() > threshold) {
    probe?.fallback(silenceReason(conversation));
    return null;
  }

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

  /**
   * Quay xe thì phải NÓI RA (§15).
   *
   * Đứng trên nhánh `currentTheory` ngay dưới và KHÔNG hỏi `style.concession`:
   * bướng bỉnh quyết định một người đổi ý bao nhiêu lần, chứ không cho phép họ
   * vờ như chưa bao giờ nghĩ khác. Một con BOT hôm qua bênh An, hôm nay tố An,
   * và không câu nào thừa nhận điều đó, là đúng thứ §15 phải chữa.
   *
   * Chỉ nổ khi lập trường cũ CÒN HIỆU LỰC (`narrativeMemoryRounds` vòng). Xa
   * hơn thế thì cả bàn đã quên, và một lời "tôi đổi ý" về chuyện không ai nhớ
   * chỉ làm BOT nghe như đang tự nói với mình.
   */
  if (narrative !== null && liveStanceOn(narrative, targetId, round, weights) === "trust") {
    const position = narrative[targetId]!;
    const flipped = fresh({
      kind: "CHANGE_MIND",
      targetId,
      topic: "SUSPICION",
      confidence: vote.confidence,
      evidence: usable,
      tone: "SOFT",
      reason: `đã công khai bênh người này từ vòng ${position.createdAtRound}; giờ phiếu đổi hướng`,
    });
    if (flipped) return flipped;
  }

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
