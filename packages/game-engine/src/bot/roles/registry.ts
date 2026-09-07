import type { Role } from "@masoi/shared";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { detectiveStrategy } from "./detective";
import { executionerStrategy } from "./executioner";
import { guardStrategy } from "./guard";
import { guardianAngelStrategy } from "./guardian-angel";
import { jesterStrategy } from "./jester";
import { seerStrategy } from "./seer";
import { serialKillerStrategy } from "./serial-killer";
import { sorcererStrategy } from "./sorcerer";
import { traitorStrategy } from "./traitor";
import { trackerStrategy } from "./tracker";
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
  /*
   * Kẻ Phản Bội KHÔNG dùng `werewolfStrategy`, dù nó thắng cùng phe Sói: chiến
   * thuật đó dựng trên `knownRoles`, mà engine cố ý không phát bảng đó cho vai
   * này. Nó cũng không rơi về `passiveStrategy`, vì mặc định "không thiên vị"
   * là chiến thuật của một người muốn làng thắng. Xem `roles/traitor.ts`.
   *
   * KHÔNG có entry cho nó SAU khi hoá Ma Sói: `strategyFor` tra theo vai HIỆN
   * TẠI, nên `settleTraitor` đổi `role` là nó tự nhận `werewolfStrategy` ở lời
   * gọi kế tiếp - cùng cơ chế với Kẻ Báo Thù hoá Thằng Hề.
   */
  TRAITOR: traitorStrategy,
  SEER: seerStrategy,
  // Tiên Tri Tập Sự sau khi thức tỉnh soi y hệt Tiên Tri; trước đó engine đã
  // trả `night: null` nên strategy này không bao giờ được hỏi.
  APPRENTICE_SEER: seerStrategy,
  GUARD: guardStrategy,
  GUARDIAN_ANGEL: guardianAngelStrategy,
  SORCERER: sorcererStrategy,
  // Sói Alpha cắn cùng bầy như Sói Con: nó không có lượt soi riêng, và cơ chế
  // "lừa lượt soi đầu" nằm ở engine chứ không phải ở lựa chọn của nó.
  ALPHA_WOLF: werewolfStrategy,
  // KHÔNG có entry cho Trưởng Lão: cả hai vế của lá đó là phản ứng của engine -
  // tấm đệm trước nhát cắn và cái bẫy dưới chân phe làng - nên nó không có nước
  // đi nào để chọn. `passiveStrategy` là đúng chứ không phải chỗ sót.
  DETECTIVE: detectiveStrategy,
  WITCH: witchStrategy,
  // Thằng Hề KHÔNG rơi về `passiveStrategy`, dù nó không có hành động đêm:
  // mặc định "không thiên vị" của strategy nền là chiến thuật của một Dân Làng,
  // và một con Hề chơi như Dân Làng thì không bao giờ đạt được điều kiện thắng
  // của chính nó. Xem `roles/jester.ts`.
  JESTER: jesterStrategy,
  // Sát Nhân có hành động đêm THẬT, nên nó bắt buộc phải có entry ở đây: rơi
  // về `passiveStrategy` thì lượt đêm của cả vai này mất trắng mọi ván - engine
  // vẫn chào một `SERIAL_KILL` hợp lệ, và không ai nhận.
  SERIAL_KILLER: serialKillerStrategy,
  // Kẻ Theo Dõi có hành động đêm thật (TRACK) nên cũng bắt buộc phải có entry:
  // xem `roles/tracker.ts`.
  TRACKER: trackerStrategy,
  /*
   * Kẻ Báo Thù cũng KHÔNG rơi về `passiveStrategy`, cùng lý do với Thằng Hề:
   * nó không có hành động đêm, nhưng chiến thuật nền là chiến thuật của một
   * người không có nhiệm vụ - và cả ván của vai này nằm trong việc lái một lá
   * phiếu về đúng một cái tên.
   *
   * KHÔNG có entry cho vai này SAU khi nó hoá Thằng Hề, và đó là cơ chế đổi
   * chiến thuật: `strategyFor` tra theo vai HIỆN TẠI, nên một Kẻ Báo Thù đã
   * chuyển vai tự nhận `jesterStrategy` ở ngay lời gọi kế tiếp. Không có cờ
   * nào để quên xoá, và không có quyết định đang chờ nào còn đọc bảng cũ.
   */
  EXECUTIONER: executionerStrategy,
};

export function strategyFor(
  role: Role,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotRoleStrategy {
  const build = REGISTRY[role];
  return build ? build(role, weights) : passiveStrategy(role);
}
