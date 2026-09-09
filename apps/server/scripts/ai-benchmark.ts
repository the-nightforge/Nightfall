import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PRESET_DECKS } from "@masoi/shared";
import {
  DEFAULT_BOT_WEIGHTS,
  loadMlpPolicy,
  runBatch,
  type BotWeights,
  type LearnedDecisions,
  type LearnedSeats,
  type SelfPlayGame,
} from "@masoi/game-engine";

/**
 * Champion/challenger cho policy học được (BOT_SELF_LEARNING §24-§26).
 *
 * Các cấu hình trên CÙNG seed, chọn bằng `--setups`:
 *
 * - `baseline`  heuristic cả bàn — production hôm nay.
 * - `village`   làng học được đấu sói heuristic.
 * - `wolves`    sói học được đấu làng heuristic.
 * - `all`       CẢ BÀN học được — đúng cấu hình production sẽ chạy nếu cắm
 *               model. Hai hiệu của `village`/`wolves` NGƯỢC DẤU nhau (đã đo:
 *               −2,9 và +8,1), nên không suy ra được `all` bằng cách lấy trung
 *               bình; phải đo thẳng.
 * - `teacher`   heuristic KHÔNG jitter — chính teacher mà behavior cloning đã
 *               chép. Khoảng cách `all − teacher` là độ trung thành của bản
 *               sao đo bằng TỈ LỆ THẮNG, thứ mà agreement không đo được: đã
 *               gặp 94% khớp nước đi mà thua teacher 6,7 điểm.
 *
 * Số cần đọc là tỉ lệ thắng của LÀNG ở mỗi cấu hình so với baseline, GHÉP
 * THEO SEED (cùng seed = cùng chia vai), kèm sai số chuẩn của hiệu đó. Với
 * 300 ván mỗi lô, sàn nhiễu nhị thức là ±2,85 điểm/lô bất kể cấu hình; ba lô
 * cho SE của hiệu ≈ 1,3 điểm — một hiệu +2 chỉ tương đương ~1,5σ.
 *
 * Vỏ I/O quanh nhân thuần, cùng ranh giới với mọi script khác ở đây:
 * `packages/game-engine` không chạm đĩa, nên việc mở file trọng số nằm ở đây.
 */

const SETUP_NAMES = ["baseline", "village", "wolves", "all", "teacher"] as const;
type SetupName = (typeof SETUP_NAMES)[number];

interface Options {
  model: string;
  games: number;
  repeat: number;
  seed: string;
  players: number;
  preset: boolean;
  defense: boolean;
  out: string | null;
  setups: SetupName[];
  learnedDecisions: LearnedDecisions;
}

function usage(): string {
  return [
    "npm run ai:benchmark -- --model <model.weights.json> [tuỳ chọn]",
    "",
    "  --model <path>       Bắt buộc. File JSON do ai-training xuất (masoi-mlp-1)",
    "  --games <n>          Số ván mỗi cấu hình mỗi seed (mặc định: 300)",
    "  --repeat <n>         Số seed (mặc định: 3)",
    "  --seed <text>        Tiền tố seed (mặc định: bench)",
    "  --players <n>        Số người mỗi bàn (mặc định: 8)",
    `  --setups <a,b,...>   Trong ${SETUP_NAMES.join(", ")} (mặc định: baseline,village,wolves)`,
    "  --learned-decisions  vote | night | both (mặc định both) — ablation theo lượt",
    "  --no-preset          Không dùng bộ bài chuẩn của số người đó",
    "  --no-defense         Tắt vòng bào chữa",
    "  --out <path>         Ghi kết quả thô ra JSON",
  ].join("\n");
}

