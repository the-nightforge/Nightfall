import type { StrategyContext } from "../planning/planner";
import type { PolicyModel } from "./policy-model";
import { heuristicPolicyModel } from "./policy-model";

/**
 * PR 8 của BOT_AI_CONTINUE_UPGRADE (§23/§24): HybridPolicy trên seam M7.
 *
 *   finalScore = alpha × heuristicScore + beta × learnedScore
 *
 * §24 yêu cầu BẮT ĐẦU với `alpha = 1, beta = 0` — tức hybrid phải byte-identical
 * với heuristic cho tới khi benchmark chứng minh beta đáng tăng. Đúng shape đó:
 *
 * - `heuristicPolicyModel()` (M7) là đường mặc định, score của nó là bảng điểm
 *   planner đã chấm (score term gốc, thang −∞..+∞).
 * - `learned` là một scorer THỨ CẤP trả điểm chuẩn hoá ±1 (trung bình reward
 *   của các trajectory từng rơi vào cùng "tình huống") hoặc `null` khi chưa có
 *   dữ liệu. §23: thành phần học đầu tiên là action value model; §38: không ML
 *   framework — bảng tra thống kê là đủ.
 *
 * Tình huống ở đây là BUCKET suspicion (10 điểm/bucket, clamp 0..9): thô, tất
 * định, không đòi feature engineering, và đủ để một bảng tra từ vài nghìn ván
 * nói được "bỏ phiếu người ở mức nghi này thường đi tới thắng hay thua".
 * Vá lỗ hổng của bảng tra: ứng viên KHÔNG có dữ liệu được coi là 0 — trung
 * tính, không được beta cộng cũng không bị beta trừ.
 */

/** Điểm học được của một ứng viên: trung bình reward ±1, hoặc `null` = chưa có dữ liệu. */
export interface LearnedScorer {
  readonly name: string;
  score(targetId: string, context: StrategyContext): number | null;
}

interface BucketStat {
  rewardSum: number;
  count: number;
}

export interface TrajectoryStats {
  /** Khoá: `${decision}:s${bucket}`; bucket = clamp(floor(suspicion/10), 0..9). */
  counts: Record<string, BucketStat>;
}

function bucketOf(suspicion: number): number {
  return Math.min(9, Math.max(0, Math.floor(suspicion / 10)));
}

/**
 * Gom thống kê reward theo (decision, bucket suspicion của mục tiêu) từ
 * trajectory PR 7. Chỉ dùng line quyết định VOTE có mục tiêu — các decision
 * khác (NIGHT/SPEECH…) để cho consumer sau mở rộng cùng shape khoá.
 */
export function buildTrajectoryStats(trajectories: readonly BotTrajectoryLike[]): TrajectoryStats {
  const counts: Record<string, BucketStat> = {};
  for (const line of trajectories) {
    if (line.decision !== "VOTE" || line.selectedAction.targetId === null) continue;
    const target = line.observation.belief.find(
      (entry) => entry.playerId === line.selectedAction.targetId,
    );
    if (!target) continue;
    const key = `VOTE:s${bucketOf(target.suspicion)}`;
    const stat = counts[key] ?? { rewardSum: 0, count: 0 };
    stat.rewardSum += line.reward;
    stat.count += 1;
    counts[key] = stat;
  }
  return { counts };
}

/** Hợp đồng tối thiểu mà `buildTrajectoryStats` cần — đúng shape `BotTrajectory`. */
export interface BotTrajectoryLike {
  decision: string;
  reward: number;
  selectedAction: { targetId: string | null };
  observation: {
    belief: Array<{ playerId: string; suspicion: number }>;
  };
}

/** Learned scorer từ bảng thống kê: avg reward của bucket, `null` khi trống. */
export function statsLearnedScorer(stats: TrajectoryStats): LearnedScorer {
  return {
    name: "stats-bucket-v1",
    score(targetId, context) {
      const entry = context.state.suspicion[targetId];
      const suspicion = entry && "score" in entry ? entry.score : 0;
      const stat = stats.counts[`VOTE:s${bucketOf(suspicion)}`];
      if (!stat || stat.count === 0) return null;
      return stat.rewardSum / stat.count;
    },
  };
}

export interface HybridPolicyOptions {
  /** Trọng số heuristic. §24 khởi điểm 1. */
  alpha?: number;
  /** Trọng số learned. §24 khởi điểm 0 — tắt hoàn toàn cho tới khi bench nói được. */
  beta?: number;
  learned?: LearnedScorer;
}

/**
 * HybridPolicy: cùng hợp đồng `PolicyModel` — cắm vào `selectVote` (tham số
 * `policy`) hay `BotRuntime({ votePolicy })` mà không đổi call sites.
 *
 * "Heuristic score" của mỗi ứng viên LÀ score planner đã chấm (đã gồm mọi term
 * belief/counterfactual), nên alpha chỉ là hệ số tỉ lệ; beta nhân điểm learned
 * ±1 (thang nhỏ có chủ đích: beta phải LỚN — cỡ chênh điểm heuristic — mới lật
 * được lựa chọn, và điều đó nhìn thấy ngay khi đọc cấu hình).
 */
export function hybridPolicyModel(options: HybridPolicyOptions = {}): PolicyModel {
  const alpha = options.alpha ?? 1;
  const beta = options.beta ?? 0;
  const fallback = heuristicPolicyModel();

  return {
    name: options.learned ? `hybrid(alpha=${alpha},beta=${beta})` : fallback.name,
    selectAction(candidates, context, probe) {
      if (candidates.length === 0) {
        probe?.fallback("không có ứng viên hợp lệ nào để chấm điểm");
        return { targetId: null };
      }
      if (beta === 0 || !options.learned) {
        // §24 khởi điểm: đi đúng heuristic, kể cả khi learned có mặt.
        return fallback.selectAction(candidates, context, probe);
      }

      const blended = candidates.map((candidate) => {
        const learned = options.learned!.score(candidate.targetId, context);
        // Không có dữ liệu → trung tính 0: beta không cộng không trừ.
        const learnedValue = learned ?? 0;
        return {
          targetId: candidate.targetId,
          score: alpha * candidate.score + beta * learnedValue,
        };
      });

      blended.sort(
        (left, right) => right.score - left.score || left.targetId.localeCompare(right.targetId),
      );
      return { targetId: blended[0]!.targetId };
    },
  };
}
