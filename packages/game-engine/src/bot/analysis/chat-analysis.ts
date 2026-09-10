import type { Phase, Role } from "@masoi/shared";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import type { BotChatObservation, BotMemory, BotMemoryType, BotPlayerKnowledge } from "../types";

/**
 * Dạng "plain": hạ chữ thường, bỏ dấu câu, nhưng GIỮ NGUYÊN dấu tiếng Việt.
 *
 * `export` để công cụ đào alias ngoài luồng chơi (`npm run mine-aliases`) chuẩn
 * hoá văn bản bằng ĐÚNG hàm mà bot dùng. Một bản sao ở đó sẽ trôi lệch, và khi
 * nó trôi thì đề xuất alias sinh ra sẽ nói về một parser không tồn tại.
 */
export function plainForm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Dấu câu là ranh giới mệnh đề duy nhất mà parser này tin. */
export const CLAUSE_SEPARATORS = /[.,;:!?\n]+/;

const COMBINING_MARKS = /[\u0300-\u036f]/g;

/**
 * Dạng "ascii": bỏ dấu, để so khớp tên và để hiểu người gõ không dấu. `đ` không
 * phải dấu tổ hợp nên phải thay riêng.
 *
 * `export` cùng lý do với `plainForm`.
 */
export function asciiForm(text: string): string {
  return plainForm(text).normalize("NFD").replace(COMBINING_MARKS, "").replace(/đ/g, "d");
}

/**
 * Cụm dài đứng trước để "dân làng" không bị khớp thành "dân".
 *
 * `export` và `readonly`: đây là bảng mà công cụ đào alias so vào để biết một
 * token vai đã được biết hay chưa. Nó chỉ được ĐỌC từ ngoài - thêm alias là một
 * việc có người duyệt, không phải một việc script tự làm lúc chạy.
 */
export const ROLE_PHRASES: ReadonlyArray<readonly [string, Role]> = [
  ["kẻ nguyền rủa", "CURSED"],
  ["tiên tri tập sự", "APPRENTICE_SEER"],
  ["thằng hề", "JESTER"],
  // Từ tờ đề xuất `reports/alias-proposal.md`: cách người chơi thật gọi vai.
  // "thầy bói" đứng trước "tiên tri" chỉ vì cùng vai, không đụng cụm nào.
  ["thầy bói", "SEER"],
  ["sát thủ", "SERIAL_KILLER"],
  ["hộ vệ", "GUARD"],
  ["bảo kê", "GUARD"],
  ["dân đen", "VILLAGER"],
  // Trước "kẻ" của bất kỳ cụm nào khác và trước "sói": "báo thù" một mình
  // không phải một cái tên vai, nên chỉ cụm đủ ba tiếng mới được khớp.
  ["kẻ báo thù", "EXECUTIONER"],
  // Ngay cạnh "kẻ báo thù" và cùng quy ước: cụm đủ ba tiếng mới khớp. Hai cái
  // tên chia nhau tiếng "kẻ" nên cả hai phải là cụm đầy đủ, nếu không thì tiếng
  // đó một mình sẽ khớp bừa vào cái đứng trước trong bảng.
  ["kẻ phản bội", "TRAITOR"],
  // "phản bội" không kèm "kẻ" vẫn là một cách gọi tự nhiên trong câu khai, và
  // nó không đụng cụm nào khác trong bảng.
  ["phản bội", "TRAITOR"],
  // Trước "sát" bất kỳ và trước "thám tử": không có cụm nào ngắn hơn khớp được,
  // nhưng giữ đúng quy ước "cụm dài đứng trước" của bảng này.
  ["sát nhân", "SERIAL_KILLER"],
  ["thám tử", "DETECTIVE"],
  // "trưởng lão" trước "trưởng" của "thị trưởng"? Không đụng nhau - hai cụm
  // khác tiếng đầu - nhưng giữ đúng quy ước cụm dài đứng trước của bảng.
  ["trưởng lão", "ELDER"],
  // Sói Pháp Sư: CHỈ nghe-hiểu, không bao giờ claim công khai (bầy giữ kín).
  // Đứng trước "sói" để "sói pháp sư" không bị khớp thành "sói" thường.
  ["sói pháp sư", "SORCERER"],
  ["pháp sư", "SORCERER"],
  // "song trùng" không kèm "kẻ" vẫn là một cách gọi tự nhiên trong câu khai,
  // và nó không đụng cụm nào khác trong bảng - cùng quy ước với "phản bội".
  ["kẻ song trùng", "DOPPELGANGER"],
  ["song trùng", "DOPPELGANGER"],
  // "theo dõi" không kèm "kẻ" vẫn là cách gọi tự nhiên trong câu khai, và
  // không đụng cụm nào khác trong bảng - cùng quy ước với "phản bội"/"song
  // trùng" ở trên.
  ["kẻ theo dõi", "TRACKER"],
  ["theo dõi", "TRACKER"],
  ["thị trưởng", "MAYOR"],
  ["sói con", "WOLF_CUB"],
  // Trước "sói" để "sói alpha" không bị khớp thành "sói" thường - cùng lý do
  // với "sói pháp sư" ngay trên. Nghe-hiểu cho parser đọc ngược lời khai.
  ["sói alpha", "ALPHA_WOLF"],
  ["dân thường", "VILLAGER"],
  ["dân làng", "VILLAGER"],
  ["tiên tri", "SEER"],
  ["phù thuỷ", "WITCH"],
  ["phù thủy", "WITCH"],
  ["thợ săn", "HUNTER"],
  ["bảo vệ", "GUARD"],
  ["ma sói", "WEREWOLF"],
  ["sói", "WEREWOLF"],
  // "hề" đứng SAU "thằng hề" vì bảng này khớp theo thứ tự, cụm dài trước. Nó
  // an toàn dù là một từ rất thường gặp ("không hề", "hề hấn") vì chỗ khớp chỉ
  // nhìn phần NGAY SAU "tôi là"/"X là", và phải khớp trọn từ.
  ["hề", "JESTER"],
  ["dân", "VILLAGER"],
  // Viết tắt người chơi thật hay gõ. An toàn vì chỗ khớp chỉ nhìn phần NGAY
  // SAU một cách tự xưng ("t là tt", "mình là bv") và phải khớp trọn token -
  // "tt" hay "bv" nằm giữa câu không bao giờ tới được đây. "dan" không cần
  // thêm: `roleAtStart` đã so cả dạng bỏ dấu của "dân".
  ["tt", "SEER"],
  ["bv", "GUARD"],
  // Cùng quy ước với "tt"/"bv": chỉ khớp trọn token ngay sau một cách tự
  // xưng. Nguồn: `reports/alias-proposal.md` (pt, ts, dl, sw).
  ["pt", "WITCH"],
  ["ts", "HUNTER"],
  ["dl", "VILLAGER"],
  ["sw", "WEREWOLF"],
];

