import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runBatch } from "@masoi/game-engine";
import { PRESET_DECKS, specialRoleList, type RoomConfig } from "@masoi/shared";

/**
 * Đo tỉ lệ thắng của preset - và của bộ bài ứng viên - như một ván xếp hạng
 * THẬT: speech bật, pha DEFENSE bật, events tắt (preset chạy mode "ranked").
 *
 * Ba lệnh con, cùng một file để workflow `preset-balance.yml` và máy dev gọi y
 * hệt nhau:
 *
 *   matrix --presets all|none|18,20 --candidates '<json>'   JSON matrix cho Actions
 *   run --n 20 --label preset-20 --games 125 --shard 0 [--override '{..}'] --out dir
 *   merge <dir>                                             bảng markdown
 *
 * Ứng viên là một preset cộng phần ghi đè, ví dụ
 *   [{"label":"18-3W+NR","n":18,"override":{"werewolves":3,"cursed":true}}]
 * Số Dân Làng luôn suy lại từ cỡ phòng trừ số lá đặc biệt.
 *
 * Seed chỉ phụ thuộc cỡ phòng và shard (`balance:<n>:<shard>`), KHÔNG phụ thuộc
 * nhãn: preset và mọi ứng viên cùng cỡ chạy đúng một bộ seed, nên cột Δ là so
 * cặp chứ không cộng thêm nhiễu của hai bộ seed khác nhau.
 */

interface Deck {
  label: string;
  n: number;
  override: Partial<RoomConfig>;
}

interface ShardResult {
  label: string;
  n: number;
  shard: number;
  games: number;
  village: number;
  wolves: number;
  /** Ván chạm trần vòng mà chưa phân thắng thua. */
  other: number;
  rounds: number;
  deck: string[];
  villagers: number;
}

const presetLabel = (n: number): string => `preset-${n}`;

