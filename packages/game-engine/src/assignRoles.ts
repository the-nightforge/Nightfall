import { specialRoleList } from "@masoi/shared";
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
 * Xây dựng danh sách vai trò theo cấu hình rồi xáo trộn.
 *
 * `config.villagers` là số Dân Làng do host đặt, và khi có nó thì bộ bài phải
 * khớp ĐÚNG số người - không lấp thêm, không cắt bớt. Thiếu trường đó thì Dân
 * Làng lấp phần còn lại như trước; xem chú thích ở `RoomConfig.villagers` cho
 * lý do đường tương thích này tồn tại.
 */
export function buildRoleDeck(
  config: RoomConfig,
  playerCount: number,
  rng: () => number = Math.random,
): Role[] {
  if (playerCount < 6) throw new Error("Cần ít nhất 6 người chơi");
  const deck = specialRoleList(config);
  const villagers = config.villagers ?? Math.max(0, playerCount - deck.length);
  for (let i = 0; i < villagers; i += 1) deck.push("VILLAGER");
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