/**
 * Một mệnh đề chứa từ phủ định thì ý nghĩa của nó đảo ngược, và parser này cố
 * tình không hiểu ngữ nghĩa. "An không thể là sói" phải bị bỏ qua, chứ không
 * được biến thành một cáo buộc nhắm vào An.
 */
const NEGATIONS = ["không", "chưa", "chẳng", "chả", "đâu có", "làm gì"];

/**
 * Phủ định mà dạng bỏ dấu trùng một từ thường: "chả" -> "cha" (cha xứ, cha
 * nội). Chỉ so dạng CÓ DẤU cho những từ này; người gõ không dấu mất một phủ
 * định hiếm, còn hơn là mọi câu có "cha" đều bị nuốt.
 */
const ASCII_AMBIGUOUS_NEGATIONS = new Set(["chả"]);

/**
 * Phủ định teencode. So theo TOKEN chứ không theo chuỗi con: "k" là chuỗi con
 * của "ok", "kk", "kkk" và của mọi tên có chữ k - so chuỗi con thì gần hết chat
 * bị coi là phủ định. Chỉ so trên dạng `plain` (giữ dấu): "hông" theo ascii là
 * "hong", trùng tên Hồng.
 */
const NEGATION_TOKENS = ["k", "ko", "kg", "hok", "hông", "hổng", "hem", "éo", "đếch"];

/**
 * Tiếng đệm cảm thán mà người chat gõ liền trước câu chính, không dấu phẩy:
 * "ok tôi là tiên tri", "ủa tôi nghi Bình". Bỏ chúng ở ĐẦU mệnh đề trước khi
 * so mẫu, và chỉ chúng.
 *
 * Cố tình KHÔNG có "thì", "nếu", "vậy", "mà", "ai": đó là những từ đổi nghĩa
 * cả câu ("nếu tôi là sói", "ai bảo tôi là sói"), và chính vì chúng mà parser
 * chỉ nhận mẫu ở đầu mệnh đề.
 */
const LEADING_INTERJECTIONS = new Set([
  "ok", "oke", "okie", "ừ", "ờ", "ừm", "ủa", "ơ", "hmm", "hm", "kk", "kkk", "haha",
  "hehe", "hihi", "alo", "thôi", "rồi", "à", "ê", "haizz", "haiz", "uh", "ừa", "dạ",
]);

/**
 * Cách tự xưng được nhận trước một lời khai. Teencode "t" đứng đầu mệnh đề gần
 * như luôn là "tôi"; các ngôi khác là cách gọi tự nhiên của người chơi thật.
 * "nhận bv" là cách khai không có chủ ngữ ("tôi nhận vai bảo vệ"); nó an toàn
 * vì token ngay sau vẫn phải là một tên vai.
 * `parseCounterClaim` vẫn chỉ nhận "tôi mới là" - phản bác là mẫu nặng hơn, nới
 * riêng khi có bằng chứng từ log.
 */
const FIRST_PERSON_MARKERS = ["tôi là ", "t là ", "tui là ", "mình là ", "tớ là ", "nhận "];

/**
 * Cách người chơi thật mở một lời buộc tội. "tôi nghi" là mẫu gốc; phần còn
 * lại là những gì người thật gõ khi họ không thèm gõ "tôi": "nghi Bình",
 * "vote Bình", "treo Bình đi", "chốt Bình".
 *
 * Nhóm "nghi" KHÔNG nhận dạng không dấu (xem `afterMarker`): "nghi" và "nghĩ"
 * cùng rút về "nghi", và "t nghi Binh vo toi" phải không thành cáo buộc.
 */
const SUSPECT_MARKERS = ["tôi nghi ", "t nghi ", "tui nghi ", "mình nghi ", "tớ nghi ", "nghi "];

/**
 * Người gõ KHÔNG dấu thì "nghi" có thể là "nghĩ". Khi đó vẫn nhận "nghi X"
 * là cáo buộc - đó là cách gõ phổ biến nhất trong phòng - TRỪ khi vế sau có
 * một từ nói X vô tội: "nghi Binh vo toi" là "nghĩ Bình vô tội".
 */
const INNOCENCE_ASCII = ["dan", "sach", "vo toi", "trong", "ok", "oke", "tot", "an toan", "uy tin", "that"];

/** Cách người thật nói "tôi bỏ phiếu cho X"; mỗi mẫu có thêm dạng có chủ ngữ. */
const PUSH_VERBS = ["vote ", "treo ", "chốt ", "up ", "đẩy ", "lynch ", "kill ", "bỏ phiếu "];
const SUBJECT_PREFIXES = ["", "tôi ", "t ", "tui ", "mình ", "tớ "];
const PUSH_MARKERS = SUBJECT_PREFIXES.flatMap((subject) =>
  PUSH_VERBS.map((verb) => `${subject}${verb}`),
);

/** "sói là Bình": vai đứng trước, tên đứng sau. */
const WOLF_IS_MARKER = "sói là ";

/** Cách mở một lời bênh vực, cùng tinh thần với `SUSPECT_MARKERS`. */
const TRUST_MARKERS = ["tôi tin ", "t tin ", "tui tin ", "mình tin ", "tớ tin ", "tin "];
const SPARE_MARKERS = ["đừng treo ", "đừng vote ", "đừng chốt ", "đừng up ", "đừng đẩy ", "tha cho ", "tha "];

