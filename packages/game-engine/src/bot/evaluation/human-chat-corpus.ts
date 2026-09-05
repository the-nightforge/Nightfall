/**
 * Corpus câu người chơi THẬT gõ, dùng để đo bot "nghe" được bao nhiêu.
 *
 * Bot được tune bằng self-play bot-vs-bot, nơi mọi câu đều do bảng mẫu sinh ra
 * và parser hiểu 100%. Gặp người thì khác: người gõ teencode, bỏ dấu, bỏ chủ
 * ngữ, bỏ "là", mỉa mai. Corpus này là thước đo duy nhất của khoảng cách đó
 * mà harness đo được mà không cần một căn phòng có người.
 *
 * NGUỒN: viết tay theo cách người chơi Ma Sói Việt gõ trong phòng chat, cùng
 * phong cách với dữ liệu mồi của `mine-aliases`. Khi có log phòng thật (≥3
 * người thật), thay bằng câu thật - và giữ lại những câu ở đây mà log không
 * có, vì chúng vẫn là câu người ta sẽ gõ.
 *
 * Mỗi mục là một câu cùng điều parser PHẢI đọc ra. `traps` là những câu parser
 * KHÔNG được đọc thành gì: đùa, hỏi, phủ định, điều kiện. Một câu bẫy lọt
 * thành bằng chứng còn tệ hơn mười câu thật bị bỏ sót, nên tỉ lệ bẫy bị bỏ
 * qua phải là 100%, không phải "cao".
 *
 * Bàn mẫu: An (a), Bình (b), Chi (c), Dũng (d), Hà (h). Người nói luôn là
 * "me", một người ngoài bàn mẫu, để câu tự xưng không bị đọc thành nói VỀ ai.
 */

export type HumanChatExpectation =
  | { type: "ACCUSE"; targetId: string }
  | { type: "DEFEND"; targetId: string }
  | { type: "ROLE_CLAIM"; role: string }
  /** Câu nói THẲNG VỚI một người: hỏi hoặc gọi. Không sinh bằng chứng. */
  | { type: "DIRECT"; targetId: string };

export interface HumanChatSample {
  text: string;
  expect: HumanChatExpectation;
}

export const HUMAN_CHAT_PLAYERS: ReadonlyArray<{ id: string; name: string }> = [
  { id: "me", name: "Minh" },
  { id: "a", name: "An" },
  { id: "b", name: "Bình" },
  { id: "c", name: "Chi" },
  { id: "d", name: "Dũng" },
  { id: "h", name: "Hà" },
];

const accuse = (text: string, targetId = "b"): HumanChatSample => ({
  text,
  expect: { type: "ACCUSE", targetId },
});
const defend = (text: string, targetId = "b"): HumanChatSample => ({
  text,
  expect: { type: "DEFEND", targetId },
});
const claim = (text: string, role: string): HumanChatSample => ({
  text,
  expect: { type: "ROLE_CLAIM", role },
});
const ask = (text: string, targetId = "a"): HumanChatSample => ({
  text,
  expect: { type: "DIRECT", targetId },
});

/** Lời buộc tội. Mục tiêu: parser đọc ra đúng người ở > 80% số câu. */
export const HUMAN_ACCUSATIONS: readonly HumanChatSample[] = [
  accuse("tôi nghi Bình"),
  accuse("nghi Bình lắm"),
  accuse("nghi Bình"),
  accuse("nghi Binh"),
  accuse("nghi Binh nhat"),
  accuse("t nghi Bình"),
  accuse("t nghi Binh"),
  accuse("toi nghi Binh"),
  accuse("tớ nghi Bình nha"),
  accuse("mình nghi Bình nhất bàn"),
  accuse("nghi ngờ Bình"),
  accuse("Bình là sói"),
  accuse("Binh la soi"),
  accuse("Bình là sói đấy"),
  accuse("Bình đúng là sói"),
  accuse("Binh la soi chac luon"),
  accuse("Bình sói"),
  accuse("Bình sói chắc luôn"),
  accuse("Bình sói 100%"),
  accuse("Bình 100% sói"),
  accuse("Bình đúng sói rồi"),
  accuse("Bình chuẩn sói"),
  accuse("thằng Bình sói"),
  accuse("chắc Bình sói"),
  accuse("ai cũng thấy Bình sói mà"),
  accuse("sói là Bình"),
  accuse("soi la Binh"),
  accuse("vote Bình"),
  accuse("vote Binh di"),
  accuse("vote cho Bình đi"),
  accuse("vote Bình lên đi"),
  accuse("t vote Bình"),
  accuse("mình vote Bình nhé"),
  accuse("tôi vote Bình"),
  accuse("treo Bình đi mọi người"),
  accuse("treo Binh"),
  accuse("t treo Bình"),
  accuse("chốt Bình nha"),
  accuse("t chốt Bình"),
  accuse("up Bình"),
  accuse("đẩy Bình lên"),
  accuse("day Binh len"),
  accuse("lynch Bình"),
  accuse("kill Bình"),
  accuse("tôi bỏ phiếu Bình"),
  accuse("bỏ phiếu Bình đi"),
  accuse("Bình sủa nhiều quá"),
  accuse("Bình sủa"),
  accuse("Bình fake tt"),
  accuse("Bình giả tt"),
  accuse("Bình khả nghi"),
  accuse("tôi thấy Bình khả nghi"),
  accuse("Bình đáng nghi vl"),
  accuse("Bình đáng ngờ nhất"),
  accuse("Bình xạo"),
  accuse("Bình nói dối"),
  accuse("Bình láo"),
  accuse("Bình sói, Chi dân"),
  accuse("Bình im suốt, nghi Bình"),
  // Những câu dưới đây parser CHƯA hiểu; giữ lại để con số nói thật.
  accuse("Bình với Chi cùng phe sói"),
  accuse("Bình mà tt gì, sói thì có"),
  accuse("Bình bay"),
  accuse("ko phải Chi, là Bình"),
  accuse("phiếu của tôi cho Bình"),
  accuse("Bình tt giả"),
  accuse("Bình lươn lẹo"),
];

