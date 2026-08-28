import type { Role } from "@masoi/shared";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { detectiveStrategy } from "./detective";
import { guardStrategy } from "./guard";
import { guardianAngelStrategy } from "./guardian-angel";
import { priestStrategy } from "./priest";
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
 *
 * Từ Phase 3, mỗi factory nhận `weights` và ĐÓNG GÓI nó vào strategy trả về.
 * Cách này thay vì thêm một tham số vào từng phương thức: một strategy là một
 * đối tượng ĐÃ ĐƯỢC CẤU HÌNH, nên không có đường nào để hai lời gọi trên cùng
 * một strategy chạy với hai bộ trọng số khác nhau.
 */
const REGISTRY: Partial<Record<Role, (role: Role, weights: BotWeights) => BotRoleStrategy>> = {
  WEREWOLF: werewolfStrategy,
  // Sói Con dùng đúng chiến lược Sói: nó cắn cùng bầy, và cơ chế "chết thì bầy
  // được cắn hai" nằm ở engine chứ không phải ở lựa chọn của nó.
  WOLF_CUB: werewolfStrategy,
  SEER: seerStrategy,
  // Tiên Tri Tập Sự sau khi thức tỉnh soi y hệt Tiên Tri; trước đó engine đã
  // trả `night: null` nên strategy này không bao giờ được hỏi.
  APPRENTICE_SEER: seerStrategy,
  GUARD: guardStrategy,
  GUARDIAN_ANGEL: guardianAngelStrategy,
  DETECTIVE: detectiveStrategy,
  PRIEST: priestStrategy,
  WITCH: witchStrategy,
};

export function strategyFor(
  role: Role,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotRoleStrategy {
  const build = REGISTRY[role];
  return build ? build(role, weights) : passiveStrategy(role);
}
