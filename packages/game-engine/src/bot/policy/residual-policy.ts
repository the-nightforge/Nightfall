import type { BotWeights } from "../config/weights";
import type { VoteScoringFrame } from "../decision/vote-decision";
import { buildLiveObservation } from "../learning/live-observation";
import type { LearnedPolicy } from "../learning/mlp";
import {
  DAY_ACTION_KIND,
  DEFAULT_MAX_SEATS,
  actionIndexOf,
  encodeObservation,
  type EncodedObservation,
} from "../learning/observation";
import type { StrategyContext } from "../planning/planner";
import type { BotBrainState, BotDecisionContext, BotRng } from "../types";
import type { LearnedPickSink, LearnedPolicyOptions } from "./learned-policy";
import {
  heuristicPolicyModel,
  type NightPolicyModel,
  type PolicyModel,
} from "./policy-model";

/**
 * Residual policy (spec 2026-09-09-residual-policy-design):
 *
 *   adjusted_i = score_i + β · logits(obs)[ô hành động của ứng viên i]
 *
 * Model KHÔNG thay teacher, nó hiệu chỉnh teacher. `score_i` là điểm THẬT của
 * bảng đã chấm (kể cả jitter) — cùng điểm mà heuristic sẽ dùng nếu không có
 * model — nên residual 0 và T=0 cho đúng nước heuristic, byte một; tệ nhất
 * bằng heuristic; PPO chỉ học phần hơn. Đây là cách xoá hẳn lớp vấn đề "bản
 * sao ≠ teacher" (policy-0004 khớp 94 % mà thua teacher 6,6 điểm, vì
 * observation chỉ mang 2 trong 8 số hạng điểm) thay vì vá nó.
 *
 * Phân phối chỉ trên TẬP ỨNG VIÊN của bảng (không phải toàn mask encoder): ô
 * "không treo ai" hay các loại đêm khác không thuộc bảng nên không có xác
 * suất. Python dựng lại đúng phân phối này từ `bases` (điểm có jitter theo
 * ô), β và τ — không cần biết bảng đến từ đâu.
 */

export interface ResidualRow {
  targetId: string;
  actionIndex: number;
  adjusted: number;
}

/**
 * Ánh xạ bảng ứng viên → (ô hành động, điểm đã hiệu chỉnh). Một ứng viên
 * không có ghế trong observation là một bảng không hiệu chỉnh được: trả `[]`
 * để vòng gọi rơi về heuristic, thay vì hiệu chỉnh nửa bảng.
 */
export function residualRows(
  candidates: ReadonlyArray<{ targetId: string; score: number }>,
  kind: string,
  logits: readonly number[],
  seats: readonly string[],
  beta: number,
  maxSeats: number = DEFAULT_MAX_SEATS,
): ResidualRow[] {
  const rows: ResidualRow[] = [];
  for (const candidate of candidates) {
    const seat = seats.indexOf(candidate.targetId);
    if (seat < 0 || seat >= maxSeats) return [];
    const actionIndex = actionIndexOf(kind, seat, maxSeats);
    rows.push({
      targetId: candidate.targetId,
      actionIndex,
      adjusted: candidate.score + beta * logits[actionIndex]!,
    });
  }
  return rows;
}

/** log softmax(adjusted/t) trên bảng; trừ max trước khi exp vì điểm chạy tới hàng trăm. */
function logProbTable(rows: readonly ResidualRow[], t: number): Map<string, number> {
  const max = Math.max(...rows.map((row) => row.adjusted / t));
  const exps = rows.map((row) => Math.exp(row.adjusted / t - max));
  const z = exps.reduce((a, b) => a + b, 0);
  return new Map(rows.map((row, k) => [row.targetId, Math.log(exps[k]! / z)]));
}

/**
 * T=0: argmax theo `adjusted`, hoà thì `targetId.localeCompare` — ĐÚNG
 * tie-break của `selectVote`/`rankNightTargets`, không phải theo thứ tự ghế
 * (ghế xếp theo `localeCompare` rồi xoay về self, nên "p10" có thể đứng sau
 * "p2" ở ghế mà đứng trước ở id). Không rút RNG. `logProb` ở τ=1, cùng quy
 * ước với `sampleMasked`.
 *
 * T>0: lấy mẫu softmax(adjusted/T) — đúng MỘT lần rút, duyệt theo thứ tự bảng
 * để replay tái lập.
 */