function flag(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

function buildConfig(deck: Deck): RoomConfig {
  const base = PRESET_DECKS[deck.n];
  if (!base) throw new Error(`${deck.label}: không có preset ${deck.n} người`);
  // Một khoá gõ sai ("curse") không đổi gì mà vẫn ra một hàng số trông hợp lệ.
  const unknown = Object.keys(deck.override).filter((key) => !(key in base) && key !== "traitor");
  if (unknown.length > 0) throw new Error(`${deck.label}: khoá không nhận ra: ${unknown.join(", ")}`);

  const config = { ...base, ...deck.override } as RoomConfig;
  config.villagers = deck.n - specialRoleList(config).length;
  if (config.villagers < 1) throw new Error(`${deck.label}: không còn ghế Dân Làng`);
  return config;
}

function matrix(argv: readonly string[]): void {
  const presets = flag(argv, "--presets") ?? "all";
  const sizes =
    presets === "all"
      ? Object.keys(PRESET_DECKS).map(Number)
      : presets === "none"
        ? []
        : presets.split(",").map((s) => Number(s.trim()));

  const decks: Deck[] = sizes.map((n) => ({ label: presetLabel(n), n, override: {} }));
  const candidates = JSON.parse(flag(argv, "--candidates") || "[]") as Deck[];
  for (const c of candidates) decks.push({ label: c.label, n: Number(c.n), override: c.override ?? {} });

  const seen = new Set<string>();
  for (const deck of decks) {
    // Nhãn thành tên artifact và tên file, nên chỉ nhận ký tự an toàn cho cả hai.
    if (!/^[A-Za-z0-9._+-]+$/.test(deck.label)) throw new Error(`nhãn không hợp lệ: "${deck.label}"`);
    if (seen.has(deck.label)) throw new Error(`nhãn trùng: "${deck.label}"`);
    seen.add(deck.label);
    buildConfig(deck); // hỏng thì hỏng ở đây, trước khi tốn phút runner nào
  }
  if (decks.length === 0) throw new Error("không có bộ bài nào để đo");

  const include = decks.map((d) => ({ label: d.label, n: d.n, override: JSON.stringify(d.override) }));
  process.stdout.write(JSON.stringify({ include }));
}

function run(argv: readonly string[]): void {
  const n = Number(flag(argv, "--n"));
  const label = flag(argv, "--label") ?? presetLabel(n);
  const games = Number(flag(argv, "--games") ?? 50);
  const shard = Number(flag(argv, "--shard") ?? 0);
  const outDir = resolve(flag(argv, "--out") ?? "preset-balance-out");
  const override = JSON.parse(flag(argv, "--override") || "{}") as Partial<RoomConfig>;
  const config = buildConfig({ label, n, override });

  const played = runBatch({
    seedBase: `balance:${n}:${shard}`,
    games,
    playerCount: n,
    config,
    speech: true,
    defense: true,
    events: false,
    maxRounds: 20,
  });

  const result: ShardResult = {
    label,
    n,
    shard,
    games: played.length,
    village: played.filter((g) => g.winner === "village").length,
    wolves: played.filter((g) => g.winner === "wolves").length,
    other: played.filter((g) => g.winner !== "village" && g.winner !== "wolves").length,
    rounds: played.reduce((sum, g) => sum + g.rounds, 0),
    deck: specialRoleList(config),
    villagers: config.villagers ?? 0,
  };
  mkdirSync(outDir, { recursive: true });
  // Mỗi shard một file: nhiều process ghi nối chung một file thì dòng đè nhau.
  writeFileSync(join(outDir, `${label}__${shard}.json`), `${JSON.stringify(result)}\n`);
}

function compactDeck(deck: readonly string[], villagers: number): string {
  const counts = new Map<string, number>();
  for (const role of deck) counts.set(role, (counts.get(role) ?? 0) + 1);
  counts.set("VILLAGER", villagers);
  return [...counts].map(([role, c]) => (c > 1 ? `${role}×${c}` : role)).join(", ");
}

function merge(argv: readonly string[]): void {
  const dir = resolve(argv[0] ?? "preset-balance-out");
  const totals = new Map<string, ShardResult>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const r = JSON.parse(readFileSync(join(dir, file), "utf8")) as ShardResult;
    const acc = totals.get(r.label);
    if (!acc) totals.set(r.label, { ...r });
    else {
      acc.games += r.games;
      acc.village += r.village;
      acc.wolves += r.wolves;
      acc.other += r.other;
      acc.rounds += r.rounds;
    }
  }

  const rate = (r: ShardResult): number => (r.village / r.games) * 100;
  const rows = [...totals.values()].sort(
    (a, b) => a.n - b.n || Number(b.label === presetLabel(b.n)) - Number(a.label === presetLabel(a.n)) || a.label.localeCompare(b.label),
  );

  const lines = [
    "## Preset balance - tỉ lệ thắng phe Dân",
    "",
    "Bot đấu bot, speech + DEFENSE bật, events tắt. ✅ 45-55% · ⚠️ 40-60% · ❌ ngoài 40-60%. Δ là so cặp với preset cùng cỡ (cùng seed).",
    "",
    "| | Bộ bài | n | Ván | Dân thắng | ±95% | Δ preset | Hết vòng | Vòng TB | Thành phần |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---|",
  ];
  for (const r of rows) {
    const p = rate(r);
    const ci = 1.96 * Math.sqrt((p * (100 - p)) / r.games);
    const preset = totals.get(presetLabel(r.n));
    const delta = preset && preset !== r ? `${p - rate(preset) >= 0 ? "+" : ""}${(p - rate(preset)).toFixed(1)}` : "";
    const dist = Math.abs(p - 50);
    const mark = dist <= 5 ? "✅" : dist <= 10 ? "⚠️" : "❌";
    lines.push(
      `| ${mark} | ${r.label} | ${r.n} | ${r.games} | ${p.toFixed(1)}% | ${ci.toFixed(1)} | ${delta} | ${r.other} | ${(r.rounds / r.games).toFixed(1)} | ${compactDeck(r.deck, r.villagers)} |`,
    );
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

const [command, ...rest] = process.argv.slice(2);
if (command === "matrix") matrix(rest);
else if (command === "run") run(rest);
else if (command === "merge") merge(rest);
else {
  process.stderr.write("preset-balance.ts matrix | run | merge  (xem chú thích đầu file)\n");
  process.exit(1);
}
