import type { Role } from "@masoi/shared";
import { voteLeader } from "../decision/claim-decision";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { passiveStrategy, type BotRoleStrategy } from "./strategy";

/**
 * Thằng Hề: một chiến thuật NGƯỢC, không phải một giọng nói khác.
 *
 * Hề không có hành động đêm, nên phần duy nhất nó điều khiển được là lá phiếu
 * và lời nói ban ngày - và cả hai phải phục vụ đúng một mục tiêu: bị làng đưa
 * lên giá treo. Đây là lý do file này tồn tại thay vì để `passiveStrategy` lo:
 * một con Hề chơi như Dân Làng rồi chỉ đổi lời thoại là một con Hề chắc chắn
 * thua, vì hành vi mới là thứ làng bỏ phiếu theo.
 *
 * Hai đòn bẩy, cả hai đều đi qua `voteBias` nên chúng chỉ NGHIÊNG bảng điểm
 * của `selectVote` chứ không thay thế nó - Hề vẫn phải chọn trong đúng danh
 * sách hợp lệ mà engine cấp, và vẫn phản ứng với những gì xảy ra trên bàn:
 *
 * 1. **Chỉ vào người được tin nhất.** Đó là cáo buộc trông vô lý nhất trên
 *    bàn, và một cáo buộc vô lý nhắm vào người làng đang dựa vào là cách nhanh
 *    nhất để bị đọc thành Sói.
 * 2. **Không bao giờ hùa theo đám đông.** Một ngày kết thúc bằng việc treo
 *    người khác là một ngày Hề mất trắng, nên đứng ngoài chuyến xe đang lăn
 *    vừa giữ được ngày đó vừa khiến chính nó thành kẻ lạc lõng - và kẻ lạc
 *    lõng là kẻ bị soi.
 *
 * Cố ý KHÔNG làm: bỏ phiếu cho chính mình. Engine cho phép, nhưng nó là một
 * tín hiệu đọc ra ngay lập tức là "người này muốn bị treo" - nó không lừa được
 * ai, và một Hề bị nhìn thấu thì làng chỉ việc tha.
 */
export function jesterStrategy(
  _role: Role = "JESTER",
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotRoleStrategy {
  const base = passiveStrategy("JESTER");
  return {
    role: "JESTER",

    // Không có lượt đêm nào để mà quyết: `ROLE_META.JESTER` không có
    // `nightOrder`, nên engine trả `night: null` và hàm này không bao giờ được
    // hỏi. Uỷ quyền cho `passiveStrategy` để câu trả lời đó chỉ có một chỗ.
    decideNight: base.decideNight,

    voteBias(context, state) {
      const tuning = weights.jester;
      const knowledge = context.knowledge;
      const bias: Record<string, number> = {};

      // Cổng tái lập, cùng dạng với cổng của nhóm `claim`: cấu hình chưa bật
      // hành vi Hề (v1-v6) thì hàm này không nghiêng gì cả, và một ván chạy
      // dưới cấu hình đó giữ nguyên hành vi cũ từng bit.
      if (
        tuning.contrarianTrustBonus === 0 &&
        tuning.bandwagonPenalty === 0 &&
        tuning.crowdSuspicionDamping === 0
      ) {
        return bias;
      }

      const leader = voteLeader(knowledge.currentVoteCounts.players);

      for (const player of knowledge.players) {
        if (!player.alive || player.id === knowledge.botId) continue;
        const trust = state.trust[player.id]?.score ?? 0;
        const suspicion = state.suspicion[player.id]?.score ?? 0;
        bias[player.id] =
          trust * tuning.contrarianTrustBonus -
          suspicion * tuning.crowdSuspicionDamping -
          (player.id === leader ? tuning.bandwagonPenalty : 0);
      }

      return bias;
    },
  };
}
