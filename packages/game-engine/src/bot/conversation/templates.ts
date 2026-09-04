import { ROLE_META } from "@masoi/shared";
import { fnv1a32 } from "../hash";
import {
  BOT_SPEECH_TONES,
  type BotSpeechIntention,
  type BotSpeechKind,
  type BotSpeechTone,
} from "../types";
import { speechTextFingerprint } from "./fingerprint";

/**
 * Câu chữ cho một ý định đã chốt, không cần mạng.
 *
 * Đây là đường lui khi nhà cung cấp tắt, lỗi hoặc hết quota - và là nguồn duy
 * nhất trong self-play. Phase 3 có đúng ba câu cho ba ý định, nên mọi ván đọc
 * lên giống hệt nhau; đó là một nửa của "BOT lặp đi lặp lại cùng kiểu câu".
 *
 * Ba tính chất, cả ba đều có test:
 *
 * 1. **Tất định.** Chọn mẫu bằng hàm băm của `(seed, bot, vòng, lượt, vân tay
 *    ý định)`. Không RNG - một đường lui ngẫu nhiên làm hỏng đúng tính tái lập
 *    mà Phase 1 và Phase 3 đã bỏ công xây.
 * 2. **Không thêm thông tin.** Đúng ba chỗ trống: tên mục tiêu, tên người được
 *    trả lời, và một câu tóm tắt bằng chứng đã được cấp. Không có chỗ tự do nào
 *    khác, nên mẫu không thể bịa ra sự kiện và không thể đổi mục tiêu.
 * 3. **Không lặp liền.** Trùng câu vừa nói thì dịch sang mẫu kế tiếp.
 */

export type SpeechTemplatePool = Partial<Record<BotSpeechTone, string[]>> & {
  /** Luôn có: mọi giọng thiếu mẫu đều rơi về đây. */
  NEUTRAL: string[];
};

/**
 * Bảng mẫu.
 *
 * Viết như người chơi gõ trong khung chat: câu cụt, từ đệm nhẹ, không dấu câu
 * cầu kỳ. Vài mẫu cố tình không phải câu hoàn chỉnh - đó là cách người ta chat.
 */