/**
 * Nhãn đứng SAU tên: "Bình sói", "Bình dân", "Bình khả nghi". Chỉ dạng CÓ
 * DẤU, và đó là ranh giới quan trọng nhất của nhóm này: "soi" không dấu là
 * động từ soi của Tiên Tri ("Bình soi Chi"), và "dan"/"sach" nằm trong đủ thứ
 * tên và chữ khác. Cụm nhiều tiếng so theo dãy token.
 */
const ACCUSE_LABELS = ["sói", "sủa", "fake", "giả", "khả nghi", "đáng nghi", "đáng ngờ", "xạo", "nói dối", "láo"];
const DEFEND_LABELS = ["dân", "sạch", "trong sạch", "vô tội", "ok", "oke", "uy tín", "an toàn"];

/**
 * Tiếng đệm được phép chen giữa tên và nhãn: "Bình đúng sói rồi", "Bình chắc
 * dân", "Bình 100% sói". Chỉ từ nhấn mạnh, không có từ đổi nghĩa.
 */
const LABEL_INTENSIFIERS = new Set([
  "đúng", "chắc", "chắn", "chuẩn", "100", "quá", "rất", "hơi", "khá", "là", "thì",
  "đích", "thị", "cũng", "đang", "vẫn", "mới",
]);

/**
 * Từ được phép chen giữa TÊN và NHÃN trong một mệnh đề phủ định.
 *
 * "Bình không phải sói", "Bình ko thể là sói", "Bình chả phải dân": chính từ
 * phủ định đứng chen vào đó, nên không lùi qua nó thì không bao giờ với tới
 * được cái tên. `phải`/`thể` đi kèm vì chúng chỉ xuất hiện ở đúng chỗ này -
 * không có mẫu khẳng định nào của parser dùng tới hai từ ấy.
 *
 * `LABEL_INTENSIFIERS` gộp vào để "Bình ko đúng là sói" vẫn đọc được.
 */
const NEGATED_LABEL_FILLERS = new Set([
  ...LABEL_INTENSIFIERS,
  ...NEGATION_TOKENS,
  ...NEGATIONS,
  "phải",
  "thể",
]);

/** Từ phủ định ở dạng MỘT token, để hỏi "có phủ định chen vào đây không". */
const NEGATION_WORDS = new Set([...NEGATIONS, ...NEGATION_TOKENS]);

function importanceTable(weights: BotWeights): Partial<Record<BotMemoryType, number>> {
  const table = weights.memoryImportance;
  return {
    ROLE_CLAIM: table.roleClaim,
    COUNTER_CLAIM: table.counterClaim,
    ACCUSE: table.accuse,
    DEFEND: table.defend,
    DIRECT_ADDRESS: table.directAddress,
    DIRECT_QUESTION: table.directQuestion,
  };
}

/**
 * Từ để hỏi được chấp nhận khi câu không có dấu chấm hỏi.
 *
 * Người chat game bỏ dấu câu liên tục, nên bắt buộc phải có `?` sẽ bỏ sót phần
 * lớn câu hỏi thật. Danh sách cố tình NGẮN và chỉ gồm những từ mà sự hiện diện
 * của chúng, KÈM một cái tên khớp duy nhất, gần như luôn có nghĩa là đang hỏi.
 */
const QUESTION_WORDS = ["sao", "tại sao", "vì sao", "thế nào", "đâu", "gì", "nào", "ai"];

/**
 * Đuôi hỏi có/không ở CUỐI một mệnh đề: "An nói rõ hơn được không", "An là tt
 * đúng ko". Chúng giữ đúng vai của dấu "?" mà người chat game hay bỏ - và chỉ
 * được nhận ở cuối mệnh đề, vì "không" đứng giữa câu là phủ định.
 *
 * Dạng có dấu so trên `plain`; dạng không dấu chỉ nhận cụm HAI tiếng ("duoc
 * khong", "phai ko"), vì một tiếng rời bỏ dấu đụng ngay vào tên người: "hả" →
 * "ha" là tên Hà, và "toi nghi Ha" không phải một câu hỏi.
 */
const YES_NO_TAILS = [
  "được không", "được ko", "được k", "đc không", "đc ko", "đc k", "dc ko", "dc k",
  "phải không", "phải ko", "phải k",
  "đúng không", "đúng ko", "đúng k",
  "hả", "hở", "hử",
];
const YES_NO_TAILS_ASCII = ["duoc khong", "duoc ko", "duoc k", "dc khong", "phai khong", "phai ko", "dung khong", "dung ko"];

/**
 * Lời XIN ý kiến, nêu tên người được hỏi: "hóng ý kiến An", "xin ý kiến An".
 * Cụm phải đủ hai tiếng trở lên; "ý kiến" một mình là nói VỀ ý kiến của ai đó
 * ("ý kiến của An hay đấy") chứ chưa phải hỏi họ.
 */
const OPINION_REQUESTS = ["hóng ý kiến", "xin ý kiến", "hóng ý"];
const OPINION_REQUESTS_ASCII = ["hong y kien", "xin y kien"];

/** Tiểu từ gọi đáp: dấu hiệu rõ ràng nhất của việc nói VỚI ai đó. */
const VOCATIVE_PARTICLES = ["ơi", "à", "ê", "này", "nhé", "nhá"];

/** Tiểu từ cầu khiến ở CUỐI câu: "An giải thích đi" là nói với An. */
const IMPERATIVE_ENDINGS = ["đi", "nào", "xem", "coi", "thử"];

function includesWord(text: string, word: string): boolean {
  return (
    text === word ||
    text.startsWith(`${word} `) ||
    text.endsWith(` ${word}`) ||
    text.includes(` ${word} `)
  );
}

/**
 * Từ mở đầu một GIẢ ĐỊNH: "nếu An trả lời được không thì tính sau" không hỏi
 * An. Chỉ xét ở đầu mệnh đề, sau khi bỏ "ok"/"ủa"; một mệnh đề khác trong
 * cùng tin nhắn vẫn có thể là câu hỏi thật ("nếu An là dân, An nói rõ được không").
 */
const CONDITIONAL_OPENERS = ["nếu", "giả sử", "lỡ", "nhỡ", "ví dụ", "kể cả", "dù", "cứ cho là"];

