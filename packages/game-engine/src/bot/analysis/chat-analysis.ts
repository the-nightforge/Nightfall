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
  };
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
