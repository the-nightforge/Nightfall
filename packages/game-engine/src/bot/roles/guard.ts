import type { Role } from "@masoi/shared";
import { incomingHostilityOf } from "../analysis/social-analysis";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { sumTerms, type TraceTerm } from "../trace/trace";
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

    decideNight(context, state, rng, probe) {
      const night = context.knowledge.night;
      if (!night || !night.legalActions.includes("GUARD")) {
        probe?.fallback("không có lượt đỡ nào đang mở");
        return null;
      }

      // `legalTargets.GUARD` đã loại `guardPrevious` ở engine; lọc lại để chiến
      // thuật không phụ thuộc vào việc engine nhớ làm điều đó.
      const candidates = night.legalTargets.GUARD.filter(
        (id) => id !== night.guardPrevious,
      );
      if (candidates.length === 0) {
        probe?.fallback("không còn ai để đỡ ngoài mục tiêu của đêm trước");
        return null;
      }

      const me = context.knowledge.botId;
      const selfHostility = incomingHostilityOf(state, me);
      const tuning = weights.selfPreservation;

      // Ai đã được đỡ gần đây. Bảo Vệ luôn chọn "người đáng tin nhất" sẽ đỡ đúng
      // một người gần như mọi đêm, và bầy Sói đọc được mẫu đó sau hai vòng -
      // lúc đó vai Bảo Vệ tự chỉ vào mình bằng chính lịch trình của nó.
      const guardedBefore = new Set(
        state.previousNightActions
          .filter((entry) => entry.action === "GUARD" && entry.targetId !== null)
          .map((entry) => entry.targetId as string),
      );

      const scored = candidates
        .map((targetId) => {
          const trust = state.trust[targetId]?.score ?? 0;
          const suspicion = state.suspicion[targetId]?.score ?? 0;
          const selfBonus =
            targetId === me && selfHostility >= tuning.guardSelfHostilityThreshold
              ? tuning.guardSelfBonusBase + selfHostility * tuning.guardSelfBonusSpan
              : 0;
          // Đỡ người mình nghi là Sói thì vừa phí lượt vừa cứu nhầm phe.
          const terms: TraceTerm[] = [
            { name: "trust", value: trust },
            { name: "suspicionPenalty", value: -(suspicion * tuning.guardSuspicionPenalty) },
            { name: "selfPreservation", value: selfBonus },
            {
              name: "repeatPenalty",
              value: guardedBefore.has(targetId) ? -tuning.guardRepeatPenalty : 0,
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
