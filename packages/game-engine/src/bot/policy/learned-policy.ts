import type { BotWeights } from "../config/weights";
import type { VoteScoringFrame } from "../decision/vote-decision";
import { buildLiveObservation } from "../learning/live-observation";
import type { LearnedPolicy } from "../learning/mlp";
import {
  ACTION_KINDS,
  DAY_ACTION_KIND,
  DEFAULT_MAX_SEATS,
  NO_TARGET_ACTION,
  decodeAction,
  encodeObservation,
  maskLogits,
  slotsPerKind,
} from "../learning/observation";
import type { StrategyContext } from "../planning/planner";
import type { BeliefSnapshot } from "../trace/trace";
import { heuristicPolicyModel, type PolicyModel } from "./policy-model";

export interface LearnedPolicyOptions {
  maxSeats?: number;
  /**
   * Ảnh chụp belief lấy ở CUỐI `observe` — đúng thứ trace ghi vào
   * `beliefAfter` và đúng thứ model đã thấy lúc train. Xem
   * `buildLiveObservation`; vắng mặt thì belief được tính lại tại chỗ.
   */
  belief?: () => BeliefSnapshot | undefined;
}

/** Chỉ số có logit lớn nhất trong các ô đang bật; `null` nếu không ô nào bật. */
export function argmaxMasked(
  logits: readonly number[],
  mask: readonly boolean[],
): number | null {
  const masked = maskLogits(logits, mask);
  let best: number | null = null;
  for (let i = 0; i < masked.length; i += 1) {
    if (masked[i]! === Number.NEGATIVE_INFINITY) continue;
    if (best === null || masked[i]! > masked[best]!) best = i;
  }
  return best;
}

/**
 * `PolicyModel` cho lượt VOTE, chọn bằng policy học được.
 *
 * Nhận bảng ứng viên đã chấm (hợp đồng seam) nhưng KHÔNG đọc điểm: nó dựng
 * observation lúc chơi, lấy logits, che theo mask của encoder VÀ theo tập ứng
 * viên mà planner đưa (hai tập phải trùng; nếu encoder mở một ô planner không
 * đưa thì ô đó bị che — planner là trọng tài). Không có ô hợp lệ, hoặc decode
 * ra loại khác CHOOSE, thì rơi về heuristic — không bao giờ ném giữa ván.
 */
export function learnedPolicyModel(
  policy: LearnedPolicy,
  weights: BotWeights,
  options: LearnedPolicyOptions = {},
): PolicyModel<VoteScoringFrame> {
  const maxSeats = options.maxSeats ?? DEFAULT_MAX_SEATS;
  const slots = slotsPerKind(maxSeats);
  const dayKind = ACTION_KINDS.indexOf(DAY_ACTION_KIND);
  const fallback = heuristicPolicyModel<VoteScoringFrame>();
  return {
    name: `learned:${policy.id}`,
    selectAction(candidates, context: StrategyContext<VoteScoringFrame>, probe) {
      if (candidates.length === 0) return fallback.selectAction(candidates, context, probe);
      const live = buildLiveObservation(
        context.context.knowledge,
        context.state,
        weights,
        "VOTE",
        options.belief?.(),
      );
      const encoded = encodeObservation(live, { maxSeats });
      const allowed = new Set(candidates.map((candidate) => candidate.targetId));
      const noneLegal = live.legalActions.includes(NO_TARGET_ACTION);
      const mask = encoded.mask.map((on, index) => {
        if (!on) return false;
        if (Math.floor(index / slots) !== dayKind) return false;
        const slot = index % slots;
        if (slot === maxSeats) return noneLegal;
        return allowed.has(encoded.seats[slot]!);
      });
      const index = argmaxMasked(policy.logits(encoded.features), mask);
      if (index === null) return fallback.selectAction(candidates, context, probe);
      const decoded = decodeAction(index, encoded.seats, maxSeats);
      if (decoded.kind !== DAY_ACTION_KIND) {
        return fallback.selectAction(candidates, context, probe);
      }
      return { targetId: decoded.targetId };
    },
  };
}
