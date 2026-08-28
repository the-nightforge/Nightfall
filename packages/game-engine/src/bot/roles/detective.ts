import { nightEvidence, type BotRoleStrategy } from "./strategy";

/**
 * Thám Tử so hai người và chỉ biết họ CÙNG phe hay KHÁC phe.
 *
 * Thông tin đó chỉ có giá trị khi cả hai đều còn mơ hồ. So một người gần chắc
 * là Sói với một người gần chắc trong sạch thì kết quả đã đoán được trước, và
 * lượt điều tra thành vô nghĩa. Vì vậy chọn hai ứng viên KHÔNG CHẮC NHẤT.
 *
 * Cặp "cùng phe" cũng đáng giá gấp đôi khi hai người đó đã dính nhau trong
 * social graph: nó biến một nghi ngờ về quan hệ thành một sự thật về phe.
 */
const MOST_INFORMATIVE_SUSPICION = 50;

export function detectiveStrategy(): BotRoleStrategy {
  return {
    role: "DETECTIVE",

    decideNight(context, state, rng) {
      const night = context.knowledge.night;
      if (!night || !night.legalActions.includes("DETECTIVE_CHECK")) return null;

      const candidates = night.legalTargets.DETECTIVE_CHECK.filter(
        (id) => id !== context.knowledge.botId,
      );
      // Engine đòi đúng hai người khác nhau; ít hơn thì bỏ lượt thay vì gửi một
      // nước đi chắc chắn bị từ chối.
      if (candidates.length < 2) return null;

      const ranked = candidates
        .map((targetId) => {
          const suspicion = state.suspicion[targetId]?.score ?? 0;
          const uncertainty = 100 - Math.abs(suspicion - MOST_INFORMATIVE_SUSPICION) * 2;
          return { targetId, score: uncertainty + (rng() - 0.5) * 6 };
        })
        .sort((a, b) => b.score - a.score || a.targetId.localeCompare(b.targetId));

      return {
        kind: "NIGHT_ACTION",
        action: "DETECTIVE_CHECK",
        targetId: ranked[0].targetId,
        secondaryTargetId: ranked[1].targetId,
        confidence: 0.65,
        evidence: [
          nightEvidence(
            "ACCUSE",
            context.knowledge.round,
            ranked[0].targetId,
            `so phe với ${ranked[1].targetId} vì cả hai đều chưa rõ`,
          ),
        ],
      };
    },

    voteBias: () => ({}),
  };
}
