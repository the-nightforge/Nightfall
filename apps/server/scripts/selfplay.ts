import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  BOT_WEIGHTS_PRESETS,
  DEFAULT_BOT_WEIGHTS,
  buildReport,
  formatReportText,
  runBatch,
  weightsPreset,
  type BotWeights,
  type SelfPlayBatchInput,
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
  verifyReplay: boolean;
  out: string | null;
  quiet: boolean;
  /** Dùng bộ bài chuẩn của số người đó thay cho bộ bài mặc định của runner. */
  preset: boolean;
}

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
    "  --verify-replay     Chạy lại mỗi ván để bắt REPLAY_DIVERGENCE (chậm gấp đôi)",
    "  --out <đường dẫn>   Ghi JSON ra file",
    "  --quiet             Chỉ in JSON, không in bản tóm tắt",
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
    verifyReplay: false,
    out: null,
    quiet: false,
    preset: false,
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
      case "--verify-replay":
        options.verifyReplay = true;
        break;
      case "--out":
        options.out = argv[++i] ?? null;
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
    verifyReplay: options.verifyReplay,
    // Bộ bài mặc định của runner (2 Sói, Tiên Tri, Bảo Vệ, Phù Thuỷ) không đổi
    // theo số người, nên một batch 15 người mặc định KHÔNG đo bộ bài mà ván 15
    // người thật sự chia. `--preset` là cách hỏi đúng câu hỏi đó.
    config: options.preset ? presetDeck(options.players) : undefined,
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

  // Mã thoát khác 0 khi có vi phạm: một batch hỏng phải làm đỏ CI, không phải
  // chỉ in ra rồi báo thành công.
  if (report.violations.length > 0) process.exitCode = 1;
}

main();