export const SPEECH_TEMPLATES: Record<BotSpeechKind, SpeechTemplatePool> = {
  ACCUSE: {
    NEUTRAL: [
      "Tôi nghi {target}, {evidence}.",
      "{target} đáng ngờ đấy, {evidence}.",
      "Nói thật là tôi để ý {target} từ nãy, {evidence}.",
      "{evidence} — {target} giải thích được không.",
      "Tôi chọn {target}. {evidence}.",
      "Hmm, {target} nhé. {evidence}.",
    ],
    FIRM: [
      "Tôi nghi {target}, {evidence}.",
      "{target} đi, {evidence} rồi còn gì.",
      "Cái này rõ mà: {evidence}. {target}.",
      "Tôi bầu {target}, lý do là {evidence}.",
      "Khỏi vòng vo, {target}. {evidence}.",
      "{evidence}. Với tôi thế là đủ về {target}.",
    ],
    TENSE: [
      "{target} chứ ai nữa, {evidence}.",
      "Thôi khỏi cãi, {evidence}. {target}.",
      "{target} đang lươn quá đấy, {evidence}.",
      "Tôi chán rồi. {target}, {evidence}.",
    ],
    SOFT: [
      "Mình hơi nghi {target}, tại {evidence}.",
      "Không chắc lắm nhưng {target} nhé, {evidence}.",
      "Có khi là {target} chăng, {evidence}.",
      "Mình nghiêng về {target}, {evidence}.",
    ],
    PLAYFUL: [
      "Đặt cửa {target} nào, {evidence}.",
      "{target} ơi, {evidence} kìa.",
      "Thôi tôi vote {target} cho vui, mà {evidence} thật.",
      "Xin phép nghi {target} một cái, {evidence}.",
    ],
    CURIOUS: [
      "Tôi nghi {target} — {evidence}, thấy sao?",
      "{evidence}. Ai thấy {target} ổn không?",
      "Có ai để ý {target} không, {evidence}.",
      "{target} nhé, {evidence}. Mọi người nghĩ thế nào.",
    ],
  },

  QUESTION: {
    NEUTRAL: [
      "{target} nghĩ sao về tình hình bây giờ?",
      "{target} nói vài câu đi.",
      "Nãy giờ {target} im nhỉ.",
      "{target} đang tính bầu ai thế?",
      "Cho hỏi {target} thấy ai lạ nhất?",
      "{target} ơi, ý kiến đi.",
    ],
    CURIOUS: [
      "{target} nghĩ sao về tình hình bây giờ?",
      "{target} đọc được gì chưa?",
      "Ơ {target}, sao im thế?",
      "{target} thấy ai đáng nghi nhất?",
      "Hỏi thật, {target} đang nghĩ gì?",
      "{target} kể xem nãy giờ để ý được gì.",
    ],
    FIRM: [
      "{target} nói đi.",
      "{target}, ý kiến đâu.",
      "Đến lượt {target} rồi đấy.",
      "{target} trả lời cái.",
    ],
    SOFT: [
      "{target} có muốn nói gì không?",
      "Mình muốn nghe {target} tí.",
      "{target} thấy sao nhỉ?",
      "Không ép nhưng {target} nói vài câu nhé.",
    ],
    PLAYFUL: [
      "{target} ngủ à?",
      "Alo {target}, còn sống không đó.",
      "{target} im như thóc thế.",
      "Ai đánh thức {target} hộ cái.",
    ],
    TENSE: [
      "{target} định im tới bao giờ.",
      "{target}, nói đi chứ.",
      "Im mãi thế {target}.",
      "{target} tránh né gì vậy.",
    ],
  },

  WITHHOLD: {
    NEUTRAL: [
      "Tôi chưa đủ căn cứ để treo ai.",
      "Thật sự chưa thấy gì rõ.",
      "Chưa đủ dữ kiện, tôi chưa chốt.",
      "Từ từ đã, tôi chưa nghĩ ra.",
      "Nay tôi chịu, chưa đọc được ai.",
    ],
    SOFT: [
      "Mình chưa dám chỉ ai cả.",
      "Chưa chắc lắm, để mình nghe thêm.",
      "Mình còn phân vân.",
      "Thôi mình chưa quyết đâu.",
    ],
    FIRM: [
      "Chưa đủ căn cứ, tôi không chốt bừa.",
      "Không có bằng chứng thì tôi không bầu.",
      "Tôi giữ phiếu.",
      "Chưa rõ thì đừng treo bừa.",
    ],
    PLAYFUL: [
      "Não tôi đang lag, chưa nghĩ ra.",
      "Nay tôi đoán dở lắm, chịu.",
      "Xin một quyền trợ giúp.",
      "Thôi tôi hóng đã.",
    ],
    TENSE: [
      "Chưa gì rõ ràng cả, đừng đẩy tôi.",
      "Tôi chưa chốt, đừng hỏi nữa.",
      "Thiếu căn cứ mà cứ giục.",
      "Chưa đủ, thế thôi.",
    ],
    CURIOUS: [
      "Tôi chưa rõ, ai có gì thêm không?",
      "Chưa đủ căn cứ — có ai đọc ra gì chưa?",
      "Tôi mù rồi, mọi người thấy sao?",
      "Chưa chốt được, có ai chắc hơn không.",
    ],
  },

  /**
   * Hình dạng của những mẫu này bị PARSER ép, không phải do thẩm mỹ.
   *
   * `parseClause` chỉ nhận vai ở ĐẦU mệnh đề, ngay sau đúng chuỗi `"tôi là "`,
   * và nó GIẾT cả mệnh đề nếu thấy một từ phủ định. Nên câu khai phải là một
   * mệnh đề riêng, mở đầu bằng đúng ba chữ đó, và không được chứa "không",
   * "chưa", "chẳng", "chả" trong cùng mệnh đề. Lời nhấn mạnh phải nằm ở mệnh
   * đề KHÁC, sau một dấu câu.
   *
   * `{role}` do `fill()` thay bằng `ROLE_META[claimedRole].name` — cùng bảng
   * chữ mà giao diện đang hiển thị, nên không có bảng thứ hai để trôi lệch.
   */
  CLAIM_ROLE: {
    NEUTRAL: [
      "Tôi là {role}.",
      "Nói thật, tôi là {role}.",
      "Thôi được rồi. Tôi là {role}.",
      "Tôi là {role}, giờ nói ra đây.",
    ],
    FIRM: [
      "Tôi là {role}.",
      "Tôi là {role}, nghe cho rõ.",
      "Khỏi đoán nữa. Tôi là {role}.",
      "Tôi là {role}. Tin hay tuỳ mọi người.",
    ],
    TENSE: [
      "Tôi là {role}, đủ rồi đấy.",
      "Tôi là {role}. Ép tôi lộ ra thì đây.",
      "Được, tôi là {role}.",
      "Tôi là {role}, hài lòng chưa.",
    ],
    SOFT: [
      "Mình xin nói thật, tôi là {role}.",
      "Tôi là {role}, mình giấu nãy giờ.",
      "Thật ra, tôi là {role}.",
      "Tôi là {role}. Mong mọi người nghe mình.",
    ],
    PLAYFUL: [
      "Lộ bài luôn: tôi là {role}.",
      "Tôi là {role} đây, bất ngờ chưa.",
      "Ừ thì, tôi là {role}.",
      "Tôi là {role}, khai xong nhẹ cả người.",
    ],
    CURIOUS: [
      "Tôi là {role}. Ai tin tôi nào?",
      "Tôi là {role}, mọi người thấy sao?",
      "Tôi là {role}. Có ai muốn hỏi gì không.",
      "Tôi là {role} — giờ tính thế nào?",
    ],
  },

  /**
   * `parseCounterClaim` so trên CẢ tin nhắn và đòi hai mẩu cùng lúc:
   * `" không thể là "` rồi `"tôi mới là "`. Nó cũng là mẫu DUY NHẤT được phép
   * chứa từ phủ định, vì phủ định chính là nội dung của nó. Đừng đảo thứ tự
   * hai vế và đừng bỏ dấu phẩy.
   */
  COUNTER_CLAIM: {
    NEUTRAL: [
      "{target} không thể là {role}, tôi mới là {role}.",
      "Sai rồi, {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role} được, tôi mới là {role}.",
      "Nghe này: {target} không thể là {role}, tôi mới là {role}.",
    ],
    FIRM: [
      "{target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role} đâu, tôi mới là {role}.",
      "Dừng lại. {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role}, tôi mới là {role}, rõ chưa.",
    ],
    TENSE: [
      "{target} không thể là {role}, tôi mới là {role}.",
      "Láo. {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role} nhé, tôi mới là {role}.",
      "Nó bịa đấy, {target} không thể là {role}, tôi mới là {role}.",
    ],
    SOFT: [
      "Mình tiếc, {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role} đâu ạ, tôi mới là {role}.",
      "Xin lỗi nhé, {target} không thể là {role}, tôi mới là {role}.",
      "Mình phải nói: {target} không thể là {role}, tôi mới là {role}.",
    ],
    PLAYFUL: [
      "Ơ hay, {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role} nha, tôi mới là {role}.",
      "Cướp vai à? {target} không thể là {role}, tôi mới là {role}.",
      "Vui nhỉ. {target} không thể là {role}, tôi mới là {role}.",
    ],
    CURIOUS: [
      "{target} không thể là {role}, tôi mới là {role}. Tin ai đây?",
      "Lạ nhỉ, {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role}, tôi mới là {role} — sao đây?",
      "{target} không thể là {role}, tôi mới là {role}. Mọi người xử đi.",
    ],
  },

  REPLY: {
    NEUTRAL: [
      "{author}, ý tôi là thế này thôi.",
      "Ừ {author}, tôi hiểu ý.",
      "Trả lời {author}: tôi không nghĩ vậy đâu.",
      "{author} này, tôi nói rồi đó.",
      "Về câu của {author} thì tôi thấy bình thường.",
      "Được rồi {author}, tôi nghe.",
    ],
    PLAYFUL: [
      "{author} hỏi khó ghê.",
      "Ơ {author}, hỏi thế ai trả lời được.",
      "{author} bình tĩnh nào.",
      "Ok ok {author}, tôi đây.",
    ],
    FIRM: [
      "{author}, tôi trả lời rồi đấy.",
      "Nghe này {author}: không phải như vậy.",
      "{author} nghe cho rõ nhé.",
      "Tôi nói thẳng với {author} luôn.",
    ],
    SOFT: [
      "{author} ơi, mình hiểu ý cậu.",
      "Mình trả lời {author} nhé.",
      "Không sao đâu {author}.",
      "{author} này, mình nghĩ khác tí.",
    ],
    TENSE: [
      "{author} hỏi vậy là sao.",
      "Tôi trả lời {author} một lần thôi.",
      "{author} đừng bắt bẻ nữa.",
      "Nói với {author} cho rõ luôn.",
    ],
    CURIOUS: [
      "{author} hỏi vậy nghĩa là sao?",
      "Ý {author} là gì cơ?",
      "{author} nói rõ hơn đi.",
      "Tôi chưa hiểu ý {author}.",
    ],
  },

  AGREE: {
    NEUTRAL: [
      "Ừ, tôi cũng nghi {target}.",
      "Đồng ý về {target}.",
      "Tôi cùng ý, {target} lạ thật.",
      "Chuẩn, {target} đáng ngờ.",
      "Tôi cũng thấy {target} như vậy.",
      "Ok, {target} nhé.",
    ],
    SOFT: [
      "Mình cũng nghiêng về {target}.",
      "Ừ, {target} cũng có lý.",
      "Mình thấy hợp lý, {target} nhé.",
      "Đồng ý nhẹ về {target} thôi.",
    ],
    FIRM: [
      "Đúng, {target}.",
      "Tôi theo, {target} đi.",
      "Chốt {target}.",
      "Không cần bàn thêm, {target}.",
    ],
    PLAYFUL: [
      "Hai ta cùng thuyền, {target} nhé.",
      "Đồng ý luôn, {target} xui rồi.",
      "Ừ ừ, {target}.",
      "Tôi cũng cửa {target}.",
    ],
    TENSE: [
      "Ừ, {target}, tôi nói từ nãy rồi.",
      "Cuối cùng cũng có người thấy {target} lạ.",
      "Đúng {target} chứ còn ai.",
      "Ừ. {target}.",
    ],
    CURIOUS: [
      "Ừ tôi cũng nghi {target}, còn ai thấy vậy không?",
      "Tôi đồng ý về {target} — ai khác thì sao?",
      "Ừ, {target}. Mọi người nghĩ sao.",
      "Tôi cũng nghĩ {target}, nhưng chắc chưa?",
    ],
  },

  DISAGREE: {
    NEUTRAL: [
      "Tôi không nghĩ vậy về {target}.",
      "Không, {target} không hợp lý đâu.",
      "Tôi thấy khác, {target} chưa đủ.",
      "Khoan đã, {target} thì hơi vội.",
      "Tôi phản đối chuyện {target}.",
      "Không đồng ý về {target}.",
    ],
    FIRM: [
      "Không. {target} sai rồi.",
      "Tôi không theo vụ {target}.",
      "Chuyện {target} này vô lý.",
      "Tôi phản đối, {target} không đúng.",
    ],
    TENSE: [
      "{target} cái gì mà {target}.",
      "Vô lý, {target} kiểu gì.",
      "Tôi không chịu vụ {target} đâu.",
      "Đừng đẩy {target} như thế.",
    ],
    SOFT: [
      "Mình hơi khác ý về {target}.",
      "Mình chưa thấy thuyết phục lắm về {target}.",
      "Có khi không phải {target} đâu.",
      "Mình nghiêng hướng khác, không phải {target}.",
    ],
    PLAYFUL: [
      "Ơ {target} á, thôi nào.",
      "Tôi cửa ngược, không phải {target}.",
      "{target}? Nghe hài quá.",
      "Cho tôi xin, {target} thì hơi quá.",
    ],
    CURIOUS: [
      "Tôi không nghĩ là {target} — dựa vào đâu vậy?",
      "Sao lại {target}? Tôi thấy khác.",
      "Không đồng ý về {target}, lý do là gì?",
      "{target} thật à? Tôi chưa thấy.",
    ],
  },

  CHALLENGE: {
    NEUTRAL: [
      "{author} nói rõ xem nào.",
      "{author} dựa vào đâu thế?",
      "Tôi muốn nghe {author} giải thích.",
      "{author} nói lại cho rõ đi.",
    ],
    FIRM: [
      "{author} nói rõ ra đi.",
      "{author} chứng minh xem.",
      "Đừng nói chung chung, {author}.",
      "{author} trả lời thẳng vào.",
    ],
    TENSE: [
      "{author} đang lái đấy à.",
      "{author} nói kiểu gì vậy.",
      "Tôi hỏi thật {author}, ý đồ gì.",
      "{author} nói cho tử tế.",
    ],
    SOFT: [
      "{author} nói thêm chút được không.",
      "Mình chưa hiểu ý {author} lắm.",
      "{author} giải thích giúp mình.",
      "Cho mình hỏi lại {author} nhé.",
    ],
    PLAYFUL: [
      "{author} chém à?",
      "Ơ {author}, dẫn chứng đâu.",
      "{author} nói nghe ghê ta.",
      "Bằng chứng đâu {author} ơi.",
    ],
    CURIOUS: [
      "{author} dựa vào đâu vậy?",
      "Sao {author} chắc thế?",
      "{author} thấy gì mà nói vậy?",
      "Ý {author} là sao cơ?",
    ],
  },

  DEFEND: {
    NEUTRAL: [
      "Đừng treo {target} vội.",
      "Tôi thấy {target} ổn mà.",
      "Khoan, {target} chưa làm gì sai.",
      "Để {target} nói đã.",
    ],
    SOFT: [
      "Mình thấy {target} không đáng nghi đâu.",
      "Từ từ đã, {target} chưa chắc.",
      "Mình bênh {target} cái.",
      "Đừng vội với {target} nhé.",
    ],
    FIRM: [
      "Không, {target} không phải.",
      "Bỏ {target} ra, nhắm người khác đi.",
      "Tôi bảo đảm {target} ổn.",
      "Treo {target} là mất một ngày.",
    ],
    TENSE: [
      "Đừng có đẩy {target}.",
      "Lại {target} à, chán thật.",
      "Ai đẩy {target} thế.",
      "Thôi tha cho {target} đi.",
    ],
    PLAYFUL: [
      "{target} vô tội mà, tôi thề.",
      "Tha cho {target} cái nào.",
      "Ơ, {target} hiền thế mà.",
      "Cho {target} sống thêm ngày nữa.",
    ],
    CURIOUS: [
      "Sao lại {target}? Tôi thấy ổn mà.",
      "{target} làm gì mà bị đẩy vậy?",
      "Ai nghi {target} thế, vì sao?",
      "Có gì về {target} mà tôi bỏ lỡ à?",
    ],
  },

  ASK_EVIDENCE: {
    NEUTRAL: [
      "{author} có căn cứ gì không?",
      "Dựa vào đâu vậy {author}?",
      "{author} nói rõ lý do đi.",
      "Cho tôi xin bằng chứng, {author}.",
      "{author} thấy gì mà chắc thế?",
      "Lý do là gì {author}?",
    ],
    CURIOUS: [
      "{author} có căn cứ gì không?",
      "Ơ, {author} dựa vào đâu?",
      "{author} kể xem thấy gì.",
      "Sao {author} chắc vậy?",
      "Bằng chứng đâu {author}?",
      "{author} nói rõ hơn được không.",
    ],
    FIRM: [
      "Bằng chứng đâu {author}.",
      "{author} đưa lý do ra.",
      "Không có căn cứ thì đừng nói, {author}.",
      "{author} chứng minh đi.",
    ],
    TENSE: [
      "{author} nói suông à.",
      "Bằng chứng đâu, {author}.",
      "{author} đừng chém.",
      "Không có gì thì im, {author}.",
    ],
    SOFT: [
      "{author} có gì để mình tin không?",
      "Mình muốn nghe lý do của {author}.",
      "{author} chia sẻ căn cứ đi.",
      "Cho mình xin lý do nhé {author}.",
    ],
    PLAYFUL: [
      "Nguồn đâu {author}?",
      "{author} nói có sách không?",
      "Ủa {author}, bịa à?",
      "Show hàng đi {author}.",
    ],
  },

  CHANGE_MIND: {
    NEUTRAL: [
      "Tôi đổi ý, giờ tôi nghi {target}.",
      "Nghĩ lại thì {target} mới đúng.",
      "Thôi tôi chuyển sang {target}.",
      "Tôi rút lại lúc nãy, {target} nhé.",
    ],
    SOFT: [
      "Mình đổi ý rồi, {target} nhé.",
      "Nghe mọi người xong mình nghiêng về {target}.",
      "Mình nghĩ lại, chắc là {target}.",
      "Thôi mình theo {target}.",
    ],
    FIRM: [
      "Tôi đổi phiếu. {target}.",
      "Rút lại, giờ là {target}.",
      "Tôi sai lúc nãy. {target}.",
      "Chuyển sang {target}.",
    ],
    PLAYFUL: [
      "Ừ thì tôi sai, {target} nhé.",
      "Quay xe, {target}.",
      "Đổi cửa sang {target}.",
      "Thôi tôi theo {target} vậy.",
    ],
    TENSE: [
      "Được rồi, {target}. Tôi đổi.",
      "Thôi {target} đi, tôi chán rồi.",
      "Đổi, {target}.",
      "Tôi rút, giờ là {target}.",
    ],
    CURIOUS: [
      "Tôi đổi ý sang {target}, ai theo không?",
      "Giờ tôi nghi {target} hơn — mọi người sao?",
      "Nghĩ lại thì {target}, thấy hợp lý không?",
      "Chuyển sang {target} nhé, ai phản đối?",
    ],
  },

  REACTION: {
    NEUTRAL: ["Ừ.", "Hmm.", "Ờ thế à.", "Được rồi.", "Ok.", "Thấy rồi."],
    PLAYFUL: ["Ơ kìa.", "Hehe.", "Ủa.", "Trời."],
    FIRM: ["Ừ.", "Rõ.", "Được.", "Biết rồi."],
    SOFT: ["Ừ nhỉ.", "Ờ.", "Cũng được.", "Vậy à."],
    TENSE: ["Hừ.", "Thôi được.", "Chán.", "Lại thế."],
    CURIOUS: ["Ơ?", "Thế à?", "Hả?", "Sao cơ?"],
  },

  HUMOR: {
    NEUTRAL: [
      "Thôi tôi im cho lành.",
      "Nay tôi hóng là chính.",
      "Tôi đứng ngoài xem.",
      "Cứ để mọi người cãi đã.",
    ],
    PLAYFUL: [
      "Tôi mà là sói thì tôi đã diễn hay hơn rồi.",
      "Làng này cãi nhau hay hơn xem phim.",
      "Tôi bán hạt dưa đây.",
      "Nay ai cũng thành thám tử hết.",
    ],
    SOFT: [
      "Thôi mọi người bình tĩnh nào.",
      "Đừng căng quá.",
      "Từ từ rồi cũng ra.",
      "Cãi nhẹ thôi.",
    ],
    FIRM: [
      "Cãi ít thôi, bầu đi.",
      "Nói ít làm nhiều.",
      "Thôi vào việc.",
      "Đủ rồi đấy.",
    ],
    TENSE: [
      "Cãi nhau cả ngày được đấy.",
      "Hay lắm, cứ thế mà thua.",
      "Sói nó đang cười kìa.",
      "Thôi khỏi bầu luôn.",
    ],
    CURIOUS: [
      "Ai đang vui nhất ở đây nhỉ?",
      "Có ai nghiêm túc không đấy?",
      "Nãy giờ ai chưa nói ta?",
      "Thế cuối cùng bầu ai?",
    ],
  },
};

