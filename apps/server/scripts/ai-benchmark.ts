import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PRESET_DECKS } from "@masoi/shared";
import {
  DEFAULT_BOT_WEIGHTS,
  loadMlpPolicy,
  runBatch,
  type LearnedSeats,
  type SelfPlayGame,
} from "@masoi/game-engine";

/**
 * Champion/challenger cho policy học được (BOT_SELF_LEARNING §24-§26).
 *
 * Ba cấu hình trên CÙNG seed: baseline (heuristic cả bàn), làng học được đấu
 * sói heuristic, sói học được đấu làng heuristic. Số cần đọc là tỉ lệ thắng
 * của LÀNG ở mỗi cấu hình so với baseline, và độ lệch giữa các seed — theo
 * kinh nghiệm của repo, 60 ván lệch ±10 điểm, 3×300 ván mới kết luận được ±3%.
 *
 * Vỏ I/O quanh nhân thuần, cùng ranh giới với mọi script khác ở đây:
 * `packages/game-engine` không chạm đĩa, nên việc mở file trọng số nằm ở đây.
 */

interface Options {
  model: string;
  games: number;
  repeat: number;
  seed: string;
  players: number;
  preset: boolean;
  defense: boolean;
  out: string | null;
}

function usage(): string {
  return [
    "npm run ai:benchmark -- --model <model.weights.json> [tuỳ chọn]",
    "",
    "  --model <path>   Bắt buộc. File JSON do ai-training xuất (masoi-mlp-1)",
    "  --games <n>      Số ván mỗi cấu hình mỗi seed (mặc định: 300)",
    "  --repeat <n>     Số seed (mặc định: 3)",
    "  --seed <text>    Tiền tố seed (mặc định: bench)",
    "  --players <n>    Số người mỗi bàn (mặc định: 8)",
    "  --no-preset      Không dùng bộ bài chuẩn của số người đó",
    "  --no-defense     Tắt vòng bào chữa",
    "  --out <path>     Ghi kết quả thô ra JSON",
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
    else throw new Error(`Tham số không nhận ra: ${a}\n\n${usage()}`);
  }
  if (!o.model) throw new Error(usage());
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

function main(): void {
  const o = parseArgs(process.argv.slice(2));
  const policy = loadMlpPolicy(JSON.parse(readFileSync(resolve(o.model), "utf8")));
  const config = o.preset ? PRESET_DECKS[o.players] : undefined;
  if (o.preset && !config) throw new Error(`Không có bộ bài chuẩn cho ${o.players} người`);

  const setups: Array<{ name: string; seats: LearnedSeats | null }> = [
    { name: "baseline (heuristic)", seats: null },
    { name: "làng học được", seats: "village" },
    { name: "sói học được", seats: "wolves" },
  ];
  const rows: Array<{
    setup: string;
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
        weights: DEFAULT_BOT_WEIGHTS,
        defense: o.defense,
        speech: true,
        learnedPolicy: setup.seats ? policy : undefined,
        learnedSeats: setup.seats ?? undefined,
      });
      const villageWin = villageWinRate(games);
      const violations = games.reduce((n, game) => n + game.violations.length, 0);
      rows.push({
        setup: setup.name,
        seed: seedBase,
        games: games.length,
        villageWin,
        unfinished: games.filter((game) => game.winner === null).length,
        violations,
      });
      process.stdout.write(
        `${setup.name.padEnd(22)} ${seedBase.padEnd(10)}` +
          ` làng thắng ${(villageWin * 100).toFixed(1)}%  vi phạm ${violations}\n`,
      );
    }
  }

  const summary = setups.map((setup) => {
    const mine = rows.filter((row) => row.setup === setup.name).map((row) => row.villageWin);
    const mean = mine.reduce((a, b) => a + b, 0) / mine.length;
    const spread = Math.max(...mine) - Math.min(...mine);
    return { setup: setup.name, villageWinMean: mean, spread };
  });

  process.stdout.write("\n");
  for (const s of summary) {
    process.stdout.write(
      `${s.setup.padEnd(22)} TB ${(s.villageWinMean * 100).toFixed(1)}%` +
        `  lệch giữa seed ${(s.spread * 100).toFixed(1)} điểm\n`,
    );
  }
  const base = summary[0]!.villageWinMean;
  process.stdout.write(
    `\nΔ làng học được  ${((summary[1]!.villageWinMean - base) * 100).toFixed(1)}` +
      " điểm (dương = làng học được mạnh hơn)\n",
  );
  process.stdout.write(
    `Δ sói học được   ${((base - summary[2]!.villageWinMean) * 100).toFixed(1)}` +
      " điểm (dương = sói học được mạnh hơn)\n",
  );

  if (o.out) {
    writeFileSync(
      resolve(o.out),
      JSON.stringify({ model: policy.id, options: o, rows, summary }, null, 2),
    );
  }
  // Một vi phạm bất biến làm hỏng mọi con số ở trên: policy đã gửi một nước
  // engine không chào, nên bảng này không đo cái nó nói là đang đo.
  if (rows.some((row) => row.violations > 0)) process.exitCode = 1;
}

main();
