import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Chạy TRỌN lượt sweep `role-power` trên máy này, thay cho workflow 15 shard
 * từng nằm ở `.github/workflows/role-power.yml`.
 *
 * Vì sao gỡ khỏi CI: một lượt 300 ván tốn ~780 phút Actions - gần 40% hạn mức
 * tháng của một tài khoản cá nhân cho ĐÚNG MỘT lần bấm. Máy này có 16 lõi, tức
 * nhiều hơn số shard, nên chạy tại chỗ vừa không tốn phút vừa xong nhanh hơn:
 * runner của GitHub chỉ có 2 lõi mỗi shard.
 *
 * Cách chia shard giữ nguyên của workflow cũ, kể cả lý do chia: giá mỗi lượt
 * tăng gần bậc 3.5 theo số người, nên preset 20 một mình đắt hơn cả cụm 8-12
 * cộng lại, và preset lớn phải cắt tiếp theo chiều VAI.
 *
 * Chạy:
 *   npm run role-power:sweep                    # 300 ván, số chốt, vài giờ
 *   npm run role-power:sweep -- --games 30      # thử đường ống, ~15 phút
 *   npm run role-power:sweep -- --jobs 8        # chừa lõi cho việc khác
 *   npm run role-power:sweep -- --shard 03 --shard 04
 *
 * Shard nào đã có JSON hợp lệ trong thư mục ra thì lượt sau BỎ QUA - máy để
 * qua đêm có thể ngủ, mất điện, hoặc bị Ctrl-C mà không phải đo lại từ đầu.
 * `--fresh` xoá sạch để đo lại.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROLE_POWER = join(HERE, "role-power.ts");
const MERGE = join(HERE, "role-power-merge.ts");

/** Y hệt ma trận của workflow cũ. Vai không có trong preset thì script tự bỏ qua. */
const SHARDS: ReadonlyArray<{ id: string; args: readonly string[] }> = [
  { id: "01", args: ["--only", "8", "--only", "9", "--only", "10", "--only", "11", "--only", "12"] },
  { id: "02", args: ["--only", "13", "--only", "14"] },
  { id: "03", args: ["--only", "15"] },
  { id: "04", args: ["--only", "16"] },

  { id: "05", args: ["--only", "17", "--role", "SEER", "--role", "GUARD", "--role", "WITCH", "--role", "HUNTER", "--role", "CURSED", "--role", "WOLF_CUB", "--role", "APPRENTICE_SEER"] },
  { id: "06", args: ["--only", "17", "--role", "DETECTIVE", "--role", "TRACKER", "--role", "MAYOR", "--role", "ELDER", "--role", "SORCERER", "--role", "DOPPELGANGER"] },

  { id: "07", args: ["--only", "18", "--role", "SEER", "--role", "GUARD", "--role", "WITCH", "--role", "HUNTER", "--role", "CURSED", "--role", "WOLF_CUB", "--role", "APPRENTICE_SEER"] },
  { id: "08", args: ["--only", "18", "--role", "DETECTIVE", "--role", "TRACKER", "--role", "MAYOR", "--role", "ELDER", "--role", "SORCERER", "--role", "DOPPELGANGER"] },

  { id: "09", args: ["--only", "19", "--role", "SEER", "--role", "GUARD", "--role", "WITCH", "--role", "HUNTER", "--role", "CURSED"] },
  { id: "10", args: ["--only", "19", "--role", "WOLF_CUB", "--role", "APPRENTICE_SEER", "--role", "DETECTIVE", "--role", "TRACKER", "--role", "MAYOR"] },
  { id: "11", args: ["--only", "19", "--role", "ELDER", "--role", "SORCERER", "--role", "DOPPELGANGER"] },

  { id: "12", args: ["--only", "20", "--role", "SEER", "--role", "GUARD", "--role", "WITCH", "--role", "HUNTER"] },
  { id: "13", args: ["--only", "20", "--role", "CURSED", "--role", "WOLF_CUB", "--role", "APPRENTICE_SEER"] },
  { id: "14", args: ["--only", "20", "--role", "DETECTIVE", "--role", "TRACKER", "--role", "MAYOR", "--role", "ELDER"] },
  { id: "15", args: ["--only", "20", "--role", "SORCERER", "--role", "DOPPELGANGER"] },
];

interface Options {
  games: number;
  jobs: number;
  outDir: string;
  fresh: boolean;
  only: readonly string[];
}

function parseArgs(argv: readonly string[]): Options {
  const flag = (name: string): string | undefined => {
    const at = argv.indexOf(name);
    return at >= 0 ? argv[at + 1] : undefined;
  };

  const games = Number(flag("--games") ?? 300);
  if (!Number.isInteger(games) || games <= 0) throw new Error("--games phải là số nguyên dương");

  // Mỗi shard là MỘT tiến trình một luồng, nên số job trần là số shard. Chừa
  // một lõi để máy còn dùng được trong lúc sweep chạy hàng giờ.
  const defaultJobs = Math.min(SHARDS.length, Math.max(1, cpus().length - 1));
  const jobs = Number(flag("--jobs") ?? defaultJobs);
  if (!Number.isInteger(jobs) || jobs <= 0) throw new Error("--jobs phải là số nguyên dương");

  const only = argv.flatMap((arg, i) => (arg === "--shard" ? [String(argv[i + 1])] : []));
  for (const id of only) {
    if (!SHARDS.some((s) => s.id === id)) throw new Error(`Không có shard "${id}"`);
  }

  return {
    games,
    jobs,
    outDir: resolve(flag("--out") ?? ".role-power"),
    fresh: argv.includes("--fresh"),
    only,
  };
}