export interface SpeechTemplateRequest {
  intention: BotSpeechIntention;
  /** Tên hiển thị của mục tiêu, hoặc `null`. */
  targetName: string | null;
  /** Tên người được trả lời, hoặc `null`. */
  replyToName: string | null;
  /** Khoá seed của ván/phòng. */
  seedTag: string;
  botId: string;
  round: number;
  /** Thứ tự lượt nói của chính BOT; nguồn biến thiên chính. */
  seq: number;
  /** Vân tay của những câu vừa nói, để không chọn lại. */
  avoidFingerprints?: readonly string[];
}

/** Giọng gần nhất có mẫu; `NEUTRAL` luôn tồn tại nên vòng lặp luôn dừng. */
function poolFor(kind: BotSpeechKind, tone: BotSpeechTone): string[] {
  const table = SPEECH_TEMPLATES[kind];
  return table[tone] ?? table.NEUTRAL;
}

/**
 * Điền chỗ trống.
 *
 * Ba khoá, không hơn. Thiếu dữ liệu thì dùng một từ chung chung thay vì để lộ
 * `undefined` hay một dấu ngoặc chưa thay - cả hai đều đọc ra như lỗi phần mềm
 * ngay giữa một ván đấu.
 */
function fill(template: string, request: SpeechTemplateRequest): string {
  const first = request.intention.evidence[0];
  return template
    .replace(/\{target\}/g, request.targetName ?? "người đó")
    .replace(/\{author\}/g, request.replyToName ?? request.targetName ?? "bạn")
    .replace(/\{evidence\}/g, first?.summary ?? "tôi thấy hơi lạ")
    .replaceAll("{role}", request.intention.claimedRole
      ? ROLE_META[request.intention.claimedRole].name
      : "dân làng");
}