/** Đoạn trong ngoặc kép là lời TRÍCH, không phải lời nói với ai. Bỏ đi trước khi tìm dấu hiệu hỏi mới. */
const QUOTED_SPAN = /["“”'‘’][^"“”'‘’]*["“”'‘’]/g;

function stripQuoted(raw: string): string {
  return raw.replace(QUOTED_SPAN, " ");
}

function clauseOf(text: string): Clause {
  return { plain: plainForm(text), ascii: asciiForm(text) };
}

function opensConditional(clause: Clause): boolean {
  const head = stripLeadingInterjections(clause);
  return CONDITIONAL_OPENERS.some(
    (word) =>
      head.plain === word ||
      head.plain.startsWith(`${word} `) ||
      head.ascii === asciiForm(word) ||
      head.ascii.startsWith(`${asciiForm(word)} `),
  );
}

/**
 * Phần đứng TRƯỚC một dấu hiệu hỏi mới có làm nó mất nghĩa hỏi không.
 *
 * Hai dấu hiệu mới (đuôi có/không, xin ý kiến) không có dấu "?" chống lưng,
 * nên chúng chỉ được tin khi phần đầu mệnh đề không phủ định ("tôi không hóng
 * ý kiến An", "An không phải sói đúng không" - bảo thủ: im) và không mở đầu
 * bằng giả định. Dấu "?" và từ để hỏi giữ luật cũ: "An không phải sói à?"
 * vẫn là câu hỏi.
 */
function headAllowsAsking(head: Clause): boolean {
  if (head.plain.length === 0) return true;
  return !hasNegation(head) && !opensConditional(head);
}

/** Có mệnh đề nào kết bằng một đuôi hỏi có/không không. Xem `YES_NO_TAILS`. */
function endsWithYesNoTail(raw: string): boolean {
  return stripQuoted(raw).split(CLAUSE_SEPARATORS).some((segment) => {
    const clause = clauseOf(segment);
    if (clause.plain.length === 0) return false;
    const plainTail = YES_NO_TAILS.find((tail) => clause.plain === tail || clause.plain.endsWith(` ${tail}`));
    if (plainTail !== undefined) {
      return headAllowsAsking(clauseOf(clause.plain.slice(0, clause.plain.length - plainTail.length)));
    }
    const asciiTail = YES_NO_TAILS_ASCII.find((tail) => clause.ascii === tail || clause.ascii.endsWith(` ${tail}`));
    if (asciiTail !== undefined) {
      return headAllowsAsking(clauseOf(clause.ascii.slice(0, clause.ascii.length - asciiTail.length)));
    }
    return false;
  });
}

/** Có mệnh đề nào XIN ý kiến (không phủ định, không giả định, không trích) không. */
function requestsOpinion(raw: string): boolean {
  return stripQuoted(raw).split(CLAUSE_SEPARATORS).some((segment) => {
    const clause = clauseOf(segment);
    if (clause.plain.length === 0) return false;
    for (const phrase of OPINION_REQUESTS) {
      const index = includesWord(clause.plain, phrase) ? clause.plain.indexOf(phrase) : -1;
      if (index >= 0) return headAllowsAsking(clauseOf(clause.plain.slice(0, index)));
    }
    for (const phrase of OPINION_REQUESTS_ASCII) {
      const index = includesWord(clause.ascii, phrase) ? clause.ascii.indexOf(phrase) : -1;
      if (index >= 0) return headAllowsAsking(clauseOf(clause.ascii.slice(0, index)));
    }
    return false;
  });
}

/**
 * Câu hỏi ĐANG HỎI VỀ CHUYỆN GÌ (spec COMMUNICATION §13).
 *
 * Bảy ô. Chúng sinh ra cho `question-policy.ts`, nơi rẽ nhánh KHÁC NHAU trên
 * từng ô; file đó đã bị xoá cùng thang v24–v28 (xem `DEFAULT_BOT_WEIGHTS`),
 * nên hiện nhãn này vẫn được gắn và đi vào `trigger.questionType` nhưng KHÔNG
 * còn ai rẽ nhánh trên nó.
 * Spec §13 gợi ý thêm `MOTIVE` và `DEFENSE`; hai ô đó bị bỏ có chủ đích vì mọi
 * đường đi của chúng trùng khít `GENERAL` - một nhãn không ai đọc là một nhãn
 * sẽ trôi lệch khỏi hành vi thật. Thêm lại khi có một nhánh chiến thuật cần nó.
 */
