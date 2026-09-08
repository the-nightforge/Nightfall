import { roleTeam, type Role } from "@masoi/shared";
import type { BotEvidence } from "../types";
import type { RoleBelief, RoleBeliefInput } from "./role-belief";
import { projectRoleBeliefs } from "./role-belief";
import { buildDiscussionGraph } from "../analysis/discussion-graph";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { possibleWolfPairScore, socialEdgeKey } from "../analysis/social-analysis";

/**
 * PR 2 của BOT_AI_CONTINUE_UPGRADE (§8/§34): đánh giá QUAN HỆ CẶP người.
 *
 * Scalar suspicion từng người là QUÁ NHÌN RIÊNG LẺ: "a và b liên tục bênh nhau
 * cùng trùng phiếu" là một tín hiệu mà hai scalar không biểu diễn được. Social
 * graph (`state.relationships`) đã giữ quan hệ theo hướng `from->to` từ Phase
 * 2, và `possibleWolfPairScore` đã chấm độ phối hợp cặp kèm chiết khấu số mẫu.
 * Lớp này nâng chúng thành một BẢNG ĐÁNH GIÁ CẶP đọc được, đúng shape spec §8.
 *
 * Tầng dưới, tầng trên — module này KHÔNG tính gì mới cả:
 * - marginal P(wolf-team) của từng người: từ projection PR 1 (`role-belief.ts`),
 *   nơi scalar suspicion đã hấp thụ mọi bằng chứng cá nhân;
 * - độ phối hợp cặp: từ `possibleWolfPairScore`, nơi các cạnh đã chiết khấu
 *   theo số mẫu (`weights.social.priorStrength`).
 *
 * Ràng buộc §34 "pairwise KHÔNG được đè bằng chứng cá nhân" — chốt bằng chặn
 * trên Fréchet trên joint:
 *
 *   P(a ∧ b) = min( min(pA, pB), pA × pB × (1 + compatibility) )
 *
 * - Không quan sát nào (`compatibility = 0`) → joint = tích độc lập: quan hệ
 *   trống không thay đổi gì belief cá nhân.
 * - Hợp lực bão hoà → joint tiến gần min(pA, pB) nhưng không bao giờ vượt: hai
 *   người bênh nhau khít cũng không thể làm hai người sạch sẽ thành một cặp Sói.
 * - Thù địch chỉ làm compatibility thấp (không có gì để cộng) — nó KHÔNG kéo
 *   joint xuống dưới tích độc lập: "hai người đang cãi nhau" không phải bằng
 *   chứng cả hai trong sạch, chỉ là không có tín hiệu phối hợp.
 *
 * Thuần: cùng input → cùng bảng. Không RNG; cặp chuẩn hoá `playerA < playerB`;
 * chỉ gồm người SỐNG (phần phối hợp về người chết thuộc PR chiến thuật sau).
 */

export interface PlayerPairAssessment {
  /** Chuẩn hoá `playerA < playerB` theo `localeCompare`. */
  playerA: string;
  playerB: string;
  /**
   * P(CẢ HAI thuộc phe Sói) — joint đã chặn Fréchet, đã nhân hệ số tương quan
   * từ social graph. KHÔNG phải "điểm nghi cặp" kiểu cũ: đây là xác suất.
   */
  wolfPairScore: number;
  /** Độ liên minh 0..1: bênh vực + trùng phiếu, chiết khấu theo số mẫu. */
  allyScore: number;
  /** Độ thù địch 0..1: cáo buộc + phản bác, chiết khấu theo số mẫu. */
  conflictScore: number;
  /**
   * Độ CÙNG-HƯỚNG 0..1 (PR 4): hai người cùng tố hay cùng bênh một người khác
   * trong các đợt áp lực gần đây — tín hiệu liên minh §34 "shared targets",
   * chiết khấu theo ĐỘ ĐÔNG của đám đông (§13: cặp đôi mạnh hơn đám đông).
   */
  coAccusationScore: number;
  /** Bằng chứng từ CẢ HAI hướng cạnh, sort theo id, không trùng. */
  evidence: BotEvidence[];
}

export interface PairAssessmentInput extends RoleBeliefInput {
  /** Truyền sẵn bảng PR 1 nếu đã tính; thiếu thì tự chiếu. */
  roleBeliefs?: Record<string, RoleBelief>;
  weights?: BotWeights;
}

interface PairDirectionStats {
  support: number;
  alignment: number;
  hostility: number;
}

