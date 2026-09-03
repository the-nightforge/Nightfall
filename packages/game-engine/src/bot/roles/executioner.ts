import type { Role } from "@masoi/shared";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { passiveStrategy, type BotRoleStrategy } from "./strategy";

/**
 * Kẻ Báo Thù: một chiến dịch, không phải một kỹ năng.
 *
 * Nó không thức dậy ban đêm, không soi được ai, không giết được ai. Toàn bộ ván
 * của nó nằm trong một câu: thuyết phục cả làng treo cổ ĐÚNG MỘT người mà engine
 * đã chỉ định. Vì vậy file này chỉ có `voteBias` - và cũng vì vậy nó KHÔNG rơi
 * về `passiveStrategy` như một Dân Làng: mặc định "không thiên vị" của strategy
 * nền là chiến thuật của người không có nhiệm vụ, và một Kẻ Báo Thù chơi như
 * vậy sẽ không bao giờ đạt được điều kiện thắng của chính nó.
 *
 * Ba ranh giới, và cả ba đều là ranh giới THÔNG TIN chứ không phải lựa chọn
 * chiến thuật:
 *
 * - **Mục tiêu KHÔNG phải bằng chứng.** Người đó luôn thuộc phe Dân, nên biến
 *   "đây là mục tiêu của tôi" thành "người này là Sói" là ghi một điều dối trá
 *   vào chính lớp sự thật mà mọi quyết định khác của BOT đọc - kể cả phát bắn
 *   Thợ Săn của người khác, qua đường lời nói. File này vì thế KHÔNG sinh một
 *   `BotEvidence` nào và không đụng tới `suspicion`/`trust`; nó chỉ trả về một
 *   delta cho bảng điểm phiếu, thứ chết theo từng lượt quyết định.
 * - **Không đọc `knownRoles` của ai ngoài chính mình.** Nó không có đồng bọn và
 *   engine không cấp cho nó bảng vai nào.
 * - **Không nói ra id mục tiêu.** Lời thoại đi qua `speech-planner` và
 *   `speech-renderer` từ một ý định chỉ mang `targetId` đã được chọn bằng bảng
 *   điểm chung - cùng đường mà mọi vai khác đi, nên không có chỗ nào để "mục
 *   tiêu nhiệm vụ" rò ra thành một câu.
 *
 * Sau khi HOÀN THÀNH nhiệm vụ, nó thôi đẩy: `won` bật thì bảng bias rỗng và BOT
 * quay lại chơi bằng bằng chứng công khai như mọi người. Thành tích đã ghi rồi,
 * và tiếp tục dồn phiếu vào một cái xác chỉ tổ lộ mặt.
 *
 * Sau khi CHUYỂN VAI thì file này không còn được gọi nữa - `role` đã là
 * `JESTER`, nên `strategyFor` trả về chiến lược của Hề. Không có cờ nào phải
 * nhớ, và mọi quyết định đang chờ đều đọc `selfRole` mới ở lần gọi kế tiếp.
 */
export function executionerStrategy(
  _role: Role = "EXECUTIONER",
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotRoleStrategy {
  const base = passiveStrategy("EXECUTIONER");
  const tuning = weights.executioner;

  return {
    role: "EXECUTIONER",

    // Không có lượt đêm nào để mà quyết: `ROLE_META.EXECUTIONER` không có
    // `nightOrder`, nên engine trả `night: null` và hàm này không bao giờ được
    // hỏi. Uỷ quyền cho `passiveStrategy` để câu trả lời đó chỉ có một chỗ.
    decideNight: base.decideNight,

    voteBias(context, state) {
      const bias: Record<string, number> = {};

      // Cổng tái lập, cùng dạng với cổng của nhóm `jester` và `serialKiller`:
      // cấu hình chưa bật hành vi này (v1-v8) thì hàm không nghiêng gì cả.
      if (tuning.targetPush === 0 && tuning.othersDamping === 0) return bias;

      const knowledge = context.knowledge;
      const targetId = knowledge.executionerTargetId ?? null;
      // Không có nhiệm vụ (state cũ, hoặc engine chưa cấp): chơi như bình
      // thường thay vì đoán một mục tiêu.
      if (!targetId) return bias;

      /*
       * Nhiệm vụ đã xong thì thôi đẩy.
       *
       * Đọc từ chính bảng người sống chứ không cần một cờ riêng: mục tiêu đã
       * chết nghĩa là hoặc nó vừa thắng, hoặc nó sắp hoá Thằng Hề ở lần
       * `settleExecutioner` kế tiếp. Cả hai trường hợp đều KHÔNG còn lý do để
       * dồn phiếu vào một cái tên không còn trên bàn - và bảng điểm chung cũng
       * đã loại người chết khỏi danh sách ứng viên.
       */
      const target = knowledge.players.find((player) => player.id === targetId);
      if (!target || !target.alive) return bias;

      for (const player of knowledge.players) {
        if (!player.alive || player.id === knowledge.botId) continue;
        if (player.id === targetId) {
          const trust = state.trust[targetId]?.score ?? 0;
          bias[player.id] = tuning.targetPush - trust * tuning.protectedTargetPenalty;
        } else if (tuning.othersDamping !== 0) {
          bias[player.id] = -tuning.othersDamping;
        }
      }

      return bias;
    },
  };
}