export const QUESTION_TYPES = [
  /** "mày là sói phải ko" - một cáo buộc mặc áo câu hỏi. */
  "ACCUSATION",
  /** "vai gì thế", "t là tt, còn ông" - hỏi thẳng vai. */
  "ROLE",
  /** "dựa vào đâu", "căn cứ gì" - đòi bằng chứng. */
  "EVIDENCE",
  /** "sao lúc nãy bảo tin A giờ lại nghi" - hỏi về tính nhất quán. */
  "CONSISTENCY",
  /** "sao vote B" - hỏi về lá phiếu. */
  "VOTE",
  /** "nghi ai nhất" - hỏi mục tiêu. */
  "TARGET",
  "GENERAL",
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

/** Dấu hiệu của từng loại. Bảo thủ: không khớp gì thì `GENERAL`. */
const QUESTION_MARKERS: ReadonlyArray<readonly [QuestionType, readonly string[]]> = [
  // Trước ROLE: "mày là sói ko" có chữ vai, nhưng nó là một lời tố chứ không
  // phải một câu hỏi về vai. Chỉ dòng SÓI mới đảo được nghĩa như vậy.
  ["ACCUSATION", ["sói", "ma sói", "sw", "sói con", "sói alpha", "phản bội", "sát nhân"]],
  ["ROLE", ["vai gì", "vai nào", "vai j", "role gì", "vai của", "tiên tri", "tt", "bảo vệ", "bv", "phù thuỷ", "phù thủy", "thợ săn", "thám tử", "dân làng", "dân"]],
  ["EVIDENCE", ["căn cứ", "bằng chứng", "dựa vào đâu", "dựa vào gì", "sao biết", "biết sao", "lý do", "chứng minh", "cơ sở"]],
  // Trước VOTE: "sao lúc nãy đổi phiếu" là câu hỏi về tính nhất quán, không
  // phải một câu hỏi về lá phiếu hôm nay.
  ["CONSISTENCY", ["lúc nãy", "hồi nãy", "vừa nãy", "hôm qua", "vòng trước", "đổi ý", "đổi phiếu", "quay xe", "lúc trước", "ban nãy", "mới nói", "vừa bảo"]],
  ["VOTE", ["vote", "phiếu", "bỏ phiếu", "treo ai", "treo ", "vót"]],
  ["TARGET", ["nghi ai", "nghi ng nào", "ai lạ", "chọn ai", "theo ai", "nhắm ai", "ai nhất"]],
];

/**
 * Câu hỏi này thuộc loại nào.
 *
 * Chạy trên CẢ tin nhắn, cùng lý do với `parseDirectAddress`: dấu hiệu loại
 * thường nằm khác mệnh đề với lời gọi tên ("An ơi, dựa vào đâu vậy").
 *
 * Thuần cú pháp như phần còn lại của module: nó nói câu hỏi ĐỀ CẬP tới chuyện
 * gì, không nói người hỏi đang nghĩ gì. Không sinh bằng chứng, không đổi belief.
 */
export function classifyQuestion(whole: Clause): QuestionType {
  for (const [type, markers] of QUESTION_MARKERS) {
    for (const marker of markers) {
      const ascii = asciiForm(marker);
      if (includesWord(whole.plain, marker) || includesWord(whole.ascii, ascii)) {
        return type;
      }
    }
  }
  return "GENERAL";
}

/**
 * Một câu nói THẲNG VỚI một người, nếu có.
 *
 * Đòi hỏi một dấu hiệu cú pháp tường minh: dấu hỏi, một từ để hỏi, một tiểu từ
 * gọi đáp, hoặc một tiểu từ cầu khiến ở cuối câu. Chỉ nêu tên là CHƯA ĐỦ.
 *
 * Ranh giới này là cố ý và nó là ranh giới quan trọng nhất của cả module. "Bình
 * không thể là sói" có nêu tên Bình nhưng là nói VỀ Bình, không phải nói VỚI
 * Bình; coi nó là một lời nhắm tới sẽ khiến gần như mọi câu trong ván sinh ra
 * một móc treo hội thoại, và BOT sẽ đáp lại những câu chẳng ai hỏi nó.
 *
 * Chạy trên CẢ tin nhắn chứ không theo mệnh đề: lời gọi tên hay nằm ở cuối
 * ("nghĩ sao An?"), và tách mệnh đề sẽ cắt nó khỏi phần còn lại của câu.
 */
function parseDirectAddress(
  whole: Clause,
  raw: string,
  actorId: string,
  players: readonly BotPlayerKnowledge[],
): ParsedSpeech | null {
  const target = resolveTarget(whole.plain, players);
  // Người gửi tự nêu tên mình không phải là đang nói với chính mình.
  if (!target || target.id === actorId) return null;

  // "đâu" vừa là từ để hỏi ("An đâu rồi") vừa là tiểu từ phủ định cuối câu
  // ("tôi ko tin An đâu"). Trong một câu đã có phủ định thì nó là vế sau.
  const negated = hasNegation(whole);
  const asking =
    raw.includes("?") ||
    QUESTION_WORDS.some((word) => (word === "đâu" && negated ? false : includesWord(whole.plain, word))) ||
    endsWithYesNoTail(raw) ||
    requestsOpinion(raw);
  if (asking) {
    return {
      type: "DIRECT_QUESTION",
      targetId: target.id,
      data: { questionType: classifyQuestion(whole) },
    };
  }

  const calling =
    VOCATIVE_PARTICLES.some((word) => includesWord(whole.plain, word)) ||
    IMPERATIVE_ENDINGS.some((word) => whole.plain.endsWith(` ${word}`));
  return calling ? { type: "DIRECT_ADDRESS", targetId: target.id, data: {} } : null;
}

/** Hai dạng của cùng một mệnh đề, dùng song song trong toàn bộ parser. */
export interface Clause {
  plain: string;
  ascii: string;
}

/**
 * `export` để công cụ đào alias loại đúng những mệnh đề mà parser cũng loại.
 * Không dùng chung hàm này thì đề xuất sẽ đầy alias rút ra từ "tôi không phải
 * sói" - tức những câu mà parser sẽ không bao giờ đọc tới.
 */
export function hasNegation(clause: Clause): boolean {
  // So theo TOKEN ở cả hai dạng, không so chuỗi con. Trước đây dạng ascii so
  // chuỗi con, nên "chả" (-> "cha") nuốt luôn "chắc", "chào", "chạy"...: mọi
  // câu "Bình là sói chắc luôn" đều bị coi là phủ định và bot điếc hẳn.
  const plainTokens = clause.plain.split(" ").filter(Boolean);
  const asciiTokens = clause.ascii.split(" ").filter(Boolean);
  if (
    NEGATIONS.some(
      (word) =>
        containsTokens(plainTokens, word.split(" ")) ||
        (!ASCII_AMBIGUOUS_NEGATIONS.has(word) &&
          containsTokens(asciiTokens, asciiForm(word).split(" "))),
    )
  ) {
    return true;
  }
  if (NEGATION_TOKENS.some((word) => plainTokens.includes(word))) return true;
  // "Bình sói đâu" / "Bình mà tt gì": "đâu"/"gì" ở CUỐI câu là phủ định
  // theo lối nói, không phải từ để hỏi. Một mình "đâu" ("Bình đâu") thì
  // không phải câu nào để mà phủ định.
  const last = plainTokens.at(-1);
  return plainTokens.length > 1 && (last === "đâu" || last === "gì");
}

/**
 * Bỏ tiếng đệm cảm thán ở đầu mệnh đề, giữ lại ít nhất một token.
 *
 * `export` cùng lý do với `hasNegation`: công cụ đào alias phải nhìn mệnh đề
 * đúng như parser nhìn.
 */
export function stripLeadingInterjections(clause: Clause): Clause {
  const tokens = clause.plain.split(" ").filter(Boolean);
  let start = 0;
  while (start < tokens.length - 1 && LEADING_INTERJECTIONS.has(tokens[start]!)) start += 1;
  if (start === 0) return clause;
  const plain = tokens.slice(start).join(" ");
  return { plain, ascii: asciiForm(plain) };
}

/**
 * Vai đứng ngay ĐẦU đoạn, hoặc `null`.
 *
 * `export` để công cụ đào alias hỏi đúng một câu: "token này parser hiện tại đã
 * hiểu chưa". Trả `null` chính là định nghĩa của một alias còn thiếu.
 */
export function roleAtStart(segment: Clause): Role | null {
  for (const [phrase, role] of ROLE_PHRASES) {
    for (const [text, marker] of [
      [segment.plain, phrase],
      [segment.ascii, asciiForm(phrase)],
    ] as const) {
      if (text === marker || text.startsWith(`${marker} `)) return role;
    }
  }
  return null;
}

function containsTokens(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0) return false;
  for (let index = 0; index + needle.length <= haystack.length; index += 1) {
    if (needle.every((token, offset) => haystack[index + offset] === token)) return true;
  }
  return false;
}