function averageDirection(
  state: PairAssessmentInput["state"],
  leftId: string,
  rightId: string,
): { stats: PairDirectionStats; samples: number } {
  const forward = state.relationships[socialEdgeKey(leftId, rightId)];
  const backward = state.relationships[socialEdgeKey(rightId, leftId)];
  const average = (pick: (edge: NonNullable<typeof forward>) => number): number =>
    ((forward ? pick(forward) : 0) + (backward ? pick(backward) : 0)) / 2;

  return {
    stats: {
      support: average((edge) => edge.support),
      alignment: average((edge) => edge.voteAlignment),
      hostility: average((edge) => edge.hostility),
    },
    samples: (forward?.samples ?? 0) + (backward?.samples ?? 0),
  };
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Độ cùng-hướng của một cặp từ discussion graph (PR 4).
 *
 * Mỗi đợt áp lực mà cả hai cùng đứng về một phía cộng:
 * - cùng TỐ: `2 / accuserCount` — đám đông hai người thì đầy đủ, đông hơn thì
 *   loãng (ba người → 0.67, năm → 0.4). Đó là phần §13 "chỉ hai đứa cùng tố"
 *   là tín hiệu của bầy.
 * - cùng BÊNH: `coDefenseContribution` — bênh thường ít người tham gia hơn tố,
 *   nên mỗi đợt bênh nặng hơn.
 *
 * Chiết khấu theo SỐ ĐỢT qua `priorStrength` của social: một đợt trùng hợp là
 * chuyện thường, hai ba đợt liên tiếp mới là khuôn mẫu.
 */
export function coAccusationScoreOf(
  input: PairAssessmentInput,
  leftId: string,
  rightId: string,
): number {
  const graph = buildDiscussionGraph(input);
  let raw = 0;
  let episodes = 0;
  for (const episode of graph.episodes) {
    const bothAccuse =
      episode.accuserIds.includes(leftId) && episode.accuserIds.includes(rightId);
    const bothDefend =
      episode.defenderIds.includes(leftId) && episode.defenderIds.includes(rightId);
    if (!bothAccuse && !bothDefend) continue;
    episodes += 1;
    if (bothAccuse) raw += 2 / Math.max(2, episode.accuserIds.length);
    if (bothDefend) raw += coDefenseContribution;
  }
  if (episodes === 0) return 0;
  const observationWeight = episodes / (episodes + priorStrengthOf(input));
  return Math.min(1, raw * observationWeight);
}

const coDefenseContribution = 1;
const priorStrengthOf = (input: PairAssessmentInput): number =>
  (input.weights ?? DEFAULT_BOT_WEIGHTS).social.priorStrength;

/**
 * Đánh giá MỌI cặp người SỐNG, theo thứ tự chuẩn hoá. Với n người sống thì có
 * n×(n−1)/2 cặp — dưới 20 người là trần hợp lý, không cần lọc trước.
 */
export function assessPairs(input: PairAssessmentInput): PlayerPairAssessment[] {
  const weights = input.weights ?? DEFAULT_BOT_WEIGHTS;
  const roleBeliefs = input.roleBeliefs ?? projectRoleBeliefs(input);
  const aliveIds = input.knowledge.players
    .filter((player) => player.alive)
    .map((player) => player.id)
    .sort();

  const pairs: PlayerPairAssessment[] = [];
  for (let i = 0; i < aliveIds.length; i += 1) {
    for (let j = i + 1; j < aliveIds.length; j += 1) {
      const leftId = aliveIds[i]!;
      const rightId = aliveIds[j]!;

      const pLeft = roleBeliefs[leftId] ? getWolfMass(roleBeliefs[leftId]!) : 0;
      const pRight = roleBeliefs[rightId] ? getWolfMass(roleBeliefs[rightId]!) : 0;

      const { stats, samples } = averageDirection(input.state, leftId, rightId);
      // Chiết khấu số mẫu giống `possibleWolfPairScore`: vài mẫu đầu chưa đủ
      // tin để kể là quan hệ.
      const observationWeight = samples / (samples + weights.social.priorStrength);
      const compatibility = possibleWolfPairScore(input.state, leftId, rightId, weights);
      const coScore = coAccusationScoreOf(input, leftId, rightId);

      const independent = pLeft * pRight;
      const joint = Math.min(
        Math.min(pLeft, pRight),
        independent * (1 + Math.min(1, compatibility + coScore)),
      );

      // Evidence gom hai hướng cạnh: cùng một bảng reason mà graph đang giữ,
      // dedup theo id và sort ổn định để so sánh được giữa hai lần chiếu.
      const forward = input.state.relationships[socialEdgeKey(leftId, rightId)];
      const backward = input.state.relationships[socialEdgeKey(rightId, leftId)];
      const byId = new Map<string, BotEvidence>();
      for (const edge of [forward, backward]) {
        for (const reason of edge?.reasons ?? []) byId.set(reason.id, reason);
      }
      const evidenceList = [...byId.values()]
        .sort((left, right) => left.id.localeCompare(right.id))
        .slice(0, weights.limits.edgeReasons);

      pairs.push({
        playerA: leftId,
        playerB: rightId,
        wolfPairScore: joint,
        allyScore: clampUnit(
          (stats.support + stats.alignment) * observationWeight,
        ),
        conflictScore: clampUnit(stats.hostility * observationWeight),
        coAccusationScore: coScore,
        evidence: evidenceList,
      });
    }
  }

  return pairs;
}

/** Tổng khối lượng phe Sói của một belief PR 1 (đã chuẩn hoá sẵn). */
function getWolfMass(belief: RoleBelief): number {
  let total = 0;
  for (const [role, probability] of Object.entries(belief.probabilities)) {
    if (roleTeam(role as Role) === "wolves") total += probability;
  }
  return total;
}