/** Lời bênh vực. */
export const HUMAN_DEFENCES: readonly HumanChatSample[] = [
  defend("tôi tin Bình"),
  defend("tin Bình"),
  defend("t tin Bình"),
  defend("mình tin Bình mà"),
  defend("tha Bình đi"),
  defend("đừng treo Bình"),
  defend("dung treo Binh"),
  defend("đừng vote Bình"),
  defend("Bình dân"),
  defend("Bình dân chắc"),
  defend("Bình dân mà"),
  defend("Bình sạch"),
  defend("Bình sạch rồi"),
  defend("Bình trong sạch"),
  defend("Bình vô tội"),
  defend("Bình ok"),
  defend("Bình uy tín"),
  defend("Bình an toàn"),
  defend("Bình chắc dân"),
  defend("Bình đúng dân rồi"),
  defend("Bình là dân"),
  defend("Binh la dan"),
  defend("tôi nghĩ Bình vô tội"),
  // Chưa hiểu.
  defend("Bình ko sói đâu"),
  defend("Bình không phải sói"),
  defend("tin Bình hơn Chi"),
];

/** Tự nhận vai. */
export const HUMAN_CLAIMS: readonly HumanChatSample[] = [
  claim("tôi là tiên tri", "SEER"),
  claim("t là tt", "SEER"),
  claim("mình là tt luôn, ai counter thì lên", "SEER"),
  claim("toi la tien tri", "SEER"),
  claim("tôi là thầy bói", "SEER"),
  claim("tôi là bv", "GUARD"),
  claim("nhận bv, tối qua đỡ cho An", "GUARD"),
  claim("tôi là bảo kê của làng", "GUARD"),
  claim("t la ho ve", "GUARD"),
  claim("mình là pt nè, hết bình cứu rồi", "WITCH"),
  claim("tôi là phù thuỷ", "WITCH"),
  claim("tôi là ts nhé, cẩn thận", "HUNTER"),
  claim("t là thợ săn", "HUNTER"),
  claim("mình là pháp sư nha", "SORCERER"),
  claim("tôi là sói pháp sư", "SORCERER"),
  claim("t là pháp sư", "SORCERER"),
  claim("nhận dl, tôi chỉ là dân đen thôi", "VILLAGER"),
  claim("tôi là dân", "VILLAGER"),
  claim("t là dân thường mà", "VILLAGER"),
  claim("ok tôi là tiên tri", "SEER"),
  claim("kk tôi là tiên tri đây", "SEER"),
  claim("tớ là tiên tri", "SEER"),
  claim("tui là bảo vệ", "GUARD"),
  claim("tôi là sát thủ", "SERIAL_KILLER"),
];

/**
 * Câu BẪY: parser không được đọc ra bất cứ bằng chứng nào (cáo buộc, bênh
 * vực, khai vai). Lời nhắm tới (`DIRECT_*`) không tính - chúng không sinh
 * bằng chứng.
 */
