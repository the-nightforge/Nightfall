import { nightEvidence, type BotRoleStrategy } from "./strategy";

/**
 * Tiên Tri soi người CÓ ÍCH NHẤT ĐỂ BIẾT, không phải người đáng ngờ nhất.
 *
 * Soi người đã gần chắc là Sói gần như không đổi được gì: làng đang định treo
 * họ rồi. Soi người đã chắc chắn trong sạch còn tệ hơn. Giá trị thông tin cao
 * nhất nằm ở giữa - người mà kết quả có thể lật theo cả hai hướng.
 */
const MOST_INFORMATIVE_SUSPICION = 50;

export function seerStrategy(): BotRoleStrategy {
  return {
    role: "SEER",

    decideNight(context, state, rng) {
      const night = context.knowledge.night;
      if (!night || !night.legalActions.includes("SEE")) return null;

      const alreadySeen = new Set(
        state.knownInformation.seerResults
          .map((memory) => memory.targetId)
          .filter((id): id is string => id !== undefined),
      );

      const candidates = night.legalTargets.SEE.filter((id) => !alreadySeen.has(id));
      if (candidates.length === 0) return null;

      const scored = candidates
        .map((targetId) => {
          const suspicion = state.suspicion[targetId]?.score ?? 0;
          // Càng gần mốc "chưa rõ" thì càng đáng soi.
          const uncertainty = 100 - Math.abs(suspicion - MOST_INFORMATIVE_SUSPICION) * 2;
          return { targetId, score: uncertainty + (rng() - 0.5) * 6 };
        })
        .sort((a, b) => b.score - a.score || a.targetId.localeCompare(b.targetId));

      const winner = scored[0];
      return {
        kind: "NIGHT_ACTION",
        action: "SEE",
        targetId: winner.targetId,
        confidence: 0.7,
        evidence: [
          nightEvidence(
            "ACCUSE",
            context.knowledge.round,
            winner.targetId,
            "chưa rõ phe nên soi để biết",
          ),
        ],
      };
    },

    voteBias: () => ({}),
  };
}
