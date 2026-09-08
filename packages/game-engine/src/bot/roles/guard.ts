import type { Role } from "@masoi/shared";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { nightEvidence, type BotRoleStrategy } from "./strategy";
import { rankNightTargets } from "./night-scoring";

/**
 * Bảo Vệ đỡ người đáng tin nhất và chưa được đỡ gần đây.
 *
 * KHÔNG có nhánh tự đỡ, và đó là chủ ý của luật chứ không phải thiếu sót: engine
 * cấm Bảo Vệ tự bảo vệ mình, `legalTargets.GUARD` đã lọc chính mình ra trước khi
 * chiến thuật nhìn thấy danh sách. Ở đây từng có một khoản thưởng "tự đỡ khi
 * đang bị nhắm" cùng ba knob nuôi nó - không dòng nào chạy được lần nào, vì
 * `me` không bao giờ nằm trong nhóm ứng viên.
 *
 * Nếu sau này muốn cho Bảo Vệ tự đỡ thì chỗ sửa là ENGINE, không phải file này:
 * một khoản thưởng trong lõi AI trỏ vào nước đi mà engine sẽ từ chối chỉ làm
 * hỏng lượt đêm.
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
      const tuning = weights.selfPreservation;

      // Ai đã được đỡ gần đây. Bảo Vệ luôn chọn "người đáng tin nhất" sẽ đỡ đúng
      // một người gần như mọi đêm, và bầy Sói đọc được mẫu đó sau hai vòng -
      // lúc đó vai Bảo Vệ tự chỉ vào mình bằng chính lịch trình của nó.
      const guardedBefore = new Set(
        state.previousNightActions
          .filter((entry) => entry.action === "GUARD" && entry.targetId !== null)
          .map((entry) => entry.targetId as string),
      );

      const scored = rankNightTargets(candidates, {
        weights,
        rng,
        probe,
        termsFor: (targetId) => {
          const trust = state.trust[targetId]?.score ?? 0;
          const suspicion = state.suspicion[targetId]?.score ?? 0;
          return [
            { name: "trust", value: trust },
            // Đỡ người mình nghi là Sói thì vừa phí lượt vừa cứu nhầm phe.
            { name: "suspicionPenalty", value: -(suspicion * tuning.guardSuspicionPenalty) },
            {
              name: "repeatPenalty",
              value: guardedBefore.has(targetId) ? -tuning.guardRepeatPenalty : 0,
            },
          ];
        },
      });

      const winner = scored[0];
      // Đêm Cảnh Giác mở lượt che thứ hai. Điều kiện do engine chốt ở
      // `bonusSecondTargetFor`, giống hệt Màn Sương Tan của Tiên Tri: đọc thẳng
      // `activeEventId` ở đây là dựng lại luật lần thứ hai, và bản sao đó sẽ
      // trôi lệch khỏi `submitNightAction`.
      const runnerUp = night.bonusSecondTargetFor === "GUARD" ? (scored[1]?.targetId ?? null) : null;

      return {
        kind: "NIGHT_ACTION",
        action: "GUARD",
        targetId: winner.targetId,
        secondaryTargetId: runnerUp,
        confidence: weights.nightConfidence.guard,
        evidence: [
          nightEvidence(
            "DEFEND",
            context.knowledge.round,
            winner.targetId,
            "đỡ người đáng tin nhất",
            0,
            weights,
          ),
        ],
      };
    },

    voteBias: () => ({}),
  };
}
