import type { Role } from "@masoi/shared";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { passiveStrategy, type BotRoleStrategy } from "./strategy";

/**
 * Kẻ Phản Bội: chơi cho phe Sói mà KHÔNG BIẾT phe Sói là ai.
 *
 * Đó là toàn bộ cái khó của vai này, và cũng là lý do file này tồn tại thay vì
 * để `werewolfStrategy` lo. Chiến thuật Sói dựng trên `knownRoles` - nó biết
 * đồng bọn, nên nó biết phải tránh ai và đẩy ai. Kẻ Phản Bội không có bảng đó:
 * engine cố ý không phát cho nó, vì bầy cũng không biết nó. Cho nó dùng chiến
 * thuật Sói là cho nó một danh sách rỗng rồi để nó chơi hệt một Dân Làng.
 *
 * Nó cũng KHÔNG rơi về `passiveStrategy`, cùng lý do với Thằng Hề: mặc định
 * "không thiên vị" là chiến thuật của một người muốn làng thắng, và một Kẻ
 * Phản Bội chơi như vậy thì đang giúp đúng phe nó cần đánh bại.
 *
 * Hai đòn bẩy, cả hai đi qua `voteBias` nên chúng chỉ NGHIÊNG bảng điểm của
 * `selectVote` chứ không thay nó - lá phiếu vẫn nằm trong danh sách hợp lệ và
 * vẫn phản ứng với những gì xảy ra trên bàn:
 *
 * 1. **Tránh xa người nó nghi nhất.** Không biết Sói là ai, nhưng nó biết cách
 *    làng suy luận - vì nó dùng chính bộ não đó. Người nó nghi nhất cũng là
 *    người làng sắp nghi nhất, và đó là con Sói có xác suất cao nhất bàn. Bỏ
 *    phiếu cho người đó là tự tay giúp làng. Đây là suy luận GIÁN TIẾP và nó
 *    sai thường xuyên - đúng như thân phận của lá bài.
 * 2. **Nhắm vào người tin cậy nhất.** Ở bàn này, người được tin nhất gần như
 *    luôn là một vai chức năng đã lộ - Tiên Tri đã khai, người vừa được soi
 *    sạch. Đó là nguồn xác nhận của làng, và nó là thứ bầy Sói cần dọn đi.
 *
 * Cố ý KHÔNG làm: khai láo một vai chức năng. Đó là nước đi của một con Sói có
 * đồng bọn đỡ lời; một mình thì lời khai chỉ tạo ra một cuộc cãi vai mà nó chắc
 * chắn thua, vì Tiên Tri thật vẫn còn đó và vẫn cầm kết quả.
 *
 * Cổng tái lập giống hệt nhóm `jester`: cả hai số hạng bằng 0 thì hàm này
 * không nghiêng gì cả, và một ván chạy dưới cấu hình cũ giữ nguyên từng bit.
 */
export function traitorStrategy(
  _role: Role = "TRAITOR",
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotRoleStrategy {
  const base = passiveStrategy("TRAITOR");
  return {
    role: "TRAITOR",

    // Không có lượt đêm: `ROLE_META.TRAITOR` không có `nightOrder`, nên engine
    // trả `night: null` và hàm này không bao giờ được hỏi. Uỷ quyền để câu trả
    // lời đó chỉ có một chỗ.
    decideNight: base.decideNight,

    voteBias(context, state) {
      const tuning = weights.traitor;
      const bias: Record<string, number> = {};
      if (tuning.suspectShield === 0 && tuning.trustedTargetBonus === 0) return bias;

      for (const player of context.knowledge.players) {
        if (!player.alive || player.id === context.knowledge.botId) continue;
        const id = player.id;
        const suspicion = state.suspicion[id]?.score ?? 0;
        const trust = state.trust[id]?.score ?? 0;
        // Dấu ÂM cho nghi ngờ: càng nghi thì càng tránh bỏ phiếu. Đây là chỗ
        // duy nhất trong lõi mà `suspicion` bị đọc ngược dấu, và nó đúng ngược
        // dấu vì lá bài này thắng khi làng đoán sai.
        const shield = -suspicion * tuning.suspectShield;
        const target = trust * tuning.trustedTargetBonus;
        const value = shield + target;
        if (value !== 0) bias[id] = value;
      }
      return bias;
    },
  };
}