/**
 * Chỉ nhận target khi nó khớp duy nhất.
 *
 * Tên đầy đủ được ưu tiên; chỉ khi không có tên đầy đủ nào khớp thì mới xét tên
 * rút gọn. Hai người cùng tên rút gọn thì bỏ qua câu, vì đoán bừa một người sẽ
 * tạo ra bằng chứng sai mà người chơi không thể phản bác.
 */
function resolveTarget(
  segment: string,
  players: readonly BotPlayerKnowledge[],
): BotPlayerKnowledge | null {
  const tokens = asciiForm(segment).split(" ").filter(Boolean);
  if (tokens.length === 0) return null;

  const fullMatches = players.filter((player) =>
    containsTokens(tokens, asciiForm(player.name).split(" ").filter(Boolean)),
  );
  if (fullMatches.length === 1) return fullMatches[0]!;
  if (fullMatches.length > 1) return null;

  const shortMatches = players.filter((player) => {
    const parts = asciiForm(player.name).split(" ").filter(Boolean);
    const short = parts.at(-1);
    return short !== undefined && tokens.includes(short);
  });
  return shortMatches.length === 1 ? shortMatches[0]! : null;
}

interface ParsedSpeech {
  type: BotMemoryType;
  targetId?: string;
  data: Record<string, unknown>;
}

/**
 * Mẫu chỉ được nhận ở ĐẦU mệnh đề.
 *
 * Cho phép khớp giữa câu là cách nhanh nhất để biến "ai bảo tôi là sói?" hay
 * "nếu tôi là sói thì tôi đã giết B rồi" thành một lời tự nhận vai được ghim
 * vĩnh viễn vào state.
 *
 * `acceptAscii = false` dành cho mẫu mà việc bỏ dấu tạo ra một từ khác hẳn:
 * "tôi nghi" (nghi ngờ) và "tôi nghĩ" (suy nghĩ) cùng rút về "toi nghi", nên
 * chấp nhận dạng không dấu ở đó sẽ biến mọi câu "tôi nghĩ X vô tội" thành một
 * lời buộc tội X.
 */
function afterMarker(clause: Clause, marker: string, acceptAscii = true): Clause | null {
  if (clause.plain.startsWith(marker)) {
    const rest = clause.plain.slice(marker.length).trim();
    return { plain: rest, ascii: asciiForm(rest) };
  }
  if (!acceptAscii) return null;
  // `asciiForm` cắt khoảng trắng cuối, mà mọi marker đều kết thúc bằng một
  // khoảng trắng để đòi khớp trọn từ. Trả lại nó, nếu không "tha " rút thành
  // "tha" và khớp luôn "thằng Bình sói".
  const asciiMarker = marker.endsWith(" ") ? `${asciiForm(marker)} ` : asciiForm(marker);
  if (clause.ascii.startsWith(asciiMarker)) {
    const rest = clause.ascii.slice(asciiMarker.length).trim();
    return { plain: rest, ascii: rest };
  }
  return null;
}

/** Vị trí của một mẫu nằm giữa mệnh đề, thử cả hai dạng. */
function markerIndex(clause: Clause, marker: string): { index: number; text: string } | null {
  const plainIndex = clause.plain.indexOf(marker);
  if (plainIndex !== -1) return { index: plainIndex, text: clause.plain };
  const asciiIndex = clause.ascii.indexOf(asciiForm(marker));
  return asciiIndex === -1 ? null : { index: asciiIndex, text: clause.ascii };
}

/**
 * Phản bác: "<tên> không thể là <role>, tôi mới là <role>".
 *
 * Mẫu này được so trên CẢ tin nhắn chứ không theo mệnh đề, vì hai vế của nó nằm
 * hai bên dấu phẩy. Nó cũng là mẫu duy nhất được phép chứa từ phủ định, vì phủ
 * định chính là nội dung của nó.
 */
function parseCounterClaim(
  whole: Clause,
  players: readonly BotPlayerKnowledge[],
): ParsedSpeech | null {
  const denied = markerIndex(whole, " không thể là ");
  if (!denied) return null;
  const counter = markerIndex(whole, "tôi mới là ");
  if (!counter) return null;

  const target = resolveTarget(denied.text.slice(0, denied.index), players);
  const rest = counter.text.slice(counter.index + "tôi mới là ".length).trim();
  const role = roleAtStart({ plain: rest, ascii: asciiForm(rest) });
  return target && role
    ? { type: "COUNTER_CLAIM", targetId: target.id, data: { role } }
    : null;
}

