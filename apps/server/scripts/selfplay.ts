import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  BOT_WEIGHTS_PRESETS,
  DEFAULT_BOT_WEIGHTS,
  buildReport,
  formatReportText,
  runBatch,
  serializeTraces,
  traceFileName,
  weightsPreset,
  type BotWeights,
  type SelfPlayBatchInput,
  type SelfPlayGame,
} from "@masoi/game-engine";
import { PRESET_DECKS, type RoomConfig } from "@masoi/shared";

/**
 * Runner self-play — vỏ I/O quanh một nhân THUẦN.
 *
 * Ranh giới ở đây là điều kiện để nhân mô phỏng chạy được bên trong test của
 * engine: mọi thứ không tất định hoặc chạm đĩa đều sống ở file này. Cụ thể là
 * đọc tham số, ghi file, đo đồng hồ tường, và hỏi Git về commit hiện tại.
 *
 * `packages/game-engine` không import `fs`, `process`, `child_process` hay
 * `net` - có test khẳng định điều đó.
 */

interface Options {
  seed: string;
  games: number;
  players: number;
  maxRounds: number;
  weights: BotWeights;
  events: boolean;
  speech: boolean;
  /** Bật vòng speech DEFENSE thật trong từng ván. Xem `SelfPlayInput.defense`. */
  defense: boolean;
  /** Số ghế đầu gắn cờ isBot=false. Xem `SelfPlayRecord.humanSeats`. */
  humans: number;
  verifyReplay: boolean;
  out: string | null;
  quiet: boolean;
  /** Dùng bộ bài chuẩn của số người đó thay cho bộ bài mặc định của runner. */
  preset: boolean;
  /** Thư mục nhận JSONL trace. `null` là TẮT, và tắt là mặc định. */
  traces: string | null;
  /** Trần số ván được ghi trace. Chỉ có nghĩa khi `traces` khác `null`. */
  traceGames: number;
}

/**
 * Trần mặc định cho số ván ghi trace.
 *
 * Năm ván là số ván một người thật sự mở ra đọc trong một buổi tuning. Đặt trần
 * ở đây chứ không để người dùng tự nhớ, vì thứ đang được chặn không phải sự bất
 * tiện mà là một batch 1000 ván ghi ra vài GB JSONL trước khi ai kịp thấy.
 */
const DEFAULT_TRACE_GAMES = 5;

