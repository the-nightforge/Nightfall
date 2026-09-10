import { aggregateBotMetrics, type BotMetrics, type BotMetricsReport } from "../src/game/bot-metrics";
import { prisma } from "../src/db";

/**
 * Cộng dồn chỉ số giao tiếp của bot trên ván thật (`GameResult.botMetrics`).
 *
 * CHỈ đọc cột đó - không đọc bảng chat, không đọc tên người chơi. Mọi phép cộng
 * nằm ở `aggregateBotMetrics` (thuần, có test); file này chỉ đọc DB và in.
 *
 * Chạy:  npm run prod-metrics -- --since 2026-09-10 --min-humans 1
 */

interface Options {
  since: Date | null;
  weights: string | undefined;
  minHumans: number | undefined;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { since: null, weights: undefined, minHumans: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`Thiếu giá trị cho ${arg}`);
      i += 1;
      return value;
    };
    if (arg === "--since") {
      const date = new Date(next());
      if (Number.isNaN(date.getTime())) throw new Error("--since phải là một ngày, ví dụ 2026-09-10");
      options.since = date;
    } else if (arg === "--weights") {
      options.weights = next();
    } else if (arg === "--min-humans") {
      const value = Number(next());
      if (!Number.isInteger(value) || value < 0) throw new Error("--min-humans phải là số nguyên không âm");
      options.minHumans = value;
    } else {
      throw new Error(`Tham số lạ: ${arg}`);
    }
  }
  return options;
}

const pct = ([n, d]: [number, number]): string =>
  d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}% (${n}/${d})`;

const total = (counts: Record<string, number>): number =>
  Object.values(counts).reduce((sum, value) => sum + value, 0);

function format(report: BotMetricsReport): string {
  const { bot, human } = report.questionOutcomes;
  const outcomeKeys = [...new Set([...Object.keys(bot), ...Object.keys(human)])];
  return [
    `metricsVersion ${report.metricsVersion} — ${report.games} ván ` +
      `(bỏ ${report.skippedOtherVersion} ván khác phiên bản, ${report.skippedFilters} ván không qua bộ lọc)`,
    `ván bị cắt sổ: ${report.truncatedGames} · lỗi bộ ghi: ${report.recorderErrors}`,
    `ván theo brain: ${Object.entries(report.byBrain).map(([brain, n]) => `${brain}=${n}`).join(", ")}`,
    "",
    "tỉ lệ:",
    ...Object.entries(report.ratios).map(([key, value]) => `  ${key.padEnd(28)} ${pct(value)}`),
    "",
    "câu hỏi — bot hỏi bot | người hỏi bot:",
    ...outcomeKeys.map(
      (key) =>
        `  ${key.padEnd(22)} ${pct([bot[key] ?? 0, total(bot)])} | ${pct([human[key] ?? 0, total(human)])}`,
    ),
    "",
    `câu bị phòng chặn: ${JSON.stringify(report.blocked)}`,
    `câu/bot/ngày: ${report.botDays[1] === 0 ? "n/a" : (report.botDays[0] / report.botDays[1]).toFixed(2)}`,
    `chuỗi đối đáp dài nhất: ${report.maxChain}`,
    `lời khai/ván: ${report.games === 0 ? "n/a" : (report.claims / report.games).toFixed(2)}` +
      ` · ván có phản bác: ${report.gamesWithCounterClaim}/${report.games}`,
  ].join("\n");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const rows = await prisma.gameResult.findMany({
    where: options.since ? { createdAt: { gte: options.since } } : {},
    select: { botMetrics: true },
  });
  const metrics = rows
    .map((row) => row.botMetrics as unknown as BotMetrics | null)
    .filter((value): value is BotMetrics => value !== null);
  console.log(`[prod-metrics] ${rows.length} ván trong khoảng, ${metrics.length} ván có botMetrics`);

  const report = aggregateBotMetrics(metrics, { weightsVersion: options.weights, minHumans: options.minHumans });
  console.log(report ? format(report) : "Chưa có ván nào có botMetrics.");
}

main()
  .catch((error) => {
    console.error("[prod-metrics]", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
