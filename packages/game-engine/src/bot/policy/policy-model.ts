import type { StrategyContext } from "../planning/planner";
import type { DecisionProbe } from "../trace/trace";
import type { NightActionKind } from "../types";

/**
 * Seam chính sách (spec BOT_AI_UPGRADE §27): lớp CHỌN-HÀNH-ĐỘNG cuối cùng.
 *
 * Tách ba tầng cho khỏi lẫn: scorer tính bảng term cho từng ứng viên
 * (`scoreVoteCandidate`), `StrategicPlanner` quyết định cách CHẤM GIÁ (immediate
 * hay look-ahead), còn `PolicyModel` quyết định CHỌN AI từ bảng điểm đã có.
 * Hiện tại tầng ba là heuristic thuần; sau này một `RLPolicyModel` cắm vào đây
 * mà engine và `BotRuntime` không đổi call sites.
 *
 * Hợp đồng:
 * - Nhận candidates ĐÃ chấm điểm; không tự chấm lại, không bịa ứng viên ngoài
 *   danh sách.
 * - Trả `targetId` của ứng viên được chọn, hoặc `null` khi chủ động không chọn
 *   ai (rỗng ứng viên, hoặc một model tương lai muốn bỏ lượt có chủ đích).
 * - Tất định theo đầu vào: cùng bảng điểm = cùng kết quả. Model không được rút
 *   RNG — mọi giá ngẫu nhiên đã nằm trong điểm.
 */
export interface PolicyDecision {
  /** Ứng viên được chọn, hoặc `null` = chủ động không chọn ai. */
  targetId: string | null;
}

export interface PolicyModel<Frame = unknown> {
  readonly name: string;
  selectAction(
    candidates: ReadonlyArray<{ targetId: string; score: number }>,
    context: StrategyContext<Frame>,
    probe?: DecisionProbe,
  ): PolicyDecision;
}

/**
 * Heuristic hiện hành — đúng quy tắc `selectVote` đã dùng từ trước: điểm cao
 * nhất thắng, hoà điểm thì `targetId` nhỏ hơn theo `localeCompare`, danh sách
 * rỗng thì trả `null` kèm fallback reason GIỐNG HỆT text cũ để trace không đổi.
 */
export function heuristicPolicyModel<Frame>(): PolicyModel<Frame> {
  return {
    name: "heuristic",
    selectAction(candidates, _context, probe) {
      if (candidates.length === 0) {
        probe?.fallback("không có ứng viên hợp lệ nào để chấm điểm");
        return { targetId: null };
      }
      const sorted = [...candidates].sort(
        (left, right) => right.score - left.score || left.targetId.localeCompare(right.targetId),
      );
      return { targetId: sorted[0]!.targetId };
    },
  };
}

/** Một dòng của bảng ứng viên đêm đã chấm. */
export interface NightCandidate {
  targetId: string;
  score: number;
}

/**
 * Seam CHỌN cho lượt đêm — đối xứng với `PolicyModel` của lượt bầu.
 *
 * `rankNightTargets` gọi nó SAU khi đã chấm và sort bảng của MỘT loại hành
 * động, rồi đưa lựa chọn lên đầu bảng; vai đọc `scored[0]` như cũ nên không
 * vai nào phải biết seam tồn tại. Khác `PolicyModel` ngày, model ĐƯỢC rút RNG
 * (lấy mẫu ở rollout) — RNG là của bot, đi qua `wrapRngForTrace`, nên vẫn
 * tái lập. Trả `null` = giữ nguyên thứ tự heuristic. Không bịa được ứng viên:
 * id ngoài bảng bị bỏ qua.
 */
export interface NightPolicyModel {
  readonly name: string;
  selectTarget(
    action: NightActionKind,
    candidates: ReadonlyArray<NightCandidate>,
  ): string | null;
}
