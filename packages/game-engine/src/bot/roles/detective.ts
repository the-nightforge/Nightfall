import type { Role } from "@masoi/shared";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { nightEvidence, type BotRoleStrategy } from "./strategy";
import { rankNightTargets } from "./night-scoring";
import { informationValue } from "./uncertainty";

/**
 * Thám Tử so hai người và chỉ biết họ CÙNG phe hay KHÁC phe.
 *
 * Thông tin đó chỉ có giá trị khi cả hai đều còn mơ hồ. So một người gần chắc
 * là Sói với một người gần chắc trong sạch thì kết quả đã đoán được trước, và
 * lượt điều tra thành vô nghĩa. Vì vậy chọn hai ứng viên KHÔNG CHẮC NHẤT, theo
 * đúng thang giá trị thông tin mà Tiên Tri dùng.
 */
export function detectiveStrategy(
  _role: Role = "DETECTIVE",
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotRoleStrategy {
  return {
    role: "DETECTIVE",

    decideNight(context, state, rng, probe, policy) {
      const night = context.knowledge.night;
      if (!night || !night.legalActions.includes("DETECTIVE_CHECK")) {
        probe?.fallback("không có lượt điều tra nào đang mở");
        return null;
      }

      const candidates = night.legalTargets.DETECTIVE_CHECK.filter(
        (id) => id !== context.knowledge.botId,
      );
      // Engine đòi đúng hai người khác nhau; ít hơn thì bỏ lượt thay vì gửi một
      // nước đi chắc chắn bị từ chối.
      if (candidates.length < 2) {
        probe?.fallback("cần đúng hai mục tiêu hợp lệ, chỉ có ít hơn");
        return null;
      }

      const ranked = rankNightTargets(candidates, {
        weights,
        rng,
        probe,
        action: "DETECTIVE_CHECK",
        policy,
        termsFor: (targetId) => [
          {
            name: "informationValue",
            value: informationValue(state.suspicion[targetId]?.score ?? 0, weights),
          },
        ],
      });

      return {
        kind: "NIGHT_ACTION",
        action: "DETECTIVE_CHECK",
        targetId: ranked[0].targetId,
        secondaryTargetId: ranked[1].targetId,
        confidence: weights.nightConfidence.detective,
        evidence: [
          nightEvidence(
            "ACCUSE",
            context.knowledge.round,
            ranked[0].targetId,
            `so phe với ${ranked[1].targetId} vì cả hai đều chưa rõ`,
            0,
            weights,
          ),
        ],
      };
    },

    voteBias: () => ({}),
  };
}
