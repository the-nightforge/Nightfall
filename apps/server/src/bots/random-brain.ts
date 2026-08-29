import type { RoomSnapshot } from "@masoi/shared";
import type { Always, BotBrain, DaySpeechDecision, DefenseDecision } from "./types";
import { decided, nothingToDo } from "./types";

/**
 * Chọn TẤT ĐỊNH theo bị cáo và vòng.
 *
 * Trước Phase 4 chỗ này dùng nguồn ngẫu nhiên toàn cục, và đó là lượt rút cuối
 * cùng còn sót trong đường sinh lời nói: hai lần chạy lại cùng một ván cho hai
 * lời bào chữa khác nhau. Hàm băm cho cùng tính chất mong muốn - hai bị cáo
 * khác nhau nói khác nhau, cùng một người ở hai vòng cũng khác - mà vẫn tái
 * lập được.
 */
function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function pick<T>(items: readonly T[], key: string): T | undefined {
  return items.length === 0 ? undefined : items[fnv1a32(key) % items.length];
}

/**
 * Lời bào chữa dự phòng. Một bị cáo im lặng trông như màn hình hỏng, mà đây lại
 * là não duy nhất chắc chắn trả lời được.
 *
 * Không câu nào nêu tên ai và không câu nào nhận một vai cụ thể: đây là đường
 * lui dùng cho MỌI vai, nên một câu nhận vai sẽ biến nó thành lời khai gian
 * của Tiên Tri hay Sói.
 */
const DEFENSE_LINES = [
  "Tôi là dân thường, treo tôi là mất một phiếu của làng.",
  "Các bạn đang nhắm nhầm người, tối nay sẽ rõ thôi.",
  "Tôi không có gì để giấu, ai đẩy phiếu tôi mới là đáng ngờ.",
  "Treo tôi thì mai làng vẫn mất người thôi, nghĩ kỹ đi.",
  "Tôi ngồi im nãy giờ chứ có làm gì đâu mà bị đẩy.",
  "Được, cứ treo. Rồi mai mọi người sẽ biết là phí một ngày.",
  "Ai gom phiếu nhanh thế thì hỏi lại chính người đó đi.",
  "Tôi không giải thích được nhiều, nhưng tôi không phải sói.",
];

/**
 * Não dự phòng cuối cùng: chọn ngẫu nhiên trong các câu mẫu, không gọi mạng nên
 * không bao giờ hỏng. Vì thế nó chỉ trả ok - không có nhánh { ok: false }.
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

  async decideDefense(view: RoomSnapshot): Promise<Always<DefenseDecision>> {
    if (!view.trial?.canSpeak) return nothingToDo();
    const key = `${view.code}:${view.you?.id ?? ""}:${view.round}`;
    return decided({ chat: pick(DEFENSE_LINES, key)! });
  }
}

export const randomBrain = new RandomBrain();