function parseClause(
  raw: Clause,
  players: readonly BotPlayerKnowledge[],
): ParsedSpeech | null {
  if (raw.plain.length === 0) return null;
  // Phủ định rẽ sang một đường RIÊNG, hẹp hơn hẳn: chỉ nhãn, và ngược cực.
  // Không mẫu khẳng định nào chạy được ở đó - xem `parseNegatedClause`.
  if (hasNegation(raw)) return parseNegatedClause(raw, players);
  // Bỏ "ok"/"ủa"/"kk" đứng trước câu chính. Phủ định đã được xét trên mệnh đề
  // ĐẦY ĐỦ ở trên, nên bước này không mở đường cho "ko" lọt qua.
  const clause = stripLeadingInterjections(raw);

  for (const marker of FIRST_PERSON_MARKERS) {
    const claim = afterMarker(clause, marker);
    if (!claim) continue;
    const role = roleAtStart(claim);
    return role ? { type: "ROLE_CLAIM", data: { role } } : null;
  }

  // "nghi" tự nó không có dấu, nên `acceptAscii = false` không đủ để chặn
  // "nghi Binh vo toi" (nghĩ Bình vô tội) gõ không dấu. Người đã gõ dấu mà
  // viết "nghi" thì đúng là đang nghi; người gõ không dấu thì chỉ được nhận
  // khi vế sau không nói gì tới sự vô tội của người bị nêu tên.
  //
  // Người gõ có dấu: chỉ so dạng có dấu, để "tôi nghĩ Bình" không khớp "tôi
  // nghi" qua đường ascii. Người gõ không dấu: so ascii, kèm cổng vô tội.
  const typedWithDiacritics = clause.plain !== clause.ascii;
  for (const marker of SUSPECT_MARKERS) {
    const suspect = afterMarker(clause, marker, !typedWithDiacritics);
    if (!suspect) continue;
    if (!typedWithDiacritics && mentionsInnocence(suspect.ascii)) return null;
    const target = resolveTarget(suspect.plain, players);
    return target ? { type: "ACCUSE", targetId: target.id, data: {} } : null;
  }

  const wolfIs = afterMarker(clause, WOLF_IS_MARKER);
  if (wolfIs) {
    const target = resolveTarget(wolfIs.plain, players);
    return target ? { type: "ACCUSE", targetId: target.id, data: {} } : null;
  }

  // "đừng treo"/"đừng vote" đứng đầu mệnh đề nên không bao giờ tới được
  // `PUSH_MARKERS` ("treo "/"vote " phải ở ngay đầu), nhưng xét bênh vực TRƯỚC
  // để thứ tự trong file cũng nói đúng điều đó.
  for (const marker of SPARE_MARKERS) {
    const spare = afterMarker(clause, marker);
    if (!spare) continue;
    const target = resolveTarget(spare.plain, players);
    return target ? { type: "DEFEND", targetId: target.id, data: {} } : null;
  }

  for (const marker of PUSH_MARKERS) {
    const push = afterMarker(clause, marker);
    if (!push) continue;
    const target = resolveTarget(push.plain, players);
    return target ? { type: "ACCUSE", targetId: target.id, data: {} } : null;
  }

  const wolfCall = markerIndex(clause, " là sói");
  if (wolfCall) {
    const target = resolveTarget(wolfCall.text.slice(0, wolfCall.index), players);
    return target ? { type: "ACCUSE", targetId: target.id, data: {} } : null;
  }

  // Đối xứng với " là sói", và cũng nhận dạng không dấu: "Binh la dan" là
  // câu bênh vực phổ biến nhất trong phòng.
  const villagerCall = markerIndex(clause, " là dân");
  if (villagerCall) {
    const target = resolveTarget(villagerCall.text.slice(0, villagerCall.index), players);
    return target ? { type: "DEFEND", targetId: target.id, data: {} } : null;
  }

  for (const marker of TRUST_MARKERS) {
    const trust = afterMarker(clause, marker);
    if (!trust) continue;
    const target = resolveTarget(trust.plain, players);
    return target ? { type: "DEFEND", targetId: target.id, data: {} } : null;
  }

  const accused = labelledTarget(clause, ACCUSE_LABELS, players);
  if (accused) return { type: "ACCUSE", targetId: accused.target.id, data: {} };

  const cleared = labelledTarget(clause, DEFEND_LABELS, players);
  if (cleared) return { type: "DEFEND", targetId: cleared.target.id, data: {} };

  return null;
}

/**
 * Người đứng NGAY TRƯỚC một nhãn: "Bình sói", "thằng Bình dân".
 *
 * Chỉ nhìn token liền trước nhãn, không nhìn cả mệnh đề: "Bình soi Chi ra dân"
 * có "dân" ở cuối nhưng token trước nó là "ra", nên không ai được bênh cả.
 * So trên dạng `plain` (giữ dấu) - xem chú thích ở `ACCUSE_LABELS`.
 */
interface LabelMatch {
  target: BotPlayerKnowledge;
  /** Vị trí token của TÊN. */
  head: number;
  /** Vị trí token đầu tiên của NHÃN. */
  index: number;
}

function labelledTarget(
  clause: Clause,
  labels: readonly string[],
  players: readonly BotPlayerKnowledge[],
  fillers: ReadonlySet<string> = LABEL_INTENSIFIERS,
): LabelMatch | null {
  const tokens = clause.plain.split(" ").filter(Boolean);
  for (const label of labels) {
    const needle = label.split(" ");
    for (let index = 1; index + needle.length <= tokens.length; index += 1) {
      if (!needle.every((token, offset) => tokens[index + offset] === token)) continue;
      // Lùi qua tiếng đệm nhấn mạnh: "Bình đúng là sói" -> "bình".
      let head = index - 1;
      while (head > 0 && fillers.has(tokens[head]!)) head -= 1;
      const target = resolveTarget(tokens[head]!, players);
      if (target) return { target, head, index };
    }
  }
  return null;
}

