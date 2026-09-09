import { createReadStream, createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve, join } from "node:path";
import { ROLES } from "@masoi/shared";
import {
  DEFAULT_MAX_SEATS,
  actionSize,
  encodeObservation,
  observationFeatureNames,
  observationSize,
  splitOf,
  validateTrajectoryLine,
  type BotTrajectory,
} from "@masoi/game-engine";

/**
 * BOT_SELF_LEARNING §39: trajectory JSONL → tensor nhị phân cho tầng train Python.
 *
 * Encoder chỉ có MỘT bản, và nó ở TypeScript cùng chỗ với knowledge boundary.
 * Viết lại nó bằng Python sẽ tạo bản sao thứ hai của đúng phần mã quyết định
 * "cái gì được nhìn thấy" — và hai bản sao sẽ trôi lệch, âm thầm, theo hướng
 * không ai kiểm được. Vì vậy Python KHÔNG parse trajectory; nó chỉ đọc số.
 *
 * Định dạng: `.bin` thô + `meta.json`. Không header .npy vì không cần —
 * `np.fromfile(path, dtype).reshape(...)` đọc thẳng, và một header tự viết là
 * thêm một thứ nữa có thể sai.
 *
 * Đọc theo DÒNG: dataset 10.000 ván nặng ~2,7 GB, nạp cả file vào RAM là cách
 * chắc chắn nhất để tầng train không bao giờ chạy được trên máy thật.
 */

interface Options {
  input: string;
  out: string;
  maxSeats: number;
}

function usage(): string {
  return [
    "npm run ai:encode -- --in <trajectories.jsonl> --out <dir> [--max-seats <n>]",
    "",
    `  --max-seats <n>  Trần số ghế của vector (mặc định: ${DEFAULT_MAX_SEATS})`,
  ].join("\n");
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { input: "", out: "", maxSeats: DEFAULT_MAX_SEATS };
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case "--in":
        options.input = argv[++i] ?? "";
        break;
      case "--out":
        options.out = argv[++i] ?? "";
        break;
      case "--max-seats":
        options.maxSeats = Number(argv[++i] ?? DEFAULT_MAX_SEATS);
        break;
      case "--help":
      case "-h":
        process.stdout.write(`${usage()}\n`);
        process.exit(0);
        break;
      default:
        throw new Error(`Tham số không nhận ra: ${argv[i]}\n\n${usage()}`);
    }
  }
  if (options.input === "" || options.out === "") throw new Error(usage());
  return options;
}

const SPLIT_CODE = { train: 0, validation: 1, test: 2 } as const;

/** Commit hiện tại, hoặc `null`. Không bao giờ làm hỏng cả lần chạy. */
function currentCommit(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const outDir = resolve(options.out);
  mkdirSync(outDir, { recursive: true });

  const obsSize = observationSize(options.maxSeats);
  const actSize = actionSize(options.maxSeats);
  const roleIndex = new Map(ROLES.map((role, index) => [role as string, index]));

  const streams = {
    features: createWriteStream(join(outDir, "features.f32.bin")),
    masks: createWriteStream(join(outDir, "masks.u8.bin")),
    actions: createWriteStream(join(outDir, "actions.i32.bin")),
    rewards: createWriteStream(join(outDir, "rewards.i8.bin")),
    splits: createWriteStream(join(outDir, "splits.u8.bin")),
    roles: createWriteStream(join(outDir, "roles.u8.bin")),
  };

  let read = 0;
  let rejected = 0;
  let unlabelled = 0;
  let rows = 0;
  const games = new Set<string>();
  const perSplit = { train: 0, validation: 0, test: 0 };

  const lines = createInterface({
    input: createReadStream(resolve(options.input), "utf8"),
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  for await (const raw of lines) {
    const text = raw.trim();
    if (text === "") continue;
    read += 1;

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      rejected += 1;
      continue;
    }

    // §7: line bẩn bị TỪ CHỐI, không được lọc bớt trường rồi encode tiếp.
    if (!validateTrajectoryLine(parsed).valid) {
      rejected += 1;
      continue;
    }

    const line = parsed as BotTrajectory;
    const encoded = encodeObservation(line, { maxSeats: options.maxSeats });
    // Không có nhãn hành động (SPEECH/FINAL_VOTE) thì không phải mẫu behavior
    // cloning. Bỏ qua, không bịa nhãn.
    if (encoded.actionIndex === null) {
      unlabelled += 1;
      continue;
    }

    const split = splitOf(line.gameId);
    games.add(line.gameId);
    perSplit[split] += 1;
    rows += 1;

    streams.features.write(Buffer.from(Float32Array.from(encoded.features).buffer));
    streams.masks.write(Buffer.from(Uint8Array.from(encoded.mask, (ok) => (ok ? 1 : 0))));
    streams.actions.write(Buffer.from(Int32Array.of(encoded.actionIndex).buffer));
    streams.rewards.write(Buffer.from(Int8Array.of(line.reward)));
    streams.splits.write(Buffer.from(Uint8Array.of(SPLIT_CODE[split])));
    streams.roles.write(Buffer.from(Uint8Array.of(roleIndex.get(line.finalRole) ?? 255)));
  }

  await Promise.all(
    Object.values(streams).map(
      (stream) => new Promise<void>((done) => stream.end(done)),
    ),
  );

  // §46: mọi model train ra từ tập này phải truy được về đúng tập này.
  const meta = {
    datasetVersion: "dataset-0001",
    gitCommit: currentCommit(),
    source: resolve(options.input),
    rows,
    games: games.size,
    linesRead: read,
    rejected,
    unlabelled,
    obsSize,
    actionSize: actSize,
    maxSeats: options.maxSeats,
    splitCounts: perSplit,
    splitCode: SPLIT_CODE,
    roles: [...ROLES],
    featureNames: observationFeatureNames(options.maxSeats),
  };
  writeFileSync(join(outDir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");

  process.stdout.write(
    [
      `Đã đọc      ${read} dòng (${games.size} ván)`,
      `TỪ CHỐI     ${rejected}`,
      `không nhãn  ${unlabelled}`,
      `mẫu train   ${rows}  (train ${perSplit.train} / val ${perSplit.validation} / test ${perSplit.test})`,
      `vector      ${obsSize} chiều, ${actSize} hành động`,
      `Đã ghi      ${outDir}`,
      "",
    ].join("\n"),
  );

  // Dataset bẩn phải làm đỏ CI, cùng lý do với ai-validate-dataset.
  if (rejected > 0) process.exitCode = 1;
}

void main();
