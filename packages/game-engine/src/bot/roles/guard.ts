import type { Role } from "@masoi/shared";
import { incomingHostilityOf } from "../analysis/social-analysis";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { nightEvidence, type BotRoleStrategy } from "./strategy";

/**
 * Bảo Vệ đỡ người đáng tin nhất, và tự đỡ khi chính mình đang bị nhắm.
 *
 * Người bị cả làng công kích ban ngày là người bầy Sói cũng muốn loại - hoặc vì
 * họ nguy hiểm, hoặc vì giết họ dễ đổ tội. Khi đó tự đỡ là nước đúng.
 */
export function guardStrategy(
  _role: Role = "GUARD",
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotRoleStrategy {
  return {
    role: "GUARD",

    decideNight(context, state, rng) {
      const night = context.knowledge.night;
      if (!night || !night.legalActions.includes("GUARD")) return null;

      // `legalTargets.GUARD` đã loại `guardPrevious` ở engine; lọc lại để chiến
      // thuật không phụ thuộc vào việc engine nhớ làm điều đó.
      const candidates = night.legalTargets.GUARD.filter(
        (id) => id !== night.guardPrevious,
      );
      if (candidates.length === 0) return null;

      const me = context.knowledge.botId;
      const selfHostility = incomingHostilityOf(state, me);
      const tuning = weights.selfPreservation;

      const scored = candidates
        .map((targetId) => {
          const trust = state.trust[targetId]?.score ?? 0;
          const suspicion = state.suspicion[targetId]?.score ?? 0;
          const selfBonus =
            targetId === me && selfHostility >= tuning.guardSelfHostilityThreshold
              ? tuning.guardSelfBonusBase + selfHostility * tuning.guardSelfBonusSpan
              : 0;
          // Đỡ người mình nghi là Sói thì vừa phí lượt vừa cứu nhầm phe.
          return {
            targetId,
            score:
              trust -
              suspicion * tuning.guardSuspicionPenalty +
              selfBonus +
              (rng() - 0.5) * weights.confidence.jitterSpan,
          };
        })
        .sort((a, b) => b.score - a.score || a.targetId.localeCompare(b.targetId));

      const winner = scored[0];
      return {
        kind: "NIGHT_ACTION",
        action: "GUARD",
        targetId: winner.targetId,
        confidence: weights.nightConfidence.guard,
        evidence: [
          nightEvidence(
            "DEFEND",
            context.knowledge.round,
            winner.targetId,
            winner.targetId === me ? "tự đỡ vì đang bị nhắm" : "đỡ người đáng tin nhất",
            0,
            weights,
          ),
        ],
      };
    },

    voteBias: () => ({}),
  };
}
