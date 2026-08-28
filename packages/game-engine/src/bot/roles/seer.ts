import type { Role } from "@masoi/shared";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { sumTerms, type TraceTerm } from "../trace/trace";
import { nightEvidence, type BotRoleStrategy } from "./strategy";
import { informationValue } from "./uncertainty";

/**
 * Tiên Tri soi người CÓ ÍCH NHẤT ĐỂ BIẾT, không phải người đáng ngờ nhất.
 *
 * Soi người đã gần chắc là Sói gần như không đổi được gì: làng đang định treo
 * họ rồi. Soi người đã chắc chắn trong sạch còn tệ hơn. Giá trị thông tin cao
 * nhất nằm ở giữa - người mà kết quả có thể lật theo cả hai hướng.
 *
 * `role` là tham số để Tiên Tri Tập Sự đã thức tỉnh dùng lại nguyên chiến lược
 * này - lúc đó kỹ năng của hai vai là một. Trước khi thức tỉnh, engine trả
 * `night: null` nên strategy không bao giờ được hỏi.
 */
export function seerStrategy(
  role: Role = "SEER",
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotRoleStrategy {
  return {
    role,

    decideNight(context, state, rng, probe) {
      const night = context.knowledge.night;
      if (!night || !night.legalActions.includes("SEE")) {
        probe?.fallback("không có lượt soi nào đang mở");
        return null;
      }

      const alreadySeen = new Set(
        state.knownInformation.seerResults
          .map((memory) => memory.targetId)
          .filter((id): id is string => id !== undefined),
      );

      const candidates = night.legalTargets.SEE.filter((id) => !alreadySeen.has(id));
      if (candidates.length === 0) {
        probe?.fallback("đã soi hết mọi mục tiêu hợp lệ");
        return null;
      }

      const scored = candidates
        .map((targetId) => {
          const terms: TraceTerm[] = [
            {
              name: "informationValue",
              value: informationValue(state.suspicion[targetId]?.score ?? 0, weights),
            },
            { name: "jitter", value: (rng() - 0.5) * weights.confidence.jitterSpan },
          ];
          const score = sumTerms(terms);
          probe?.candidate({ targetId, score, terms, evidenceIds: [] });
          return { targetId, score };
        })
        .sort((a, b) => b.score - a.score || a.targetId.localeCompare(b.targetId));

      const winner = scored[0];
      return {
        kind: "NIGHT_ACTION",
        action: "SEE",
        targetId: winner.targetId,
        confidence: weights.nightConfidence.seer,
        evidence: [
          nightEvidence(
            "ACCUSE",
            context.knowledge.round,
            winner.targetId,
            "chưa rõ phe nên soi để biết",
            0,
            weights,
          ),
        ],
      };
    },

    voteBias: () => ({}),
  };
}
