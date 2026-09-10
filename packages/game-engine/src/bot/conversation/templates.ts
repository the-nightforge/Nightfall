import { isRole, ROLE_META } from "@masoi/shared";
import { fnv1a32 } from "../hash";
import {
  BOT_SPEECH_TONES,
  type BotSpeechIntention,
  type BotSpeechKind,
  type BotSpeechTone,
} from "../types";
import { openingOf, speechTextFingerprint } from "./fingerprint";

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
 * 2. **Không thêm thông tin.** Đúng bốn chỗ trống: tên mục tiêu, tên người được
 *    trả lời, một câu tóm tắt bằng chứng đã được cấp, và tên vai đã chốt. Không
 *    có chỗ tự do nào khác, nên mẫu không thể bịa ra sự kiện và không thể đổi
 *    mục tiêu.
 * 3. **Không lặp liền.** Trùng câu vừa nói thì dịch sang mẫu kế tiếp; trùng
 *    cách mở đầu gần đây cũng dịch, nếu còn mẫu để dịch.
 *
 * Từ Task A (bot chat giống người): mỗi bể có tối thiểu 12 mẫu, khoảng một
 * phần ba là câu cụt/teencode, và có một lớp "nhiễu người" - hạ chữ đầu câu,
 * typo hiếm - đi qua đúng một hàm băm. Xem `humanize()` bên dưới.
 */

export type SpeechTemplatePool = Partial<Record<BotSpeechTone, string[]>> & {
  /** Luôn có: mọi giọng thiếu mẫu đều rơi về đây. */
  NEUTRAL: string[];
};

/**
 * Bảng mẫu.
 *
 * Viết như người chơi gõ trong khung chat: câu cụt, từ đệm nhẹ, teencode vừa
 * phải (`k`, `ko`, `mn`, `=))`, `kkk`), không dấu câu cầu kỳ. Nhiều mẫu cố tình
 * không phải câu hoàn chỉnh - đó là cách người ta chat.
 *
 * Bốn luật khi thêm mẫu, vì bot KHÁC đọc những câu này bằng `chat-analysis`:
 *
 * - Ngoài `CLAIM_ROLE`/`COUNTER_CLAIM`, không mẫu nào được chứa `tôi là ` ở đầu
 *   mệnh đề, hay `<tên> là sói` - hai mẫu đó ghim một lời khai/cáo buộc vào
 *   state của cả bàn. Có test quét toàn bảng.
 * - Tránh những từ tình cờ trùng tên người khi bỏ dấu ("bình thường" khớp
 *   "Bình", "chi tiết" khớp "Chi").
 * - Ở mẫu không phải câu hỏi, hạn chế `sao/gì/nào/đâu/ai` cạnh một cái tên:
 *   parser coi đó là câu hỏi nhắm thẳng và bot kia sẽ thấy mình "bị hỏi".
 * - Một phần mẫu `ACCUSE` giữ dạng `tôi nghi {target}` và một phần `DEFEND` giữ
 *   `đừng treo {target}` / `tôi tin {target}`: đó là những gì bot khác đọc
 *   được. Bỏ hết là belief của cả bàn mất một nguồn, và win-rate trôi.
 */
