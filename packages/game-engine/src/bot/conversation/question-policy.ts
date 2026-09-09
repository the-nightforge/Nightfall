import type { QuestionType } from "../analysis/chat-analysis";
import type { BotSpeechStyle } from "../personality/speech-style";
import type { BotSpeechKind, BotSpeechTone, BotSpeechTopic } from "../types";

/**
 * PR 4 của `NIGHTFALL_BOT_COMMUNICATION_UPGRADE` (§13, §14): bị hỏi thì đáp
 * KIỂU GÌ.
 *
 * Trước module này, một câu hỏi nhắm vào BOT chỉ có hai đường ra - `REPLY` hoặc
 * `ASK_EVIDENCE` - chọn theo đúng một trait (`style.inquisitive`). Nội dung câu
 * hỏi không tham gia, nên "mày là sói phải ko" và "nghi ai nhất" nhận cùng một
 * cách xử.
 *
 * Ranh giới quan trọng nhất ở đây: **né một câu hỏi là một nước đi hợp lệ.**
 * Spec §28 nói thẳng đừng tối ưu tỉ lệ trả lời lên 100%. Vì vậy `IGNORE` là một
 * kết quả có thật của hàm này, không phải một lỗi.
 *
 * THUẦN: không RNG, không state, không đọc raw chat. Chỗ gọi (`speech-planner`)
 * vẫn giữ nguyên lượt rút "có đáp không" của Phase 4.
 */

/**
 * Cách đáp một câu hỏi (§14).
 *
 * Bảy ô, và mỗi ô ra một Ý ĐỊNH khác nhau ở ít nhất một trục mà tầng dưới đọc
 * được (`kind`, `topic`, `tone`, `evidence`). Một strategy không phân biệt được
 * ở đầu ra là một strategy không tồn tại - xem `intentionFor`.
 */
export const RESPONSE_STRATEGIES = [
  "DIRECT_ANSWER",
  "PARTIAL_ANSWER",
  "ANSWER_WITH_EVIDENCE",
  "DEFLECT",
  "COUNTER_QUESTION",
  "CHALLENGE_PREMISE",
  "IGNORE",
] as const;

export type ResponseStrategy = (typeof RESPONSE_STRATEGIES)[number];

export interface QuestionContext {
  type: QuestionType;
  /** Áp lực đang dồn vào BOT, `0..1`. Xem `ConversationState.pressureOnMe`. */
  pressureOnMe: number;
  /** Uy tín của NGƯỜI HỎI trong mắt BOT, `0..1`. Một người đáng tin hỏi thì đáng đáp. */
  askerCredibility: number;
  /** Số bằng chứng BOT đang cầm mà CHƯA nói ra. */
  unspokenEvidence: number;
  /** BOT đã công khai nhận một vai chưa. */
  hasClaimedRole: boolean;
  /**
   * Dưới mức tầm quan trọng này, và không bị dồn, thì bỏ qua.
   * Đến từ `weights.conversation.questionIgnoreFloor`.
   */
  ignoreFloor: number;
  style: BotSpeechStyle;
}

/**
 * Sức nặng gốc của từng loại câu hỏi.
 *
 * ponytail: hằng số module, không phải `BotWeights`. Chúng xếp hạng các loại
 * với NHAU, không phải một nút vặn đổi được thắng thua - trần trên là khi một
 * benchmark cho thấy thứ hạng sai, và lúc đó chuyển cả bảng thành weights.
 *
 * ĐÃ HIỆU CHỈNH bằng số đo, không phải bằng trực giác. Bảng đầu tiên chạy từ
 * 0.35 (GENERAL) tới 0.9 (ACCUSATION); trên 1.200 ván nó kéo tỉ lệ đáp câu hỏi
 * từ 55,8% xuống 4,5%, vì phần lớn câu hỏi thật trong ván là `GENERAL` và
 * `TARGET` ("An thấy sao", "thấy ai lạ ko") và cả hai rơi dưới ngưỡng ngay với
 * một người hỏi TRUNG TÍNH. Thang bây giờ đặt sao cho một người hỏi trung tính
 * (credibility 0.5) vượt ngưỡng ở MỌI loại, và `IGNORE` chỉ dành cho câu vu vơ
 * từ người đã tự làm mất uy tín - đúng nghĩa "đôi lúc né là hợp lý" của §28,
 * không phải "gần như không bao giờ đáp".
 */
const BASE_IMPORTANCE: Readonly<Record<QuestionType, number>> = Object.freeze({
  ACCUSATION: 0.95,
  ROLE: 0.9,
  CONSISTENCY: 0.85,
  EVIDENCE: 0.75,
  VOTE: 0.7,
  TARGET: 0.65,
  GENERAL: 0.55,
});

/** Áp lực từ mức này trở lên thì không câu hỏi nào được bỏ qua. */
const PRESSURE_FORCES_REPLY = 0.2;

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Câu hỏi này đáng đáp tới mức nào, `0..1` (§13 "Importance").
 *
 * Ba nguồn: loại câu hỏi, uy tín người hỏi, và áp lực đang dồn vào bot. Một câu
 * vu vơ từ người chẳng ai tin, giữa lúc không ai để ý tới mình, là câu duy nhất
 * đáng bỏ qua.
 */
export function questionImportance(context: QuestionContext): number {
  const base = BASE_IMPORTANCE[context.type];
  return clampUnit(base * (0.7 + 0.3 * context.askerCredibility) + 0.25 * context.pressureOnMe);
}

