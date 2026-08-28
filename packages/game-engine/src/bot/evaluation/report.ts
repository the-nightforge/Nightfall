import type { Team } from "@masoi/shared";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { collectMetrics, type Ratio, type RoleMetrics, type SelfPlayMetrics, type TeamMetrics } from "./metrics";
import type { InvariantViolation } from "./invariants";
import { replayCommand, runSelfPlay, type SelfPlayGame, type SelfPlayInput } from "./selfplay";

/**
 * Báo cáo một batch tự chơi.
 *
 * Builder này THUẦN: không `Date`, không `fs`, không `process`. `timing` và
 * `commit` là `null` ở đây và do CLI bơm vào SAU, vì cả hai đều là I/O và cả hai
 * đều không tất định - trộn chúng vào builder sẽ khiến "cùng batch cho cùng
 * report" không còn kiểm được.
 */

export interface SelfPlayBatchInput {
  /** Seed của từng ván là `${seedBase}:${i}`. */
  seedBase: string;
  games: number;
  playerCount?: number;
  config?: SelfPlayInput["config"];
  weights?: BotWeights;
  maxRounds?: number;
  events?: boolean;
  speech?: boolean;
  /** Chạy lại mọi ván lần thứ hai để bắt `REPLAY_DIVERGENCE`. Tốn gấp đôi. */
  verifyReplay?: boolean;
}

export interface ReportTiming {
  totalMs: number;
  msPerGame: number;
}

export interface SelfPlayReport {
  schemaVersion: 1;
  weightsVersion: string;
  seedBase: string;
  seedRange: { first: string; last: string };
  games: number;
  config: {
    playerCount: number;
    maxRounds: number;
    events: boolean;
    speech: boolean;
    room: SelfPlayGame["record"]["config"];
  };
  metrics: SelfPlayMetrics;
  metricsByTeam: Record<Team, TeamMetrics>;
  metricsByRole: RoleMetrics[];
  violations: InvariantViolation[];
  failedSeeds: Array<{ seed: string; reason: string; replay: string }>;
  /** `null` ở nhân thuần; CLI điền. */
  timing: ReportTiming | null;
  /** `null` ở nhân thuần; CLI điền. */
  commit: string | null;
}

export function seedFor(seedBase: string, index: number): string {
  return `${seedBase}:${index}`;
}

/** Chạy cả batch. Tách khỏi `buildReport` để CLI đo được thời gian quanh nó. */
export function runBatch(input: SelfPlayBatchInput): SelfPlayGame[] {
  const games: SelfPlayGame[] = [];
  for (let i = 0; i < input.games; i += 1) {
    const game = runSelfPlay({
      seed: seedFor(input.seedBase, i),
      playerCount: input.playerCount,
      config: input.config,
      weights: input.weights,
      maxRounds: input.maxRounds,
      events: input.events,
      speech: input.speech,
    });

    if (input.verifyReplay) {
      const again = runSelfPlay({
        seed: seedFor(input.seedBase, i),
        playerCount: input.playerCount,
        config: input.config,
        weights: input.weights,
        maxRounds: input.maxRounds,
        events: input.events,
        speech: input.speech,
      });
      if (JSON.stringify(again.events) !== JSON.stringify(game.events)) {
        game.violations.push({
          id: "REPLAY_DIVERGENCE",
          seed: game.record.seed,
          record: game.record,
          round: game.rounds,
          phase: "GAME_OVER",
          playerId: null,
          expected: "cùng seed cho cùng chuỗi sự kiện",
          actual: "hai lần chạy cho ra chuỗi khác nhau",
          events: [],
        });
      }
    }

    games.push(game);
  }
  return games;
}