/**
 * Một câu cho ý định này.
 *
 * Chỉ số mẫu là hàm băm của seed + bot + vòng + lượt + vân tay ngữ nghĩa. Hai
 * BOT cùng ý ở cùng vòng vẫn nói khác nhau vì `botId` nằm trong khoá; cùng một
 * BOT ở hai lượt khác nhau cũng vậy vì `seq` nằm trong khoá.
 */
export function renderSpeechTemplate(request: SpeechTemplateRequest): string {
  const { intention } = request;
  const pool = poolFor(intention.kind, intention.tone);
  const avoid = new Set(request.avoidFingerprints ?? []);

  const semantic = [
    intention.kind,
    intention.targetId ?? "-",
    intention.replyToMessageId ?? "-",
    intention.topic ?? "-",
  ].join("|");
  const start =
    fnv1a32(`${request.seedTag}|${request.botId}|${request.round}|${request.seq}|${semantic}`) %
    pool.length;

  for (let step = 0; step < pool.length; step += 1) {
    const text = fill(pool[(start + step) % pool.length]!, request);
    if (!avoid.has(speechTextFingerprint(text))) return text;
  }

  // Cả bảng đều đã nói gần đây. Trả về mẫu đầu tiên chứ không ném: một lượt
  // nói trùng còn tốt hơn một ngoại lệ chạy lên tầng scheduler.
  return fill(pool[start]!, request);
}

/** Dùng cho test: mọi giọng đều có mẫu, kể cả khi rơi về `NEUTRAL`. */
export function templatePoolSizes(kind: BotSpeechKind): Record<BotSpeechTone, number> {
  const sizes = {} as Record<BotSpeechTone, number>;
  for (const tone of BOT_SPEECH_TONES) sizes[tone] = poolFor(kind, tone).length;
  return sizes;
}