/**
 * Chọn cách đáp.
 *
 * Bậc thang, dừng ở nấc đầu tiên đúng. Thứ tự là thứ tự ưu tiên, và hai nấc đầu
 * là hai luật CỨNG chứ không phải sở thích:
 *
 * 1. Câu vặt từ người không đáng kể, giữa lúc yên: bỏ qua.
 * 2. **Bị hỏi vai mà chưa khai: KHÔNG BAO GIỜ trả lời thẳng.** Một lời khai là
 *    nước đi nặng nhất mà lời nói làm được, và nó là quyết định của
 *    `decideChatClaim` - thứ đứng TRÊN cả hai đường trong planner. Để một câu
 *    hỏi của người khác moi được lời khai ra là giao nước đi đó cho đối thủ.
 */
export function chooseResponseStrategy(context: QuestionContext): ResponseStrategy {
  const { type, style, pressureOnMe, unspokenEvidence } = context;

  if (
    questionImportance(context) < context.ignoreFloor &&
    pressureOnMe < PRESSURE_FORCES_REPLY
  ) {
    return "IGNORE";
  }

  if (type === "ROLE" && !context.hasClaimedRole) {
    if (style.harshness >= 0.6) return "CHALLENGE_PREMISE";
    return style.inquisitive >= 0.5 ? "COUNTER_QUESTION" : "DEFLECT";
  }

  // Một cáo buộc mặc áo câu hỏi được đáp như một cáo buộc: hoặc bác cái tiền
  // đề, hoặc hỏi ngược. Trả lời thẳng "không, tôi không phải sói" là câu mà
  // đúng một con Sói cũng nói được, nên nó không mua được gì.
  if (type === "ACCUSATION") {
    return style.harshness >= 0.5 ? "CHALLENGE_PREMISE" : "COUNTER_QUESTION";
  }

  // Có căn cứ chưa nói thì đây là lúc tốt nhất để nói: người ta vừa mở lời mời.
  if (unspokenEvidence > 0 && type !== "GENERAL") return "ANSWER_WITH_EVIDENCE";

  // Bị đòi căn cứ mà không có: nói được tới đâu nói tới đó, hoặc bẻ lại câu
  // hỏi. Im hoặc lảng ở đây là dấu hiệu tệ nhất một người chơi có thể phát ra.
  if (type === "EVIDENCE") {
    return style.concession >= 0.5 ? "PARTIAL_ANSWER" : "CHALLENGE_PREMISE";
  }

  // Câu hỏi về tính nhất quán phải được đáp THẲNG. Né đúng câu này là tự nhận
  // mình có chỗ không khớp - xem §15 (narrative consistency).
  if (type === "CONSISTENCY") return "DIRECT_ANSWER";

  // Đang bị dồn và không phải người dễ nhượng bộ: lái sang chuyện khác.
  if (pressureOnMe >= 0.5 && style.concession < 0.5) return "DEFLECT";

  return "DIRECT_ANSWER";
}

/** Hình dạng ý định mà một strategy sinh ra. `null` là im lặng. */
export interface ResponseShape {
  kind: BotSpeechKind;
  topic: BotSpeechTopic;
  tone: BotSpeechTone;
  /** Ý định này có được mang bằng chứng không. */
  withEvidence: boolean;
}

const TOPIC_OF: Readonly<Record<QuestionType, BotSpeechTopic>> = Object.freeze({
  ACCUSATION: "SUSPICION",
  ROLE: "ROLE_CLAIM",
  EVIDENCE: "EVIDENCE",
  CONSISTENCY: "PROCESS",
  VOTE: "VOTE",
  TARGET: "SUSPICION",
  GENERAL: "PROCESS",
});

/**
 * Strategy + loại câu hỏi -> hình dạng ý định.
 *
 * Không thêm speech kind mới. Mười bốn loại hiện có đã phủ hết bảy strategy, và
 * mỗi kind mới kéo theo một câu dẫn trong `prompt.ts`, một nhánh trong
 * `templates.ts`, và một cổng trong `speech-renderer.ts` - giá đó chỉ đáng trả
 * khi không cách nào diễn đạt được bằng cái đang có.
 */
export function intentionFor(
  strategy: ResponseStrategy,
  type: QuestionType,
  style: BotSpeechStyle,
): ResponseShape | null {
  const topic = TOPIC_OF[type];

  switch (strategy) {
    case "IGNORE":
      return null;
    case "DIRECT_ANSWER":
      return { kind: "REPLY", topic, tone: style.harshness >= 0.6 ? "FIRM" : "NEUTRAL", withEvidence: false };
    case "PARTIAL_ANSWER":
      return { kind: "REPLY", topic, tone: "SOFT", withEvidence: false };
    case "ANSWER_WITH_EVIDENCE":
      return { kind: "REPLY", topic, tone: "FIRM", withEvidence: true };
    case "DEFLECT":
      // Lảng đi thì chủ đề đổi sang "chuyện thủ tục", không còn là chuyện được
      // hỏi. Đó là chỗ DUY NHẤT tầng dưới phân biệt được nó với một câu đáp
      // thẳng, nên `topic` ở đây không được lấy theo loại câu hỏi.
      return { kind: "REPLY", topic: "PROCESS", tone: "NEUTRAL", withEvidence: false };
    case "COUNTER_QUESTION":
      return { kind: "QUESTION", topic, tone: "CURIOUS", withEvidence: false };
    case "CHALLENGE_PREMISE":
      return { kind: "CHALLENGE", topic, tone: style.harshness >= 0.6 ? "TENSE" : "FIRM", withEvidence: false };
    default: {
      const unreachable: never = strategy;
      throw new Error(`Chưa có hình dạng ý định cho strategy: ${String(unreachable)}`);
    }
  }
}
