import { runBatch } from "@masoi/game-engine";
import { PRESET_DECKS, ROLE_POWER, type Role, type RoomConfig } from "@masoi/shared";

/**
 * Đo giá trị THẬT của từng vai bằng self-play, để `ROLE_POWER` thôi là một bảng
 * số đoán tay.
 *
 * Cách đo là so cặp: chạy preset đúng như nó là, rồi chạy lại preset đó với một
 * vai bị gỡ ra - ghế trống tự thành Dân Làng - trên ĐÚNG bộ seed cũ. Chênh lệch
 * tỉ lệ thắng của phe làng giữa hai lần chính là phần mà vai đó đóng góp so với
 * một lá Dân Làng. Đó đúng bằng thứ `ROLE_POWER` phải mã hoá, vì bộ chấm cân
 * bằng chỉ dùng nó để đo ĐỘ LỆCH của một bộ bài so với preset.
 *
 * Dùng chung seed cho cả hai nhánh là điều bắt buộc chứ không phải tối ưu: hai
 * bộ seed khác nhau thì phần lớn chênh lệch đo được là nhiễu xáo bài.
 *
 * CẢNH BÁO khi đọc số: đây là BOT đánh BOT. Con số nói "lõi bot khai thác được
 * bao nhiêu từ vai này", không phải "người chơi khai thác được bao nhiêu". Vai
 * nào cần đọc vị và nói dối - Thị Trưởng, Kẻ Nguyền Rủa - sẽ bị đo thấp hơn giá
 * trị thật của nó trên bàn người.
 *
 * Chạy: npx tsx apps/server/scripts/role-power.ts [--games N]
 */

/** Các vai bật/tắt được, cùng khoá cấu hình của chúng. */
const TOGGLES: ReadonlyArray<[Role, keyof RoomConfig]> = [
  ["SEER", "seer"],
  ["GUARD", "guard"],
  ["WITCH", "witch"],
  ["HUNTER", "hunter"],
  ["CURSED", "cursed"],
  ["WOLF_CUB", "wolfCub"],
  ["APPRENTICE_SEER", "apprenticeSeer"],
  ["DETECTIVE", "detective"],
  ["GUARDIAN_ANGEL", "guardianAngel"],
  ["PRIEST", "priest"],
  ["MAYOR", "mayor"],
];

function villageWinRate(
  playerCount: number,
  config: RoomConfig,
  games: number,
  seedBase: string,
): number {
  const results = runBatch({
    seedBase,
    games,
    playerCount,
    config,
    // Sự kiện tắt: chúng bơm phương sai vào đúng thứ đang cần đo, và ranked -
    // chế độ mà bộ chấm cân bằng gác - vốn không có sự kiện nào.
    events: false,
    // Lời nói không đổi quyết định (lõi quyết trước, câu chữ dựng sau), nên tắt
    // đi chỉ để chạy nhanh hơn.
    speech: false,
  });

  const finished = results.filter((game) => game.winner !== null);
  if (finished.length === 0) return 0;
  return finished.filter((game) => game.winner === "village").length / finished.length;
}

function main(): void {
  const argv = process.argv.slice(2);
  const gamesFlag = argv.indexOf("--games");
  const games = gamesFlag >= 0 ? Number(argv[gamesFlag + 1]) : 300;
  if (!Number.isFinite(games) || games <= 0) throw new Error("--games cần một số dương");

  const deltas = new Map<Role, number[]>();
  const baselines: Array<[number, number]> = [];

  for (const [countRaw, preset] of Object.entries(PRESET_DECKS)) {
    const playerCount = Number(countRaw);
    const seedBase = `power:${playerCount}`;
    const base = villageWinRate(playerCount, preset, games, seedBase);
    baselines.push([playerCount, base]);

    for (const [role, key] of TOGGLES) {
      if (preset[key] !== true) continue;
      const without = { ...preset, [key]: false } as RoomConfig;
      const delta = base - villageWinRate(playerCount, without, games, seedBase);
      // Sói Con nằm phe Sói: gỡ nó ra thì phe làng KHOẺ lên, nên dấu phải lật để
      // "delta" ở mọi dòng đều đọc là "đóng góp cho phe sở hữu nó".
      const owned = role === "WOLF_CUB" ? -delta : delta;
      deltas.set(role, [...(deltas.get(role) ?? []), owned]);
    }
  }

  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

  process.stdout.write(`\nTỉ lệ thắng phe làng theo preset (${games} ván/preset)\n`);
  for (const [count, rate] of baselines) {
    const bar = "#".repeat(Math.round(rate * 40));
    process.stdout.write(`  ${String(count).padStart(2)} người  ${(rate * 100).toFixed(1).padStart(5)}%  ${bar}\n`);
  }

  // Neo vào vai LÀNG mạnh nhất, không phải vai mạnh nhất nói chung: Sói Con
  // thuộc phe kia, và một thang dựng trên nó sẽ nén toàn bộ bảng vai làng.
  // Bảng cũ chỉ có nghĩa ở TỈ LỆ giữa các vai (điểm cân bằng dựng trên hiệu số),
  // nên giữ nguyên một điểm neo là cách đổi thang mà không phá mọi ngưỡng đã hiệu chỉnh.
  const entries = [...deltas.entries()].map(([role, xs]) => [role, mean(xs)] as const);
  const anchor = entries
    .filter(([role]) => role !== "WOLF_CUB")
    .reduce((best, cur) => (cur[1] > best[1] ? cur : best));
  const villager = ROLE_POWER.VILLAGER;
  const scale = (ROLE_POWER[anchor[0]] - villager) / anchor[1];

  process.stdout.write(`\nĐóng góp biên so với một lá Dân Làng (neo: ${anchor[0]} = ${ROLE_POWER[anchor[0]]})\n`);
  process.stdout.write(`  ${"vai".padEnd(16)} ${"Δ thắng".padStart(9)}  ${"đo được".padStart(8)}  ${"đang dùng".padStart(9)}  mẫu\n`);
  for (const [role, delta] of entries.sort((a, b) => b[1] - a[1])) {
    const measured = villager + delta * scale;
    process.stdout.write(
      `  ${role.padEnd(16)} ${(delta * 100).toFixed(1).padStart(8)}%  ${measured.toFixed(1).padStart(8)}  ${String(ROLE_POWER[role]).padStart(9)}  ${deltas.get(role)!.length}\n`,
    );
  }
  process.stdout.write("\n");
}

main();
