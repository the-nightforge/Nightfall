import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  buildAnswerKey,
  buildTranscript,
  formatTranscript,
  runSelfPlay,
  weightsPreset,
  DEFAULT_BOT_WEIGHTS,
  type BotWeights,
  type TranscriptAnswerKey,
} from "@masoi/game-engine";

/**
 * PR 9 của `NIGHTFALL_BOT_COMMUNICATION_UPGRADE` (§27): sinh bộ biên bản để
 * NGƯỜI chấm chất lượng hội thoại.
 *
 * Vỏ I/O quanh một nhân THUẦN, đúng ranh giới của `selfplay.ts`: mọi thứ chạm
 * đĩa hay đọc tham số sống ở đây, còn `buildTranscript` / `buildAnswerKey` nằm
 * trong engine và không biết gì về file.
 *
 * Ghi ra HAI thứ, và việc tách chúng là toàn bộ lý do script này tồn tại:
 *
 * ```text
 * <out>/transcripts/*.md   -> đưa người chấm. KHÔNG có vai, kết cục hay seed.
 * <out>/answer-key.json    -> mở SAU khi chấm xong.
 * <out>/scoring-sheet.csv  -> tờ điền điểm, 7 trục của §27.
 * ```
 */

/** Bảy trục của §27, đúng thứ tự spec liệt kê. */
const AXES = [
  "naturalness",
  "responsiveness",
  "consistency",
  "persuasiveness",
  "strategic_quality",
  "deception",
  "personality",
] as const;

interface Options {
  seed: string;
  games: number;
  players: number;
  maxRounds: number;
  weights: BotWeights;
  out: string;
}

function usage(): string {
  return [
    "Sinh bộ biên bản mù để người chấm (COMMUNICATION §27).",
    "",
    "  --seed <chuỗi>    Gốc seed (mặc định: transcript)",
    "  --games <số>      Số ván, 10-20 theo §27 (mặc định: 12)",
    "  --players <số>    Số ghế (mặc định: 8)",
    "  --max-rounds <số> Trần số vòng (mặc định: 12)",
    "  --weights <ver>   Phiên bản trọng số (mặc định: bản đang dùng)",
    "  --out <thư mục>   Nơi ghi (mặc định: reports/human-eval)",
  ].join("\n");
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    seed: "transcript",
    games: 12,
    players: 8,
    maxRounds: 12,
    weights: DEFAULT_BOT_WEIGHTS,
    out: "reports/human-eval",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case "--seed":
        options.seed = value ?? options.seed;
        index += 1;
        break;
      case "--games":
        options.games = Number(value);
        index += 1;
        break;
      case "--players":
        options.players = Number(value);
        index += 1;
        break;
      case "--max-rounds":
        options.maxRounds = Number(value);
        index += 1;
        break;
      case "--weights":
        options.weights = weightsPreset(value ?? "");
        index += 1;
        break;
      case "--out":
        options.out = value ?? options.out;
        index += 1;
        break;
      case "--help":
        process.stdout.write(`${usage()}\n`);
        process.exit(0);
        break;
      default:
        break;
    }
  }

  if (!Number.isInteger(options.games) || options.games < 1) {
    throw new Error("--games phải là số nguyên dương");
  }
  return options;
}

/**
 * Nhãn ẩn danh: A, B, ... Z, AA, AB...
 *
 * Không phải seed và không phải số thứ tự của seed: người chấm không được có
 * đường nào dựng lại ván để đọc ra vai.
 */
function labelFor(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `Ván ${out}`;
}

function write(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, "utf8");
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const outDir = resolve(process.cwd(), options.out);
  const keys: TranscriptAnswerKey[] = [];
  const rows: string[] = [`label,rater,${AXES.join(",")},notes`];

  for (let index = 0; index < options.games; index += 1) {
    const game = runSelfPlay({
      seed: `${options.seed}-${index}`,
      players: options.players,
      maxRounds: options.maxRounds,
      weights: options.weights,
      speech: true,
    });

    const names: Record<string, string> = {};
    Object.keys(game.roles)
      .sort()
      .forEach((playerId, seat) => {
        names[playerId] = `Người ${seat + 1}`;
      });

    const label = labelFor(index);
    write(
      join(outDir, "transcripts", `${label.replace(/\s+/g, "-").toLowerCase()}.md`),
      formatTranscript(buildTranscript(game, label, names)),
    );
    keys.push(buildAnswerKey(game, label, names));
    rows.push(`${label},,${AXES.map(() => "").join(",")},`);
  }

  write(join(outDir, "answer-key.json"), `${JSON.stringify(keys, null, 2)}\n`);
  write(join(outDir, "scoring-sheet.csv"), `${rows.join("\n")}\n`);

  process.stdout.write(
    [
      `Đã ghi ${options.games} biên bản vào ${outDir}/transcripts`,
      `Tờ chấm: ${outDir}/scoring-sheet.csv`,
      `Đáp án (CHỈ mở sau khi chấm xong): ${outDir}/answer-key.json`,
      "",
      "Quy trình đầy đủ: docs/bot-communication-human-eval.md",
      "",
    ].join("\n"),
  );
}

main();
