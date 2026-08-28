import { nightEvidence, type BotRoleStrategy } from "./strategy";

/**
 * Hai bình dùng ĐÚNG MỘT LẦN cả ván, nên ngưỡng phải cao.
 *
 * Tiêu một bình vì không nghĩ ra việc gì hay hơn là cách chắc chắn nhất để
 * không còn nó vào lúc thật sự cần. Vì vậy mặc định của Phù Thuỷ là SKIP, và
 * hai hằng số dưới đây là điều kiện để phá lệ.
 */
const HEAL_TRUST_THRESHOLD = 40;
const POISON_SUSPICION_THRESHOLD = 85;
/** Trên mức này thì dù nghi tới đâu cũng không độc: rủi ro giết nhầm quá lớn. */
const POISON_TRUST_VETO = 50;

export function witchStrategy(): BotRoleStrategy {
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

        if (isSelf || (trust >= HEAL_TRUST_THRESHOLD && trust > suspicion)) {
          return {
            kind: "NIGHT_ACTION",
            action: "HEAL",
            // Engine không nhận mục tiêu cho bình cứu: nó luôn cứu nạn nhân đêm đó.
            targetId: null,
            confidence: 0.8,
            evidence: [
              nightEvidence("DEFEND", round, victim, "cứu nạn nhân đáng tin của đêm nay"),
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
              item.suspicion >= POISON_SUSPICION_THRESHOLD &&
              item.trust < POISON_TRUST_VETO,
          )
          .sort(
            (a, b) => b.suspicion - a.suspicion || a.targetId.localeCompare(b.targetId),
          );

        if (scored.length > 0) {
          return {
            kind: "NIGHT_ACTION",
            action: "POISON",
            targetId: scored[0].targetId,
            confidence: 0.75,
            evidence: [
              nightEvidence(
                "ACCUSE",
                round,
                scored[0].targetId,
                "gần như chắc chắn là Sói nên dùng bình độc",
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
        confidence: 0.5,
        evidence: [],
      };
    },

    voteBias: () => ({}),
  };
}