/**
 * Mệnh đề PHỦ ĐỊNH: chỉ đọc NHÃN, và đọc ngược cực.
 *
 * "Bình không phải sói" là một lời bênh vực, không phải một câu vô nghĩa - và
 * người Việt bênh nhau bằng cách phủ định lời tố nhiều hơn là bằng cách khen.
 * Trước đây `parseClause` nuốt trọn mọi mệnh đề phủ định, nên cả nhóm câu ấy
 * vô hình với bot.
 *
 * Chỉ NHÃN, không động từ, và đó là ranh giới quan trọng nhất ở đây:
 *
 * - Nhãn là một khẳng định VỀ NGƯỜI ("Bình là sói"), nên phủ định nó cũng là
 *   một khẳng định về người, chỉ ngược cực.
 * - Động từ là trạng thái của NGƯỜI NÓI ("tôi không nghi Bình", "t k tin
 *   Bình"). "Tôi không nghi Bình" không có nghĩa là Bình dân - nó chỉ nghĩa là
 *   người nói chưa nghi. Đọc nó thành bênh vực là suy diễn, và đó đúng là thứ
 *   parser này cố tình không làm. Cả nhóm đó vẫn trả `null`, và vẫn nằm trong
 *   `HUMAN_TRAPS`.
 *
 * Mọi mẫu khẳng định (khai vai, `nghi`, `vote`, `treo`, `tin`, `là sói`,
 * `là dân`) đều KHÔNG được chạy ở đây: một mệnh đề phủ định đi qua chúng là
 * đúng cái lỗi mà cổng `hasNegation` được dựng để chặn.
 */
function parseNegatedClause(
  clause: Clause,
  players: readonly BotPlayerKnowledge[],
): ParsedSpeech | null {
  const tokens = clause.plain.split(" ").filter(Boolean);

  /**
   * Từ phủ định phải nằm CHEN GIỮA tên và nhãn, không chỉ đâu đó trong câu.
   *
   * Đây là ranh giới giữa "Bình không phải sói" (bênh Bình) và "An là sói đúng
   * không" (một câu HỎI). Cả hai đều có "không" nên `hasNegation` gật cả hai,
   * nhưng ở câu sau, phủ định nằm ở ĐUÔI HỎI phía sau nhãn - nó không phủ định
   * cái nhãn, nó biến cả câu thành câu hỏi. Đọc nó thành lời bênh An là đảo
   * ngược hẳn nghĩa, tệ hơn im lặng.
   *
   * Cũng chính điều kiện này loại luôn lối phủ định bằng tiểu từ cuối câu mà
   * `hasNegation` nhận ("Bình sói đâu", "Bình mà sói gì"): ở đó không có gì
   * chen giữa tên và nhãn cả. Chúng mơ hồ thật - "Bình mà tt gì, sói thì có"
   * là một lời TỐ - nên chúng ở lại phía im lặng.
   */
  const negatedBetween = (match: LabelMatch): boolean =>
    tokens.slice(match.head + 1, match.index).some((token) => NEGATION_WORDS.has(token));

  const cleared = labelledTarget(clause, ACCUSE_LABELS, players, NEGATED_LABEL_FILLERS);
  if (cleared && negatedBetween(cleared)) {
    return { type: "DEFEND", targetId: cleared.target.id, data: {} };
  }

  const accused = labelledTarget(clause, DEFEND_LABELS, players, NEGATED_LABEL_FILLERS);
  if (accused && negatedBetween(accused)) {
    return { type: "ACCUSE", targetId: accused.target.id, data: {} };
  }

  return null;
}


function mentionsInnocence(asciiRest: string): boolean {
  const tokens = asciiRest.split(" ").filter(Boolean);
  return INNOCENCE_ASCII.some((word) => containsTokens(tokens, word.split(" ")));
}

export interface ChatAnalysisOptions {
  round?: number;
  phase?: Phase;
  weights?: BotWeights;
}

/**
 * Parser bảo thủ: chỉ tạo observation khi actor có thật, message ID có thật,
 * target khớp duy nhất và một mệnh đề bắt đầu bằng một mẫu rõ ràng. Câu mơ hồ,
 * câu phủ định và tên trùng đều bị bỏ qua thay vì suy diễn, và nội dung gốc
 * không bao giờ được copy vào memory.
 *
 * Caller phải truyền chat ĐÃ LỌC theo quyền của chính BOT: module này phân tích
 * đúng những gì nó được đưa và không tự biết kênh nào là bí mật.
 */
export function analyzeChat(
  messages: readonly BotChatObservation[],
  players: readonly BotPlayerKnowledge[],
  options: ChatAnalysisOptions = {},
): BotMemory[] {
  const { round = 0, phase = "DAY_DISCUSSION", weights = DEFAULT_BOT_WEIGHTS } = options;
  const importance = importanceTable(weights);
  const memories: BotMemory[] = [];

  const push = (message: BotChatObservation, parsed: ParsedSpeech) => {
    memories.push({
      id: `${parsed.type}:${message.id}:${parsed.targetId ?? ""}`,
      sourceId: message.id,
      round,
      phase,
      type: parsed.type,
      actorId: message.actorId,
      targetId: parsed.targetId,
      importance: importance[parsed.type] ?? weights.memoryImportance.fallback,
      pinned: parsed.type === "ROLE_CLAIM" || parsed.type === "COUNTER_CLAIM",
      data: parsed.data,
    });
  };

  for (const message of messages) {
    if (!players.some((player) => player.id === message.actorId)) continue;

    const whole: Clause = { plain: plainForm(message.text), ascii: asciiForm(message.text) };

    // Lời nhắm tới được xét ĐỘC LẬP với mọi mẫu khác, và luôn được xét.
    //
    // "Tôi nghi An, đúng không An?" vừa là một cáo buộc vừa là một câu hỏi nhắm
    // vào An. Cho hai thứ đó loại trừ nhau sẽ mất một trong hai, và mất cái nào
    // cũng làm hỏng một hành vi khác nhau: mất cáo buộc thì belief không cập
    // nhật, mất câu hỏi thì BOT không biết mình vừa bị hỏi.
    const addressed = parseDirectAddress(whole, message.text, message.actorId, players);
    if (addressed) push(message, addressed);

    const counterClaim = parseCounterClaim(whole, players);
    if (counterClaim) {
      push(message, counterClaim);
      continue;
    }

    // Tách mệnh đề trên văn bản gốc: dấu câu là ranh giới duy nhất cho biết một
    // mẫu có đang mở đầu một ý mới hay chỉ nằm lọt giữa câu. Mỗi mệnh đề được
    // đọc độc lập, nên "Đừng treo An, tôi nghi Chi" giữ được cả hai ý.
    for (const raw of message.text.split(CLAUSE_SEPARATORS)) {
      const parsed = parseClause({ plain: plainForm(raw), ascii: asciiForm(raw) }, players);
      if (parsed) push(message, parsed);
    }
  }

  return memories;
}
