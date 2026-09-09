import type { BotKnowledgeView, BotBrainState, BotMemoryType } from "../types";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { incomingHostilityOf, socialEdgeKey } from "../analysis/social-analysis";
import { credibilityOf } from "./player-assessment";

/**
 * PR 6 của `NIGHTFALL_BOT_COMMUNICATION_UPGRADE` (§8, §9): mỗi người chơi được
 * thuyết phục bằng một kiểu khác nhau, và BOT nên nói theo kiểu của NGƯỜI NGHE.
 *
 * §9 cho đúng bốn ô:
 *
 * ```text
 * Analyst          -> evidence
 * Aggressive       -> direct challenge
 * Majority follower-> consensus framing
 * Skeptic          -> consistency / contradiction
 * ```
 *
 * Bốn ô đó là `PersuasionStyle` bên dưới, và mọi thứ khác trong file này chỉ
 * tồn tại để chọn ra một trong bốn.
 *
 * Mọi chiều đều đọc từ HÀNH VI CÔNG KHAI - lịch sử phiếu, và loại mệnh đề mà
 * `chat-analysis` đã parse. Không đọc raw chat, không đọc vai, không đọc gì mà
 * cả bàn không cùng thấy.
 *
 * DẪN XUẤT, không lưu trữ. THUẦN: không RNG, không đồng hồ, không I/O.
 */

export const PERSUASION_STYLES = [
  /** Thuyết phục bằng bằng chứng cụ thể. */
  "EVIDENCE",
  /** Thuyết phục bằng cách thách thức thẳng. */
  "CHALLENGE",
  /** Thuyết phục bằng đồng thuận số đông. */
  "CONSENSUS",
  /** Thuyết phục bằng cách chỉ ra chỗ không khớp. */
  "CONSISTENCY",
] as const;

export type PersuasionStyle = (typeof PERSUASION_STYLES)[number];

/**
 * Hồ sơ GIAO TIẾP về một người (§8).
 *
 * Bốn trường đầu dùng lại nguyên các công thức đã có (`state.trust/suspicion`,
 * `credibilityOf`, `incomingHostilityOf`) - cùng số mà `PlayerAssessment` đọc,
 * nên hai bảng không bao giờ nói hai chuyện khác nhau về cùng một người.
 *
 * KHÔNG gọi `projectRoleBeliefs`: bảng xác suất vai là thứ đắt nhất trong lớp
 * belief, và không chiều nào ở đây cần tới nó. Đó cũng là lý do file này không
 * đơn giản mở rộng `assessPlayer`.
 */
export interface CommunicationProfile {
  playerId: string;
  /** Thang gốc 0..100, giữ nguyên như `PlayerAssessment`. */
  trust: number;
  suspicion: number;
  /** Lời nói đáng tin tới đâu, 0..1. */
  credibility: number;
  /** Lái được dư luận tới đâu, 0..1. */
  influence: number;

  /** Hay công khai buộc tội tới đâu, 0..1. Từ `PlayerProfile.aggroRate`. */
  aggression: number;
  /** Hay bỏ phiếu theo phe đông nhất tới đâu, 0..1. */
  followMajority: number;
  /** Hay đòi bằng chứng / soi tính nhất quán tới đâu, 0..1. */
  analyticalStyle: number;
  /** Quan hệ hai chiều với CHÍNH BOT, `-1..1`. Âm là thù địch. */
  relationship: number;
  /** Dễ bị lay chuyển tới đâu, 0..1. Heuristic - xem §9. */
  persuadability: number;

  /** Bao nhiêu quan sát đứng sau hồ sơ này. Ít mẫu thì đừng tin nhiều. */
  samples: number;
  /**
   * Kiểu thuyết phục hợp với người này, hoặc `null` khi chưa đủ mẫu để dám
   * đọc. `null` nghĩa là "cứ nói theo tính cách của chính mình" - đúng hành vi
   * trước PR 6.
   */
  style: PersuasionStyle | null;
}

/** Loại memory ĐẾN TỪ CHAT; mẫu số của các tỉ lệ hành vi lời nói. */
const CHAT_MEMORY_TYPES: ReadonlySet<BotMemoryType> = new Set<BotMemoryType>([
  "ACCUSE",
  "DEFEND",
  "ROLE_CLAIM",
  "COUNTER_CLAIM",
  "DIRECT_ADDRESS",
  "DIRECT_QUESTION",
]);

/**
 * Loại câu hỏi cho thấy người hỏi đang SOI, không chỉ đang dò.
 *
 * Dùng lại đúng nhãn mà `chat-analysis` gắn ở PR 4. Không có PR 4 thì chiều
 * `analyticalStyle` sẽ phải đoán từ raw text, và đó là ranh giới không được
 * bước qua.
 */
const ANALYTICAL_QUESTIONS: ReadonlySet<string> = new Set(["EVIDENCE", "CONSISTENCY"]);

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Tỉ lệ lá phiếu của một người rơi đúng vào mục tiêu ĐÔNG PHIẾU NHẤT của vòng.
 *
 * Đọc `publicVoteHistory` - dữ liệu cả bàn cùng thấy. Vòng không ai bỏ phiếu
 * cho một NGƯỜI cụ thể thì không tính: ở đó không có "số đông" để mà theo.
 */