export function pickResidual(
  rows: readonly ResidualRow[],
  temperature: number,
  rng: BotRng,
): { row: ResidualRow; logProb: number } | null {
  if (rows.length === 0) return null;
  if (temperature <= 0) {
    const sorted = [...rows].sort(
      (a, b) => b.adjusted - a.adjusted || a.targetId.localeCompare(b.targetId),
    );
    const best = sorted[0]!;
    return { row: best, logProb: logProbTable(rows, 1).get(best.targetId)! };
  }
  const table = logProbTable(rows, temperature);
  const u = rng();
  let acc = 0;
  for (const row of rows) {
    acc += Math.exp(table.get(row.targetId)!);
    if (u < acc) return { row, logProb: table.get(row.targetId)! };
  }
  // Sai số dồn của tổng có thể để `acc` dừng dưới `u` ở ô cuối; ô cuối là câu
  // trả lời đúng ở đó, không phải một lỗi.
  const last = rows[rows.length - 1]!;
  return { row: last, logProb: table.get(last.targetId)! };
}

function betaOf(policy: LearnedPolicy): number {
  if (!policy.residual) {
    throw new Error(`policy "${policy.id}" không phải residual (thiếu residual.beta)`);
  }
  return policy.residual.beta;
}

/**
 * `PolicyModel` lượt VOTE: hiệu chỉnh bảng planner đã chấm rồi chọn. Cùng
 * observation với `learnedPolicyModel` (ảnh chụp belief cuối `observe`).
 */
export function residualVotePolicy(
  policy: LearnedPolicy,
  weights: BotWeights,
  options: LearnedPolicyOptions = {},
  onPick?: LearnedPickSink,
): PolicyModel<VoteScoringFrame> {
  const beta = betaOf(policy);
  const maxSeats = options.maxSeats ?? DEFAULT_MAX_SEATS;
  const fallback = heuristicPolicyModel<VoteScoringFrame>();
  return {
    name: `residual:${policy.id}`,
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
      const features = encoded.features;
      const rows = residualRows(
        candidates,
        DAY_ACTION_KIND,
        policy.logits(features),
        encoded.seats,
        beta,
        maxSeats,
      );
      const temperature = options.temperature ?? 0;
      const picked = pickResidual(rows, temperature, context.rng);
      if (!picked) return fallback.selectAction(candidates, context, probe);
      onPick?.(
        {
          actionIndex: picked.row.actionIndex,
          logProb: picked.logProb,
          value: policy.value(features),
          temperature,
          beta,
        },
        { kind: DAY_ACTION_KIND, targetId: picked.row.targetId },
      );
      return { targetId: picked.row.targetId };
    },
  };
}

/**
 * `NightPolicyModel` cho MỘT lượt đêm: observation "NIGHT" dựng LƯỜI ở lần
 * hỏi đầu (strategy có thể không chấm bảng nào), rồi dùng lại cho mọi bảng
 * của cùng lượt.
 */
export function residualNightPolicy(
  policy: LearnedPolicy,
  weights: BotWeights,
  context: BotDecisionContext,
  state: BotBrainState,
  rng: BotRng,
  options: LearnedPolicyOptions = {},
  onPick?: LearnedPickSink,
): NightPolicyModel {
  const beta = betaOf(policy);
  const maxSeats = options.maxSeats ?? DEFAULT_MAX_SEATS;
  let cached: { encoded: EncodedObservation; logits: number[] } | undefined;
  const prepare = (): { encoded: EncodedObservation; logits: number[] } => {
    if (!cached) {
      const live = buildLiveObservation(
        context.knowledge,
        state,
        weights,
        "NIGHT",
        options.belief?.(),
      );
      const encoded = encodeObservation(live, { maxSeats });
      cached = { encoded, logits: policy.logits(encoded.features) };
    }
    return cached;
  };
  return {
    name: `residual:${policy.id}`,
    selectTarget(action, candidates) {
      if (candidates.length === 0) return null;
      const { encoded, logits } = prepare();
      const rows = residualRows(candidates, action, logits, encoded.seats, beta, maxSeats);
      const temperature = options.temperature ?? 0;
      const picked = pickResidual(rows, temperature, rng);
      if (!picked) return null;
      onPick?.(
        {
          actionIndex: picked.row.actionIndex,
          logProb: picked.logProb,
          value: policy.value(encoded.features),
          temperature,
          beta,
        },
        { kind: action, targetId: picked.row.targetId },
      );
      return picked.row.targetId;
    },
  };
}
