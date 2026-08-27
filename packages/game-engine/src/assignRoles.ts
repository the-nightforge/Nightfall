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
 * Dân Làng lấp đầy chỗ còn lại.
 */
export function buildRoleDeck(config: RoomConfig, playerCount: number): Role[] {
  if (playerCount < 6) throw new Error("Cần ít nhất 6 người chơi");
  const deck: Role[] = [];
  for (let i = 0; i < config.werewolves; i++) deck.push("WEREWOLF");
  if (config.seer) deck.push("SEER");
  if (config.guard) deck.push("GUARD");
  if (config.witch) deck.push("WITCH");
  while (deck.length < playerCount) deck.push("VILLAGER");
  if (deck.length !== playerCount) throw new Error("Cấu hình vai trò không khớp số người chơi");
  return shuffle(deck);
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
  const deck = buildRoleDeck(config, players.length);
  const shuffledPlayers = shuffle(players, rng);
  const result: Record<string, Role> = {};
  shuffledPlayers.forEach((p, i) => {
    result[p.id] = deck[i];
  });
  return result;
}