function followMajorityOf(knowledge: BotKnowledgeView, playerId: string): {
  rate: number;
  rounds: number;
} {
  let followed = 0;
  let rounds = 0;

  for (const recap of knowledge.publicVoteHistory) {
    const counts = new Map<string, number>();
    for (const ballot of recap.finalBallots) {
      if (ballot.choice.type !== "PLAYER") continue;
      counts.set(ballot.choice.targetId, (counts.get(ballot.choice.targetId) ?? 0) + 1);
    }
    if (counts.size === 0) continue;

    // Hoà thì lấy id nhỏ nhất: tất định, và ở thế hoà thì "số đông" vốn đã
    // không có nghĩa rõ ràng nên chọn cách nào cũng là quy ước.
    let leader = "";
    let best = 0;
    for (const [targetId, count] of [...counts.entries()].sort()) {
      if (count > best) {
        leader = targetId;
        best = count;
      }
    }

    const ballot = recap.finalBallots.find((entry) => entry.voterId === playerId);
    if (!ballot || ballot.choice.type !== "PLAYER") continue;
    rounds += 1;
    if (ballot.choice.targetId === leader) followed += 1;
  }

  return { rate: rounds === 0 ? 0 : followed / rounds, rounds };
}

/** Quan hệ hai chiều giữa BOT và một người, `-1..1`. */
function relationshipWith(state: BotBrainState, playerId: string): number {
  const outgoing = state.relationships[socialEdgeKey(state.playerId, playerId)];
  const incoming = state.relationships[socialEdgeKey(playerId, state.playerId)];
  const net = (edge: typeof outgoing): number =>
    edge ? edge.support - edge.hostility : 0;
  return Math.min(1, Math.max(-1, (net(outgoing) + net(incoming)) / 2));
}

/**
 * Kiểu thuyết phục hợp với một người.
 *
 * Chấm bốn ô rồi lấy ô cao nhất; hoà thì theo thứ tự cố định của
 * `PERSUASION_STYLES`, nên kết quả tất định.
 *
 * `CONSISTENCY` chấm bằng mức THÙ ĐỊCH hướng về BOT, không bằng một chiều
 * "hoài nghi" riêng: người đang không tin mình thì một lời khẳng định nữa
 * không mua được gì, còn một chỗ không khớp thì họ tự kiểm được.
 */
function styleOf(profile: Omit<CommunicationProfile, "style">): PersuasionStyle {
  const scores: Record<PersuasionStyle, number> = {
    EVIDENCE: profile.analyticalStyle,
    CHALLENGE: profile.aggression,
    CONSENSUS: profile.followMajority,
    CONSISTENCY: Math.max(0, -profile.relationship),
  };

  let best: PersuasionStyle = "EVIDENCE";
  for (const style of PERSUASION_STYLES) {
    if (scores[style] > scores[best]) best = style;
  }
  return best;
}

export function buildCommunicationProfile(
  knowledge: BotKnowledgeView,
  state: BotBrainState,
  playerId: string,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): CommunicationProfile {
  let chatMemories = 0;
  let analyticalQuestions = 0;

  for (const memory of state.memories) {
    if (memory.actorId !== playerId) continue;
    if (!CHAT_MEMORY_TYPES.has(memory.type)) continue;
    chatMemories += 1;
    if (
      memory.type === "DIRECT_QUESTION" &&
      typeof memory.data.questionType === "string" &&
      ANALYTICAL_QUESTIONS.has(memory.data.questionType)
    ) {
      analyticalQuestions += 1;
    }
  }

  const majority = followMajorityOf(knowledge, playerId);
  const aggression = clampUnit(state.profiles[playerId]?.aggroRate ?? 0);
  const followMajority = clampUnit(majority.rate);

  const base: Omit<CommunicationProfile, "style"> = {
    playerId,
    trust: state.trust[playerId]?.score ?? 0,
    suspicion: state.suspicion[playerId]?.score ?? 0,
    credibility: credibilityOf(state, playerId, weights),
    influence: clampUnit(incomingHostilityOf(state, playerId)),
    aggression,
    followMajority,
    analyticalStyle: chatMemories === 0 ? 0 : analyticalQuestions / chatMemories,
    relationship: relationshipWith(state, playerId),
    // Heuristic của §9: người theo số đông và không hung hăng thì dễ lay
    // chuyển. Không có cách nào nhìn thấy `stubbornness` của người khác.
    persuadability: clampUnit((followMajority + (1 - aggression)) / 2),
    samples: chatMemories + majority.rounds,
  };

  const minSamples = weights.conversation.persuasionMinSamples;
  return {
    ...base,
    // Chưa đủ mẫu thì KHÔNG đọc: điều chỉnh cách nói theo một quan sát duy nhất
    // là điều chỉnh theo nhiễu, và nó sẽ làm bàn nghe thất thường chứ không
    // tinh tế hơn. `0` tắt hẳn cơ chế (v1..v25).
    style: minSamples > 0 && base.samples >= minSamples ? styleOf(base) : null,
  };
}
