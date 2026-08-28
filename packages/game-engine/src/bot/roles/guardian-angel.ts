import { incomingHostilityOf } from "../analysis/social-analysis";
import { nightEvidence, type BotRoleStrategy } from "./strategy";

/**
 * Thiên Thần Hộ Mệnh chỉ có HAI lượt cả ván, nên nó đắt hơn Bảo Vệ nhiều.
 *
 * Bảo Vệ đỡ mỗi đêm nên đỡ hụt chỉ tốn một đêm; Thiên Thần đỡ hụt là tốn nửa
 * số lượt mình có. Vì vậy ngưỡng ở đây cao hơn: chỉ đỡ khi có người rõ ràng
 * đang là mục tiêu, chứ không đỡ "người đáng tin nhất" một cách chung chung.
 */
const WORTH_A_CHARGE = 0.35;

export function guardianAngelStrategy(): BotRoleStrategy {
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
            score: trust - suspicion * 0.5 + hostility * 80 + (rng() - 0.5) * 6,
          };
        })
        .sort((a, b) => b.score - a.score || a.targetId.localeCompare(b.targetId));

      const best = ranked[0];
      // Không có ai đáng để tiêu một lượt thì giữ lại. Một lượt còn nguyên ở
      // đêm sau đáng giá hơn một lượt đỡ bừa đêm nay.
      const worthIt =
        best.hostility >= WORTH_A_CHARGE ||
        (state.trust[best.targetId]?.score ?? 0) > 0;
      if (!worthIt) return null;

      return {
        kind: "NIGHT_ACTION",
        action: "GUARDIAN_PROTECT",
        targetId: best.targetId,
        confidence: 0.6,
        evidence: [
          nightEvidence(
            "DEFEND",
            context.knowledge.round,
            best.targetId,
            "đang bị nhắm nên đáng để tiêu một lượt hộ mệnh",
          ),
        ],
      };
    },

    voteBias: () => ({}),
  };
}
