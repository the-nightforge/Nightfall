import { MAX_BELIEF_SCORE } from "../belief/evidence";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import type {
  BotBrainState,
  BotDecisionContext,
  BotEvidence,
  BotRng,
} from "../types";
import { voteThreshold } from "./vote-decision";

export interface BotFinalVoteIntention {
  kind: "FINAL_VOTE";
  guilty: boolean;
  confidence: number;
  evidence: BotEvidence[];
}

export interface BotHunterShotIntention {
  kind: "HUNTER_SHOT";
  targetId: string | null;
  confidence: number;
  evidence: BotEvidence[];
}

function isKnownAlly(context: BotDecisionContext, playerId: string): boolean {
  const knowledge = context.knowledge;
  const selfIsWolf = knowledge.knownRoles[knowledge.botId] === "WEREWOLF";
  return selfIsWolf && knowledge.knownRoles[playerId] === "WEREWOLF";
}

/**
 * Treo hay Tha.
 *
 * Mặc định là TREO, và mặc định đó được đổi lại sau khi có dữ liệu.
 *
 * Thiết kế ban đầu của Phase 2 chọn mặc định THA, với lý do "mặc định Treo biến
 * mỗi phiên toà thành một vụ hành quyết". Harness ở Task 9 bác bỏ điều đó: với
 * mặc định THA, phe làng thua 30/30 ván. Lý do là một vòng lặp chết - không ai
 * bị kết án, nên không có lịch sử phiếu để sinh bằng chứng, nên nghi ngờ mãi
 * bằng 0, nên không ai bị kết án.
 *
 * Điều bị bỏ sót: tới được phiên toà nghĩa là đa số làng ĐÃ chỉ vào người này.
 * Tha vì bản thân mình chưa có bằng chứng riêng là vứt bỏ phán đoán tập thể và
 * tiêu một ngày, trong khi mỗi đêm làng vẫn mất một người.
 *
 * Nên luật đúng là: TREO, trừ khi có lý do TÍCH CỰC để tin người này vô tội -
 * Tiên Tri đã soi sạch, hoặc đó là đồng đội mình.
 */
export function decideFinalVote(
  context: BotDecisionContext,
  state: BotBrainState,
  rng: BotRng,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotFinalVoteIntention {
  const accusedId = context.knowledge.trialAccusedId;
  void rng;

  if (!accusedId) {
    return { kind: "FINAL_VOTE", guilty: false, confidence: 1, evidence: [] };
  }

  // Sói không bao giờ giúp treo đồng bọn, bất kể bằng chứng công khai nói gì.
  if (isKnownAlly(context, accusedId)) {
    return { kind: "FINAL_VOTE", guilty: false, confidence: 1, evidence: [] };
  }

  const entry = state.suspicion[accusedId];
  const suspicion = entry?.score ?? 0;
  const trust = state.trust[accusedId]?.score ?? 0;

  // Chỉ tin tưởng CÓ CƠ SỞ mới cứu được bị cáo. `trust` chỉ lên cao khi có
  // nguồn thật: kết quả soi, hoặc nhiều lần được người khác bênh.
  const guilty = trust < suspicion + weights.confidence.spareTrustMargin;

  return {
    kind: "FINAL_VOTE",
    guilty,
    confidence: Math.min(1, Math.abs(trust - suspicion) / MAX_BELIEF_SCORE),
    // Chỉ mang theo lý do khi thật sự kết tội; một phiếu Tha không cần bằng chứng.
    evidence: guilty
      ? (entry?.reasons ?? [])
          .slice(-weights.limits.intentionEvidence)
          .map((item) => ({ ...item }))
      : [],
  };
}

/**
 * Phát bắn cuối của Thợ Săn.
 *
 * `null` là kết quả tốt và thường gặp: bắn bừa lúc chết là cách nhanh nhất để
 * phe làng tự sát, vì Thợ Săn chết thường có nghĩa là họ đang thiếu thông tin
 * nhất chứ không phải nhiều nhất.
 */
export function decideHunterShot(
  context: BotDecisionContext,
  state: BotBrainState,
  rng: BotRng,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotHunterShotIntention {
  const shot = context.knowledge.hunterShot;
  void rng;

  if (!shot || !shot.canAct) {
    return { kind: "HUNTER_SHOT", targetId: null, confidence: 1, evidence: [] };
  }

  const threshold =
    voteThreshold(state.personality, weights) + weights.confidence.hunterMargin;

  const scored = shot.legalTargets
    .filter((id) => id !== context.knowledge.botId && !isKnownAlly(context, id))
    .map((targetId) => ({ targetId, score: state.suspicion[targetId]?.score ?? 0 }))
    .filter((item) => item.score >= threshold)
    .sort((a, b) => b.score - a.score || a.targetId.localeCompare(b.targetId));

  if (scored.length === 0) {
    return { kind: "HUNTER_SHOT", targetId: null, confidence: 1, evidence: [] };
  }

  const winner = scored[0];
  return {
    kind: "HUNTER_SHOT",
    targetId: winner.targetId,
    confidence: Math.min(1, winner.score / MAX_BELIEF_SCORE),
    evidence: (state.suspicion[winner.targetId]?.reasons ?? [])
      .slice(-weights.limits.intentionEvidence)
      .map((item) => ({ ...item })),
  };
}