function usage(): string {
  const presets = Object.keys(BOT_WEIGHTS_PRESETS).sort().join(", ");
  return [
    "npm run selfplay -- [tuỳ chọn]",
    "",
    "  --seed <chuỗi>      Gốc seed (mặc định: batch)",
    "  --games <số>        Số ván (mặc định: 100)",
    "  --players <số>      Số người mỗi ván (mặc định: 8)",
    "  --max-rounds <số>   Trần số vòng (mặc định: 20)",
    `  --weights <ver>     Phiên bản trọng số (có: ${presets})`,
    "  --preset            Dùng PRESET_DECKS của số người đó (bộ bài thật của ván xếp hạng)",
    "  --events            Bật sự kiện cân bằng động",
    "  --no-speech         Tắt lời nói giữa các BOT",
    "  --defense           Bật vòng speech DEFENSE thật (mọi bot sống được nói trước bỏ phiếu)",
    "  --humans <số>       Gắn cờ isBot=false cho n ghế đầu (vẫn bot điều khiển) để đo nhánh bàn-có-người",
    "  --verify-replay     Chạy lại mỗi ván để bắt REPLAY_DIVERGENCE (chậm gấp đôi)",
    "  --out <đường dẫn>   Ghi JSON ra file",
    "  --traces <thư mục>  Ghi trace quyết định ra JSONL, mỗi ván một file (mặc định: tắt)",
    `  --trace-games <số>  Số ván đầu được ghi trace (mặc định: ${DEFAULT_TRACE_GAMES})`,
    "  --quiet             Chỉ in JSON, không in bản tóm tắt",
    "",
    "Đọc trace:  npm run trace-view -- <file.jsonl> [--bot <id>]",
  ].join("\n");
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    seed: "batch",
    games: 100,
    players: 8,
    maxRounds: 20,
    weights: DEFAULT_BOT_WEIGHTS,
    events: false,
    speech: true,
    defense: false,
    humans: 0,
    verifyReplay: false,
    out: null,
    quiet: false,
    preset: false,
    traces: null,
    traceGames: DEFAULT_TRACE_GAMES,
  };

  const number = (raw: string | undefined, flag: string): number => {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${flag} cần một số dương, nhận "${raw}"`);
    }
    return Math.floor(value);
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    switch (flag) {
      case "--seed":
        options.seed = argv[++i] ?? options.seed;
        break;
      case "--games":
        options.games = number(argv[++i], flag);
        break;
      case "--players":
        options.players = number(argv[++i], flag);
        break;
      case "--max-rounds":
        options.maxRounds = number(argv[++i], flag);
        break;
      case "--weights":
        // `weightsPreset` ném với thông điệp liệt kê các phiên bản đã biết, nên
        // một lỗi đánh máy ở đây được trả lời ngay thay vì sinh ra 300 ván sai.
        options.weights = weightsPreset(argv[++i] ?? "");
        break;
      case "--preset":
        options.preset = true;
        break;
      case "--events":
        options.events = true;
        break;
      case "--no-speech":
        options.speech = false;
        break;
      case "--defense":
        options.defense = true;
        break;
      case "--humans":
        options.humans = number(argv[++i], flag);
        break;
      case "--verify-replay":
        options.verifyReplay = true;
        break;
      case "--out":
        options.out = argv[++i] ?? null;
        break;
      case "--traces":
        options.traces = argv[++i] ?? null;
        break;
      case "--trace-games":
        options.traceGames = number(argv[++i], flag);
        break;
      case "--quiet":
        options.quiet = true;
        break;
      case "--help":
      case "-h":
        process.stdout.write(`${usage()}\n`);
        process.exit(0);
        break;
      default:
        throw new Error(`Tham số không nhận ra: ${flag}\n\n${usage()}`);
    }
  }

  return options;
}

function presetDeck(playerCount: number): RoomConfig {
  const deck = PRESET_DECKS[playerCount];
  if (!deck) {
    const known = Object.keys(PRESET_DECKS).join(", ");
    throw new Error(`--preset không có bộ bài chuẩn cho ${playerCount} người (có: ${known})`);
  }
  return deck;
}

/**
 * Ghi trace của những ván CÓ trace ra JSONL, mỗi ván một file.
 *
 * Một file mỗi ván chứ không một file cho cả batch: đơn vị mà người đọc mở ra
 * là một VÁN ("sao ván này bot treo nhầm An"), và tên file mang seed nên từ một
 * file trace luôn chạy lại được đúng ván đã sinh ra nó.
 *
 * Trả về đường dẫn đã ghi, để lời báo cuối chỉ được đúng chỗ cần mở.
 */
function writeTraces(directory: string, games: readonly SelfPlayGame[]): string[] {
  const root = resolve(directory);
  mkdirSync(root, { recursive: true });

  const written: string[] = [];
  for (const game of games) {
    // Ván ngoài trần trace có mảng rỗng. Ghi ra một file trống chỉ tạo ra thứ
    // để người ta mở nhầm rồi tưởng bot không quyết định gì.
    if (game.traces.length === 0) continue;
    const target = join(root, traceFileName(game.record.seed));
    writeFileSync(target, serializeTraces(game.traces), "utf8");
    written.push(target);
  }
  return written;
}

/** Commit hiện tại, hoặc `null`. Không bao giờ làm hỏng cả lần chạy. */
function currentCommit(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));

  const batch: SelfPlayBatchInput = {
    seedBase: options.seed,
    games: options.games,
    playerCount: options.players,
    maxRounds: options.maxRounds,
    weights: options.weights,
    events: options.events,
    speech: options.speech,
    defense: options.defense,
    humanSeats: options.humans,
    verifyReplay: options.verifyReplay,
    // Bộ bài mặc định của runner (2 Sói, Tiên Tri, Bảo Vệ, Phù Thuỷ) không đổi
    // theo số người, nên một batch 15 người mặc định KHÔNG đo bộ bài mà ván 15
    // người thật sự chia. `--preset` là cách hỏi đúng câu hỏi đó.
    config: options.preset ? presetDeck(options.players) : undefined,
    // Không `--traces` thì 0, và 0 nghĩa là `runSelfPlay` không dựng collector,
    // không bọc RNG, không cấp phát một object trace nào. Buộc trần vào sự có
    // mặt của thư mục ĐÍCH chứ không vào `--trace-games`, để không có cách nào
    // trả giá bộ nhớ cho một tập trace rồi vứt đi vì quên chỗ ghi.
    traceGames: options.traces === null ? 0 : Math.min(options.traceGames, options.games),
  };

  const startedAt = performance.now();
  const games = runBatch(batch);
  const totalMs = performance.now() - startedAt;

  const report = buildReport(batch, games);
  // Bơm vào SAU khi builder chạy, để nhân thuần vẫn tất định.
  report.timing = { totalMs, msPerGame: totalMs / Math.max(1, games.length) };
  report.commit = currentCommit();

  if (!options.quiet) process.stdout.write(`${formatReportText(report)}\n`);

  if (options.out) {
    const target = resolve(options.out);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    if (!options.quiet) process.stdout.write(`\nĐã ghi ${target}\n`);
  } else if (options.quiet) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }

  if (options.traces !== null) {
    const files = writeTraces(options.traces, games);
    if (!options.quiet) {
      const total = games.reduce((sum, game) => sum + game.traces.length, 0);
      process.stdout.write(
        `\nĐã ghi trace ${files.length} ván (${total} quyết định) vào ${resolve(options.traces)}\n`,
      );
      // In lệnh đọc kèm một file có thật: một đường dẫn không có lệnh đi cùng
      // là một thư mục người ta ghi ra rồi không bao giờ mở.
      if (files[0]) process.stdout.write(`Đọc:  npm run trace-view -- ${files[0]}\n`);
    }
  }

  // Mã thoát khác 0 khi có vi phạm: một batch hỏng phải làm đỏ CI, không phải
  // chỉ in ra rồi báo thành công.
  if (report.violations.length > 0) process.exitCode = 1;
}

main();
