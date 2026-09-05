import type { Role } from "@masoi/shared";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { isThinVillage } from "../knowledge";
import { nightEvidence, type BotRoleStrategy } from "./strategy";
import type { BotDecisionContext } from "../types";

/**
 * Ngưỡng nghi ngờ để Phù Thuỷ dám dùng bình độc ĐÊM NAY.
 *
 * Tách ra để harness self-play ghi được "đêm này bình còn mà không dùng thì
 * ngưỡng là bao nhiêu" (`WITCH_HOLD`) bằng ĐÚNG con số chiến lược đang dùng,
 * thay vì chép lại phép tính rồi trôi lệch. Chiết khấu là 0 ở v1..v14.
 */
export function witchPoisonThreshold(
  knowledge: BotDecisionContext["knowledge"],
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): number {
  const tuning = weights.roleThresholds;
  return (
    tuning.witchPoisonSuspicion -
    (isThinVillage(knowledge, weights) ? tuning.witchPoisonLosingDiscount : 0)
  );
}

/**
 * Hai bình dùng ĐÚNG MỘT LẦN cả ván, nên ngưỡng phải cao.
 *
 * Tiêu một bình vì không nghĩ ra việc gì hay hơn là cách chắc chắn nhất để
 * không còn nó vào lúc thật sự cần. Vì vậy mặc định của Phù Thuỷ là SKIP, và
 * ba ngưỡng trong `roleThresholds` là điều kiện để phá lệ.
 *
 * Mặt trái của cùng lý lẽ đó: một bình còn nguyên khi ván kết thúc có giá trị
 * bằng 0. Khi làng đã mỏng (`isThinVillage`), hai ngưỡng hạ một nấc
 * (`witchPoisonLosingDiscount`, `witchHealLosingDiscount`) - vẫn cần bằng
 * chứng, chỉ là bằng chứng vừa đủ thì dùng thay vì ôm tới cuối.
 */
export function witchStrategy(
  _role: Role = "WITCH",
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotRoleStrategy {
  const tuning = weights.roleThresholds;

  return {
    role: "WITCH",

    decideNight(context, state, _rng, probe) {
      const night = context.knowledge.night;
      if (!night) {
        probe?.fallback("không có lượt đêm nào đang mở");
        return null;
      }

      const round = context.knowledge.round;

      // Chiết khấu là 0 ở v1..v14, nên hai ngưỡng dưới đây bằng đúng bảng cũ.
      const thin = isThinVillage(context.knowledge, weights);
      const healTrust = tuning.witchHealTrust - (thin ? tuning.witchHealLosingDiscount : 0);
      const poisonSuspicion = witchPoisonThreshold(context.knowledge, weights);

      // --- Bình cứu ---
      // Chỉ được chào HEAL khi engine xác nhận có nạn nhân và bình còn.
      if (night.legalActions.includes("HEAL") && night.wolfTarget) {
        const victim = night.wolfTarget;
        const trust = state.trust[victim]?.score ?? 0;
        const suspicion = state.suspicion[victim]?.score ?? 0;
        // Cứu chính mình luôn đáng, kể cả khi chưa có dữ liệu về ai.
        const isSelf = victim === context.knowledge.botId;

        probe?.candidate({
          targetId: victim,
          score: trust - healTrust,
          terms: [
            { name: "victimTrust", value: trust },
            { name: "healTrustThreshold", value: -healTrust },
          ],
          evidenceIds: [],
        });

        if (isSelf || (trust >= healTrust && trust > suspicion)) {
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
              item.suspicion >= poisonSuspicion &&
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

      probe?.fallback(
        `không ai vượt ngưỡng độc ${poisonSuspicion} và không có nạn nhân đáng cứu`,
      );

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
