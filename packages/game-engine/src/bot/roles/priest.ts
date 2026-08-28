import type { Role } from "@masoi/shared";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { nightEvidence, type BotRoleStrategy } from "./strategy";

/**
 * Nước thánh là kỹ năng có phản đòn: trúng Sói thì Sói chết, trúng Dân thì
 * chính LINH MỤC chết.
 *
 * Đây là lý do ngưỡng ở đây cao hơn cả bình độc của Phù Thuỷ. Phù Thuỷ độc
 * nhầm thì mất một người; Linh Mục ném nhầm thì mất luôn chính mình VÀ người
 * bị ném vẫn sống. Dùng bừa là tự sát, nên mặc định là GIỮ BÌNH.
 */
export function priestStrategy(
  _role: Role = "PRIEST",
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotRoleStrategy {
  const tuning = weights.roleThresholds;

  return {
    role: "PRIEST",

    decideNight(context, state) {
      const night = context.knowledge.night;
      if (!night || !night.legalActions.includes("HOLY_WATER")) return null;

      const ranked = night.legalTargets.HOLY_WATER.filter(
        (id) => id !== context.knowledge.botId,
      )
        .map((targetId) => ({
          targetId,
          suspicion: state.suspicion[targetId]?.score ?? 0,
          trust: state.trust[targetId]?.score ?? 0,
        }))
        .filter(
          (item) =>
            item.suspicion >= tuning.priestSuspicion &&
            item.trust < tuning.priestTrustVeto,
        )
        .sort((a, b) => b.suspicion - a.suspicion || a.targetId.localeCompare(b.targetId));

      // Giữ bình. `null` ở đây là một quyết định, không phải một lượt hỏng.
      if (ranked.length === 0) return null;

      return {
        kind: "NIGHT_ACTION",
        action: "HOLY_WATER",
        targetId: ranked[0].targetId,
        confidence: weights.nightConfidence.priest,
        evidence: [
          nightEvidence(
            "ACCUSE",
            context.knowledge.round,
            ranked[0].targetId,
            "gần như chắc chắn là Sói nên đáng để ném Nước thánh",
            0,
            weights,
          ),
        ],
      };
    },

    voteBias: () => ({}),
  };
}
