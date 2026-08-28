import type { PublicVoteChoice } from "@masoi/shared";
import { possibleWolfPairScore } from "../analysis/social-analysis";
import type {
  BotBrainState,
  BotDecisionContext,
  BotEvidence,
  BotPersonality,
  BotRng,
  BotVoteIntention,
} from "../types";

/** Bằng chứng chắc chắn đáng giá hơn cùng một điểm nghi ngờ không có lý do. */
const EVIDENCE_CONFIDENCE_BONUS = 8;
/** Bị nhiều người công kích là tín hiệu xã hội, không phải bằng chứng cứng. */
const HOSTILITY_BONUS = 6;
/** Đóng góp tối đa của social graph khi cặp đôi trông như đang phối hợp. */
const PAIR_BONUS = 8;
/** Trust kéo ngược suspicion nhưng không bao giờ triệt tiêu được nó. */
const TRUST_DAMPING = 0.2;
/** Biên độ nhiễu người-hoá: tối đa ±3 điểm, luôn từ RNG được inject. */
const JITTER_SPAN = 6;

/** Số evidence tối đa mang theo một intention. */
const MAX_INTENTION_EVIDENCE = 3;

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Ngưỡng tối thiểu để dám đề cử ai đó. Người hung hăng và người chịu rủi ro
 * cao hạ ngưỡng này xuống, nhưng không ai xuống dưới ~48.
 */
export function voteThreshold(personality: BotPersonality): number {
  return 58 - personality.aggressiveness * 6 - personality.riskTolerance * 4;
}

/** Khoảng cách tối thiểu để bỏ mục tiêu đang bầu và chuyển sang người khác. */
export function voteHysteresis(personality: BotPersonality): number {
  return 5 + personality.stubbornness * 8;
}

function incomingHostility(state: BotBrainState, targetId: string): number {
  let total = 0;
  let count = 0;
  for (const [key, edge] of Object.entries(state.relationships)) {
    if (!key.endsWith(`->${targetId}`)) continue;
    total += edge.hostility;
    count += 1;
  }
  return count === 0 ? 0 : total / count;
}

/**
 * Social graph chỉ được phép bổ sung suspicion, không kết luận role: điểm cặp
 * đôi được nhân với mức nghi ngờ đã có bằng chứng của người kia, nên một cặp
 * mà cả hai đều sạch sẽ không tự sinh ra nghi ngờ.
 */
function pairPressure(state: BotBrainState, targetId: string): number {
  let best = 0;
  for (const otherId of Object.keys(state.suspicion).sort()) {
    if (otherId === targetId) continue;
    const other = state.suspicion[otherId];
    if (!other || other.reasons.length === 0) continue;
    best = Math.max(best, possibleWolfPairScore(state, targetId, otherId) * (other.score / 100));
  }
  return best;
}

interface ScoredTarget {
  targetId: string;
  score: number;
  evidence: BotEvidence[];
  topConfidence: number;
}

function noEliminationIntention(confidence: number): BotVoteIntention {
  return {
    kind: "VOTE",
    choice: { type: "NO_ELIMINATION" },
    confidence: clampUnit(confidence),
    evidence: [],
  };
}

/**
 * Chấm điểm mọi lựa chọn hợp lệ rồi trả về một ý định có bằng chứng thật.
 *
 * Hàm này thuần: cùng context, cùng state và cùng RNG thì cùng kết quả. Nó
 * không bao giờ nhận `GameState` hay `Room`, và không bao giờ bịa ra một mục
 * tiêu không nằm trong `legalVoteChoices` mà engine đã cấp.
 */
export function selectVote(
  context: BotDecisionContext,
  state: BotBrainState,
  rng: BotRng,
): BotVoteIntention {
  const knowledge = context.knowledge;
  const personality = state.personality;
  const selfIsWolf =
    knowledge.knownRoles[state.playerId] === "WEREWOLF" ||
    knowledge.knownRoles[state.playerId] === "WOLF_CUB";
  const threshold = voteThreshold(personality);

  const scored: ScoredTarget[] = [];
  for (const choice of knowledge.legalVoteChoices) {
    if (choice.type !== "PLAYER") continue;
    // Engine cho phép tự bầu mình, nhưng một BOT tự đề cử mình là hành vi vô
    // nghĩa; luật vẫn được báo cáo trung thực ở knowledge view.
    if (choice.targetId === state.playerId) continue;

    const belief = state.suspicion[choice.targetId];
    const reasons = belief?.reasons ?? [];
    const topConfidence = reasons.reduce((max, item) => Math.max(max, item.confidence), 0);

    let score =
      (belief?.score ?? 0) +
      topConfidence * EVIDENCE_CONFIDENCE_BONUS +
      incomingHostility(state, choice.targetId) * HOSTILITY_BONUS +
      pairPressure(state, choice.targetId) * PAIR_BONUS -
      (state.trust[choice.targetId]?.score ?? 0) * TRUST_DAMPING;

    // Phase 1 chỉ có teammate-safety penalty đơn giản; bussing thuộc Phase 3.
    const targetRole = knowledge.knownRoles[choice.targetId];
    const targetIsWolf = targetRole === "WEREWOLF" || targetRole === "WOLF_CUB";
    if (selfIsWolf && targetIsWolf) {
      score -= 25 + personality.loyalty * 30;
    }

    score += (rng() - 0.5) * JITTER_SPAN;

    scored.push({
      targetId: choice.targetId,
      score,
      evidence: reasons.slice(-MAX_INTENTION_EVIDENCE),
      topConfidence,
    });
  }

  // Sắp xếp có tie-break theo id để hai lần chạy giống hệt nhau không phụ thuộc
  // thứ tự chèn của bảng belief.
  scored.sort((left, right) =>
    right.score === left.score
      ? left.targetId.localeCompare(right.targetId)
      : right.score - left.score,
  );

  const best = scored[0];
  if (!best) return noEliminationIntention(1);

  let winner = best;
  const myVote = knowledge.myVote;
  if (myVote && myVote.type === "PLAYER") {
    const current = scored.find((item) => item.targetId === myVote.targetId);
    const currentQualifies =
      current !== undefined && current.evidence.length > 0 && current.score >= threshold;
    if (
      currentQualifies &&
      winner.targetId !== current.targetId &&
      winner.score < current.score + voteHysteresis(personality)
    ) {
      winner = current;
    }
  }

  // Một mục tiêu dẫn đầu chỉ nhờ jitter mà không có lý do nào thì không đáng
  // để treo: BOT chọn không treo thay vì bịa một cáo buộc không nguồn.
  if (winner.score < threshold || winner.evidence.length === 0) {
    return noEliminationIntention((threshold - best.score) / Math.max(1, threshold));
  }

  const normalized = clampUnit((winner.score - threshold) / Math.max(1, 100 - threshold));
  const choice: PublicVoteChoice = { type: "PLAYER", targetId: winner.targetId };
  return {
    kind: "VOTE",
    choice,
    confidence: clampUnit((normalized + winner.topConfidence) / 2),
    evidence: winner.evidence.map((item) => ({ ...item })),
  };
}