function parseArgs(argv: readonly string[]): Options {
  const o: Options = {
    model: "",
    games: 300,
    repeat: 3,
    seed: "bench",
    players: 8,
    preset: true,
    defense: true,
    out: null,
    setups: ["baseline", "village", "wolves"],
    learnedDecisions: "both",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = (): string => argv[(i += 1)] ?? "";
    if (a === "--model") o.model = next();
    else if (a === "--games") o.games = Number(next());
    else if (a === "--repeat") o.repeat = Number(next());
    else if (a === "--seed") o.seed = next();
    else if (a === "--players") o.players = Number(next());
    else if (a === "--no-preset") o.preset = false;
    else if (a === "--no-defense") o.defense = false;
    else if (a === "--out") o.out = next();
    else if (a === "--setups") {
      o.setups = next()
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name !== "")
        .map((name) => {
          if (!(SETUP_NAMES as readonly string[]).includes(name)) {
            throw new Error(`--setups không nhận "${name}" (có: ${SETUP_NAMES.join(", ")})`);
          }
          return name as SetupName;
        });
    } else if (a === "--learned-decisions") {
      const value = next();
      if (value !== "vote" && value !== "night" && value !== "both") {
        throw new Error(`--learned-decisions cần vote | night | both, nhận "${value}"`);
      }
      o.learnedDecisions = value;
    } else throw new Error(`Tham số không nhận ra: ${a}\n\n${usage()}`);
  }
  if (!o.model) throw new Error(usage());
  if (o.setups.length === 0) throw new Error("--setups rỗng");
  for (const [name, value] of [
    ["--games", o.games],
    ["--repeat", o.repeat],
    ["--players", o.players],
  ] as const) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${name} phải là số nguyên dương, nhận "${value}"`);
    }
  }
  return o;
}

/**
 * Tỉ lệ thắng của LÀNG trên những ván CÓ kết cục.
 *
 * Ván tràn trần vòng (`winner === null`) bị loại khỏi mẫu số chứ không tính
 * là làng thua: nó không nói gì về policy, và đếm nó vào sẽ trộn hai đại
 * lượng khác nhau vào một con số.
 */
function villageWinRate(games: readonly SelfPlayGame[]): number {
  const finished = games.filter((game) => game.winner !== null);
  return finished.length === 0
    ? 0
    : finished.filter((game) => game.winner === "village").length / finished.length;
}

/** Cùng phép biến đổi với `selfplay.ts --no-jitter`: chính teacher của BC. */
function withoutJitter(weights: BotWeights): BotWeights {
  return {
    ...weights,
    version: `${weights.version}+nojitter`,
    confidence: { ...weights.confidence, jitterSpan: 0 },
  };
}

interface Setup {
  name: SetupName;
  label: string;
  seats: LearnedSeats | null;
  weights: BotWeights;
}

const SETUPS: Record<SetupName, Omit<Setup, "name">> = {
  baseline: { label: "baseline (heuristic)", seats: null, weights: DEFAULT_BOT_WEIGHTS },
  village: { label: "làng học được", seats: "village", weights: DEFAULT_BOT_WEIGHTS },
  wolves: { label: "sói học được", seats: "wolves", weights: DEFAULT_BOT_WEIGHTS },
  all: { label: "cả bàn học được", seats: "all", weights: DEFAULT_BOT_WEIGHTS },
  teacher: {
    label: "teacher (không jitter)",
    seats: null,
    weights: withoutJitter(DEFAULT_BOT_WEIGHTS),
  },
};

/** Trung bình và sai số chuẩn của một dãy hiệu ghép theo seed. */
function pairedStats(diffs: readonly number[]): { mean: number; se: number } {
  const n = diffs.length;
  const mean = diffs.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { mean, se: Number.NaN };
  const variance = diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  return { mean, se: Math.sqrt(variance / n) };
}

function main(): void {
  const o = parseArgs(process.argv.slice(2));
  const policy = loadMlpPolicy(JSON.parse(readFileSync(resolve(o.model), "utf8")));
  const config = o.preset ? PRESET_DECKS[o.players] : undefined;
  if (o.preset && !config) throw new Error(`Không có bộ bài chuẩn cho ${o.players} người`);

  const setups: Setup[] = o.setups.map((name) => ({ name, ...SETUPS[name] }));
  const rows: Array<{
    setup: SetupName;
    label: string;
    seed: string;
    games: number;
    villageWin: number;
    unfinished: number;
    violations: number;
  }> = [];

  for (const setup of setups) {
    for (let r = 0; r < o.repeat; r += 1) {
      const seedBase = `${o.seed}-${r}`;
      const games = runBatch({
        seedBase,
        games: o.games,
        playerCount: o.players,
        config,
        weights: setup.weights,
        defense: o.defense,
        speech: true,
        learnedPolicy: setup.seats ? policy : undefined,
        learnedSeats: setup.seats ?? undefined,
        learnedDecisions: setup.seats ? o.learnedDecisions : undefined,
      });
      const villageWin = villageWinRate(games);
      const violations = games.reduce((n, game) => n + game.violations.length, 0);
      rows.push({
        setup: setup.name,
        label: setup.label,
        seed: seedBase,
        games: games.length,
        villageWin,
        unfinished: games.filter((game) => game.winner === null).length,
        violations,
      });
      process.stdout.write(
        `${setup.label.padEnd(24)} ${seedBase.padEnd(10)}` +
          ` làng thắng ${(villageWin * 100).toFixed(1)}%  vi phạm ${violations}\n`,
      );
    }
  }

  const winsOf = (name: SetupName): number[] =>
    rows.filter((row) => row.setup === name).map((row) => row.villageWin);
  const summary = setups.map((setup) => {
    const mine = winsOf(setup.name);
    const mean = mine.reduce((a, b) => a + b, 0) / mine.length;
    const spread = Math.max(...mine) - Math.min(...mine);
    return { setup: setup.name, label: setup.label, villageWinMean: mean, spread };
  });

  process.stdout.write("\n");
  for (const s of summary) {
    process.stdout.write(
      `${s.label.padEnd(24)} TB ${(s.villageWinMean * 100).toFixed(1)}%` +
        `  lệch giữa seed ${(s.spread * 100).toFixed(1)} điểm\n`,
    );
  }

  // Hiệu GHÉP THEO SEED so với baseline. Dấu quy về "phe học được mạnh hơn":
  // làng mạnh lên đẩy villageWin LÊN, sói mạnh lên đẩy nó XUỐNG.
  const paired: Record<string, { mean: number; se: number }> = {};
  if (o.setups.includes("baseline")) {
    const base = winsOf("baseline");
    const report = (name: SetupName, sign: 1 | -1, note: string): void => {
      if (!o.setups.includes(name)) return;
      const diffs = winsOf(name).map((v, i) => sign * (v - base[i]!) * 100);
      const stat = pairedStats(diffs);
      paired[name] = stat;
      const se = Number.isNaN(stat.se) ? "" : ` ± ${stat.se.toFixed(1)}`;
      process.stdout.write(
        `Δ ${SETUPS[name].label.padEnd(22)} ${stat.mean >= 0 ? "+" : ""}${stat.mean.toFixed(1)}${se} điểm  ${note}\n`,
      );
    };
    process.stdout.write("\n");
    report("village", 1, "(dương = làng học được mạnh hơn)");
    report("wolves", -1, "(dương = sói học được mạnh hơn)");
    report("all", 1, "(dương = làng thắng nhiều hơn khi CẢ BÀN dùng model)");
    report("teacher", 1, "(dương = bỏ jitter có lợi cho làng)");
    if (o.setups.includes("all") && o.setups.includes("teacher")) {
      const teacher = winsOf("teacher");
      const diffs = winsOf("all").map((v, i) => (v - teacher[i]!) * 100);
      const stat = pairedStats(diffs);
      paired["all-vs-teacher"] = stat;
      process.stdout.write(
        `Δ bản sao − teacher       ${stat.mean >= 0 ? "+" : ""}${stat.mean.toFixed(1)}` +
          `${Number.isNaN(stat.se) ? "" : ` ± ${stat.se.toFixed(1)}`} điểm` +
          "  (âm = bản sao chơi LÀNG kém hơn chính teacher nó chép)\n",
      );
    }
    process.stdout.write(
      "\n(± là sai số chuẩn của hiệu ghép theo seed; sàn nhiễu nhị thức ±" +
        `${((Math.sqrt(0.25 / o.games)) * 100).toFixed(1)} điểm/lô với ${o.games} ván)\n`,
    );
  }

  if (o.out) {
    writeFileSync(
      resolve(o.out),
      JSON.stringify({ model: policy.id, options: o, rows, summary, paired }, null, 2),
    );
  }
  // Một vi phạm bất biến làm hỏng mọi con số ở trên: policy đã gửi một nước
  // engine không chào, nên bảng này không đo cái nó nói là đang đo.
  if (rows.some((row) => row.violations > 0)) process.exitCode = 1;
}

main();
