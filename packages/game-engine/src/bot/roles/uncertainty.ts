import { MAX_BELIEF_SCORE } from "../belief/evidence";
import type { BotWeights } from "../config/weights";

/**
 * Giá trị thông tin của việc điều tra một người.
 *
 * Cao nhất ở giữa thang nghi ngờ và giảm dần về hai đầu: soi một người đã gần
 * chắc là Sói không đổi được gì (làng sắp treo họ rồi), và soi một người đã
 * chắc chắn trong sạch còn tệ hơn.
 *
 * Sống ở đây thay vì được chép hai lần vào `seer.ts` và `detective.ts`. Trước
 * Phase 3 cả hằng số lẫn công thức đều bị nhân bản, nên chỉnh một vai mà quên
 * vai kia là chuyện chờ xảy ra.
 */
export function informationValue(suspicion: number, weights: BotWeights): number {
  const { seerMostInformativeSuspicion, seerUncertaintySlope } = weights.roleThresholds;
  return (
    MAX_BELIEF_SCORE -
    Math.abs(suspicion - seerMostInformativeSuspicion) * seerUncertaintySlope
  );
}
