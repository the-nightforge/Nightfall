import type { Phase, Role } from "@masoi/shared";
import type { BotChatObservation, BotMemory, BotMemoryType, BotPlayerKnowledge } from "../types";

/**
 * Bỏ dấu và hạ chữ thường để so khớp tên và mẫu câu. `đ` không phải dấu tổ hợp
 * nên phải thay riêng, nếu không "Đừng treo" sẽ không khớp mẫu nào.
 */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    // Escape thay vì dán ký tự tổ hợp trực tiếp: một editor chuẩn hoá lại file
    // sẽ âm thầm làm hỏng character class nếu nó được viết bằng ký tự thật.
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cụm dài đứng trước để "dân làng" không bị khớp thành "dân". */
const ROLE_PHRASES: Array<[string, Role]> = [
  ["ke nguyen rua", "CURSED"],
  ["dan thuong", "VILLAGER"],
  ["dan lang", "VILLAGER"],
  ["tien tri", "SEER"],
  ["phu thuy", "WITCH"],
  ["tho san", "HUNTER"],
  ["bao ve", "GUARD"],
  ["ma soi", "WEREWOLF"],
  ["soi", "WEREWOLF"],
  ["dan", "VILLAGER"],
];

const IMPORTANCE: Partial<Record<BotMemoryType, number>> = {
  ROLE_CLAIM: 8,
  COUNTER_CLAIM: 8,
  ACCUSE: 4,
  DEFEND: 3,
};

function roleAtStart(segment: string): Role | null {
  for (const [phrase, role] of ROLE_PHRASES) {
    if (segment === phrase || segment.startsWith(`${phrase} `)) return role;
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
 * Tên đầy đủ được ưu tiên; chỉ khi không có tên đầy đủ nào khớp thì mới xét
 * tên rút gọn. Hai người cùng tên rút gọn thì bỏ qua câu, vì đoán bừa một
 * người sẽ tạo ra bằng chứng sai mà người chơi không thể phản bác.
 */
function resolveTarget(
  segment: string,
  players: readonly BotPlayerKnowledge[],
): BotPlayerKnowledge | null {
  const tokens = normalize(segment).split(" ").filter(Boolean);
  if (tokens.length === 0) return null;

  const fullMatches = players.filter((player) =>
    containsTokens(tokens, normalize(player.name).split(" ").filter(Boolean)),
  );
  if (fullMatches.length === 1) return fullMatches[0]!;
  if (fullMatches.length > 1) return null;

  const shortMatches = players.filter((player) => {
    const parts = normalize(player.name).split(" ").filter(Boolean);
    const short = parts.at(-1);
    return short !== undefined && tokens.includes(short);
  });
  return shortMatches.length === 1 ? shortMatches[0]! : null;
}

function after(text: string, marker: string): string | null {
  const index = text.indexOf(marker);
  return index === -1 ? null : text.slice(index + marker.length).trim();
}

function before(text: string, marker: string): string | null {
  const index = text.indexOf(marker);
  return index === -1 ? null : text.slice(0, index).trim();
}

interface ParsedSpeech {
  type: BotMemoryType;
  targetId?: string;
  data: Record<string, unknown>;
}

function parse(
  text: string,
  players: readonly BotPlayerKnowledge[],
): ParsedSpeech | null {
  const normalized = normalize(text);

  // Phản bác: "<tên> không thể là <role>, tôi mới là <role>".
  const deniedSegment = before(normalized, " khong the la ");
  const counterRoleSegment = after(normalized, " toi moi la ");
  if (deniedSegment !== null && counterRoleSegment !== null) {
    const target = resolveTarget(deniedSegment, players);
    const role = roleAtStart(counterRoleSegment);
    if (target && role) {
      return { type: "COUNTER_CLAIM", targetId: target.id, data: { role } };
    }
    return null;
  }

  // Tự nhận vai: "tôi là <role>".
  const claimSegment = normalized.startsWith("toi la ")
    ? normalized.slice("toi la ".length)
    : after(normalized, " toi la ");
  if (claimSegment !== null) {
    const role = roleAtStart(claimSegment);
    return role ? { type: "ROLE_CLAIM", data: { role } } : null;
  }

  // Buộc tội rõ ràng.
  const suspectSegment = normalized.startsWith("toi nghi ")
    ? normalized.slice("toi nghi ".length)
    : after(normalized, " toi nghi ");
  if (suspectSegment !== null) {
    const target = resolveTarget(suspectSegment, players);
    return target ? { type: "ACCUSE", targetId: target.id, data: {} } : null;
  }
  const wolfCallSegment = before(normalized, " la soi");
  if (wolfCallSegment !== null) {
    const target = resolveTarget(wolfCallSegment, players);
    return target ? { type: "ACCUSE", targetId: target.id, data: {} } : null;
  }

  // Bênh vực rõ ràng.
  const trustSegment = normalized.startsWith("toi tin ")
    ? normalized.slice("toi tin ".length)
    : after(normalized, " toi tin ");
  if (trustSegment !== null) {
    const target = resolveTarget(trustSegment, players);
    return target ? { type: "DEFEND", targetId: target.id, data: {} } : null;
  }
  const spareSegment = normalized.startsWith("dung treo ")
    ? normalized.slice("dung treo ".length)
    : after(normalized, " dung treo ");
  if (spareSegment !== null) {
    const target = resolveTarget(spareSegment, players);
    return target ? { type: "DEFEND", targetId: target.id, data: {} } : null;
  }

  return null;
}

export interface ChatAnalysisOptions {
  round?: number;
  phase?: Phase;
}

/**
 * Parser bảo thủ: chỉ tạo observation khi actor có thật, message ID có thật,
 * target khớp duy nhất và câu chứa một mẫu rõ ràng. Câu mơ hồ bị bỏ qua thay vì
 * suy diễn, và nội dung gốc không bao giờ được copy vào memory.
 */
export function analyzeChat(
  messages: readonly BotChatObservation[],
  players: readonly BotPlayerKnowledge[],
  options: ChatAnalysisOptions = {},
): BotMemory[] {
  const { round = 0, phase = "DAY_DISCUSSION" } = options;
  const memories: BotMemory[] = [];

  for (const message of messages) {
    if (!players.some((player) => player.id === message.actorId)) continue;
    const parsed = parse(message.text, players);
    if (!parsed) continue;

    const pinned = parsed.type === "ROLE_CLAIM" || parsed.type === "COUNTER_CLAIM";
    memories.push({
      id: `${parsed.type}:${message.id}`,
      sourceId: message.id,
      round,
      phase,
      type: parsed.type,
      actorId: message.actorId,
      targetId: parsed.targetId,
      importance: IMPORTANCE[parsed.type] ?? 3,
      pinned,
      data: parsed.data,
    });
  }

  return memories;
}
