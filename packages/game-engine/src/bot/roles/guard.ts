import { incomingHostilityOf } from "../analysis/social-analysis";
import { nightEvidence, type BotRoleStrategy } from "./strategy";

/**
 * Ngưỡng thù địch mà trên đó Bảo Vệ coi chính mình là mục tiêu đêm nay.
 *
 * Người bị cả làng công kích ban ngày là người bầy Sói cũng muốn loại - hoặc vì
 * họ nguy hiểm, hoặc vì giết họ dễ đổ tội. Khi đó tự đỡ là nước đúng.
 */
const SELF_GUARD_HOSTILITY = 0.5;

export function guardStrategy(): BotRoleStrategy {
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

      const scored = candidates
        .map((targetId) => {
          const trust = state.trust[targetId]?.score ?? 0;
          const suspicion = state.suspicion[targetId]?.score ?? 0;
          const selfBonus =
            targetId === me && selfHostility >= SELF_GUARD_HOSTILITY
              ? 60 + selfHostility * 60
              : 0;
          // Đỡ người mình nghi là Sói thì vừa phí lượt vừa cứu nhầm phe.
          return {
            targetId,
            score: trust - suspicion * 0.5 + selfBonus + (rng() - 0.5) * 6,
          };
        })
        .sort((a, b) => b.score - a.score || a.targetId.localeCompare(b.targetId));

      const winner = scored[0];
      return {
        kind: "NIGHT_ACTION",
        action: "GUARD",
        targetId: winner.targetId,
        confidence: 0.6,
        evidence: [
          nightEvidence(
            "DEFEND",
            context.knowledge.round,
            winner.targetId,
            winner.targetId === me ? "tự đỡ vì đang bị nhắm" : "đỡ người đáng tin nhất",
          ),
        ],
      };
    },

    voteBias: () => ({}),
  };
}
