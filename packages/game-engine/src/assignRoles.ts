import type { Role } from "@masoi/shared";
import type { RoomConfig } from "@masoi/shared";

export function shuffle<T>(items: T[], rng: () => number = Math.random): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Danh sách vai đặc biệt (không tính Dân Làng lấp chỗ trống) theo cấu hình.
 * Dùng chung giữa `buildRoleDeck` và bộ phân tích cân bằng ở `balance/analyzer.ts`
 * để khỏi lặp đúng 11 dòng `if (config.x) push(...)` ở hai nơi.
 */
export function specialRoleList(config: RoomConfig): Role[] {
  const roles: Role[] = [];
  for (let i = 0; i < config.werewolves; i++) roles.push("WEREWOLF");
  if (config.wolfCub) roles.push("WOLF_CUB");
  if (config.seer) roles.push("SEER");
  if (config.apprenticeSeer) roles.push("APPRENTICE_SEER");
  if (config.detective) roles.push("DETECTIVE");
  if (config.guard) roles.push("GUARD");
  if (config.guardianAngel) roles.push("GUARDIAN_ANGEL");
  if (config.priest) roles.push("PRIEST");
  if (config.witch) roles.push("WITCH");
  if (config.hunter) roles.push("HUNTER");
  if (config.mayor) roles.push("MAYOR");
  // Tối đa một Kẻ Nguyền Rủa mỗi ván: một lá duy nhất trong bộ bài.
  if (config.cursed) roles.push("CURSED");
  return roles;
}

/**
 * Xây dựng danh sách vai trò theo cấu hình rồi xáo trộn.
 * Dân Làng lấp đầy chỗ còn lại.
 */
export function buildRoleDeck(
  config: RoomConfig,
  playerCount: number,
  rng: () => number = Math.random,
): Role[] {
  if (playerCount < 6) throw new Error("Cần ít nhất 6 người chơi");
  const deck = specialRoleList(config);
  while (deck.length < playerCount) deck.push("VILLAGER");
  if (deck.length !== playerCount) throw new Error("Cấu hình vai trò không khớp số người chơi");
  // Xáo bằng ĐÚNG nguồn ngẫu nhiên được truyền vào. Trước đây hàm này luôn dùng
  // `Math.random`, nên một `assignRoles` đã gieo hạt vẫn cho ra ván khác nhau ở
  // mỗi lần chạy - tức là "cùng seed cho cùng ván" chưa bao giờ đúng trọn vẹn.
  return shuffle(deck, rng);
}

export interface AssignInput {
  id: string;
  name: string;
  isBot: boolean;
}

/** Chia vai trò ngẫu nhiên và bí mật cho từng người chơi. */
export function assignRoles(
  players: AssignInput[],
  config: RoomConfig,
  rng: () => number = Math.random,
): Record<string, Role> {
  const deck = buildRoleDeck(config, players.length, rng);
  const shuffledPlayers = shuffle(players, rng);
  const result: Record<string, Role> = {};
  shuffledPlayers.forEach((p, i) => {
    result[p.id] = deck[i];
  });
  return result;
}