export const SPEECH_TEMPLATES: Record<BotSpeechKind, SpeechTemplatePool> = {
  ACCUSE: {
    NEUTRAL: [
      "Tôi nghi {target}, {evidence}.",
      "{target} đáng ngờ đấy, {evidence}.",
      "Nói thật là tôi để ý {target} từ nãy, {evidence}.",
      "{evidence}. {target} giải thích được không.",
      "Tôi chọn {target}. {evidence}.",
      "Hmm, {target} nhé. {evidence}.",
      "{target} nha, {evidence}, ko đùa.",
      "ủa {target} kìa, {evidence}.",
      "hóng {target} giải thích vụ {evidence}.",
      "{target} =)) {evidence}.",
      "Để ý {target} đi mn, {evidence}.",
      "{target}. {evidence}. Thế thôi.",
      "tôi nghi {target} thật, {evidence}.",
    ],
    FIRM: [
      "Tôi nghi {target}, {evidence}.",
      "{target} đi, {evidence} rồi còn gì.",
      "Cái này rõ mà: {evidence}. {target}.",
      "Tôi bầu {target}, lý do là {evidence}.",
      "Khỏi vòng vo, {target}. {evidence}.",
      "{evidence}. Với tôi thế là đủ về {target}.",
      "{target}. Chốt. {evidence}.",
      "ko bàn nữa, {target}. {evidence}.",
      "{target} rõ rồi, {evidence}, ai theo thì theo.",
      "{evidence}, {target} k thoát được.",
      "Tôi nghi {target} nhất. {evidence}.",
      "{target}, hết. {evidence}.",
      "1 phiếu {target}. {evidence}.",
    ],
    TENSE: [
      "{target} chứ ai nữa, {evidence}.",
      "Thôi khỏi cãi, {evidence}. {target}.",
      "{target} đang lươn quá đấy, {evidence}.",
      "Tôi chán rồi. {target}, {evidence}.",
      "Tôi nghi {target}, {evidence}, đừng có lươn.",
      "{target}. {evidence}. Cãi nữa đi.",
      "mệt {target} ghê, {evidence}.",
      "{evidence}. {target} còn diễn tới bao giờ.",
      "{target} thôi đi, {evidence}.",
      "ko chịu nổi {target} nữa, {evidence}.",
      "{target} =)) {evidence} mà còn cãi.",
      "Treo {target}. {evidence}. Xong.",
      "{target} lươn vl, {evidence}.",
    ],
    SOFT: [
      "Mình hơi nghi {target}, tại {evidence}.",
      "Không chắc lắm nhưng {target} nhé, {evidence}.",
      "Có khi là {target} chăng, {evidence}.",
      "Mình nghiêng về {target}, {evidence}.",
      "Tôi nghi {target} một chút, {evidence}.",
      "hmm {target} nhỉ, {evidence}.",
      "{target} hơi lạ á, {evidence}.",
      "mình để ý {target} thôi, {evidence}, ko chắc.",
      "{target} nha, {evidence}. Nói nhẹ thôi.",
      "chắc {target}, {evidence}.",
      "Xin lỗi {target} trước, nhưng {evidence}.",
      "{target}, mình đoán vậy. {evidence}.",
      "ơ {target}, {evidence} mà.",
    ],
    PLAYFUL: [
      "Đặt cửa {target} nhé, {evidence}.",
      "{target} ơi, {evidence} kìa.",
      "Thôi tôi vote {target} cho vui, mà {evidence} thật.",
      "Xin phép nghi {target} một cái, {evidence}.",
      "Tôi nghi {target} =)) {evidence}.",
      "{target} hôm nay diễn hơi lố, {evidence}.",
      "kkk {target} lộ rồi, {evidence}.",
      "{target} xui rồi, {evidence}.",
      "cửa {target} nha, {evidence}.",
      "{target} ăn hành nhé, {evidence}.",
      "{evidence}, {target} còn cười =)).",
      "vote {target} cho vui, {evidence}.",
      "Alo {target}, {evidence} đó nha.",
    ],
    CURIOUS: [
      "Tôi nghi {target}, {evidence}, thấy sao?",
      "{evidence}. Ai thấy {target} ổn không?",
      "Có ai để ý {target} không, {evidence}.",
      "{target} nhé, {evidence}. Mọi người nghĩ thế nào.",
      "Tôi nghi {target}, {evidence}. Có ai cùng ý ko?",
      "{target} thì sao, {evidence}?",
      "ủa {target}, {evidence} là sao?",
      "hmm {target}, {evidence}. Ai giải thích hộ?",
      "{evidence}, {target} nói gì đi?",
      "{target} có gì đó, {evidence}. Mn thấy ko?",
      "Nghi {target} có đúng ko, {evidence}?",
      "{target}? {evidence} đấy.",
      "để ý {target} chưa mn, {evidence}.",
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
      "{target} đâu rồi?",
      "alo {target}?",
      "{target} nói gì đi chứ.",
      "{target} thấy sao?",
      "{target}, ý kiến?",
      "ê {target}, bầu ai?",
      "{target} nãy giờ nghĩ gì thế?",
    ],
    CURIOUS: [
      "{target} nghĩ sao về tình hình bây giờ?",
      "{target} đọc được gì chưa?",
      "Ơ {target}, sao im thế?",
      "{target} thấy ai đáng nghi nhất?",
      "Hỏi thật, {target} đang nghĩ gì?",
      "{target} kể xem nãy giờ để ý được gì.",
      "{target} thấy sao, nói nghe?",
      "hóng ý kiến {target}.",
      "{target} có gì chưa?",
      "ủa {target} nghi ai?",
      "{target}, kể đi?",
      "{target} đang nhìn ai vậy?",
      "tò mò {target} nghĩ gì thật.",
    ],
    FIRM: [
      "{target} nói đi.",
      "{target}, ý kiến đâu.",
      "Đến lượt {target} rồi đấy.",
      "{target} trả lời cái.",
      "{target}, nói.",
      "{target} lên tiếng đi.",
      "im hoài vậy {target}, nói.",
      "{target} nói thẳng đi, bầu ai?",
      "{target}, nãy giờ im là sao.",
      "{target} phát biểu.",
      "ê {target}, nói coi.",
      "{target} đừng im nữa.",
      "Hỏi {target} đấy, trả lời đi.",
    ],
    SOFT: [
      "{target} có muốn nói gì không?",
      "Mình muốn nghe {target} tí.",
      "{target} thấy sao nhỉ?",
      "Không ép nhưng {target} nói vài câu nhé.",
      "{target} ơi, nói chút được ko?",
      "{target} nghĩ sao, kể mình nghe?",
      "{target} ổn chứ? Nói gì đi.",
      "hmm {target} thấy thế nào?",
      "{target} chia sẻ tí nhé?",
      "mình hỏi {target} nhẹ thôi, bầu ai?",
      "{target} nói đi, ko sao đâu.",
      "{target} nhỉ, có ý gì ko?",
      "{target} ơi?",
    ],
    PLAYFUL: [
      "{target} ngủ à?",
      "Alo {target}, còn sống không đó.",
      "{target} im như thóc thế.",
      "Ai đánh thức {target} hộ cái.",
      "{target} afk à =))",
      "{target} ơi, hồn về chưa?",
      "ping {target}.",
      "{target} đang đi đâu đấy, quay lại nói coi.",
      "kkk {target} im ghê, nghi gì ko?",
      "{target} có nhà không đó?",
      "{target} bận xem phim à, nói câu đi.",
      "alo alo {target}?",
      "{target} tàng hình giỏi ghê =))",
    ],
    TENSE: [
      "{target} định im tới bao giờ.",
      "{target}, nói đi chứ.",
      "Im mãi thế {target}.",
      "{target} tránh né gì vậy.",
      "{target} im là có ý gì?",
      "{target}, trả lời.",
      "im gì mà im, {target} nói.",
      "{target} né hoài vậy?",
      "{target} còn im nữa là tôi bầu đấy.",
      "nói đi {target}, đừng câu giờ.",
      "{target}, sao im?",
      "{target} sợ gì mà ko nói?",
      "im ghê {target}.",
    ],
  },

  WITHHOLD: {
    NEUTRAL: [
      "Tôi chưa đủ căn cứ để treo ai.",
      "Thật sự chưa thấy gì rõ.",
      "Chưa đủ dữ kiện, tôi chưa chốt.",
      "Từ từ đã, tôi chưa nghĩ ra.",
      "Nay tôi chịu, chưa đọc được ai.",
      "chưa biết.",
      "hmm, chưa chốt được.",
      "để tôi nghe thêm đã.",
      "chưa có gì để nói.",
      "Tôi hóng thêm chút.",
      "chịu, chưa thấy ai lạ.",
      "Chưa chốt. Cho tôi xem thêm.",
      "ko biết nữa, chưa đủ.",
    ],
    SOFT: [
      "Mình chưa dám chỉ ai cả.",
      "Chưa chắc lắm, để mình nghe thêm.",
      "Mình còn phân vân.",
      "Thôi mình chưa quyết đâu.",
      "mình chưa biết nữa.",
      "hmm, mình chịu.",
      "để mình nghĩ thêm nhé.",
      "chưa rõ lắm, mình xin khất.",
      "Mình nghe đã, chưa chốt ai.",
      "mình hơi mù, thật.",
      "chưa dám nói ai hết.",
      "ko chắc, mình chưa chốt.",
      "Mình chưa thấy gì rõ, thật đấy.",
    ],
    FIRM: [
      "Chưa đủ căn cứ, tôi không chốt bừa.",
      "Không có bằng chứng thì tôi không bầu.",
      "Tôi giữ phiếu.",
      "Chưa rõ thì đừng treo bừa.",
      "Chưa đủ. Không chốt.",
      "Tôi không đoán bừa.",
      "giữ phiếu, chưa nói.",
      "ko có căn cứ thì tôi ko nói.",
      "Chưa chốt, đừng hỏi.",
      "Tôi không bầu mù.",
      "chưa đủ, đợi.",
      "Không chốt bừa được.",
      "chưa thấy gì, im.",
    ],
    PLAYFUL: [
      "Não tôi đang lag, chưa nghĩ ra.",
      "Nay tôi đoán dở lắm, chịu.",
      "Xin một quyền trợ giúp.",
      "Thôi tôi hóng đã.",
      "tôi mù rồi =))",
      "hóng thôi, chưa chốt.",
      "não load chưa xong.",
      "kkk chịu, chưa thấy ai.",
      "cho tôi xin 50/50.",
      "hmm tôi đang tung đồng xu.",
      "chưa biết, hóng tiếp.",
      "não tôi trắng luôn.",
      "Chịu. Cho tôi hóng ván này.",
    ],
    TENSE: [
      "Chưa gì rõ ràng cả, đừng đẩy tôi.",
      "Tôi chưa chốt, đừng hỏi nữa.",
      "Thiếu căn cứ mà cứ giục.",
      "Chưa đủ, thế thôi.",
      "đừng giục, chưa có gì.",
      "Tôi chưa chốt. Chấm hết.",
      "chưa, đừng ép.",
      "ko có gì để nói, thật.",
      "Chưa thấy gì, hỏi mãi.",
      "mệt, chưa chốt được.",
      "Ép tôi cũng chưa có gì.",
      "chưa đủ căn cứ, thôi.",
      "Chưa. Đừng hỏi.",
    ],
    CURIOUS: [
      "Tôi chưa rõ, ai có gì thêm không?",
      "Chưa đủ căn cứ, có ai đọc ra gì chưa?",
      "Tôi mù rồi, mọi người thấy sao?",
      "Chưa chốt được, có ai chắc hơn không.",
      "ai có gì ko, tôi chưa thấy.",
      "chưa biết, mn nghi ai?",
      "hmm, ai có manh mối gì ko?",
      "Tôi chưa có gì. Ai có?",
      "chưa rõ, ai nói tiếp đi?",
      "Mọi người thấy gì ko, tôi chịu.",
      "ai chắc hơn tôi nói đi.",
      "Chưa chốt, hóng ý mn.",
      "ủa mn nghi ai, tôi chưa có.",
    ],
  },

  /**
   * Hình dạng của những mẫu này bị PARSER ép, không phải do thẩm mỹ.
   *
   * `parseClause` chỉ nhận vai ở ĐẦU mệnh đề, ngay sau đúng chuỗi `"tôi là "`,
   * và nó GIẾT cả mệnh đề nếu thấy một từ phủ định - kể cả teencode `k`/`ko`.
   * Nên câu khai phải là một mệnh đề riêng, mở đầu bằng đúng ba chữ đó, và
   * không được chứa "không", "chưa", "chẳng", "chả", "ko", "k" trong cùng mệnh
   * đề. Lời nhấn mạnh phải nằm ở mệnh đề KHÁC, sau một dấu câu. Lưu ý `=))`
   * KHÔNG phải dấu câu với parser - nó thành khoảng trắng, không tách mệnh đề.
   *
   * `{role}` do `fill()` thay bằng `ROLE_META[claimedRole].name` — cùng bảng
   * chữ mà giao diện đang hiển thị, nên không có bảng thứ hai để trôi lệch.
   *
   * Nhóm này KHÔNG bị typo (xem `humanize`): một chữ rớt dấu ở "tôi là" là
   * một lời khai bốc hơi.
   */
  CLAIM_ROLE: {
    NEUTRAL: [
      "Tôi là {role}.",
      "Nói thật, tôi là {role}.",
      "Thôi được rồi. Tôi là {role}.",
      "Tôi là {role}, giờ nói ra đây.",
      "ok nói luôn, tôi là {role}.",
      "Tôi là {role} nhé.",
      "ừ thì, tôi là {role}.",
      "Tôi là {role}, thật.",
      "Khai luôn: tôi là {role}.",
      "Tôi là {role} đây, mn nghe cho rõ.",
      "hmm, tôi là {role}.",
      "Tôi là {role}, nói sớm cho xong.",
      "Tôi là {role}. Vậy đó.",
    ],
    FIRM: [
      "Tôi là {role}.",
      "Tôi là {role}, nghe cho rõ.",
      "Khỏi đoán nữa. Tôi là {role}.",
      "Tôi là {role}. Tin hay tuỳ mọi người.",
      "Tôi là {role}. Chấm hết.",
      "Nói 1 lần: tôi là {role}.",
      "Tôi là {role}, rõ chưa.",
      "Tôi là {role}. Ai cãi?",
      "ok, tôi là {role}. Xong.",
      "Tôi là {role}, chốt.",
      "Tôi là {role}. Bầu theo tôi.",
      "Tôi là {role}, ko đùa.",
      "Thẳng luôn: tôi là {role}.",
    ],
    TENSE: [
      "Tôi là {role}, đủ rồi đấy.",
      "Tôi là {role}. Ép tôi lộ ra thì đây.",
      "Được, tôi là {role}.",
      "Tôi là {role}, hài lòng chưa.",
      "Rồi. Tôi là {role}. Vui chưa.",
      "Tôi là {role}, ok? Thôi đi.",
      "Tôi là {role}. Giờ cãi nữa đi.",
      "ừ, tôi là {role}. Xong chưa.",
      "Tôi là {role}, mệt mn ghê.",
      "haizz, tôi là {role}.",
      "Tôi là {role}. Đừng ép nữa.",
      "Bắt tôi khai à. Tôi là {role}.",
      "Tôi là {role}, tin thì tin.",
    ],
    SOFT: [
      "Mình xin nói thật, tôi là {role}.",
      "Tôi là {role}, mình giấu nãy giờ.",
      "Thật ra, tôi là {role}.",
      "Tôi là {role}. Mong mọi người nghe mình.",
      "Tôi là {role} nha, mn tin mình nhé.",
      "hmm, tôi là {role} đó.",
      "Tôi là {role}, nói nhỏ thôi.",
      "Xin lỗi vì giấu, tôi là {role}.",
      "Tôi là {role}. Mình nói thật mà.",
      "Ừm, tôi là {role}.",
      "Tôi là {role}, mình sợ lắm.",
      "Tôi là {role} đây ạ.",
      "Nói ra cho nhẹ: tôi là {role}.",
    ],
    PLAYFUL: [
      "Lộ bài luôn: tôi là {role}.",
      "Tôi là {role} đây, bất ngờ chưa.",
      "Ừ thì, tôi là {role}.",
      "Tôi là {role}, khai xong nhẹ cả người.",
      "Tèn ten, tôi là {role}.",
      "Tôi là {role} =)) bất ngờ ha.",
      "Tôi là {role} nè, hihi.",
      "Plot twist: tôi là {role}.",
      "kkk, tôi là {role} đây.",
      "Tôi là {role}. Ai ngờ.",
      "ok lộ hàng, tôi là {role}.",
      "Tôi là {role} nha, đừng sốc.",
      "Tôi là {role}, xin vỗ tay.",
    ],
    CURIOUS: [
      "Tôi là {role}. Ai tin tôi nào?",
      "Tôi là {role}, mọi người thấy sao?",
      "Tôi là {role}. Có ai muốn hỏi gì không.",
      "Tôi là {role}, giờ tính thế nào?",
      "Tôi là {role}. Ai cùng vai ko?",
      "Tôi là {role}, mn nghĩ sao?",
      "hmm, tôi là {role}. Có ai phản bác?",
      "Tôi là {role}. Còn ai nữa ko?",
      "Tôi là {role}, ai tin?",
      "Tôi là {role} nè. Rồi sao nữa?",
      "Tôi là {role}, ok chưa mn?",
      "Tôi là {role}. Có ai khai ko?",
      "Tôi là {role}, hỏi gì hỏi đi.",
    ],
  },

  /**
   * `parseCounterClaim` so trên CẢ tin nhắn và đòi hai mẩu cùng lúc:
   * `" không thể là "` rồi `"tôi mới là "`. Nó cũng là mẫu DUY NHẤT được phép
   * chứa từ phủ định, vì phủ định chính là nội dung của nó. Đừng đảo thứ tự
   * hai vế và đừng bỏ dấu phẩy. Nhóm này cũng không bị typo.
   */
  COUNTER_CLAIM: {
    NEUTRAL: [
      "{target} không thể là {role}, tôi mới là {role}.",
      "Sai rồi, {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role} được, tôi mới là {role}.",
      "Nghe này: {target} không thể là {role}, tôi mới là {role}.",
      "ủa, {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role} nha, tôi mới là {role}.",
      "Khoan. {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role}, tôi mới là {role}. Thật.",
      "hmm {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role}, tôi mới là {role}, mn nghe kỹ.",
      "Nói cho rõ: {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role} đâu, tôi mới là {role}.",
      "ơ, {target} không thể là {role}, tôi mới là {role}.",
    ],
    FIRM: [
      "{target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role} đâu, tôi mới là {role}.",
      "Dừng lại. {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role}, tôi mới là {role}, rõ chưa.",
      "{target} không thể là {role}, tôi mới là {role}. Chấm hết.",
      "Nói láo. {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role}, tôi mới là {role}. Bầu nó đi.",
      "ok, {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role}, tôi mới là {role}, chốt.",
      "Sai. {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role}, tôi mới là {role}. Treo nó.",
      "Thẳng luôn: {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role}, tôi mới là {role}. Hết.",
    ],
    TENSE: [
      "{target} không thể là {role}, tôi mới là {role}.",
      "Láo. {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role} nhé, tôi mới là {role}.",
      "Nó bịa đấy, {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role}, tôi mới là {role}. Bịa trắng trợn.",
      "{target} không thể là {role}, tôi mới là {role}, đừng có diễn.",
      "Điên à. {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role}, tôi mới là {role}. Lươn vừa thôi.",
      "haizz, {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role}, tôi mới là {role}. Cãi đi.",
      "Bực ghê. {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role}, tôi mới là {role}, ko đùa.",
      "{target} không thể là {role}, tôi mới là {role}. Ai tin nó thì tuỳ.",
    ],
    SOFT: [
      "Mình tiếc, {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role} đâu ạ, tôi mới là {role}.",
      "Xin lỗi nhé, {target} không thể là {role}, tôi mới là {role}.",
      "Mình phải nói: {target} không thể là {role}, tôi mới là {role}.",
      "hmm, {target} không thể là {role}, tôi mới là {role} mà.",
      "{target} không thể là {role}, tôi mới là {role}, mình nói thật.",
      "Ngại ghê, {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role} nha, tôi mới là {role}, mn tin mình.",
      "ơ, {target} không thể là {role}, tôi mới là {role} đó.",
      "Mình xin phép: {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role}, tôi mới là {role}. Mình sợ mn hiểu lầm.",
      "Ừm, {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role} đâu, tôi mới là {role}, thật mà.",
    ],
    PLAYFUL: [
      "Ơ hay, {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role} nha, tôi mới là {role}.",
      "Cướp vai à? {target} không thể là {role}, tôi mới là {role}.",
      "Vui nhỉ. {target} không thể là {role}, tôi mới là {role}.",
      "kkk {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role}, tôi mới là {role} =)) diễn hay ghê.",
      "ủa alo, {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role}, tôi mới là {role}. Bắt quả tang.",
      "Hài ghê, {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role}, tôi mới là {role}, xin lỗi nha.",
      "Plot twist: {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role}, tôi mới là {role}. Hết phim.",
      "ê ê, {target} không thể là {role}, tôi mới là {role} nhé.",
    ],
    CURIOUS: [
      "{target} không thể là {role}, tôi mới là {role}. Tin ai đây?",
      "Lạ nhỉ, {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role}, tôi mới là {role}, sao đây?",
      "{target} không thể là {role}, tôi mới là {role}. Mọi người xử đi.",
      "ủa, {target} không thể là {role}, tôi mới là {role}, ai tin ai?",
      "{target} không thể là {role}, tôi mới là {role}. Mn nghĩ sao?",
      "hmm, {target} không thể là {role}, tôi mới là {role}. Lạ ghê.",
      "{target} không thể là {role}, tôi mới là {role}, giờ sao?",
      "Sao lại vậy, {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role}, tôi mới là {role}. Ai giải thích hộ?",
      "{target} không thể là {role}, tôi mới là {role}, mn chọn ai?",
      "Ơ, {target} không thể là {role}, tôi mới là {role}. Rồi sao nữa?",
      "{target} không thể là {role}, tôi mới là {role}. Có ai cùng ý ko?",
    ],
  },

  REPLY: {
    NEUTRAL: [
      "{author}, ý tôi là thế này thôi.",
      "Ừ {author}, tôi hiểu ý.",
      "Trả lời {author}: tôi không nghĩ vậy đâu.",
      "{author} này, tôi nói rồi đó.",
      "Về câu của {author} thì tôi thấy thường thôi.",
      "Được rồi {author}, tôi nghe.",
      "ok {author}, hiểu.",
      "{author} hỏi thì tôi trả lời: chưa.",
      "ừ {author}, tôi thấy rồi.",
      "{author} nói cũng có lý, nhưng tôi vẫn giữ ý.",
      "hmm {author}, tôi nói rồi mà.",
      "{author} ơi, tôi trả lời rồi nha.",
      "ừ thì, {author} nói đúng một phần.",
    ],
    PLAYFUL: [
      "{author} hỏi khó ghê.",
      "Ơ {author}, hỏi thế ai trả lời được.",
      "{author} từ từ nào.",
      "Ok ok {author}, tôi đây.",
      "{author} =)) tôi trả lời rồi mà.",
      "kkk {author} gắt ghê.",
      "{author} hỏi xoáy quá.",
      "alo {author}, có tôi.",
      "{author} nè, tôi đây.",
      "haha {author}, chịu.",
      "{author} ơi tôi nghe rõ rồi.",
      "ủa {author}, hỏi tôi á.",
      "{author} hỏi hay, tôi ko biết =))",
    ],
    FIRM: [
      "{author}, tôi trả lời rồi đấy.",
      "Nghe này {author}: không phải như vậy.",
      "{author} nghe cho rõ nhé.",
      "Tôi nói thẳng với {author} luôn.",
      "{author}, không.",
      "Trả lời {author}: không.",
      "{author}, tôi giữ ý.",
      "ko, {author}.",
      "{author}, đọc lại đi.",
      "Tôi nói với {author} 1 lần thôi.",
      "{author}, nghe kỹ.",
      "Nói rồi, {author}.",
      "{author}, tôi ko đổi.",
    ],
    SOFT: [
      "{author} ơi, mình hiểu ý cậu.",
      "Mình trả lời {author} nhé.",
      "Không sao đâu {author}.",
      "{author} này, mình nghĩ khác tí.",
      "ừ {author}, mình nghe nè.",
      "{author} nói cũng đúng, mình xin nhận.",
      "hmm {author}, mình hiểu mà.",
      "{author} ơi, mình ko có ý đó.",
      "ok {author}, mình tiếp thu.",
      "{author} nhé, mình nói nhẹ thôi.",
      "mình trả lời {author} nha.",
      "{author}, mình thấy cũng có lý.",
      "dạ {author}, mình đây.",
    ],
    TENSE: [
      "{author} hỏi vậy là sao.",
      "Tôi trả lời {author} một lần thôi.",
      "{author} đừng bắt bẻ nữa.",
      "Nói với {author} cho rõ luôn.",
      "{author}, đủ rồi.",
      "haizz {author}.",
      "{author} hỏi hoài.",
      "ko, {author}, tôi nói rồi.",
      "{author} thôi đi.",
      "Mệt {author} ghê.",
      "{author}, tôi trả lời rồi, đọc lại.",
      "{author} soi tôi làm gì.",
      "thôi {author}, đủ.",
    ],
    CURIOUS: [
      "{author} hỏi vậy nghĩa là sao?",
      "Ý {author} là gì cơ?",
      "{author} nói rõ hơn đi.",
      "Tôi chưa hiểu ý {author}.",
      "ủa {author}, ý là sao?",
      "{author} hỏi tôi hay hỏi ai?",
      "hmm {author}, ý gì?",
      "{author} muốn tôi nói gì?",
      "{author}, hỏi lại được ko?",
      "{author} đang hỏi cái gì z?",
      "ơ {author}, hả?",
      "{author} nói lại đi, tôi chưa rõ?",
      "{author} ý là tôi á?",
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
      "+1 {target}.",
      "ừ, {target}.",
      "đúng rồi, {target}.",
      "Tôi nghi {target} luôn.",
      "chuẩn luôn, {target}.",
      "{target} nha, tôi cùng ý.",
      "Cũng thấy vậy về {target}.",
    ],
    SOFT: [
      "Mình cũng nghiêng về {target}.",
      "Ừ, {target} cũng có lý.",
      "Mình thấy hợp lý, {target} nhé.",
      "Đồng ý nhẹ về {target} thôi.",
      "ừ nhỉ, {target}.",
      "mình cũng nghĩ {target} á.",
      "hmm, {target} cũng lạ thật.",
      "ok, mình theo {target} nhé.",
      "mình cùng ý về {target} nha.",
      "Ừ mình cũng thấy {target} hơi lạ.",
      "{target} nhỉ, mình cũng nghĩ vậy.",
      "đồng ý, {target}.",
      "Mình cũng để ý {target} từ nãy.",
    ],
    FIRM: [
      "Đúng, {target}.",
      "Tôi theo, {target} đi.",
      "Chốt {target}.",
      "Không cần bàn thêm, {target}.",
      "Chuẩn. {target}.",
      "+1, {target}.",
      "{target}, tôi theo.",
      "Đúng rồi, treo {target}.",
      "ok {target}.",
      "Tôi nghi {target} từ đầu.",
      "{target}. Đồng ý.",
      "Thế thôi, {target}.",
      "ừ, {target}, chốt.",
    ],
    PLAYFUL: [
      "Hai ta cùng thuyền, {target} nhé.",
      "Đồng ý luôn, {target} xui rồi.",
      "Ừ ừ, {target}.",
      "Tôi cũng cửa {target}.",
      "kkk {target}, cùng ý.",
      "{target} =)) đúng rồi.",
      "cửa {target} nha.",
      "yep, {target}.",
      "cùng team, {target} đi.",
      "{target} bị 2 người nghi rồi kìa.",
      "ok {target}, tôi theo cho vui.",
      "+1 {target} =))",
      "haha đúng, {target}.",
    ],
    TENSE: [
      "Ừ, {target}, tôi nói từ nãy rồi.",
      "Cuối cùng cũng có người thấy {target} lạ.",
      "Đúng {target} chứ còn ai.",
      "Ừ. {target}.",
      "nói mãi mới có người nghe, {target}.",
      "{target}, tất nhiên.",
      "ừ {target}, còn phải hỏi.",
      "Tôi nghi {target} lâu rồi.",
      "chốt {target} đi, lâu quá.",
      "{target}. Xong.",
      "đúng, {target}, treo.",
      "hừ, {target}, thấy chưa.",
      "ừ, {target}, mệt.",
    ],
    CURIOUS: [
      "Ừ tôi cũng nghi {target}, còn ai thấy vậy không?",
      "Tôi đồng ý về {target}, ai khác thì sao?",
      "Ừ, {target}. Mọi người nghĩ sao.",
      "Tôi cũng nghĩ {target}, nhưng chắc chưa?",
      "{target} nhỉ? Tôi cũng thấy.",
      "ừ {target}, mn sao?",
      "đồng ý {target}, ai nữa ko?",
      "Tôi nghi {target} luôn, ai theo?",
      "hmm {target}, cũng có lý nhỉ?",
      "ok {target}, còn ai?",
      "{target} á? ừ cũng lạ.",
      "cùng ý {target}, mn thấy sao?",
      "ừ, {target}, đủ chưa nhỉ?",
    ],
  },

  DISAGREE: {
    NEUTRAL: [
      "Tôi không nghĩ vậy về {target}.",
      "Không, {target} nói vậy không hợp lý.",
      "Tôi thấy khác, {target} chưa đủ.",
      "Khoan đã, {target} hơi vội.",
      "Tôi phản đối ý {target}.",
      "Không đồng ý với {target}.",
      "ko, {target}.",
      "{target} nói thế tôi ko theo.",
      "hmm, tôi thấy khác {target}.",
      "ko đồng ý, {target}.",
      "Tôi nghĩ {target} sai chỗ này.",
      "{target}, chưa thuyết phục.",
      "ko phải vậy đâu {target}.",
    ],
    FIRM: [
      "Không. {target} sai rồi.",
      "Tôi không theo {target}.",
      "{target} nói vậy vô lý.",
      "Tôi phản đối, {target} không đúng.",
      "Không, {target}.",
      "ko, {target} sai.",
      "{target}, sai.",
      "Không đồng ý, {target}.",
      "{target} nói thế là sai.",
      "ko theo {target}.",
      "Sai, {target}, sai hoàn toàn.",
      "Tôi ko chịu ý đó, {target}.",
      "Không phải thế, {target}.",
    ],
    TENSE: [
      "{target} nói cái gì vậy.",
      "Vô lý, {target}.",
      "Tôi không chịu ý {target} đâu.",
      "Đừng đẩy kiểu đó, {target}.",
      "{target} lại thế.",
      "ko, {target}, thôi đi.",
      "{target} nói bậy.",
      "haizz {target}.",
      "{target} lươn vừa thôi.",
      "sai bét, {target}.",
      "{target}, ko.",
      "Tôi mệt kiểu {target} rồi.",
      "{target} nói xong chưa, sai rồi.",
    ],
    SOFT: [
      "Mình hơi khác ý {target}.",
      "Mình chưa thấy thuyết phục lắm, {target} ạ.",
      "Có khi không phải vậy đâu {target}.",
      "Mình nghiêng hướng khác, {target} nhé.",
      "hmm {target}, mình chưa đồng ý.",
      "mình thấy hơi khác {target} á.",
      "{target} ơi, mình ko nghĩ vậy.",
      "ừm, mình chưa theo {target} được.",
      "mình xin phép ko đồng ý với {target}.",
      "{target} nhé, mình thấy chưa đúng.",
      "ko hẳn đâu {target}.",
      "Mình tiếc, mình khác ý {target}.",
      "chưa chắc đâu {target} ơi.",
    ],
    PLAYFUL: [
      "Ơ {target} á, thôi nào.",
      "Tôi cửa ngược {target}.",
      "{target}? Nghe hài quá.",
      "Cho tôi xin, {target} hơi quá.",
      "=)) {target} nói gì z.",
      "kkk {target}, ko đâu.",
      "{target} chém ghê.",
      "ko phải đâu {target} ơi =))",
      "{target} nói vậy tôi cười xỉu.",
      "ủa {target}, thật hả.",
      "{target} quay xe đi.",
      "haha {target}, ko.",
      "{target} đoán sai bét rồi.",
    ],
    CURIOUS: [
      "Tôi không nghĩ vậy, {target} dựa vào đâu?",
      "Sao lại thế, {target}? Tôi thấy khác.",
      "Không đồng ý với {target}, lý do là gì?",
      "{target} thật à? Tôi chưa thấy.",
      "ủa {target}, sao lại vậy?",
      "{target} chắc ko? tôi thấy khác.",
      "hmm {target}, dựa vào gì?",
      "{target}, có chắc ko?",
      "ko đồng ý, {target} nghĩ lại chưa?",
      "{target} nói vậy dựa vào đâu?",
      "ơ {target}, thật á?",
      "sao {target} nghĩ vậy?",
      "{target} có bằng chứng ko mà nói?",
    ],
  },

  CHALLENGE: {
    NEUTRAL: [
      "{author} nói rõ xem nào.",
      "{author} dựa vào đâu thế?",
      "Tôi muốn nghe {author} giải thích.",
      "{author} nói lại cho rõ đi.",
      "{author} giải thích đi.",
      "ơ {author}, nói rõ coi.",
      "{author}, ý là sao?",
      "hmm {author}, nói kỹ hơn.",
      "{author} nói vậy là ý gì?",
      "cụ thể đi {author}.",
      "{author}, dẫn chứng?",
      "{author} nói rõ tí.",
      "ok {author}, giải thích xem.",
    ],
    FIRM: [
      "{author} nói rõ ra đi.",
      "{author} chứng minh xem.",
      "Đừng nói chung chung, {author}.",
      "{author} trả lời thẳng vào.",
      "{author}, chứng minh.",
      "{author}, nói thẳng.",
      "bằng chứng, {author}.",
      "{author} đừng vòng vo.",
      "{author}, rõ ràng đi.",
      "Nói thẳng đi {author}.",
      "{author} giải thích ngay.",
      "ko vòng vo, {author}.",
      "{author}, trả lời.",
    ],
    TENSE: [
      "{author} đang lái đấy à.",
      "{author} nói kiểu gì vậy.",
      "Tôi hỏi thật {author}, ý đồ gì.",
      "{author} nói cho tử tế.",
      "{author} lái ghê.",
      "{author}, đừng lươn.",
      "ủa {author}, lái à?",
      "{author} nói vậy là sao, hả?",
      "{author} định lái ai.",
      "lươn vừa thôi {author}.",
      "{author}, ý đồ?",
      "{author} chém cái gì đấy.",
      "ko chấp nhận kiểu {author} nói.",
    ],
    SOFT: [
      "{author} nói thêm chút được không.",
      "Mình chưa hiểu ý {author} lắm.",
      "{author} giải thích giúp mình.",
      "Cho mình hỏi lại {author} nhé.",
      "{author} ơi, nói kỹ hơn nhé.",
      "hmm {author}, mình chưa rõ.",
      "{author} nói rõ hơn được ko?",
      "mình hỏi {author} nhẹ thôi, ý là sao?",
      "{author} nhé, giải thích tí.",
      "ừm {author}, ý là gì?",
      "{author} ơi, mình chưa hiểu.",
      "mình muốn {author} nói thêm.",
      "{author}, chút nữa được ko?",
    ],
    PLAYFUL: [
      "{author} chém à?",
      "Ơ {author}, dẫn chứng đâu.",
      "{author} nói nghe ghê ta.",
      "Bằng chứng đâu {author} ơi.",
      "{author} nổ à =))",
      "kkk {author}, nói thật ko.",
      "{author} chém gió ghê.",
      "alo {author}, dẫn chứng?",
      "{author} nói như thật.",
      "ủa {author}, thật hả?",
      "{author} =)) nguồn?",
      "{author} tự tin ghê, đâu?",
      "haha {author}, chứng minh coi.",
    ],
    CURIOUS: [
      "{author} dựa vào đâu vậy?",
      "Sao {author} chắc thế?",
      "{author} thấy gì mà nói vậy?",
      "Ý {author} là sao cơ?",
      "{author}, sao vậy?",
      "ủa {author}, dựa vào gì?",
      "{author} có gì mà chắc?",
      "hmm {author}, sao thế?",
      "{author} thấy gì z?",
      "{author}, ý là gì?",
      "sao {author} nói vậy?",
      "{author} chắc ko?",
      "{author} biết gì thêm?",
    ],
  },

  DEFEND: {
    NEUTRAL: [
      "Đừng treo {target} vội.",
      "Tôi thấy {target} ổn mà.",
      "Khoan, {target} chưa làm gì sai.",
      "Để {target} nói đã.",
      "Tôi tin {target}.",
      "{target} ổn, tôi thấy vậy.",
      "khoan, {target}.",
      "{target} chưa có gì lạ.",
      "để {target} yên đi.",
      "hmm, {target} ko đáng nghi.",
      "Đừng treo {target}, chưa đủ.",
      "{target} ok mà.",
      "tôi thấy {target} thường thôi.",
    ],
    SOFT: [
      "Mình thấy {target} không đáng nghi đâu.",
      "Từ từ đã, {target} chưa chắc.",
      "Mình bênh {target} cái.",
      "Đừng vội với {target} nhé.",
      "Tôi tin {target} mà.",
      "mình thấy {target} ổn á.",
      "đừng treo {target} nha.",
      "{target} hiền mà, đừng.",
      "hmm, mình nghĩ {target} ok.",
      "cho {target} thêm cơ hội đi.",
      "{target} chưa có gì đâu, từ từ.",
      "mình tin {target}.",
      "ơ, {target} ổn mà.",
    ],
    FIRM: [
      "Không, {target} không phải.",
      "Bỏ {target} ra, nhắm người khác đi.",
      "Tôi bảo đảm {target} ổn.",
      "Treo {target} là mất một ngày.",
      "Tôi tin {target}. Chấm hết.",
      "Đừng treo {target}.",
      "{target} sạch.",
      "ko phải {target}.",
      "{target} ổn, chuyển hướng.",
      "Tôi tin {target} tuyệt đối.",
      "bỏ {target} ra.",
      "{target}? Không.",
      "Đừng treo {target}, phí phiếu.",
    ],
    TENSE: [
      "Đừng có đẩy {target}.",
      "Lại {target} à, chán thật.",
      "Ai đẩy {target} thế.",
      "Thôi tha cho {target} đi.",
      "Đừng treo {target}, vô lý.",
      "{target} làm gì mà đẩy.",
      "tha {target} đi, mệt.",
      "haizz, lại {target}.",
      "Tôi tin {target}, ai đẩy thì tuỳ.",
      "ko phải {target}, thôi.",
      "đẩy {target} hoài.",
      "{target} sao mà đẩy.",
      "Đừng treo {target} nữa.",
    ],
    PLAYFUL: [
      "{target} vô tội mà, tôi thề.",
      "Tha cho {target} cái nào.",
      "Ơ, {target} hiền thế mà.",
      "Cho {target} sống thêm ngày nữa.",
      "Đừng treo {target}, tội =))",
      "{target} dân đen thôi.",
      "kkk {target} sạch mà.",
      "{target} mà sói thì tôi đi đầu xuống đất.",
      "Tôi tin {target}, cá luôn.",
      "tha {target} đi mn.",
      "{target} hiền khô.",
      "ủa {target} á? ko đâu.",
      "haha {target} vô tội.",
    ],
    CURIOUS: [
      "Sao lại {target}? Tôi thấy ổn mà.",
      "{target} làm gì mà bị đẩy vậy?",
      "Ai nghi {target} thế, vì sao?",
      "Có gì về {target} mà tôi bỏ lỡ à?",
      "Đừng treo {target}, có gì đâu?",
      "ủa sao {target}?",
      "Tôi tin {target}, ai nghi thì nói?",
      "{target} có gì lạ đâu nhỉ?",
      "hmm sao đẩy {target} z?",
      "{target}? dựa vào đâu?",
      "ai có gì về {target} ko?",
      "{target} ổn mà, đúng ko?",
      "sao {target} bị nhắm vậy?",
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
      "{author}, căn cứ?",
      "bằng chứng đâu {author}?",
      "{author} có gì ko?",
      "hmm {author}, lý do?",
      "{author} dựa vào gì?",
      "nguồn đâu {author}?",
      "{author} thấy gì kể đi.",
    ],
    CURIOUS: [
      "{author} có căn cứ gì không?",
      "Ơ, {author} dựa vào đâu?",
      "{author} kể xem thấy gì.",
      "Sao {author} chắc vậy?",
      "Bằng chứng đâu {author}?",
      "{author} nói rõ hơn được không.",
      "ủa {author}, có gì ko?",
      "{author} thấy gì z?",
      "hmm {author}, dựa vào gì?",
      "{author} có manh mối gì?",
      "{author}, kể nghe?",
      "sao {author} nghĩ thế?",
      "{author} biết gì mà nói?",
    ],
    FIRM: [
      "Bằng chứng đâu {author}.",
      "{author} đưa lý do ra.",
      "Không có căn cứ thì đừng nói, {author}.",
      "{author} chứng minh đi.",
      "{author}, bằng chứng.",
      "căn cứ, {author}.",
      "{author} đưa ra đi.",
      "ko có gì thì im, {author}.",
      "{author}, nguồn?",
      "chứng minh, {author}.",
      "{author} nói suông à.",
      "lý do, {author}, nhanh.",
      "{author}, đâu?",
    ],
    TENSE: [
      "{author} nói suông à.",
      "Bằng chứng đâu, {author}.",
      "{author} đừng chém.",
      "Không có gì thì im, {author}.",
      "{author}, chứng minh coi.",
      "chém gió à {author}.",
      "{author} có gì ko mà nói.",
      "haizz {author}, căn cứ?",
      "{author} nói cho có à.",
      "đâu, {author}, đâu?",
      "{author} bịa à.",
      "ko có căn cứ thì thôi {author}.",
      "{author}, nói suông hoài.",
    ],
    SOFT: [
      "{author} có gì để mình tin không?",
      "Mình muốn nghe lý do của {author}.",
      "{author} chia sẻ căn cứ đi.",
      "Cho mình xin lý do nhé {author}.",
      "{author} ơi, dựa vào gì thế?",
      "hmm {author}, có căn cứ ko?",
      "mình hỏi nhẹ, {author} thấy gì?",
      "{author} nhé, kể mình nghe.",
      "{author} có gì ko, mình tò mò.",
      "ừm {author}, lý do?",
      "{author} ơi, bằng chứng?",
      "mình xin {author} tí căn cứ.",
      "{author} nói rõ giúp mình nhé.",
    ],
    PLAYFUL: [
      "Nguồn đâu {author}?",
      "{author} nói có sách không?",
      "Ủa {author}, bịa à?",
      "Show hàng đi {author}.",
      "{author} nổ à =))",
      "kkk {author}, nguồn?",
      "{author} chém hay ghê, nguồn?",
      "alo {author}, bằng chứng?",
      "{author} =)) dựa vào gì?",
      "{author} có ảnh chụp ko =))",
      "haha {author}, kể coi.",
      "{author} nói nghe ghê, đâu?",
      "trust me bro à {author}?",
    ],
  },

  CHANGE_MIND: {
    NEUTRAL: [
      "Tôi đổi ý, giờ tôi nghi {target}.",
      "Nghĩ lại thì {target} mới đúng.",
      "Thôi tôi chuyển sang {target}.",
      "Tôi rút lại lúc nãy, {target} nhé.",
      "Đổi ý. Tôi nghi {target}.",
      "quay xe, {target}.",
      "ok tôi đổi, {target}.",
      "hmm, chuyển sang {target}.",
      "tôi đổi sang {target} nhé.",
      "Nghĩ lại rồi, {target}.",
      "Tôi sai, {target} mới đúng.",
      "đổi, {target}.",
      "Chuyển hướng: {target}.",
    ],
    SOFT: [
      "Mình đổi ý rồi, {target} nhé.",
      "Nghe mọi người xong mình nghiêng về {target}.",
      "Mình nghĩ lại, chắc là {target}.",
      "Thôi mình theo {target}.",
      "ừm, mình đổi sang {target}.",
      "mình xin đổi ý, {target} nha.",
      "hmm, chắc {target} thật.",
      "mình quay xe, {target}.",
      "ok mình theo {target} nhé.",
      "Mình sai rồi, {target} có lý hơn.",
      "mình đổi, {target}.",
      "Nghĩ kỹ thì {target} nhỉ.",
      "Xin lỗi, mình đổi sang {target}.",
    ],
    FIRM: [
      "Tôi đổi phiếu. {target}.",
      "Rút lại, giờ là {target}.",
      "Tôi sai lúc nãy. {target}.",
      "Chuyển sang {target}.",
      "Đổi. {target}.",
      "{target}. Tôi đổi.",
      "ok, {target}.",
      "quay xe. {target}.",
      "Giờ là {target}, chốt.",
      "Tôi nghi {target}, rút ý cũ.",
      "đổi sang {target}, xong.",
      "Chốt lại: {target}.",
      "Đổi phiếu, {target}, hết.",
    ],
    PLAYFUL: [
      "Ừ thì tôi sai, {target} nhé.",
      "Quay xe, {target}.",
      "Đổi cửa sang {target}.",
      "Thôi tôi theo {target} vậy.",
      "quay xe gấp, {target} =))",
      "kkk tôi đổi, {target}.",
      "ok ok {target}, tôi sai.",
      "cửa mới: {target}.",
      "haha, {target} nhé, đổi.",
      "tôi quay đầu, {target}.",
      "{target} =)) đổi.",
      "ủa hình như {target} mới đúng.",
      "đổi kèo, {target}.",
    ],
    TENSE: [
      "Được rồi, {target}. Tôi đổi.",
      "Thôi {target} đi, tôi chán rồi.",
      "Đổi, {target}.",
      "Tôi rút, giờ là {target}.",
      "haizz, {target} vậy.",
      "ừ thì {target}, đổi.",
      "mệt, chuyển sang {target}.",
      "Được, {target}. Xong chưa.",
      "quay xe, {target}, mệt.",
      "Đổi sang {target}, đừng hỏi.",
      "thôi {target}, hết.",
      "ok {target}, thoả mãn chưa.",
      "Tôi đổi, {target}, ép quá.",
    ],
    CURIOUS: [
      "Tôi đổi ý sang {target}, ai theo không?",
      "Giờ tôi nghi {target} hơn, mọi người sao?",
      "Nghĩ lại thì {target}, thấy hợp lý không?",
      "Chuyển sang {target} nhé, ai phản đối?",
      "quay xe {target}, ok ko?",
      "hmm đổi sang {target}, đúng ko?",
      "tôi đổi {target}, ai cùng?",
      "{target} nhỉ? tôi đổi.",
      "ủa hay là {target}?",
      "đổi sang {target}, mn thấy sao?",
      "Tôi đổi ý: {target}. Ổn ko?",
      "chuyển {target}, ai theo?",
      "hay {target} ta?",
    ],
  },

  REACTION: {
    NEUTRAL: [
      "Ừ.",
      "Hmm.",
      "Ờ thế à.",
      "Được rồi.",
      "Ok.",
      "Thấy rồi.",
      "ờ.",
      "uh.",
      "à.",
      "ok ok.",
      "ừm.",
      "biết rồi.",
      "vậy à.",
    ],
    PLAYFUL: [
      "Ơ kìa.",
      "Hehe.",
      "Ủa.",
      "Trời.",
      "=))",
      "kkk",
      "ối.",
      "ơ hay.",
      "haha.",
      "úi.",
      "ủa gì z.",
      "trời ơi.",
      "kk.",
    ],
    FIRM: [
      "Ừ.",
      "Rõ.",
      "Được.",
      "Biết rồi.",
      "Ok.",
      "Nghe rồi.",
      "Ghi nhận.",
      "Hiểu.",
      "Ừ, rõ.",
      "Thế à.",
      "Được, tiếp.",
      "Ừ, thấy.",
    ],
    SOFT: [
      "Ừ nhỉ.",
      "Ờ.",
      "Cũng được.",
      "Vậy à.",
      "à ừ.",
      "ừm.",
      "thế à.",
      "ờ ha.",
      "ừ, mình thấy.",
      "hmm ok.",
      "ừ ừ.",
      "dạ.",
      "ok nè.",
    ],
    TENSE: [
      "Hừ.",
      "Thôi được.",
      "Chán.",
      "Lại thế.",
      "mệt.",
      "haizz.",
      "ừ, sao nữa.",
      "tiếp đi.",
      "ờ.",
      "thôi.",
      "lại nữa.",
      "chán ghê.",
      "hừm.",
    ],
    CURIOUS: [
      "Ơ?",
      "Thế à?",
      "Hả?",
      "Sao cơ?",
      "ủa?",
      "gì cơ?",
      "thật á?",
      "ơ hay?",
      "hmm?",
      "vậy hả?",
      "sao?",
      "ủa sao?",
      "gì z?",
    ],
  },

  HUMOR: {
    NEUTRAL: [
      "Thôi tôi im cho lành.",
      "Nay tôi hóng là chính.",
      "Tôi đứng ngoài xem.",
      "Cứ để mọi người cãi đã.",
      "tôi ăn dưa hấu hóng.",
      "kkk vui ghê.",
      "làng này vui thật.",
      "để tôi lấy ghế ngồi hóng.",
      "hôm nay cãi hăng ha.",
      "ok tôi nghe.",
      "hóng.",
      "vui nhỉ =))",
      "tôi im, mn nói tiếp.",
    ],
    PLAYFUL: [
      "Tôi mà là sói thì tôi đã diễn hay hơn rồi.",
      "Làng này cãi nhau hay hơn xem phim.",
      "Tôi bán hạt dưa đây.",
      "Nay ai cũng thành thám tử hết.",
      "=)) cãi dữ z.",
      "kkk ai cũng như sói hết.",
      "drama quá trời.",
      "cho xin ít bắp rang.",
      "hóng drama nè.",
      "làng này hài vl.",
      "haha căng ghê.",
      "tôi cười xỉu.",
      "ủa vui vậy.",
    ],
    SOFT: [
      "Thôi mọi người từ từ nào.",
      "Đừng căng quá.",
      "Từ từ rồi cũng ra.",
      "Cãi nhẹ thôi.",
      "mn nhẹ nhàng thôi nha.",
      "hmm, hạ hoả tí.",
      "ok ok, từ từ.",
      "đừng cãi to quá.",
      "vui thôi mà.",
      "thở đã mn.",
      "nhẹ nhàng nào.",
      "chơi vui thôi, đừng gắt.",
      "hòa nhé mn.",
    ],
    FIRM: [
      "Cãi ít thôi, bầu đi.",
      "Nói ít làm nhiều.",
      "Thôi vào việc.",
      "Đủ rồi đấy.",
      "bớt cãi.",
      "vào việc đi.",
      "bầu đi, cãi hoài.",
      "ok, tập trung.",
      "đủ rồi, chốt.",
      "ít nói thôi.",
      "vote đi mn.",
      "tập trung nào.",
      "thôi, bàn chính đi.",
    ],
    TENSE: [
      "Cãi nhau cả ngày được đấy.",
      "Hay lắm, cứ thế mà thua.",
      "Sói nó đang cười kìa.",
      "Thôi khỏi bầu luôn.",
      "cãi nữa là thua đấy.",
      "vui ghê, thua tới nơi.",
      "haizz làng này.",
      "chợ à.",
      "sói sướng rồi.",
      "cãi đi, cãi nữa đi.",
      "ok khỏi chơi.",
      "mệt cái làng.",
      "hết cứu.",
    ],
    CURIOUS: [
      "Ai đang vui nhất ở đây nhỉ?",
      "Có ai nghiêm túc không đấy?",
      "Nãy giờ ai chưa nói ta?",
      "Thế cuối cùng bầu ai?",
      "ai đang cười z?",
      "ủa rồi sao nữa?",
      "có ai tỉnh ko?",
      "cãi xong chưa mn?",
      "rồi bầu ai đây?",
      "hmm ai hóng cùng ko?",
      "ai nói tiếp?",
      "vui vậy rồi sao?",
      "có ai đọc được gì ko?",
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
  /**
   * Cách mở đầu (ba token đầu, xem `openingOf`) của những câu vừa nói.
   *
   * Mềm hơn `avoidFingerprints`: mẫu trùng mở đầu chỉ bị dịch qua khi còn mẫu
   * khác để dịch; khi cả bể đều trùng mở đầu thì vẫn nói, chỉ không nói lại
   * nguyên câu.
   */
  avoidOpenings?: readonly string[];
}

/** Giọng gần nhất có mẫu; `NEUTRAL` luôn tồn tại nên vòng lặp luôn dừng. */
function poolFor(kind: BotSpeechKind, tone: BotSpeechTone): string[] {
  const table = SPEECH_TEMPLATES[kind];
  return table[tone] ?? table.NEUTRAL;
}

/**
 * Chuỗi bằng chứng ở dạng ghép được vào giữa câu.
 *
 * `summary` do tầng phân tích viết như một CÂU ("Đổi phiếu trong 80% thời gian
 * cuối của vòng đề cử."), còn mẫu thì ghép nó sau dấu phẩy và tự thêm dấu chấm.
 * Không sửa thì ra "..., Đổi phiếu ... đề cử.." - hai dấu chấm và một chữ hoa
 * giữa câu, hai thứ không ai gõ trong chat. Chỉ đụng chữ ĐẦU và dấu CUỐI; tên
 * người bên trong ("soi ra Nam là Sói") giữ nguyên để parser vẫn đọc được.
 */
function evidenceClause(summary: string | undefined, leading: boolean): string {
  if (summary === undefined) return "tôi thấy hơi lạ";
  const trimmed = summary.trim().replace(/[.!?…]+$/u, "");
  if (trimmed.length === 0 || leading) return trimmed || "tôi thấy hơi lạ";
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

/**
 * Điền chỗ trống, KHÔNG nhiễu.
 *
 * Bốn khoá, không hơn. Thiếu dữ liệu thì dùng một từ chung chung thay vì để lộ
 * `undefined` hay một dấu ngoặc chưa thay - cả hai đều đọc ra như lỗi phần mềm
 * ngay giữa một ván đấu.
 *
 * `export` để test đối chiếu câu đã render với dạng "sạch" của cùng mẫu, tức
 * đo được lớp nhiễu tách khỏi lớp chọn mẫu.
 */
export function fillSpeechTemplate(template: string, request: SpeechTemplateRequest): string {
  const first = request.intention.evidence[0];
  // Ván cũ (log/self-play record của bản build trước) có thể mang một vai đã bị
  // xóa cứng (PRIEST/MEDIUM): tra thẳng vào ROLE_META thì nổ cả dòng chat, nên
  // rơi về "dân làng" khi chuỗi đó không còn là vai hợp lệ.
  const claimed = request.intention.claimedRole;
  return template
    .replace(/\{target\}/g, request.targetName ?? "người đó")
    .replace(/\{author\}/g, request.replyToName ?? request.targetName ?? "bạn")
    .replace(/\{evidence\}/g, evidenceClause(first?.summary, template.startsWith("{evidence}")))
    .replaceAll("{role}", claimed && isRole(claimed) ? ROLE_META[claimed].name : "dân làng");
}

// ---------------------------------------------------------------------------
// Nhiễu người
// ---------------------------------------------------------------------------

/** Trong 100 câu mở đầu bằng chữ, chừng này câu hạ chữ đầu. */
const LOWERCASE_PER_100 = 30;
/**
 * Trong 1000 lượt render, chừng này lượt có typo - tính trên MẪU CÓ CHỖ để
 * typo. Khoảng một nửa số mẫu (câu quá ngắn, toàn tên/từ bảo vệ) không có chỗ,
 * nên tỉ lệ đo được trên toàn bộ câu rơi vào cỡ 2-3%.
 */
const TYPO_PER_1000 = 45;

/** Hai kind mà chữ nào cũng là một phần của lời khai; không được đụng. */
const NO_TYPO_KINDS: ReadonlySet<BotSpeechKind> = new Set<BotSpeechKind>([
  "CLAIM_ROLE",
  "COUNTER_CLAIM",
]);

/**
 * Chữ mà `chat-analysis` dựa vào để đọc câu của bot khác: dấu hiệu cáo buộc,
 * bênh vực, khai vai, phủ định, từ để hỏi, tiểu từ gọi đáp/cầu khiến. Rớt dấu
 * ở một chữ này là mất một bằng chứng cho cả bàn, hoặc mất một câu hỏi mà bot
 * kia lẽ ra phải thấy. Danh sách chép tay có chủ đích: engine không được kéo
 * parser vào tầng render, và test quét cả bảng bắt được trôi lệch.
 */
const TYPO_PROTECTED: ReadonlySet<string> = new Set([
  "tôi", "nghi", "là", "sói", "tin", "đừng", "treo", "không", "thể", "mới", "mình",
  "chưa", "chẳng", "chả", "đâu", "có", "làm", "gì", "sao", "tại", "vì", "thế", "nào",
  "ai", "ơi", "à", "ê", "này", "nhé", "nhá", "đi", "xem", "coi", "thử", "t", "tui",
  "ko", "k", "hok", "tt", "bv", "dân",
  // Đuôi hỏi có/không và lời xin ý kiến (`YES_NO_TAILS`, `OPINION_REQUESTS`
  // trong chat-analysis): "nói rõ hơn được không" mà dính thành "hơnđược" là
  // bot kia không còn thấy mình bị hỏi.
  "được", "đc", "phải", "đúng", "hả", "hở", "hử", "hóng", "ý", "kiến", "xin",
]);

const COMBINING_MARKS = /[\u0300-\u036f]/g;

function stripDiacritics(token: string): string {
  return token.normalize("NFD").replace(COMBINING_MARKS, "").replace(/đ/g, "d").replace(/Đ/g, "D");
}

/** Một token có thể bị rớt dấu: toàn chữ, đủ dài, có dấu để mà rớt, không bảo vệ. */
function typoCandidate(token: string): boolean {
  if (!/^\p{Letter}+$/u.test(token)) return false;
  if (token.length < 3) return false;
  if (TYPO_PROTECTED.has(token.toLowerCase())) return false;
  return stripDiacritics(token) !== token;
}

/**
 * Typo hiếm trên MẪU THÔ, trước khi điền chỗ trống.
 *
 * Làm trên mẫu thô chứ không trên câu đã điền vì tên người, chuỗi bằng chứng
 * và tên vai không bao giờ được đụng: tên rớt dấu là `resolveTarget` không
 * nhận ra ai nữa. Hai dạng typo: rớt dấu một chữ ("đáng" → "dang"), hoặc dính
 * hai chữ liền nhau ("giải thích" → "giảithích").
 *
 * Khoá băm là `(seed, bot, mẫu)` - KHÔNG có `seq`. Cùng bot, cùng mẫu thì luôn
 * cùng một dạng chữ. Đây là bắt buộc chứ không phải chọn lựa: cơ chế chống lặp
 * so vân tay của câu ĐÃ PHÁT, mà vân tay giữ nguyên dấu; nếu cùng mẫu lúc có
 * typo lúc không thì hai lần phát cùng một câu có hai vân tay khác nhau, và
 * cửa sổ chống lặp coi chúng là hai câu mới.
 */
function applyTypo(template: string, request: SpeechTemplateRequest): string {
  if (NO_TYPO_KINDS.has(request.intention.kind)) return template;

  const hash = fnv1a32(`${request.seedTag}|${request.botId}|typo|${template}`);
  if (hash % 1000 >= TYPO_PER_1000) return template;

  const tokens = template.split(" ");
  const candidates: number[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (typoCandidate(tokens[index]!)) candidates.push(index);
  }
  if (candidates.length === 0) return template;

  const pick = candidates[Math.floor(hash / 1000) % candidates.length]!;
  const merge = Math.floor(hash / 7) % 2 === 1;
  const next = tokens[pick + 1];

  // Dính chữ chỉ khi chữ kế cũng là chữ thường không bảo vệ và không phải một
  // chỗ trống - dính vào tên người là đổi tên người.
  if (merge && next !== undefined && /^\p{Letter}+$/u.test(next) && !TYPO_PROTECTED.has(next.toLowerCase())) {
    tokens.splice(pick, 2, `${tokens[pick]}${next}`);
    return tokens.join(" ");
  }

  tokens[pick] = stripDiacritics(tokens[pick]!);
  return tokens.join(" ");
}

/**
 * Hạ chữ đầu câu ở khoảng 30% lượt - nhưng chỉ khi MẪU mở đầu bằng chữ.
 *
 * Mẫu mở đầu bằng `{target}`/`{author}` thì chữ đầu là tên người, và tên người
 * viết thường đọc ra như gõ nhầm chứ không phải như đang chat.
 *
 * Khoá băm có `seq`: vân tay văn bản đã hạ chữ thường toàn câu, nên chữ đầu hoa
 * hay thường không đổi vân tay và không ảnh hưởng chống lặp. Biến thiên theo
 * lượt là miễn phí ở đây.
 */
function applyLowercase(template: string, text: string, request: SpeechTemplateRequest): string {
  if (!/^\p{Letter}/u.test(template)) return text;
  const hash = fnv1a32(`${request.seedTag}|${request.botId}|${request.round}|${request.seq}|lower`);
  if (hash % 100 >= LOWERCASE_PER_100) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Bỏ dấu chấm CUỐI câu - chỉ dấu chấm, và chỉ ở cuối.
 *
 * 728 trên 975 mẫu trong bảng này kết bằng dấu chấm, và không lớp nhiễu nào
 * đụng tới nó. Đó là một nửa lý do `casualToneRate` đo được 0,556 trên self-play:
 * `looksCasual` cần 2 trong 4 dấu hiệu, và một câu ngắn viết hoa đầu kết bằng
 * dấu chấm chỉ đạt 1. Người Việt chat trong game gần như không bao giờ chấm câu
 * cuối - đó là dấu hiệu văn viết, và nó là thứ dễ nhận ra nhất trong một khung
 * chat.
 *
 * Sửa ở ĐÂY chứ không sửa 728 chuỗi: một luật viết trong bảng là một luật sẽ bị
 * quên ở mẫu thứ 976. `humanize` vốn đã là tầng "làm cho giống người gõ".
 *
 * `?` và `!` GIỮ NGUYÊN: chúng mang giọng chứ không mang văn phong, và
 * `looksCasual` cũng chỉ tính dấu chấm. Dấu chấm GIỮA câu ("{target}. {evidence}.")
 * cũng giữ - người ta vẫn chấm giữa chừng khi gõ nhanh; chỗ lộ ra là dấu cuối.
 *
 * KHÔNG đổi vân tay: `speechTextFingerprint` bỏ mọi ký tự không phải chữ/số, và
 * `openingOf` chỉ đọc ba token đầu. Cơ chế chống lặp vì thế không thấy gì khác.
 */
function dropFinalPeriod(text: string): string {
  return text.replace(/\.+$/u, "");
}

/** Mẫu thô → câu như người gõ: typo hiếm, điền chỗ trống, hạ chữ đầu, bỏ chấm cuối. */
function humanize(template: string, request: SpeechTemplateRequest): string {
  const typed = applyTypo(template, request);
  const filled = fillSpeechTemplate(typed, request);
  return dropFinalPeriod(applyLowercase(template, filled, request));
}

/**
 * Một câu cho ý định này.
 *
 * Chỉ số mẫu là hàm băm của seed + bot + vòng + lượt + vân tay ngữ nghĩa. Hai
 * BOT cùng ý ở cùng vòng vẫn nói khác nhau vì `botId` nằm trong khoá; cùng một
 * BOT ở hai lượt khác nhau cũng vậy vì `seq` nằm trong khoá.
 *
 * Hai vòng quét, theo thứ tự nới dần:
 *
 * 1. Né cả câu đã nói LẪN cách mở đầu đã dùng.
 * 2. Chỉ né câu đã nói.
 *
 * Cả hai vòng đều cạn thì trả về mẫu đầu chứ không ném: một lượt nói trùng còn
 * tốt hơn một ngoại lệ chạy lên tầng scheduler.
 */
export function renderSpeechTemplate(request: SpeechTemplateRequest): string {
  const { intention } = request;
  const pool = poolFor(intention.kind, intention.tone);
  const avoid = new Set(request.avoidFingerprints ?? []);
  const avoidOpenings = new Set(request.avoidOpenings ?? []);

  const semantic = [
    intention.kind,
    intention.targetId ?? "-",
    intention.replyToMessageId ?? "-",
    intention.topic ?? "-",
  ].join("|");
  const start =
    fnv1a32(`${request.seedTag}|${request.botId}|${request.round}|${request.seq}|${semantic}`) %
    pool.length;

  const rendered = (step: number): string =>
    humanize(pool[(start + step) % pool.length]!, request);

  if (avoidOpenings.size > 0) {
    for (let step = 0; step < pool.length; step += 1) {
      const text = rendered(step);
      if (avoid.has(speechTextFingerprint(text))) continue;
      const opening = openingOf(text);
      if (opening !== null && avoidOpenings.has(opening)) continue;
      return text;
    }
  }

  for (let step = 0; step < pool.length; step += 1) {
    const text = rendered(step);
    if (!avoid.has(speechTextFingerprint(text))) return text;
  }

  return rendered(0);
}

/** Dùng cho test: mọi giọng đều có mẫu, kể cả khi rơi về `NEUTRAL`. */
export function templatePoolSizes(kind: BotSpeechKind): Record<BotSpeechTone, number> {
  const sizes = {} as Record<BotSpeechTone, number>;
  for (const tone of BOT_SPEECH_TONES) sizes[tone] = poolFor(kind, tone).length;
  return sizes;
}
