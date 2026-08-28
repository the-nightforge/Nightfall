import type { RoomConfig, Winner } from "@masoi/shared";
import type { BotWeights } from "../config/weights";
import type { InvariantViolation } from "./invariants";
import { runSelfPlay, MAX_ROUNDS } from "./selfplay";

export { MAX_ROUNDS };

/**
 * Mặt tiền hẹp của Phase 2 trên nhân self-play của Phase 3.
 *
 * Giữ lại vì nó là hình dạng mà test cân bằng của Phase 2 nói chuyện, và vì một
 * kết quả rút gọn (thắng/thua/số vòng) là thứ đủ dùng cho phần lớn khẳng định.
 * Thứ gì cần chuỗi sự kiện, trace hay chỉ số chi tiết thì gọi thẳng
 * `runSelfPlay`.
 *
 * `speech: false` là có chủ đích: mặt tiền này mô tả đúng phạm vi Phase 2, khi
 * BOT chưa nói với nhau. Bật lời nói lên là một thay đổi hành vi, và nó thuộc về
 * `runSelfPlay` chứ không phải một adapter tương thích ngược.
 */
export interface SimulationInput {
  seed: string;
  playerCount?: number;
  config?: Partial<RoomConfig>;
  weights?: BotWeights;
}

export interface SimulationResult {
  seed: string;
  winner: Winner;
  rounds: number;
  /** Số hành động đêm và phiếu đã nộp thành công. */
  actions: number;
  /** Vi phạm phát hiện TRONG LÚC chạy; rỗng là đạt. */
  violations: InvariantViolation[];
}

export interface SimulationMetrics {
  games: number;
  villagerWins: number;
  wolfWins: number;
  unfinished: number;
  averageRounds: number;
  violations: InvariantViolation[];
}

export function simulateGame(input: SimulationInput): SimulationResult {
  const game = runSelfPlay({ ...input, speech: false });
  return {
    seed: input.seed,
    winner: game.winner,
    rounds: game.rounds,
    actions: game.actions,
    violations: game.violations,
  };
}

/**
 * Số liệu MÔ TẢ để phát hiện hồi quy, không phải tuyên bố "BOT chơi hay".
 *
 * Thứ đáng lo là một phe thắng gần 100%: nó nghĩa là một bên không còn chơi
 * nữa. Chỉ số đầy đủ nằm ở `metrics.ts`.
 */
export function summarize(results: readonly SimulationResult[]): SimulationMetrics {
  return {
    games: results.length,
    villagerWins: results.filter((item) => item.winner === "village").length,
    wolfWins: results.filter((item) => item.winner === "wolves").length,
    unfinished: results.filter((item) => item.winner === null).length,
    averageRounds:
      results.reduce((sum, item) => sum + item.rounds, 0) / Math.max(1, results.length),
    violations: results.flatMap((item) => item.violations),
  };
}
