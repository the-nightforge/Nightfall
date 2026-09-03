import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { decideChatClaim } from "./claim-decision";
import type { BotSpeechStyle } from "../personality/speech-style";
import type { BotBrainState, BotDecisionContext, BotRng, BotSpeechIntention } from "../types";

/**
 * Thái độ của bị cáo trong lượt tự bào chữa.
 *
 * Tồn tại vì lượt này có một giả định NGẦM mà cả ba tầng đều mang theo: người
 * đang bị đưa ra treo thì muốn sống. Với gần hết bộ bài, giả định đó đúng tới
 * mức không ai nghĩ nó là một giả định - nên nó được nướng thẳng vào một ý định
 * DISAGREE cứng ở scheduler và vào một câu "hãy thuyết phục làng đừng treo bạn"
 * trong prompt.
 *
 * Với Thằng Hề thì nó SAI, và sai theo cách đắt nhất: con BOT được chỉ thị làm
 * đúng thứ phá hỏng điều kiện thắng của chính nó. Đưa thái độ thành một giá trị
 * tường minh là cách duy nhất để cả ba tầng cùng nhìn thấy điều đó thay vì mỗi
 * tầng tự đoán lấy.
 *
 * Cố ý chỉ có HAI giá trị, và `INDIFFERENT` KHÔNG phải "xin được treo": một bị
 * cáo hét "treo tôi đi" thì cả làng tha ngay lập tức. Nó là "không buồn thanh
 * minh" - đủ để không tự cứu, không đủ để tự tố.
 */
export type DefenseStance = "SURVIVE" | "INDIFFERENT";

/**
 * Giọng cho câu bất cần của Thằng Hề, suy từ tính cách.
 *
 * Cùng bậc thang mà `toneFor` của `speech-planner` dùng, và cùng lý do: thứ tự
 * ở đây là tính cách, không phải may rủi. Cùng một tình thế, hai con BOT khác
 * nhau nói khác nhau - và nói giống nhau qua các ván, vì tính cách không đổi.
 */
function jesterDefenseTone(style: BotSpeechStyle): BotSpeechIntention["tone"] {
  if (style.humor >= 0.7) return "PLAYFUL";
  if (style.harshness >= 0.6) return "TENSE";
  if (style.warmth === "WARM") return "SOFT";
  if (style.verbosity === "TERSE") return "FIRM";
  return "NEUTRAL";
}

export interface BotDefenseIntention {
  intention: BotSpeechIntention;
  stance: DefenseStance;
}

/**
 * Ý định phát ngôn cho lượt tự bào chữa - cho MỌI vai.
 *
 * Trước đây chỗ này không tồn tại: scheduler gọi `decideDefenseClaim`, và khi
 * lõi trả `null` thì nó tự dựng một ý định DISAGREE ngay tại `machine.ts`. Một
 * đường lui nằm ngoài lõi như vậy là một quyết định gameplay được viết ở tầng
 * IO - và nó không nhìn thấy vai, nên nó không thể đúng cho mọi vai.
 *
 * Hàm này thuần và KHÔNG rút số ngẫu nhiên nào của riêng nó: `decideChatClaim`
 * vẫn tiêu đúng chuỗi RNG mà nó vẫn tiêu, còn phần chọn thái độ suy ra từ vai
 * và tính cách. Nhờ vậy mọi vai khác đi qua đây ra đúng kết quả cũ, từng bit.
 */
