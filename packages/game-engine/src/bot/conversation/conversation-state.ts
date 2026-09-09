import { buildDiscussionGraph, type PressureEpisode } from "../analysis/discussion-graph";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import type { BotBrainState, BotDecisionContext, BotMemoryType } from "../types";
import { hasReplied, speechCountInRound } from "./speech-memory";

/**
 * PR 1-3 của `NIGHTFALL_BOT_COMMUNICATION_UPGRADE` (§5, §6, §7, §11, §12):
 * "tình hình xã hội" của MỘT bot, quy về vài con số mà planner đọc được.
 *
 * Thuần và DẪN XUẤT: không một byte nào ở đây được lưu vào `BotBrainState`.
 * Mọi thứ tính lại từ `state.memories` (thứ `chat-analysis` đã parse) và
 * `state.speechMemory`. Đó là điều kiện để nó không thể lệch khỏi trí nhớ thật,
 * và để `serialize()`/`restore()` không phải biết tới nó.
 *
 * Không đọc `visibleChat.text`. Thứ duy nhất đi qua ranh giới parser là loại
 * mệnh đề, người nói, người bị nhắc, và id câu — đúng như `triggers.ts`.
 *
 * Không RNG, không đồng hồ, không I/O.
 */

/**
 * Chỗ đứng của bot trong cuộc thảo luận (§12).
 *
 * Năm ô, và chúng LOẠI TRỪ nhau: một bot đang bị dồn thì không đồng thời "an
 * toàn", kể cả khi nó cũng đang nói nhiều nhất bàn. Thứ tự phân loại trong
 * `floorStatusOf` chính là thứ tự ưu tiên đó.
 */
export type FloorStatus =
  | "IGNORED"
  | "SAFE"
  | "UNDER_PRESSURE"
  | "CENTRAL"
  | "DOMINANT";

export type PressureTrend = "rising" | "stable" | "falling";

/** Một câu hỏi nhắm thẳng vào bot mà bot chưa đáp (§6). */
export interface UnansweredQuestion {
  /** Câu chat đã hỏi. Luôn có thật trong tầm nhìn của bot. */
  messageId: string;
  askerId: string;
  round: number;
  /** Số vòng đã trôi qua kể từ lúc bị hỏi. `0` là hỏi trong vòng này. */
  ageInRounds: number;
}

export interface ConversationState {
  round: number;
  /** Áp lực đang dồn vào CHÍNH bot, `0..1`. */
  pressureOnMe: number;
  pressureTrend: PressureTrend;
  /** Áp lực vòng này lên mọi người còn sống, kể cả bot. Chỉ gồm người > 0. */
  pressureByPlayer: Record<string, number>;
  floor: FloorStatus;
  /**
   * Câu hỏi còn nợ, cũ nhất đứng trước.
   *
   * KHÁC `QUESTIONED_ME` của `triggers.ts`: trigger hết hạn sau
   * `triggerFreshnessRounds` vòng vì nó trả lời câu "có đáng đáp NGAY không".
   * Danh sách này trả lời câu khác — "mình đang nợ ai câu nào" — nên nó sống
   * lâu hơn, tới `unansweredQuestionRounds`.
   */
  unansweredQuestions: UnansweredQuestion[];
  /** Số câu bot đã nói trong vòng này. */
  myMessagesThisRound: number;
  /** Phần lời nói của bot trong vòng này, `0..1`. */
  myShareOfVoice: number;
}

/** Loại memory ĐẾN TỪ CHAT — thứ duy nhất tính là "một lượt nói". */
const CHAT_MEMORY_TYPES: ReadonlySet<BotMemoryType> = new Set<BotMemoryType>([
  "ACCUSE",
  "DEFEND",
  "ROLE_CLAIM",
  "COUNTER_CLAIM",
  "DIRECT_ADDRESS",
  "DIRECT_QUESTION",
]);