export const HUMAN_TRAPS: readonly string[] = [
  "tôi mà là tt thì tôi đã soi Bình rồi",
  "ai bảo t là tt",
  "nếu t là bv thì đã che An",
  "tt đây",
  "t tưởng t là tt =))",
  "ước gì tôi là tiên tri",
  "t ko phải tt",
  "tôi k phải là tiên tri",
  "t hok phải bv",
  "tôi ko nghi Bình",
  "Bình không thể là sói",
  "Bình ko thể là sói đâu",
  "ko nghi Bình",
  "k vote Bình",
  "hok treo Bình",
  "Bình ko sói",
  "Bình hem sói đâu",
  "t k tin Bình",
  "Bình đếch phải dân",
  "Bình éo sạch",
  "ai vote Bình",
  "sao lại treo Bình",
  "ai nghi Bình giơ tay",
  "Bình soi Chi ra dân",
  "Binh soi Chi",
  "nghi Binh dan",
  "nghi Binh vo toi",
  "tính Bình sao",
  "Bình chả phải sói",
  "chào mọi người",
  "Bình ơi nói gì đi",
  "Bình nghĩ sao",
  "toi nghi Binh vo toi",
  "cha noi Binh dang o dau",
];

/**
 * Câu hỏi / lời gọi NHẮM THẲNG vào một người - thứ làm bot biết mình đang bị
 * hỏi (`DIRECT_QUESTION` / `DIRECT_ADDRESS`). Nguồn: self-play v17 xếp ~8,6%
 * câu hỏi giữa bot với nhau vào ngăn "parser không nhận ra", và hai mẫu chiếm
 * trọn con số đó ("hóng ý kiến X.", "X nói rõ hơn được không.") là hai cách
 * người thật cũng gõ. Mục tiêu: > 80%.
 */
export const HUMAN_QUESTIONS: readonly HumanChatSample[] = [
  // Dấu hỏi và từ để hỏi - đường cũ, giữ để con số không trôi.
  ask("An nghĩ sao?"),
  ask("An nghi ai"),
  ask("An oi sao vote t?"),
  ask("An ơi, bầu ai?"),
  ask("An đâu rồi"),
  ask("tại sao An lại đổi phiếu"),
  ask("bằng chứng đâu An"),
  ask("An giải thích đi"),
  ask("An nói xem nào"),
  // Đuôi hỏi có/không - không có dấu "?".
  ask("An nói rõ hơn được không"),
  ask("An nói rõ hơn được không."),
  ask("An giải thích được ko"),
  ask("An giai thich duoc khong"),
  ask("An nói rõ đc k"),
  ask("An dân phải ko"),
  ask("An soi ai đêm qua, nói được không"),
  // Xin ý kiến.
  ask("hóng ý kiến An"),
  ask("hóng ý kiến An."),
  ask("hong y kien An"),
  ask("xin ý kiến An"),
  ask("cho xin ý kiến của An cái"),
  ask("hóng ý An"),
  // Có dấu / không dấu / viết tắt, gọi đích danh.
  ask("Bình ơi", "b"),
  ask("Binh oi bau ai", "b"),
  ask("Dũng nói đi", "d"),
  ask("Dung giai thich duoc ko", "d"),
  // Những câu dưới đây parser CHƯA hiểu, giữ lại để con số nói thật: tên
  // người so ở dạng không dấu, nên "đúng" đụng Dũng và "hả" đụng Hà - hai tên
  // trong một câu thì parser cố ý không đoán. Sửa cần đổi cách so tên
  // (ưu tiên dạng có dấu), tức đụng tới mọi mẫu buộc tội/bênh vực - ngoài
  // phạm vi đợt này.
  ask("An là tt đúng không"),
  ask("An la tt dung khong"),
  ask("An đổi phiếu hả"),
];

/**
 * Câu có NÊU TÊN nhưng KHÔNG nói với người đó: parser không được sinh
 * `DIRECT_*`. Phủ định, kể chuyện người thứ ba, giả định, trích dẫn, và hai
 * tên trong một câu (parser cố ý không đoán).
 */
export const HUMAN_ADDRESS_TRAPS: readonly string[] = [
  "An không phải sói",
  "tôi không tin An",
  "An im suốt",
  "ý kiến của An hay đấy",
  "tôi cùng ý kiến với An",
  "nếu An nói rõ hơn được thì tốt",
  "An bảo là An dân",
  "An bầu Chi hả",
  "An với Bình cùng phe",
  "tôi nghi An",
  "toi nghi Ha",
  "An dân",
  "vote An",
  // Phủ định đứng trước dấu hiệu hỏi mới.
  "tôi không hóng ý kiến An",
  "ko xin ý kiến An đâu",
  "t k hong y kien An",
  "tôi ko tin An đâu",
  "An không phải sói đúng không",
  // Giả định mở đầu mệnh đề.
  "nếu An trả lời được không thì tính sau",
  "giả sử An là sói đúng không",
  "lỡ An nói rõ hơn được ko",
  // Trích dẫn.
  "An bảo “nói rõ hơn được không” xong im luôn",
];
