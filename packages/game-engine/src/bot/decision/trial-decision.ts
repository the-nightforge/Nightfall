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

/**
 * Phát bắn của Thợ Săn phải chắc hơn một lá phiếu thường.
 *
 * Phiếu đề cử còn qua được một vòng biện hộ và một phiên toà; phát bắn thì giết
 * ngay lập tức, không ai kiểm tra lại. Vì vậy ngưỡng cao hơn hẳn.
 */
const HUNTER_MARGIN = 20;

function isKnownAlly(context: BotDecisionContext, playerId: string): boolean {
  const knowledge = context.knowledge;
  const selfIsWolf = knowledge.knownRoles[knowledge.botId] === "WEREWOLF";
  return selfIsWolf && knowledge.knownRoles[playerId] === "WEREWOLF";
}

/**
 * Treo hay Tha.
 *
 * Mặc định là THA. Mặc định Treo sẽ biến mỗi phiên toà thành một vụ hành quyết:
 * phe làng đông hơn nên chính họ chịu thiệt, và Sói thắng bằng bào mòn mà không
 * cần làm gì. Chỉ bằng chứng đủ mạnh mới lật được mặc định đó.
 */
export function decideFinalVote(
  context: BotDecisionContext,
  state: BotBrainState,
  rng: BotRng,
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
  const score = entry?.score ?? 0;
  const threshold = voteThreshold(state.personality);
  const guilty = score >= threshold;

  return {
    kind: "FINAL_VOTE",
    guilty,
    confidence: Math.min(1, Math.abs(score - threshold) / Math.max(1, threshold)),
    // Chỉ mang theo lý do khi thật sự kết tội; một phiếu Tha không cần bằng chứng.
    evidence: guilty ? (entry?.reasons ?? []).slice(-3).map((item) => ({ ...item })) : [],
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
): BotHunterShotIntention {
  const shot = context.knowledge.hunterShot;
  void rng;

  if (!shot || !shot.canAct) {
    return { kind: "HUNTER_SHOT", targetId: null, confidence: 1, evidence: [] };
  }

  const threshold = voteThreshold(state.personality) + HUNTER_MARGIN;

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
    confidence: Math.min(1, winner.score / 100),
    evidence: (state.suspicion[winner.targetId]?.reasons ?? [])
      .slice(-3)
      .map((item) => ({ ...item })),
  };
}