export function buildReport(
  input: SelfPlayBatchInput,
  games: readonly SelfPlayGame[],
): SelfPlayReport {
  const weights = input.weights ?? DEFAULT_BOT_WEIGHTS;
  const { overall, byTeam, byRole } = collectMetrics(games, weights);

  const violations = games.flatMap((game) => game.violations);
  const failedSeeds = games
    .filter((game) => game.violations.length > 0)
    .map((game) => ({
      seed: game.record.seed,
      // Lý do ĐẦU TIÊN: nó là nguyên nhân, những cái sau thường là hệ quả.
      reason: `${game.violations[0].id}: ${game.violations[0].actual}`,
      replay: replayCommand(game.record),
    }));

  const first = games[0]?.record;

  return {
    schemaVersion: 1,
    weightsVersion: weights.version,
    seedBase: input.seedBase,
    seedRange: {
      first: seedFor(input.seedBase, 0),
      last: seedFor(input.seedBase, Math.max(0, input.games - 1)),
    },
    games: games.length,
    config: {
      playerCount: first?.playerCount ?? (input.playerCount ?? 8),
      maxRounds: first?.maxRounds ?? 20,
      events: first?.events ?? false,
      speech: first?.speech ?? true,
      room: first?.config ?? ({} as SelfPlayGame["record"]["config"]),
    },
    metrics: overall,
    metricsByTeam: byTeam,
    metricsByRole: byRole,
    violations,
    failedSeeds,
    timing: null,
    commit: null,
  };
}

function pct(value: Ratio): string {
  if (value.value === null) return `n/a (0 mẫu)`;
  return `${(value.value * 100).toFixed(1)}% (${value.numerator}/${value.denominator})`;
}

/** Bản tóm tắt cho người đọc. Cùng dữ liệu với JSON, không thêm kết luận nào. */
export function formatReportText(report: SelfPlayReport): string {
  const m = report.metrics;
  const lines: string[] = [
    `Self-play  ${report.games} ván  |  trọng số ${report.weightsVersion}  |  seed ${report.seedRange.first} … ${report.seedRange.last}`,
    `Cấu hình   ${report.config.playerCount} người, trần ${report.config.maxRounds} vòng, events=${report.config.events}, speech=${report.config.speech}`,
    report.commit ? `Commit     ${report.commit}` : "Commit     (không lấy được)",
    report.timing
      ? `Thời gian  ${report.timing.totalMs.toFixed(0)}ms tổng, ${report.timing.msPerGame.toFixed(1)}ms/ván`
      : "Thời gian  (không đo)",
    "",
    "── Cân bằng ──",
    `  Dân thắng            ${pct(m.winRate.village)}`,
    `  Sói thắng            ${pct(m.winRate.wolves)}`,
    `  Số vòng trung bình   ${m.averageRounds === null ? "n/a" : m.averageRounds.toFixed(2)}`,
    `  Chạm trần vòng       ${pct(m.roundLimitRate)}`,
    "",
    "── Chất lượng chơi ──",
    `  Dân bỏ phiếu trúng Sói   ${pct(m.villageVoteAccuracy)}`,
    `  Sói tố/bầu đồng bọn      ${pct(m.wolfSelfSabotage)}`,
    `  Đổi phiếu                ${pct(m.voteChangeRate)}`,
    `  Đồng thuận               ${m.consensus === null ? "n/a" : m.consensus.toFixed(3)}`,
    `  Gắn kết coalition        ${m.coalitionCohesion === null ? "n/a" : m.coalitionCohesion.toFixed(3)}`,
    `  Bằng chứng hết hạn       ${pct(m.staleEvidenceRate)}`,
    `  Lặp lời thoại            ${pct(m.speechRepetitionRate)}`,
    "",
    "── An toàn ──",
    `  Vi phạm ranh giới hiểu biết  ${m.knowledgeBoundaryViolations}`,
    `  Nước đi bị engine từ chối    ${m.fallbackActions}`,
    `  Lượt chủ động bỏ             ${m.declinedTurns}`,
    `  Tổng vi phạm bất biến        ${report.violations.length}`,
    "",
    "── Theo vai ──",
    ...report.metricsByRole.map(
      (role) => `  ${role.role.padEnd(18)} thắng ${pct(role.wins)}`,
    ),
  ];

  if (report.failedSeeds.length > 0) {
    lines.push("", "── Seed thất bại ──");
    for (const failure of report.failedSeeds) {
      lines.push(`  ${failure.seed}  ${failure.reason}`);
      lines.push(`      ${failure.replay}`);
    }
  }

  return lines.join("\n");
}
