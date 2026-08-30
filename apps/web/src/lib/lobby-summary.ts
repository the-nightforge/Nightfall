import type { Role, RoomConfig } from "@masoi/shared";
import { MIN_PLAYERS_TO_START } from "@masoi/shared";
import { PRESET_DECKS } from "./balance";

/**
 * Phần tóm tắt của phòng chờ.
 *
 * Phòng chờ cũ trải hết mọi thứ ra cùng lúc - thanh cân bằng, mười ba thẻ vai,
 * năm ô thời gian, công tắc voice - và trên điện thoại nó dài hơn ba màn hình
 * trong khi câu hỏi duy nhất lúc đó là "bấm được chưa". Module này là phần trả
 * lời đúng câu ấy; phần chi tiết lui vào các mục mở ra được.
 *
 * Thuần tính toán, không React: luật cân bằng và luật chặn bắt đầu KHÔNG đổi
 * chút nào so với bản cũ, chỉ đổi chỗ hiển thị, và test bên cạnh giữ đúng điều
 * đó.
 */

/** Thứ tự hiển thị, không phải thứ tự hành động ban đêm. Dân Làng luôn đứng cuối. */
export const VILLAGE_ROLES: Role[] = [
  "SEER",
  "APPRENTICE_SEER",
  "DETECTIVE",
  "GUARD",
  "GUARDIAN_ANGEL",
  "PRIEST",
  "WITCH",
  "HUNTER",
  "MAYOR",
  "CURSED",
];

export const WOLF_SPECIAL_ROLES: Role[] = ["WOLF_CUB"];

/** Khoá cấu hình tương ứng với từng vai bật/tắt được. */
export const CONFIG_KEY: Record<string, keyof RoomConfig> = {
  SEER: "seer",
  APPRENTICE_SEER: "apprenticeSeer",
  DETECTIVE: "detective",
  GUARD: "guard",
  GUARDIAN_ANGEL: "guardianAngel",
  PRIEST: "priest",
  WITCH: "witch",
  HUNTER: "hunter",
  MAYOR: "mayor",
  CURSED: "cursed",
  WOLF_CUB: "wolfCub",
};

export interface DeckCounts {
  wolves: number;
  specials: number;
  villagers: number;
}

/**
 * Bộ bài quy ra ba con số.
 *
 * Dân Làng lấp phần còn lại, đúng như `buildRoleDeck` làm ở engine - đây là
 * bản xem trước, không phải một luật chia bài thứ hai.
 */
export function deckCounts(config: RoomConfig, playerCount: number): DeckCounts {
  const specials = VILLAGE_ROLES.filter((role) => config[CONFIG_KEY[role]]).length;
  const wolves = config.werewolves + WOLF_SPECIAL_ROLES.filter((r) => config[CONFIG_KEY[r]]).length;
  return { wolves, specials, villagers: Math.max(0, playerCount - wolves - specials) };
}

/**
 * Bộ bài hiện tại có đúng bằng preset chuẩn cho số người này không.
 *
 * Chỉ so phần BÀI. Thời gian từng pha và chế độ Ranked/Chaos chỉnh riêng, và
 * host đổi giây thảo luận không có nghĩa là họ đã rời khỏi preset.
 */
export function isPresetDeck(config: RoomConfig, playerCount: number): boolean {
  const preset = PRESET_DECKS[playerCount];
  if (!preset) return false;
  if (preset.werewolves !== config.werewolves) return false;
  return Object.values(CONFIG_KEY).every((key) => !!preset[key] === !!config[key]);
}

export type StartBlock =
  | { kind: "need-players"; missing: number }
  | { kind: "config"; message: string }
  | { kind: "unready"; names: string[] }
  | null;

export interface StartBlockInput {
  playerCount: number;
  /** Kết quả `validateRoomConfig`; null là hợp lệ. */
  configError: string | null;
  /** Khách mời người thật chưa bấm sẵn sàng. */
  unreadyNames: string[];
}

/**
 * Lý do ĐANG chặn nút bắt đầu, hoặc null nếu bấm được.
 *
 * Trả về đúng một lý do chứ không phải danh sách: chúng đến theo thứ tự người
 * chơi thực sự gặp phải, và in cả ba cùng lúc thì hai cái sau chỉ là nhiễu -
 * chưa đủ người thì cân bằng chưa có ý nghĩa gì.
 *
 * Thứ tự này giữ nguyên từ bản phòng chờ cũ. Đổi nó là đổi luật, không phải đổi
 * giao diện.
 */
export function startBlock(input: StartBlockInput): StartBlock {
  const missing = Math.max(0, MIN_PLAYERS_TO_START - input.playerCount);
  if (missing > 0) return { kind: "need-players", missing };
  if (input.configError) return { kind: "config", message: input.configError };
  if (input.unreadyNames.length > 0) return { kind: "unready", names: input.unreadyNames };
  return null;
}
