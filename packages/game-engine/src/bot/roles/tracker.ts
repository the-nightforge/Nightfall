import type { Role } from "@masoi/shared";
import { incomingHostilityOf } from "../analysis/social-analysis";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { sumTerms, type TraceTerm } from "../trace/trace";
import { nightEvidence, type BotRoleStrategy } from "./strategy";

/**
 * Kẻ Theo Dõi không cứu ai - nó đi tìm XÁC NHẬN. Vì vậy chấm điểm ngược hẳn một
 * vai đỡ đòn: vai đỡ đòn ưu tiên người đáng TIN để che, còn ở đây ưu tiên người
 * đáng NGỜ để theo dõi. Dùng lại đúng hai tín hiệu sẵn có (suspicion,
 * incomingHostilityOf) thay vì bịa tín hiệu mới - chỉ đổi suspicion từ khoản
 * phạt (âm) thành khoản thưởng (dương).
 *
 * Không có ngưỡng "đáng để tiêu lượt": TRACK không phải tài nguyên khan hiếm
 * dùng vài lần cả ván (Task 2), nên còn mục tiêu hợp lệ là dùng. Cũng không lọc
 * "mục tiêu đêm trước" như Bảo Vệ lọc `guardPrevious` - luật cố ý CHO PHÉP theo
 * dõi lặp lại đúng một người ở hai đêm liên tiếp.
 */
export function trackerStrategy(
  _role: Role = "TRACKER",
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotRoleStrategy {
  return {
    role: "TRACKER",

    decideNight(context, state, rng, probe) {
      const night = context.knowledge.night;
      if (!night || !night.legalActions.includes("TRACK")) {
        probe?.fallback("không có lượt theo dõi nào đang mở");
        return null;
      }

      const candidates = night.legalTargets.TRACK;
      if (candidates.length === 0) {
        probe?.fallback("không còn ai để theo dõi");
        return null;
      }

      const ranked = candidates
        .map((targetId) => {
          const terms: TraceTerm[] = [
            { name: "suspicion", value: state.suspicion[targetId]?.score ?? 0 },
            { name: "incomingHostility", value: incomingHostilityOf(state, targetId) },
          ];
          const score = sumTerms(terms);
          probe?.candidate({ targetId, score, terms, evidenceIds: [] });
          return { targetId, score };
        })
        // Tie-break theo id để cùng seed luôn ra cùng kết quả.
        .sort((a, b) => (b.score === a.score ? a.targetId.localeCompare(b.targetId) : b.score - a.score));

      const best = ranked[0]!;

      return {
        kind: "NIGHT_ACTION",
        action: "TRACK",
        targetId: best.targetId,
        confidence: weights.nightConfidence.tracker,
        evidence: [
          nightEvidence(
            "ACCUSE",
            context.knowledge.round,
            best.targetId,
            "đáng ngờ nhất nên theo dõi để xác nhận",
            0,
            weights,
          ),
        ],
      };
    },

    voteBias: () => ({}),
  };
}