/**
 * Ngưỡng phân loại `FloorStatus`.
 *
 * ponytail: hằng số module, không phải `BotWeights`. Đây là nhãn cho một cái
 * nhìn DẪN XUẤT, không phải một nút vặn ảnh hưởng thắng thua — không có gì để
 * A/B. Nếu có ngày một benchmark cho thấy nhãn sai làm bot nói dở đi thì chuyển
 * bốn số này thành `ConversationWeights`, cùng đường mà `directReplyFloor` đã đi.
 */
const UNDER_PRESSURE_AT = 0.34;
const CENTRAL_MENTIONS_AT = 2;
const DOMINANT_SHARE_AT = 0.5;
/** Một người bênh gỡ được bấy nhiêu phần của một người tố. */
const DEFENDER_RELIEF = 0.6;

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Áp lực lên một người trong một vòng, `0..1`.
 *
 * Mẫu số là số người CÓ THỂ tố (người sống trừ chính mục tiêu), nên "ba người
 * tố" nặng hơn hẳn ở bàn còn năm người so với bàn còn mười hai — đúng như cảm
 * giác thật ở bàn.
 *
 * Người bênh gỡ bớt chứ không xoá: một người được bênh giữa lúc ba người đang
 * tố vẫn đang ở giữa tâm bão.
 */
function pressureOf(episode: PressureEpisode | undefined, aliveCount: number): number {
  if (!episode) return 0;
  const canAccuse = Math.max(1, aliveCount - 1);
  const net = episode.accuserIds.length - episode.defenderIds.length * DEFENDER_RELIEF;
  return clampUnit(net / canAccuse);
}

function trendOf(now: number, before: number): PressureTrend {
  // Ngưỡng chết nhỏ: một khác biệt dưới mức này là nhiễu làm tròn, không phải
  // một câu chuyện về ai đang bị dồn thêm.
  if (now - before > 0.05) return "rising";
  if (before - now > 0.05) return "falling";
  return "stable";
}

function floorStatusOf(
  pressureOnMe: number,
  mentionsOfMe: number,
  shareOfVoice: number,
  myMessages: number,
): FloorStatus {
  if (pressureOnMe >= UNDER_PRESSURE_AT) return "UNDER_PRESSURE";
  if (myMessages > 0 && shareOfVoice >= DOMINANT_SHARE_AT) return "DOMINANT";
  if (mentionsOfMe >= CENTRAL_MENTIONS_AT) return "CENTRAL";
  if (mentionsOfMe === 0 && myMessages === 0) return "IGNORED";
  return "SAFE";
}

export function buildConversationState(
  context: BotDecisionContext,
  state: BotBrainState,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): ConversationState {
  const me = state.playerId;
  const round = context.knowledge.round;
  const alive = new Map(context.knowledge.players.map((player) => [player.id, player.alive]));
  const aliveCount = [...alive.values()].filter(Boolean).length;
  const visible = new Set(context.visibleChat.map((message) => message.id));

  const { episodes } = buildDiscussionGraph({ knowledge: context.knowledge, state });
  const byKey = new Map(episodes.map((episode) => [`${episode.round}:${episode.targetId}`, episode]));

  const pressureByPlayer: Record<string, number> = {};
  for (const [playerId, isAlive] of [...alive.entries()].sort()) {
    if (!isAlive) continue;
    const value = pressureOf(byKey.get(`${round}:${playerId}`), aliveCount);
    if (value > 0) pressureByPlayer[playerId] = value;
  }

  const pressureOnMe = pressureByPlayer[me] ?? 0;
  const pressureTrend = trendOf(
    pressureOnMe,
    pressureOf(byKey.get(`${round - 1}:${me}`), aliveCount),
  );

  // ---- Ai đang nhắc tới mình, và ai đang chiếm diễn đàn ----
  let mentionsOfMe = 0;
  const otherMessages = new Set<string>();
  const unansweredQuestions: UnansweredQuestion[] = [];
  const questionWindow = weights.conversation.unansweredQuestionRounds;

  for (const memory of state.memories) {
    if (!CHAT_MEMORY_TYPES.has(memory.type)) continue;
    if (memory.actorId === me) continue;
    if (memory.round === round) otherMessages.add(memory.sourceId);
    if (memory.targetId !== me) continue;
    if (memory.round === round) mentionsOfMe += 1;

    // Nợ một câu trả lời. Không lọc theo `visible` cho phần đếm ở trên (một cáo
    // buộc vẫn là một cáo buộc dù câu đã trôi khỏi cửa sổ chat), nhưng CÓ lọc ở
    // đây: `assertSpeechScope` đòi `replyToMessageId` phải nằm trong chat đã
    // lọc, nên một câu hỏi không còn nhìn thấy thì không đáp lại được nữa.
    if (memory.type !== "DIRECT_QUESTION") continue;
    if (questionWindow <= 0) continue;
    if (round - memory.round >= questionWindow) continue;
    if (!visible.has(memory.sourceId)) continue;
    if (alive.get(memory.actorId) !== true) continue;
    if (hasReplied(state, memory.sourceId)) continue;

    unansweredQuestions.push({
      messageId: memory.sourceId,
      askerId: memory.actorId,
      round: memory.round,
      ageInRounds: round - memory.round,
    });
  }

  const myMessagesThisRound = speechCountInRound(state, round);
  const total = myMessagesThisRound + otherMessages.size;

  return {
    round,
    pressureOnMe,
    pressureTrend,
    pressureByPlayer,
    floor: floorStatusOf(
      pressureOnMe,
      mentionsOfMe,
      total === 0 ? 0 : myMessagesThisRound / total,
      myMessagesThisRound,
    ),
    unansweredQuestions: unansweredQuestions.sort(
      (left, right) =>
        left.round - right.round || left.messageId.localeCompare(right.messageId),
    ),
    myMessagesThisRound,
    myShareOfVoice: total === 0 ? 0 : myMessagesThisRound / total,
  };
}

