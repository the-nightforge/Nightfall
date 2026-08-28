import type { Role } from "@masoi/shared";
import { incomingHostilityOf } from "../analysis/social-analysis";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { nightEvidence, type BotRoleStrategy } from "./strategy";

/**
 * Thiên Thần Hộ Mệnh chỉ có HAI lượt cả ván, nên nó đắt hơn Bảo Vệ nhiều.
 *
 * Bảo Vệ đỡ mỗi đêm nên đỡ hụt chỉ tốn một đêm; Thiên Thần đỡ hụt là tốn nửa
 * số lượt mình có. Vì vậy ngưỡng ở đây cao hơn: chỉ đỡ khi có người rõ ràng
 * đang là mục tiêu, chứ không đỡ "người đáng tin nhất" một cách chung chung.
 */
export function guardianAngelStrategy(
  _role: Role = "GUARDIAN_ANGEL",
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotRoleStrategy {
  return {
    role: "GUARDIAN_ANGEL",

    decideNight(context, state, rng) {
      const night = context.knowledge.night;
      if (!night || !night.legalActions.includes("GUARDIAN_PROTECT")) return null;

      const candidates = night.legalTargets.GUARDIAN_PROTECT.filter(
        (id) => id !== night.guardPrevious,
      );
      if (candidates.length === 0) return null;

      const ranked = candidates
        .map((targetId) => {
          const trust = state.trust[targetId]?.score ?? 0;
          const suspicion = state.suspicion[targetId]?.score ?? 0;
          // Ai đang bị cả làng công kích cũng là người bầy Sói muốn loại.
          const hostility = incomingHostilityOf(state, targetId);
          return {
            targetId,
            hostility,
            score:
              trust -
              suspicion * weights.roleThresholds.guardianAngelSuspicionPenalty +
              hostility * weights.roleThresholds.guardianAngelHostilityBonus +
              (rng() - 0.5) * weights.confidence.jitterSpan,
          };
        })
        .sort((a, b) => b.score - a.score || a.targetId.localeCompare(b.targetId));

      const best = ranked[0];
      // Không có ai đáng để tiêu một lượt thì giữ lại. Một lượt còn nguyên ở
      // đêm sau đáng giá hơn một lượt đỡ bừa đêm nay.
      const worthIt =
        best.hostility >= weights.roleThresholds.guardianAngelWorthACharge ||
        (state.trust[best.targetId]?.score ?? 0) > 0;
      if (!worthIt) return null;

      return {
        kind: "NIGHT_ACTION",
        action: "GUARDIAN_PROTECT",
        targetId: best.targetId,
        confidence: weights.nightConfidence.guardianAngel,
        evidence: [
          nightEvidence(
            "DEFEND",
            context.knowledge.round,
            best.targetId,
            "đang bị nhắm nên đáng để tiêu một lượt hộ mệnh",
            0,
            weights,
          ),
        ],
      };
    },

    voteBias: () => ({}),
  };
}
