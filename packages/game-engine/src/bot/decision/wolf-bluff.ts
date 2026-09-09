import { incomingHostilityOf } from "../analysis/social-analysis";
import { buildCommunicationProfile } from "../belief/communication-profile";
import { credibilityOf } from "../belief/player-assessment";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import type { BotBrainState, BotKnowledgeView } from "../types";

/**
 * PR 7 của `NIGHTFALL_BOT_COMMUNICATION_UPGRADE` (§17): ghế nào của bầy Sói nên
 * đứng ra khai láo.
 *
 * Trước module này câu trả lời là một vòng xoay hash thuần
 * (`wolfBluffSeat`): tất định, đồng bộ được giữa các con Sói mà không cần kênh
 * liên lạc, và hoàn toàn mù trước việc con nào đang ở thế nói dối tốt nhất.
 * §17 nói thẳng: giữ hash làm fallback, thêm chấm điểm chiến lược lên trên.
 *
 * Đó chính là hình dạng của `wolfBluffPick` bên dưới - một phép PHA giữa hai
 * thứ, không phải một phép thay thế:
 *
 * ```text
 * final = share x score + (1 - share) x (ghế hash được 1 điểm, còn lại 0)
 * ```
 *
 * `share = 0` cho lại đúng vòng xoay cũ từng bit; `share = 1` là điểm số thuần;
 * ở giữa, hash là một prior mạnh mà một ghế rõ ràng tốt hơn mới vượt được.
 *
 * # Vì sao module riêng
 *
 * `claim-decision.ts` (chỗ một con Sói tự hỏi "có phải lượt mình không") và
 * `roles/wolf-team-plan.ts` (chỗ dựng kế hoạch cả bầy) đều phải đọc CÙNG một
 * đáp án. `wolf-team-plan` vốn đã import `claim-decision`, nên đặt hàm này ở
 * `claim-decision` thì không sao, nhưng nó kéo theo `communication-profile` vào
 * một file vốn chỉ nói về lời khai. Một module thứ ba mà cả hai cùng import là
 * cách duy nhất không có chiều nào phải biết về chiều kia.
 *
 * # Đồng bộ giữa các con Sói
 *
 * Không có kênh truyền tin nào giữa các `BotRuntime`. Bầy chỉ "thống nhất" khi
 * mọi con tính ra cùng đáp án, nên mọi đầu vào ở đây phải là thứ cả bầy cùng
 * thấy: phiếu công khai do engine cấp, và hồ sơ dựng từ chat ban ngày mà mọi
 * người sống đều đọc. Có test khoá tính chất này - xem
 * `bot-wolf-bluff.test.ts`.
 *
 * THUẦN: không RNG, không đồng hồ, không I/O.
 */

