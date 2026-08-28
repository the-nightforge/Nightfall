import type { Role } from "@masoi/shared";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { nightEvidence, type BotRoleStrategy } from "./strategy";

/**
 * Hai bình dùng ĐÚNG MỘT LẦN cả ván, nên ngưỡng phải cao.
 *
 * Tiêu một bình vì không nghĩ ra việc gì hay hơn là cách chắc chắn nhất để
 * không còn nó vào lúc thật sự cần. Vì vậy mặc định của Phù Thuỷ là SKIP, và
 * ba ngưỡng trong `roleThresholds` là điều kiện để phá lệ.
 */
export function witchStrategy(
  _role: Role = "WITCH",
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotRoleStrategy {
  const tuning = weights.roleThresholds;

  return {
    role: "WITCH",

    decideNight(context, state) {
      const night = context.knowledge.night;
      if (!night) return null;

      const round = context.knowledge.round;

      // --- Bình cứu ---
      // Chỉ được chào HEAL khi engine xác nhận có nạn nhân và bình còn.
      if (night.legalActions.includes("HEAL") && night.wolfTarget) {
        const victim = night.wolfTarget;
        const trust = state.trust[victim]?.score ?? 0;
        const suspicion = state.suspicion[victim]?.score ?? 0;
        // Cứu chính mình luôn đáng, kể cả khi chưa có dữ liệu về ai.
        const isSelf = victim === context.knowledge.botId;

        if (isSelf || (trust >= tuning.witchHealTrust && trust > suspicion)) {
          return {
            kind: "NIGHT_ACTION",
            action: "HEAL",
            // Engine không nhận mục tiêu cho bình cứu: nó luôn cứu nạn nhân đêm đó.
            targetId: null,
            confidence: weights.nightConfidence.witchHeal,
            evidence: [
              nightEvidence(
                "DEFEND",
                round,
                victim,
                "cứu nạn nhân đáng tin của đêm nay",
                0,
                weights,
              ),
            ],
          };
        }
      }

      // --- Bình độc ---
      if (night.legalActions.includes("POISON")) {
        const scored = night.legalTargets.POISON.filter(
          (id) => id !== context.knowledge.botId,
        )
          .map((targetId) => ({
            targetId,
            suspicion: state.suspicion[targetId]?.score ?? 0,
            trust: state.trust[targetId]?.score ?? 0,
          }))
          .filter(
            (item) =>
              item.suspicion >= tuning.witchPoisonSuspicion &&
              item.trust < tuning.witchPoisonTrustVeto,
          )
          .sort(
            (a, b) => b.suspicion - a.suspicion || a.targetId.localeCompare(b.targetId),
          );

        if (scored.length > 0) {
          return {
            kind: "NIGHT_ACTION",
            action: "POISON",
            targetId: scored[0].targetId,
            confidence: weights.nightConfidence.witchPoison,
            evidence: [
              nightEvidence(
                "ACCUSE",
                round,
                scored[0].targetId,
                "gần như chắc chắn là Sói nên dùng bình độc",
                0,
                weights,
              ),
            ],
          };
        }
      }

      if (!night.legalActions.includes("SKIP")) return null;
      return {
        kind: "NIGHT_ACTION",
        action: "SKIP",
        targetId: null,
        confidence: weights.nightConfidence.witchSkip,
        evidence: [],
      };
    },

    voteBias: () => ({}),
  };
}