function hhmmss(ms: number): string {
  const s = Math.round(ms / 1000);
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

function log(message: string): void {
  process.stderr.write(`[${new Date().toTimeString().slice(0, 8)}] ${message}\n`);
}

/** JSON rỗng hoặc cụt = shard chết giữa chừng, phải đo lại chứ không được gộp. */
function isComplete(file: string): boolean {
  if (!existsSync(file) || statSync(file).size === 0) return false;
  try {
    JSON.parse(readFileSync(file, "utf8"));
    return true;
  } catch {
    return false;
  }
}

function runShard(shard: (typeof SHARDS)[number], opts: Options): Promise<boolean> {
  const out = join(opts.outDir, `shard-${shard.id}.json`);
  const started = Date.now();

  return new Promise((done) => {
    const file = createWriteStream(out);
    // `--import tsx` thay cho `npx tsx`: không đẻ thêm một tầng shell mỗi shard,
    // và trên Windows thì npx.cmd làm việc dọn tiến trình con rối hẳn lên.
    const child = spawn(
      process.execPath,
      ["--import", "tsx", ROLE_POWER, "--json", "--games", String(opts.games), ...shard.args],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    child.stdout.pipe(file);

    // Giữ lại phần cuối stderr thôi: shard hỏng thường nổ ở dòng chót, còn in
    // cả stderr của 15 tiến trình song song thì không đọc được gì.
    let err = "";
    child.stderr.on("data", (chunk: Buffer) => {
      err = (err + chunk.toString()).slice(-2000);
    });

    child.on("error", (cause) => {
      log(`shard ${shard.id} KHÔNG chạy được: ${cause.message}`);
      file.end(() => done(false));
    });

    child.on("close", (code) => {
      file.end(() => {
        const took = hhmmss(Date.now() - started);
        if (code === 0 && isComplete(out)) {
          log(`shard ${shard.id} xong sau ${took}`);
          done(true);
          return;
        }
        // Xoá file dở: lần chạy sau phải đo lại shard này, và bước gộp không
        // được đọc nhầm một nửa kết quả thành số thật.
        rmSync(out, { force: true });
        log(`shard ${shard.id} ĐỎ sau ${took} (mã thoát ${code})\n${err.trim()}`);
        done(false);
      });
    });
  });
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.fresh) rmSync(opts.outDir, { recursive: true, force: true });
  mkdirSync(opts.outDir, { recursive: true });

  const wanted = opts.only.length > 0 ? SHARDS.filter((s) => opts.only.includes(s.id)) : SHARDS;
  const todo = wanted.filter((s) => !isComplete(join(opts.outDir, `shard-${s.id}.json`)));
  const skipped = wanted.length - todo.length;

  log(`sweep ${opts.games} ván/ô, ${todo.length} shard cần chạy${skipped > 0 ? ` (bỏ qua ${skipped} shard đã có kết quả)` : ""}, ${opts.jobs} tiến trình song song`);
  log(`thư mục ra: ${opts.outDir}`);

  const started = Date.now();
  // Nhịp tim: một lượt 300 ván chạy hàng giờ, không có dòng này thì không phân
  // biệt được "đang đo" với "đã treo".
  const heartbeat = setInterval(() => {
    log(`...vẫn đang chạy, đã ${hhmmss(Date.now() - started)}`);
  }, 5 * 60 * 1000);
  heartbeat.unref();

  let next = 0;
  let failed = 0;
  const worker = async (): Promise<void> => {
    while (next < todo.length) {
      const shard = todo[next++];
      if (shard === undefined) return;
      log(`shard ${shard.id} bắt đầu (${next}/${todo.length})`);
      if (!(await runShard(shard, opts))) failed += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.jobs, todo.length) }, worker));

  clearInterval(heartbeat);
  log(`đo xong sau ${hhmmss(Date.now() - started)}${failed > 0 ? `, ${failed} shard ĐỎ` : ""}`);

  // Gộp cả khi có shard đỏ: bảng thiếu vài preset vẫn hơn không có gì, và cột
  // số mẫu tự nói ra chỗ thiếu.
  const merged = await new Promise<string>((done, fail) => {
    const child = spawn(process.execPath, ["--import", "tsx", MERGE, opts.outDir], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    let text = "";
    child.stdout.on("data", (chunk: Buffer) => {
      text += chunk.toString();
    });
    child.on("error", fail);
    child.on("close", (code) => (code === 0 ? done(text) : fail(new Error(`gộp thất bại, mã thoát ${code}`))));
  });

  const report = join(opts.outDir, "role-power.md");
  writeFileSync(report, merged, "utf8");
  process.stdout.write(merged);
  log(`bảng đã ghi vào ${report}`);

  if (failed > 0) process.exitCode = 1;
}

main().catch((cause: unknown) => {
  log(String(cause instanceof Error ? cause.stack ?? cause.message : cause));
  process.exitCode = 1;
});
