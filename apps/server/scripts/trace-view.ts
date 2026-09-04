import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  formatTraceTimeline,
  parseTraceJsonl,
  termSumProblems,
} from "@masoi/game-engine";

/**
 * Đọc một file trace của self-play.
 *
 * Vỏ I/O mỏng: mở file, gọi hàm thuần, in ra. Toàn bộ việc dựng timeline sống
 * ở `packages/game-engine/src/bot/trace/trace-view.ts`, nên nó chạy được trong
 * test của engine mà không cần chạm đĩa - cùng ranh giới mà `selfplay.ts` giữ.
 *
 * Chạy:  npm run trace-view -- reports/traces/batch-0.jsonl --bot p3
 */

interface Options {
  file: string;
  botId: string | null;
  terms: number;
  movers: number;
}

function usage(): string {
  return [
    "npm run trace-view -- <file.jsonl> [tuỳ chọn]",
    "",
    "  --bot <id>          Chỉ in timeline của một bot (VD: p3)",
    "  --terms <số>        Số số hạng in cho mỗi ứng viên (mặc định: 4)",
    "  --movers <số>       Số người nêu tên trong khối belief (mặc định: 4)",
    "",
    "Sinh file:  npm run selfplay -- --games 20 --traces reports/traces",
  ].join("\n");
}

function parseArgs(argv: readonly string[]): Options {
  let file: string | null = null;
  const options: Omit<Options, "file"> = { botId: null, terms: 4, movers: 4 };

  const number = (raw: string | undefined, flag: string): number => {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${flag} cần một số dương, nhận "${raw}"`);
    }
    return Math.floor(value);
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]!;
    switch (flag) {
      case "--bot":
        options.botId = argv[++i] ?? null;
        break;
      case "--terms":
        options.terms = number(argv[++i], flag);
        break;
      case "--movers":
        options.movers = number(argv[++i], flag);
        break;
      case "--help":
      case "-h":
        process.stdout.write(`${usage()}\n`);
        process.exit(0);
        break;
      default:
        if (flag.startsWith("-")) throw new Error(`Tham số không nhận ra: ${flag}\n\n${usage()}`);
        if (file !== null) throw new Error(`Chỉ đọc được một file mỗi lần, đã có "${file}"`);
        file = flag;
    }
  }

  if (file === null) throw new Error(`Thiếu đường dẫn file JSONL.\n\n${usage()}`);
  return { file, ...options };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const target = resolve(options.file);

  let text: string;
  try {
    text = readFileSync(target, "utf8");
  } catch {
    throw new Error(`Không đọc được ${target}`);
  }

  const traces = parseTraceJsonl(text);

  /**
   * Kiểm "số hạng cộng lại bằng điểm" TRƯỚC khi in.
   *
   * Một trace giải thích sai còn tệ hơn không có trace: nó khiến người đọc đi
   * sửa nhầm trọng số. Nên nếu file không tự nhất quán, cảnh báo phải nằm ở
   * ĐẦU màn hình chứ không lẫn vào giữa hai trăm dòng timeline.
   */
  const problems = termSumProblems(traces);
  if (problems.length > 0) {
    const sample = problems
      .slice(0, 3)
      .map(
        (item) =>
          `  ${item.botId} v${item.round} ${item.decision} → ${item.targetId}:` +
          ` score ${item.score} nhưng tổng số hạng ${item.sum}`,
      )
      .join("\n");
    process.stdout.write(
      `⚠ ${problems.length} ứng viên có số hạng KHÔNG cộng lại bằng điểm:\n${sample}\n\n`,
    );
  }

  process.stdout.write(
    formatTraceTimeline(traces, {
      botId: options.botId,
      terms: options.terms,
      movers: options.movers,
      source: target,
    }),
  );

  // Một file không nhất quán làm đỏ CI đúng như một batch có vi phạm: cả hai
  // đều là "công cụ đang nói dối", và cả hai đều phải dừng người dùng lại.
  if (problems.length > 0) process.exitCode = 1;
}

main();