/**
 * "Lượt này có đáng mở lời không", `0..1` (§11).
 *
 * Cộng những lý do NÊN nói, trừ những lý do KHÔNG nên, rồi trung bình. Chỗ gọi
 * (`planSpeech`) cộng nó vào ngưỡng `talkativeness` — nó KHÔNG tự quyết, và
 * KHÔNG rút số. Đó là điều kiện để mọi preset cũ replay từng bit: với
 * `urgencyBoost = 0`, ngưỡng quy về đúng `talkativeness` của Phase 3.
 *
 * ponytail: bốn số hạng trọng số bằng nhau, một nút vặn duy nhất
 * (`urgencyBoost`) cho cả cụm. Tách trọng số riêng cho từng số hạng khi có một
 * benchmark chỉ ra số hạng nào đang kéo sai — không phải trước đó.
 */
export function speechUrge(
  conversation: ConversationState,
  /** Số bằng chứng CHƯA nói ra mà bot đang cầm. */
  unspokenEvidence: number,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): number {
  const { messagesPerBotPerRound } = weights.conversation;

  // Có căn cứ mới thì đáng nói; đã nói hết rồi thì mở miệng chỉ để lặp lại.
  const evidenceValue = clampUnit(unspokenEvidence / Math.max(1, weights.limits.intentionEvidence));
  // Bị dồn mà im là hành vi đáng ngờ nhất một người chơi có thể làm.
  const selfDefenseNeed = conversation.pressureOnMe;
  // Nợ câu trả lời. Hai câu là đủ để coi như nợ hết mức.
  const questionDebt = clampUnit(conversation.unansweredQuestions.length / 2);
  // Không ai nhắc tới mình cả vòng: một câu hỏi đúng lúc kéo lại được chỗ đứng.
  const socialOpportunity = conversation.floor === "IGNORED" ? 0.5 : 0;

  // Nói quá phần của mình rồi thì lời tiếp theo mua được ít hơn nó tốn.
  const redundancy = clampUnit(
    conversation.myMessagesThisRound / Math.max(1, messagesPerBotPerRound),
  );
  // Đang cầm trịch cả bàn là lúc mỗi câu thêm vào đều làm mình lộ thêm.
  const overexposure = conversation.floor === "DOMINANT" ? 0.5 : 0;

  const positive =
    (evidenceValue + selfDefenseNeed + questionDebt + socialOpportunity) / 4;
  return clampUnit(positive - (redundancy + overexposure) / 2);
}
