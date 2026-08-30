import type { Always, BotBrain, DaySpeechDecision } from "./types";
import { nothingToDo } from "./types";

/**
 * Não dự phòng cuối cùng: không gọi mạng nên không bao giờ hỏng. Vì thế nó chỉ
 * trả ok - không có nhánh { ok: false }.
 *
 * Từng có một chuỗi câu mẫu riêng (`DEFENSE_LINES`) để trả lời cho lượt tự bào
 * chữa mà không đụng `Math.random`. Không cần nữa: lượt bào chữa giờ đi qua
 * đúng `renderBotSpeech` như mọi lời nói khác, và bảng mẫu tất định của nó
 * (`renderSpeechTemplate` trong `@masoi/game-engine`) đã phủ luôn trường hợp
 * "không nhà cung cấp nào trả lời" - kể cả khi não này là não DUY NHẤT (xem
 * `chooseBrain`, nhánh `!choice.enabled`).
 */
export class RandomBrain implements BotBrain {
  readonly name = "random";

  /**
   * Não chót KHÔNG tự sinh lời thoại.
   *
   * Ban ngày đã deterministic: mục tiêu do lõi AI chốt, còn câu chữ khi mọi nhà
   * cung cấp hỏng là việc của `renderBotSpeech` với mẫu cố định. Trả về "không
   * có gì để nói" ở đây giữ cho đường lui không bịa ra một câu không nguồn.
   */
  async renderDaySpeech(): Promise<Always<DaySpeechDecision>> {
    return nothingToDo();
  }
}

export const randomBrain = new RandomBrain();