/** Bốn số hạng của `wolfBluffCandidateScore`, giữ lại để trace đọc được. */
export interface WolfBluffScore {
  seatId: string;
  /** Lời của ghế này có sức nặng tới đâu, 0..1. */
  credibility: number;
  /** Bàn có dễ đi theo ghế này không, 0..1. */
  persuadability: number;
  /** Chưa ai soi vào ghế này tới đâu, 0..1. */
  lowSuspicion: number;
  /** Ghế này đang bị dồn phiếu tới đâu, 0..1. Trừ đi. */
  exposureRisk: number;
  /** Tổng đã chuẩn hoá về 0..1. */
  score: number;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Ghế này nói dối tốt tới đâu, `0..1`.
 *
 * Bốn số hạng, mỗi cái trả lời một câu khác nhau - đó là điều kiện để cộng
 * chúng lại có nghĩa:
 *
 * - `credibility`: hồ sơ trong ván (đoán đúng bao nhiêu, đã khai láo bao nhiêu).
 * - `persuadability`: bàn có xu hướng đi theo ghế này không (PR 6).
 * - `lowSuspicion`: làng đã soi vào ghế này chưa (social graph công khai).
 * - `exposureRisk`: ghế đang gánh phiếu thì lời khai bị đọc là "khai lúc bị
 *   dồn" và `claim-credibility` cắt uy tín của nó xuống ngay - khai lúc đó là
 *   ném lời khai đi.
 *
 * §17 liệt kê năm số hạng, trong đó có `narrativeFit`. Ở codebase này thứ đo
 * được của "câu chuyện có khớp không" chính là hồ sơ độ chính xác trong ván,
 * và nó đã nằm trong `credibility` (`accuracy - bluffRate x strength`) - tách
 * ra thành số hạng thứ năm chỉ là đếm cùng một thứ hai lần.
 */
export function wolfBluffCandidateScore(
  knowledge: BotKnowledgeView,
  state: BotBrainState,
  seatId: string,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): WolfBluffScore {
  const credibility = credibilityOf(state, seatId, weights);
  const persuadability = buildCommunicationProfile(
    knowledge,
    state,
    seatId,
    weights,
  ).persuadability;
  const lowSuspicion = 1 - clampUnit(incomingHostilityOf(state, seatId));

  const aliveCount = knowledge.players.filter((player) => player.alive).length;
  const votesOnSeat = knowledge.currentVoteCounts.players[seatId] ?? 0;
  const exposureRisk = clampUnit(votesOnSeat / Math.max(1, aliveCount));

  return {
    seatId,
    credibility,
    persuadability,
    lowSuspicion,
    exposureRisk,
    score: clampUnit((credibility + persuadability + lowSuspicion) / 3 - exposureRisk),
  };
}

/**
 * Ghế đứng ra khai láo vòng này, hoặc `null` khi bầy không còn ai đủ điều kiện.
 *
 * `hashSeat` là ghế mà vòng xoay Phase 3 chọn; truyền vào thay vì tự tính để
 * module này không phải import ngược `claim-decision`.
 *
 * Hoà điểm thì `hashSeat` thắng, rồi tới id nhỏ nhất - tất định ở mọi nhánh.
 */
export function wolfBluffPick(
  knowledge: BotKnowledgeView,
  state: BotBrainState,
  seats: readonly string[],
  hashSeat: string | null,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): string | null {
  if (seats.length === 0) return null;

  const share = weights.claim.wolfBluffScoreShare;
  // Cổng tái lập: `0` là vòng xoay thuần, và phải thoát TRƯỚC khi đụng vào bất
  // cứ thứ gì để v1..v26 không đổi một bit.
  if (share <= 0) return hashSeat;

  let best: string | null = null;
  let bestValue = -1;

  for (const seatId of [...seats].sort()) {
    const strategic = wolfBluffCandidateScore(knowledge, state, seatId, weights).score;
    const rotation = seatId === hashSeat ? 1 : 0;
    const value = share * strategic + (1 - share) * rotation;
    if (value > bestValue) {
      best = seatId;
      bestValue = value;
    }
  }

  return best;
}

/**
 * Cách một con Sói cư xử với ĐỒNG BỌN đang bị làng dồn (COMMUNICATION §18).
 *
 * Năm ô, xếp từ gần tới xa:
 *
 * ```text
 * DEFEND         bênh ra mặt
 * SOFT_DISAGREE  gợn lại một câu, không bênh hẳn
 * IGNORE         không đụng vào chuyện đó
 * HARD_DISAGREE  công khai phản đối đồng bọn
 * BUS            đẩy đồng bọn lên giá treo
 * ```
 *
 * Đánh đổi mà §18 nêu: mạng đồng bọn TRƯỚC MẮT, so với rủi ro bị buộc chung một
 * dây về LÂU DÀI. Ở đây nó đọc thành hai con số công khai - đồng bọn đang gánh
 * bao nhiêu phiếu, và CHÍNH MÌNH đang gánh bao nhiêu.
 *
 * Hàm này KHÔNG chọn `BUS` hay `HARD_DISAGREE`. Buông một đồng bọn là một nước
 * đi GAMEPLAY - nó đi qua lá phiếu, và lá phiếu đã có chủ ở `werewolf.ts`
 * (bussing) cùng `wolf-team-plan.ts` (`sacrificeCandidate`). Cho tầng LỜI NÓI
 * quyền quyết cùng chuyện đó là dựng bản sao thứ hai của một luật đã có, và hai
 * bản sẽ trôi lệch. Ở đây chỉ trả lời đúng một câu hẹp hơn: **mở miệng bênh có
 * đáng không.** Hai ô kia nằm trong union vì §18 liệt kê chúng và vì consumer
 * tương lai của lá phiếu sẽ cần đúng tên gọi này.
 *
 * THUẦN: không RNG, không state.
 */
export type WolfDistanceStance =
  | "DEFEND"
  | "SOFT_DISAGREE"
  | "IGNORE"
  | "HARD_DISAGREE"
  | "BUS";

export function wolfDistanceStance(
  knowledge: BotKnowledgeView,
  /** Đồng bọn đang bị dồn. */
  allyId: string,
  /** Chính con Sói đang cân nhắc. */
  selfId: string,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): WolfDistanceStance {
  const ceiling = weights.claim.wolfDistancePressure;
  // Cổng tái lập: `0` là "cứ bênh", tức đúng hành vi trước PR 7.
  if (ceiling <= 0) return "DEFEND";

  const aliveCount = Math.max(
    1,
    knowledge.players.filter((player) => player.alive).length,
  );
  const votes = knowledge.currentVoteCounts.players;
  const allyPressure = (votes[allyId] ?? 0) / aliveCount;
  const myPressure = (votes[selfId] ?? 0) / aliveCount;

  // Chính mình đang bị soi thì mở miệng bênh là tự buộc hai người vào một dây.
  if (myPressure >= ceiling) return "IGNORE";
  // Đồng bọn chưa nguy tới đâu, mà mình thì sạch: bênh được, và bênh lúc này
  // rẻ nhất - chưa ai coi đó là một lập trường.
  //
  // Nửa ngưỡng, không phải một nút vặn thứ hai: hai ngưỡng rời nhau chỉ có
  // nghĩa khi có số đo nói chúng nên rời, và hiện chưa có.
  if (allyPressure < ceiling / 2 && myPressure === 0) return "DEFEND";
  // Còn lại: gợn một câu, không đứng hẳn về phía ai.
  return "SOFT_DISAGREE";
}
