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
  BotRng,
  NightActionKind,
} from "../types";
import { heuristicPolicyModel, type PolicyModel } from "./policy-model";

/**
 * Nước đi policy đã LẤY MẪU, kèm đúng hai con số PPO cần: `logProb` của chính
 * nước đó dưới policy đã sinh ra nó, và `value(s)` của cùng observation.
 *
 * Tính ở đây chứ không tính lại ở Python: Python không có encoder, và một
 * `logProb` tính lại từ một vector dựng lại là một `logProb` của policy KHÁC.
 */
export interface LearnedPick {
  actionIndex: number;
  logProb: number;
  value: number | null;
  temperature: number;
  /**
   * Có mặt = nước do RESIDUAL policy sinh (`residual-policy.ts`), với β đã
   * dùng. `ai:encode` đọc nó để biết tập rollout là residual và xuất `bases`
   * (điểm có jitter) cho Python dựng lại đúng phân phối cũ.
   */
  beta?: number;
}

/** Nước đi policy ĐỀ XUẤT, đã giải mã — để vòng gọi đối chiếu với nước THẬT SỰ đi. */
export interface LearnedDecided {
  /** `DAY_ACTION_KIND` hoặc một `NightActionKind`; "SKIP" cho bỏ lượt có chủ ý. */
  kind: string;
  targetId: string | null;
}

/**
 * Nhận `LearnedPick` mỗi khi policy thật sự quyết (không gọi khi rơi về
 * heuristic).
 *
 * Kèm nước đã giải mã vì policy chỉ ĐỀ XUẤT: `selectVote` còn hysteresis và
 * hai cổng "không treo ai" phía sau, và một nước bị ghi đè là một `logProb`
 * dạy PPO cập nhật theo hành động chưa từng xảy ra. Vòng gọi đối chiếu rồi mới
 * ghi.
 */
export type LearnedPickSink = (pick: LearnedPick, decided: LearnedDecided) => void;

export interface LearnedPolicyOptions {
  maxSeats?: number;
  /**
   * 0 = argmax (mặc định, đúng hành vi đánh giá). 1 = lấy mẫu từ softmax —
   * chế độ rollout của RL, nơi policy PHẢI thăm dò để có gradient.
   */
  temperature?: number;
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
 * Lấy mẫu từ softmax(logits/T) trên các ô đang bật. T=0 → argmax (logProb vẫn
 * là log p của ô đó tại T=1, để BC/RL cùng một quy ước). RNG là của bot, đi
 * qua `wrapRngForTrace`, nên rollout tái lập được bằng seed.
 */
export function sampleMasked(
  logits: readonly number[],
  mask: readonly boolean[],
  temperature: number,
  rng: BotRng,
): { index: number; logProb: number } | null {
  const idx: number[] = [];
  for (let i = 0; i < logits.length; i += 1) if (mask[i]) idx.push(i);
  if (idx.length === 0) return null;
  // Trừ max trước khi exp: logit của một MLP chưa chuẩn hoá chạy tới vài chục,
  // và `Math.exp(800)` là `Infinity` — tức mọi xác suất thành NaN.
  const logP = (t: number): Map<number, number> => {
    const max = Math.max(...idx.map((i) => logits[i]! / t));
    const exps = idx.map((i) => Math.exp(logits[i]! / t - max));
    const z = exps.reduce((a, b) => a + b, 0);
    return new Map(idx.map((i, k) => [i, Math.log(exps[k]! / z)]));
  };
  if (temperature <= 0) {
    let best = idx[0]!;
    for (const i of idx) if (logits[i]! > logits[best]!) best = i;
    return { index: best, logProb: logP(1).get(best)! };
  }
  const table = logP(temperature);
  const u = rng();
  let acc = 0;
  for (const i of idx) {
    acc += Math.exp(table.get(i)!);
    if (u < acc) return { index: i, logProb: table.get(i)! };
  }
  // Sai số dồn của tổng có thể để `acc` dừng dưới `u` ở ô cuối; ô cuối là câu
  // trả lời đúng ở đó, không phải một lỗi.
  const last = idx[idx.length - 1]!;
  return { index: last, logProb: table.get(last)! };
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
  onPick?: LearnedPickSink,
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
      const temperature = options.temperature ?? 0;
      const features = encoded.features;
      const picked = sampleMasked(policy.logits(features), mask, temperature, context.rng);
      if (!picked) return fallback.selectAction(candidates, context, probe);
      const decoded = decodeAction(picked.index, encoded.seats, maxSeats);
      if (decoded.kind !== DAY_ACTION_KIND) {
        return fallback.selectAction(candidates, context, probe);
      }
      // Chỉ báo khi nước NÀY thật sự là nước đi: một `logProb` của nước bị bỏ
      // đi là một mẫu dạy PPO cập nhật theo hành động chưa từng xảy ra.
      onPick?.(
        {
          actionIndex: picked.index,
          logProb: picked.logProb,
          value: policy.value(features),
          temperature,
        },
        { kind: DAY_ACTION_KIND, targetId: decoded.targetId },
      );
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
  rng: BotRng,
  options: LearnedPolicyOptions = {},
  onPick?: LearnedPickSink,
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
  const temperature = options.temperature ?? 0;
  const features = encoded.features;
  const picked = sampleMasked(policy.logits(features), encoded.mask, temperature, rng);
  if (!picked) return heuristic;
  const decoded = decodeAction(picked.index, encoded.seats, maxSeats);
  const kind = decoded.kind as NightActionKind;
  const report = (targetId: string | null): void => {
    onPick?.(
      {
        actionIndex: picked.index,
        logProb: picked.logProb,
        value: policy.value(features),
        temperature,
      },
      { kind, targetId },
    );
  };
  // SKIP là một nước ĐI có chủ ý của policy, không phải một lần rơi về
  // heuristic — nó có nhãn, nên nó vào rollout.
  if (kind === "SKIP") {
    report(null);
    return null;
  }
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
  report(needsTarget ? decoded.targetId : null);
  return {
    ...base,
    action: kind,
    targetId: needsTarget ? decoded.targetId : null,
    secondaryTargetId:
      heuristic && heuristic.action === kind ? heuristic.secondaryTargetId : undefined,
  };
}
