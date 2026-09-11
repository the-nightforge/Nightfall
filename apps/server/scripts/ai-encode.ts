import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  writeFileSync,
  type WriteStream,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve, join } from "node:path";
import { ROLES, isWolfPack } from "@masoi/shared";
import {
  ACTION_KINDS,
  DECISION_KINDS,
  DEFAULT_MAX_SEATS,
  actionNames,
  actionSize,
  candidateBases,
  candidateScores,
  encodeObservation,
  observationFeatureNames,
  observationSize,
  optimalActionMask,
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
 *
 * Rollout RESIDUAL (line `learned` có `beta`): ghi thêm `bases.f32.bin` —
 * điểm THẬT (có jitter) của từng ứng viên theo ô hành động, NaN ở ô khác —
 * cùng `meta.policyKind = "residual"`, `meta.beta`, `meta.temperature`. Đó là
 * đúng ba thứ Python cần để dựng lại phân phối `softmax((bases + β·net)/τ)`
 * mà policy đã lấy mẫu, nên ratio của PPO bắt đầu ở 1.
 */

interface Options {
  input: string;
  out: string;
  maxSeats: number;
  /**
   * Chỉ giữ line do policy học được LẤY MẪU ra, và ghi thêm `logprobs`/`values`
   * — tập cho PPO chứ không phải cho behavior cloning. Line heuristic trong
   * cùng file bị bỏ qua: PPO chỉ cập nhật được theo nước chính policy đã đi.
   */
  rollout: boolean;
}

function usage(): string {
  return [
    "npm run ai:encode -- --in <trajectories.jsonl> --out <dir> [--max-seats <n>] [--rollout]",
    "",
    `  --max-seats <n>  Trần số ghế của vector (mặc định: ${DEFAULT_MAX_SEATS})`,
    "  --rollout        Tập PPO: chỉ giữ line có `learned`, ghi thêm logprobs/values",
  ].join("\n");
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    input: "",
    out: "",
    maxSeats: DEFAULT_MAX_SEATS,
    rollout: false,
  };
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
      case "--rollout":
        options.rollout = true;
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
  const decisionIndex = new Map(DECISION_KINDS.map((kind, index) => [kind as string, index]));

  const streams = {
    features: createWriteStream(join(outDir, "features.f32.bin")),
    masks: createWriteStream(join(outDir, "masks.u8.bin")),
    actions: createWriteStream(join(outDir, "actions.i32.bin")),
    rewards: createWriteStream(join(outDir, "rewards.i8.bin")),
    // Nhãn shaping ±1 (spec 2026-09-11 D4); 0 = không nhãn. Luôn ghi: loader
    // nhận diện bằng SỰ CÓ MẶT của file, dataset cũ không có là đúng.
    shaping: createWriteStream(join(outDir, "shaping.i8.bin")),
    splits: createWriteStream(join(outDir, "splits.u8.bin")),
    roles: createWriteStream(join(outDir, "roles.u8.bin")),
    decisions: createWriteStream(join(outDir, "decisions.u8.bin")),
    optimal: createWriteStream(join(outDir, "optimal.u8.bin")),
    // Điểm teacher bỏ jitter theo ô hành động, NaN ở ô không phải ứng viên —
    // nhãn cho distillation (`train_bc --distill-alpha`).
    scores: createWriteStream(join(outDir, "scores.f32.bin")),
  };
  // Chỉ mở khi `--rollout`: `data.py` nhận diện tập rollout bằng SỰ CÓ MẶT của
  // hai file này, nên một cặp file rỗng nằm cạnh tập behavior cloning sẽ làm
  // loader tưởng nó là rollout rồi chết vì lệch kích thước.
  const rolloutStreams = options.rollout
    ? {
        logprobs: createWriteStream(join(outDir, "logprobs.f32.bin")),
        values: createWriteStream(join(outDir, "values.f32.bin")),
      }
    : null;

  let read = 0;
  let rejected = 0;
  let unlabelled = 0;
  let rows = 0;
  /** Nhiệt độ đã sinh ra tập này, đọc từ line rollout đầu tiên. */
  let temperature: number | null = null;
  /** β của residual policy, đọc từ line rollout đầu tiên; `null` = policy logits thuần. */
  let beta: number | null = null;
  /** Mở LƯỜI ở line residual đầu: `data.py` nhận diện residual bằng SỰ CÓ MẶT của file. */
  let basesStream: WriteStream | null = null;
  let warnedMismatch = false;
  let warnedMixed = false;
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

    // Line heuristic không có `learned`: nó là mẫu behavior cloning hợp lệ,
    // nhưng không phải mẫu PPO. Đếm vào "không nhãn" chứ không TỪ CHỐI — một
    // ván rollout vẫn có nước heuristic (Thám Tử, mọi lần rơi về nước lui).
    if (options.rollout && !line.learned) {
      unlabelled += 1;
      continue;
    }
    // Nhãn encoder phải TRÙNG chỉ số policy đã lấy mẫu. Lệch nghĩa là hai
    // đường dựng observation đã trôi khỏi nhau, và một `logProb` đo trên vector
    // A gắn vào hành động của vector B là gradient sai hướng.
    if (options.rollout && line.learned && encoded.actionIndex !== line.learned.actionIndex) {
      rejected += 1;
      if (!warnedMismatch) {
        warnedMismatch = true;
        process.stderr.write(
          `CẢNH BÁO: nhãn encoder (${encoded.actionIndex}) lệch chỉ số policy ` +
            `(${line.learned.actionIndex}) ở ván ${line.gameId}, lượt ${line.turn}. ` +
            "Chỉ báo một lần; xem tổng ở dòng TỪ CHỐI.\n",
        );
      }
      continue;
    }

    // Một tập rollout là của ĐÚNG MỘT policy ở ĐÚNG MỘT nhiệt độ: line mang
    // T/β khác line đầu là mẫu của một phân phối khác, và PPO trộn hai phân
    // phối vào một ratio là học sai trong im lặng. Kiểm TRƯỚC khi ghi bất kỳ
    // stream nào để các file .bin luôn cùng số hàng.
    if (rolloutStreams && line.learned) {
      const lineBeta = line.learned.beta ?? null;
      if (temperature === null) {
        temperature = line.learned.temperature;
        beta = lineBeta;
      } else if (line.learned.temperature !== temperature || lineBeta !== beta) {
        rejected += 1;
        if (!warnedMixed) {
          warnedMixed = true;
          process.stderr.write(
            `CẢNH BÁO: line rollout có T/β (${line.learned.temperature}/${lineBeta}) khác line ` +
              `đầu (${temperature}/${beta}) ở ván ${line.gameId}, lượt ${line.turn} — tập trộn ` +
              "hai policy là tập PPO sai. Chỉ báo một lần; xem tổng ở dòng TỪ CHỐI.\n",
          );
        }
        continue;
      }
    }

    const split = splitOf(line.gameId);
    games.add(line.gameId);
    perSplit[split] += 1;
    rows += 1;

    streams.features.write(Buffer.from(Float32Array.from(encoded.features).buffer));
    streams.masks.write(Buffer.from(Uint8Array.from(encoded.mask, (ok) => (ok ? 1 : 0))));
    streams.actions.write(Buffer.from(Int32Array.of(encoded.actionIndex).buffer));
    streams.rewards.write(Buffer.from(Int8Array.of(line.reward)));
    streams.shaping.write(Buffer.from(Int8Array.of(line.shaping ?? 0)));
    streams.splits.write(Buffer.from(Uint8Array.of(SPLIT_CODE[split])));
    streams.roles.write(Buffer.from(Uint8Array.of(roleIndex.get(line.finalRole) ?? 255)));
    streams.decisions.write(Buffer.from(Uint8Array.of(decisionIndex.get(line.decision) ?? 255)));
    const optimal = optimalActionMask(line, encoded, options.maxSeats);
    streams.optimal.write(Buffer.from(Uint8Array.from(optimal, (ok) => (ok ? 1 : 0))));
    streams.scores.write(
      Buffer.from(Float32Array.from(candidateScores(line, encoded, options.maxSeats)).buffer),
    );
    if (rolloutStreams && line.learned) {
      rolloutStreams.logprobs.write(Buffer.from(Float32Array.of(line.learned.logProb).buffer));
      // `value: null` là model không có value head. 0 là baseline trung tính
      // trên thang reward ±1, tức advantage = reward — đúng Monte Carlo không
      // baseline, không phải một con số bịa.
      rolloutStreams.values.write(Buffer.from(Float32Array.of(line.learned.value ?? 0).buffer));
      if (beta !== null) {
        basesStream ??= createWriteStream(join(outDir, "bases.f32.bin"));
        basesStream.write(
          Buffer.from(Float32Array.from(candidateBases(line, encoded, options.maxSeats)).buffer),
        );
      }
    }
  }

  await Promise.all(
    [
      ...Object.values(streams),
      ...(rolloutStreams ? Object.values(rolloutStreams) : []),
      ...(basesStream ? [basesStream] : []),
    ].map((stream) => new Promise<void>((done) => stream.end(done))),
  );

  // §46: mọi model train ra từ tập này phải truy được về đúng tập này.
  const meta = {
    // Tăng khi ĐỊNH DẠNG đổi (chiều vector, không gian hành động), để một
    // model cũ không bao giờ được nạp lên tensor mới mà không ai biết.
    datasetVersion: options.rollout ? "rollout-0001" : "dataset-0003",
    rollout: options.rollout,
    temperature,
    // Loại policy đã sinh tập: `residual` (có `bases.f32.bin`, `beta`) hay
    // `logits` thuần. `null` khi không phải rollout.
    policyKind: options.rollout ? (beta !== null ? "residual" : "logits") : null,
    beta,
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
    // Phe của từng vai, thẳng hàng với `roles`, tính ở ĐÂY bằng `isWolfPack`
    // (cùng quy ước `LearnedSeats`: trung lập về phía làng). Python lọc theo
    // phe bằng bảng này thay vì tự biết vai nào là Sói (§39).
    wolfPack: ROLES.map((role) => isWolfPack(role)),
    decisions: [...DECISION_KINDS],
    actionKinds: [...ACTION_KINDS],
    featureNames: observationFeatureNames(options.maxSeats),
    actionNames: actionNames(options.maxSeats),
  };
  writeFileSync(join(outDir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");

  process.stdout.write(
    [
      `Đã đọc      ${read} dòng (${games.size} ván)`,
      `TỪ CHỐI     ${rejected}`,
      `không nhãn  ${unlabelled}`,
      `mẫu train   ${rows}  (train ${perSplit.train} / val ${perSplit.validation} / test ${perSplit.test})`,
      ...(options.rollout
        ? [
            `rollout     T = ${temperature ?? "?"}` +
              (beta !== null ? ` β = ${beta} (residual: logprobs + values + bases)` : " (logits: logprobs + values)"),
          ]
        : []),
      `vector      ${obsSize} chiều, ${actSize} hành động`,
      `Đã ghi      ${outDir}`,
      "",
    ].join("\n"),
  );

  // Dataset bẩn phải làm đỏ CI, cùng lý do với ai-validate-dataset.
  if (rejected > 0) process.exitCode = 1;
}

void main();