export function decideDefenseSpeech(
  context: BotDecisionContext,
  state: BotBrainState,
  rng: BotRng,
  style: BotSpeechStyle,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotDefenseIntention {
  if (context.knowledge.selfRole === "JESTER") {
    /*
     * Hề không thanh minh, và cũng không xin được treo.
     *
     * `HUMOR` là loại DUY NHẤT trong bảng nói được "tôi không định cãi" mà
     * KHÔNG nói ra vì sao. Đọc thẳng bảng mẫu của nó ở mọi giọng là thấy: "Thôi
     * tôi im cho lành." (từ chối thanh minh), "Cãi ít thôi, bầu đi." (giục
     * chính cái phiên toà của mình), "Tôi mà là sói thì tôi đã diễn hay hơn
     * rồi." (một câu chối không ra chối). Không câu nào phản bác việc bị nghi,
     * không câu nào cầu xin, và không câu nào lộ vai - đúng ba điều kiện.
     *
     * Đã cân nhắc `REACTION` cho người kiệm lời rồi bỏ: bảng của nó ("Ừ.",
     * "Thấy rồi.") viết cho việc ĐÁP LẠI câu người khác, và đứng một mình trên
     * giá treo thì nó đọc như một câu lạc đề chứ không như một thái độ.
     *
     * Biến thiên đến từ GIỌNG, và giọng suy từ tính cách chứ không rút số: năm
     * giọng của bảng `HUMOR` cho ra năm câu khác hẳn nhau, nên không phải con
     * Hề nào cũng nói cùng một kiểu. Không rút số cũng có nghĩa lượt này không
     * tiêu thêm một giá trị nào của chuỗi RNG.
     *
     * Nhánh này đứng TRƯỚC `decideChatClaim`, và đó là một phép chặn chứ không
     * phải một cách sắp xếp cho gọn. Nhánh "Hề khai láo" trong hàm kia nằm
     * TRƯỚC nhánh UNDER_FIRE, nên gọi nó ở đây thì một con Hề đang đứng trên
     * giá treo vẫn có thể tung ra một lời khai Tiên Tri - tức lại đúng cái lỗi
     * này, đi vào bằng một cửa khác. Lời khai láo là nước đi của BAN NGÀY, khi
     * nó còn cần bị phản bác để leo lên giá treo; tới lúc đã đứng đó rồi thì
     * một lời khai chỉ còn một tác dụng duy nhất là cứu chính nó.
     */
    return {
      stance: "INDIFFERENT",
      intention: {
        kind: "HUMOR",
        topic: "SMALLTALK",
        confidence: 0.5,
        // KHÔNG mang bằng chứng: một bị cáo bất cần thì không trưng ra căn cứ,
        // và bằng chứng ở đây chỉ có thể phục vụ việc tự gỡ tội.
        evidence: [],
        tone: jesterDefenseTone(style),
        reason: "Thằng Hề không thanh minh: bị treo chính là điều kiện thắng của nó",
      },
    };
  }

  /*
   * KHÔNG có nhánh nào cho hai vai trung lập còn lại, và đó là một quyết định
   * chứ không phải một chỗ bỏ sót.
   *
   * Giả định ngầm "người bị đưa ra treo thì muốn sống" chỉ SAI với Thằng Hề.
   * Sát Nhân bị treo là thua, và Kẻ Báo Thù bị treo là mất cả nhiệm vụ lẫn
   * đường lui hoá Hề - cả hai đều phải đi đúng đường `SURVIVE` bên dưới. Gom
   * chúng theo nhãn `neutral` sẽ chỉ thị cho hai con BOT làm đúng thứ phá hỏng
   * điều kiện thắng của chính chúng.
   *
   * Một Kẻ Báo Thù ĐÃ hoá Thằng Hề thì `selfRole` đã là `JESTER`, nên nó rơi
   * vào nhánh ngay trên - đổi thái độ ngay ở lượt bào chữa kế tiếp mà không
   * cần một cờ nào.
   */

  /*
   * `voteTargetId: null` vì bị cáo không tự bỏ phiếu cho chính mình ở lượt này -
   * xem chú thích của `BotRuntime.decideDefenseClaim`, nhánh duy nhất đọc tham
   * số đó (Sói khai láo chủ động) không áp dụng cho một bị cáo đang bị dồn.
   */
  const claim = decideChatClaim(context, state, rng, null, weights);
  if (claim) {
    return {
      stance: "SURVIVE",
      intention: {
        kind: claim.kind === "COUNTER" ? "COUNTER_CLAIM" : "CLAIM_ROLE",
        targetId: claim.counterTargetId ?? claim.accusedId ?? undefined,
        claimedRole: claim.role,
        topic: "ROLE_CLAIM",
        // Không có `vote.confidence` ở lượt bào chữa - đây là lá bài cuối cùng
        // bị cáo còn, nên gán một mức tin cậy cao cố định thay vì suy ra từ một
        // lá phiếu không tồn tại.
        confidence: 0.9,
        evidence: [],
        tone: "FIRM",
        reason: claim.reason,
      },
    };
  }

  /*
   * Đường lui của MỌI vai còn lại, giữ nguyên hình dạng cũ từng bit.
   *
   * Không chỉ đích danh ai: vote công khai lộ AI đang bị nhắm, không lộ AI đã
   * bỏ phiếu, nên không có "kẻ tố cáo" cụ thể để phản bác. Đây KHÔNG phải một
   * quyết định gameplay - hình dạng của nó cố định bất kể ván đấu - nhưng nó
   * phải sống trong lõi, vì chỉ ở đây mới nhìn thấy vai.
   */
  return {
    stance: "SURVIVE",
    intention: {
      kind: "DISAGREE",
      topic: "SUSPICION",
      confidence: 0.5,
      evidence: [],
      tone: style.harshness >= 0.6 ? "TENSE" : "FIRM",
    },
  };
}
