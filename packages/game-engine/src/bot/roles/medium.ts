import type { Role } from "@masoi/shared";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { sumTerms, type TraceTerm } from "../trace/trace";
import { nightEvidence, type BotRoleStrategy } from "./strategy";

/**
 * Bà Đồng gọi hồn người đã chết mà LỜI KHAI của họ còn đang treo.
 *
 * Kỹ năng này không cứu được ai và không chỉ ra được mối nguy nào đang sống,
 * nên giá trị duy nhất của nó là ĐÓNG một câu hỏi mà cả làng đang cãi: người
 * vừa chết ấy có nói thật về vai của mình không. Vì vậy thứ tự ưu tiên là
 * người còn để lại tranh cãi lớn nhất, không phải người chết gần nhất.
 *
 * Không có `informationValue` như Thám Tử: thang đó chấm theo độ mơ hồ về PHE
 * của một người còn sống, còn ở đây mục tiêu đã chết và câu hỏi là về lời khai.
 */
export function mediumStrategy(
  _role: Role = "MEDIUM",
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotRoleStrategy {
  return {
    role: "MEDIUM",

    decideNight(context, state, rng, probe) {
      const night = context.knowledge.night;
      if (!night || !night.legalActions.includes("MEDIUM_CHECK")) {
        // Đêm 1 nghĩa địa còn trống, và engine không chào hành động nào cả.
        probe?.fallback("chưa có ai đã khuất để gọi hồn");
        return null;
      }

      const candidates = night.legalTargets.MEDIUM_CHECK;
      if (candidates.length === 0) {
        probe?.fallback("danh sách người đã khuất rỗng");
        return null;
      }

      const claims = context.knowledge.dayOfTruthClaims ?? {};

      const ranked = candidates
        .map((targetId) => {
          // Người từng khai một vai là người có gì đó để kiểm chứng; người chết
          // lặng lẽ thì gọi hồn lên cũng không giải quyết được tranh cãi nào.
          const claimed = claims[targetId] ? weights.nightConfidence.detective : 0;
          const terms: TraceTerm[] = [
            { name: "hadRoleClaim", value: claimed },
            { name: "suspicion", value: state.suspicion[targetId]?.score ?? 0 },
            { name: "jitter", value: (rng() - 0.5) * weights.confidence.jitterSpan },
          ];
          const score = sumTerms(terms);
          probe?.candidate({ targetId, score, terms, evidenceIds: [] });
          return { targetId, score };
        })
        .sort((a, b) => b.score - a.score || a.targetId.localeCompare(b.targetId));

      const winner = ranked[0];
      return {
        kind: "NIGHT_ACTION",
        action: "MEDIUM_CHECK",
        targetId: winner.targetId,
        confidence: weights.nightConfidence.detective,
        evidence: [
          nightEvidence(
            "ACCUSE",
            context.knowledge.round,
            winner.targetId,
            "gọi hồn để biết vai thật của người đã khuất",
            0,
            weights,
          ),
        ],
      };
    },

    voteBias: () => ({}),
  };
}
