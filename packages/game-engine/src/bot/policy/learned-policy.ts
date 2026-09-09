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
import type {
  BotBrainState,
  BotDecisionContext,
  BotNightIntention,
  NightActionKind,
} from "../types";
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

/**
 * Đề xuất nước đi ĐÊM từ policy học được, trên nền nước heuristic đã tính.
 *
 * Runtime là trọng tài: chỉ nhận (loại, mục tiêu) nếu loại được engine chào
 * (`night.legalActions`) và mục tiêu nằm trong `night.legalTargets[loại]`
 * (HEAL/SKIP không mục tiêu). Giữ `confidence`/`evidence` của heuristic vì
 * model không sinh được chúng; giữ `secondaryTargetId` khi cùng loại. Thám Tử
 * cần đúng hai người mà model chỉ nói một → luôn theo heuristic.
 */
export function selectLearnedNight(
  policy: LearnedPolicy,
  weights: BotWeights,
  context: BotDecisionContext,
  state: BotBrainState,
  heuristic: BotNightIntention | null,
  options: LearnedPolicyOptions = {},
): BotNightIntention | null {
  const night = context.knowledge.night;
  if (!night || !night.canAct) return heuristic;
  const maxSeats = options.maxSeats ?? DEFAULT_MAX_SEATS;
  const live = buildLiveObservation(
    context.knowledge,
    state,
    weights,
    "NIGHT",
    options.belief?.(),
  );
  const encoded = encodeObservation(live, { maxSeats });
  const index = argmaxMasked(policy.logits(encoded.features), encoded.mask);
  if (index === null) return heuristic;
  const decoded = decodeAction(index, encoded.seats, maxSeats);
  const kind = decoded.kind as NightActionKind;
  if (kind === "SKIP") return null;
  if (kind === "DETECTIVE_CHECK") return heuristic;
  if (!night.legalActions.includes(kind)) return heuristic;
  const needsTarget = kind !== "HEAL";
  if (needsTarget) {
    if (decoded.targetId === null) return heuristic;
    if (!(night.legalTargets[kind] ?? []).includes(decoded.targetId)) return heuristic;
  }
  const base: BotNightIntention = heuristic ?? {
    kind: "NIGHT_ACTION",
    action: kind,
    targetId: null,
    confidence: 0.5,
    evidence: [],
  };
  return {
    ...base,
    action: kind,
    targetId: needsTarget ? decoded.targetId : null,
    secondaryTargetId:
      heuristic && heuristic.action === kind ? heuristic.secondaryTargetId : undefined,
  };
}
