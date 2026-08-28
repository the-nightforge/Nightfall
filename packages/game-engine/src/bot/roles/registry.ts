import type { Role } from "@masoi/shared";
import { guardStrategy } from "./guard";
import { seerStrategy } from "./seer";
import { passiveStrategy, type BotRoleStrategy } from "./strategy";
import { werewolfStrategy } from "./werewolf";
import { witchStrategy } from "./witch";

/**
 * Bảng tra chiến lược theo vai.
 *
 * `Partial` là có chủ đích: chỉ vai có hành vi riêng mới cần một entry, còn lại
 * rơi về `passiveStrategy`. Nhờ vậy thêm một vai mới vào game sẽ mặc định
 * KHÔNG hành động đêm và KHÔNG thiên vị - an toàn, thay vì nổ ở runtime hoặc
 * bắt chước nhầm một vai khác.
 */
const REGISTRY: Partial<Record<Role, () => BotRoleStrategy>> = {
  WEREWOLF: werewolfStrategy,
  SEER: seerStrategy,
  GUARD: guardStrategy,
  WITCH: witchStrategy,
};

export function strategyFor(role: Role): BotRoleStrategy {
  const build = REGISTRY[role];
  return build ? build() : passiveStrategy(role);
}
