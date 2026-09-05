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
  | { type: "ROLE_CLAIM"; role: string };

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
  claim("mình là lm nha", "PRIEST"),
  claim("tôi là bà đồng", "MEDIUM"),
  claim("mình là bd", "MEDIUM"),
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
