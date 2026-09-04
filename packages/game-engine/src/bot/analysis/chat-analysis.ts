import type { Phase, Role } from "@masoi/shared";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import type { BotChatObservation, BotMemory, BotMemoryType, BotPlayerKnowledge } from "../types";

/**
 * Dạng "plain": hạ chữ thường, bỏ dấu câu, nhưng GIỮ NGUYÊN dấu tiếng Việt.
 */
function plainForm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Dấu câu là ranh giới mệnh đề duy nhất mà parser này tin. */
const CLAUSE_SEPARATORS = /[.,;:!?\n]+/;

const COMBINING_MARKS = /[\u0300-\u036f]/g;

/**
 * Dạng "ascii": bỏ dấu, để so khớp tên và để hiểu người gõ không dấu. `đ` không
 * phải dấu tổ hợp nên phải thay riêng.
 */
function asciiForm(text: string): string {
  return plainForm(text).normalize("NFD").replace(COMBINING_MARKS, "").replace(/đ/g, "d");
}

/** Cụm dài đứng trước để "dân làng" không bị khớp thành "dân". */
const ROLE_PHRASES: Array<[string, Role]> = [
  ["kẻ nguyền rủa", "CURSED"],
  ["tiên tri tập sự", "APPRENTICE_SEER"],
  ["thiên thần hộ mệnh", "GUARDIAN_ANGEL"],
  ["thiên thần", "GUARDIAN_ANGEL"],
  ["thằng hề", "JESTER"],
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
  ["linh mục", "PRIEST"],
  ["thị trưởng", "MAYOR"],
  ["sói con", "WOLF_CUB"],
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
];

/**
 * Một mệnh đề chứa từ phủ định thì ý nghĩa của nó đảo ngược, và parser này cố
 * tình không hiểu ngữ nghĩa. "An không thể là sói" phải bị bỏ qua, chứ không
 * được biến thành một cáo buộc nhắm vào An.
 */
const NEGATIONS = ["không", "chưa", "chẳng", "chả", "đâu có", "làm gì"];

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

  const asking =
    raw.includes("?") || QUESTION_WORDS.some((word) => includesWord(whole.plain, word));
  if (asking) return { type: "DIRECT_QUESTION", targetId: target.id, data: {} };

  const calling =
    VOCATIVE_PARTICLES.some((word) => includesWord(whole.plain, word)) ||
    IMPERATIVE_ENDINGS.some((word) => whole.plain.endsWith(` ${word}`));
  return calling ? { type: "DIRECT_ADDRESS", targetId: target.id, data: {} } : null;
}

/** Hai dạng của cùng một mệnh đề, dùng song song trong toàn bộ parser. */
interface Clause {
  plain: string;
  ascii: string;
}

function hasNegation(clause: Clause): boolean {
  return NEGATIONS.some(
    (word) => clause.plain.includes(word) || clause.ascii.includes(asciiForm(word)),
  );
}

function roleAtStart(segment: Clause): Role | null {
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
  const asciiMarker = asciiForm(marker);
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
  clause: Clause,
  players: readonly BotPlayerKnowledge[],
): ParsedSpeech | null {
  if (clause.plain.length === 0) return null;
  if (hasNegation(clause)) return null;

  const claim = afterMarker(clause, "tôi là ");
  if (claim) {
    const role = roleAtStart(claim);
    return role ? { type: "ROLE_CLAIM", data: { role } } : null;
  }

  const suspect = afterMarker(clause, "tôi nghi ", false);
  if (suspect) {
    const target = resolveTarget(suspect.plain, players);
    return target ? { type: "ACCUSE", targetId: target.id, data: {} } : null;
  }

  const wolfCall = markerIndex(clause, " là sói");
  if (wolfCall) {
    const target = resolveTarget(wolfCall.text.slice(0, wolfCall.index), players);
    return target ? { type: "ACCUSE", targetId: target.id, data: {} } : null;
  }

  const trust = afterMarker(clause, "tôi tin ");
  if (trust) {
    const target = resolveTarget(trust.plain, players);
    return target ? { type: "DEFEND", targetId: target.id, data: {} } : null;
  }

  const spare = afterMarker(clause, "đừng treo ");
  if (spare) {
    const target = resolveTarget(spare.plain, players);
    return target ? { type: "DEFEND", targetId: target.id, data: {} } : null;
  }

  return null;
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
