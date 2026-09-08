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
 * Chạy: npx tsx apps/server/scripts/role-power.ts [--games N] [--only N]...
 *
 * `--json` in ra số THÔ thay cho bảng chữ, để nhiều shard CI gộp lại được -
 * xem `role-power-merge.ts`. Hai cột "đo được"/"đang dùng" của bảng chữ dựng
 * trên vai làng mạnh nhất của CHÍNH lượt chạy, nên chúng vô nghĩa ở một shard
 * chỉ quét vài preset; JSON cố ý không mang chúng.
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
  ["TRACKER", "tracker"],
  ["MAYOR", "mayor"],
  ["ELDER", "elder"],
  ["SORCERER", "sorcerer"],
  ["ALPHA_WOLF", "alphaWolf"],
  ["DOPPELGANGER", "doppelganger"],
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
    /*
     * DEFENSE thảo luận tự do BẬT: mọi bot sống được nói trước bỏ phiếu
     * (Task 5 đo dưới luật mới; xem `SelfPlayInput.defense`).
     */
    defense: true,
    /*
     * BẬT, dù nó chạy chậm hơn nhiều.
     *
     * Bản cũ tắt với lý do "lời nói không đổi quyết định". Vế đó đúng cho CHÍNH
     * người nói - có bất biến `SPEECH_CHANGED_ACTION` gác - nhưng sai cho người
     * NGHE: bot khác đọc chat qua `chat-analysis`, và đó là kênh xác nhận chính
     * của phe làng.
     *
     * Đo so cặp trên cùng bộ seed, preset 12, 1500 ván mỗi nhánh: phe làng
     * thắng 54.4% với speech bật và 15.2% khi tắt (Δ 39.2 điểm, 19 sai số
     * chuẩn). Tắt lời nói không phải một phép rút gọn cho nhanh - nó là một trò
     * chơi khác, và một bảng `ROLE_POWER` đo trong đó không mô tả ván mà phòng
     * xếp hạng thực sự chơi.
     */
    speech: true,
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

  /*
   * `--only <n>` (lặp được): chỉ quét những cỡ phòng này.
   *
   * Một lượt quét đầy đủ với speech BẬT tốn gần ba giờ trên một luồng, và các
   * nhánh đo hoàn toàn độc lập nhau. Cờ này để chia việc ra nhiều tiến trình -
   * cột "Δ thắng" của một lượt `--only` đúng bằng số đo thô của cỡ phòng đó,
   * nên gộp lại bên ngoài được. Hai cột còn lại thì KHÔNG: chúng dựng trên vai
   * làng mạnh nhất của chính lượt chạy, nên chỉ có nghĩa ở lượt quét đầy đủ.
   */
  const only = new Set(
    argv.flatMap((arg, i) => (arg === "--only" ? [Number(argv[i + 1])] : [])),
  );
  if ([...only].some((n) => !Number.isFinite(n))) throw new Error("--only cần một số");

  /*
   * `--role <VAI>` (lặp được): chỉ đo những lá này, vẫn phải chạy nền để có
   * mốc trừ. Cùng mục đích với `--only` - chia một lượt quét dài ra nhiều
   * tiến trình - nhưng cắt theo chiều còn lại, cho những cỡ phòng mà riêng
   * một preset đã quá dài.
   */
  const roleFilter = new Set(
    argv.flatMap((arg, i) => (arg === "--role" ? [argv[i + 1]] : [])),
  );

  const asJson = argv.includes("--json");

  const deltas = new Map<Role, number[]>();
  const baselines: Array<[number, number]> = [];
  /** Số thô cho `--json`: mỗi (preset, vai) một dòng, chưa gộp gì. */
  const rawDeltas: Array<{ role: Role; playerCount: number; delta: number }> = [];

  for (const [countRaw, preset] of Object.entries(PRESET_DECKS)) {
    const playerCount = Number(countRaw);
    if (only.size > 0 && !only.has(playerCount)) continue;
    const seedBase = `power:${playerCount}`;
    // Tiến độ ra stderr: một lượt quét đầy đủ mất vài phút, và một tiến trình
    // im lặng hàng phút thì không phân biệt được với một tiến trình treo.
    process.stderr.write(`preset ${playerCount}... `);
    const base = villageWinRate(playerCount, preset, games, seedBase);
    baselines.push([playerCount, base]);

    for (const [role, key] of TOGGLES) {
      if (roleFilter.size > 0 && !roleFilter.has(role)) continue;
      if (preset[key] !== true) continue;
      /*
       * Gỡ một vai ra thì ghế đó phải thành một DÂN LÀNG, và giờ phải nói ra.
       *
       * Trước đây `buildRoleDeck` tự lấp phần còn thiếu nên dòng này không cần
       * làm gì. Từ khi `villagers` do host đặt, bộ bài phải khớp đúng số người -
       * thiếu một lá là engine ném ngay, và đó chính là phép so cặp mà cả bảng
       * `ROLE_POWER` dựng lên: "vai này đáng bao nhiêu SO VỚI một lá Dân Làng".
       */
      const without = {
        ...preset,
        [key]: false,
        ...(preset.villagers === undefined ? {} : { villagers: preset.villagers + 1 }),
      } as RoomConfig;
      const delta = base - villageWinRate(playerCount, without, games, seedBase);
      // Sói Con, Sói Pháp Sư và Sói Alpha nằm phe Sói: gỡ chúng ra thì phe làng
      // KHOẺ lên, nên dấu phải lật để "delta" ở mọi dòng đều đọc là "đóng góp
      // cho phe sở hữu nó".
      const owned = role === "WOLF_CUB" || role === "SORCERER" || role === "ALPHA_WOLF" ? -delta : delta;
      deltas.set(role, [...(deltas.get(role) ?? []), owned]);
      rawDeltas.push({ role, playerCount, delta: owned });
    }
    process.stderr.write(`làng thắng ${(base * 100).toFixed(1)}%
`);
  }

  if (asJson) {
    // stdout CHỈ có JSON: bước gộp parse trọn luồng, một dòng chữ lẫn vào là
    // hỏng cả bảng. Tiến độ vẫn ra stderr như thường.
    process.stdout.write(
      `${JSON.stringify(
        {
          games,
          presets: baselines.map(([playerCount, villageWinRate]) => ({
            playerCount,
            villageWinRate,
          })),
          deltas: rawDeltas,
        },
        null,
        2,
      )}
`,
    );
    return;
  }

  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

  process.stdout.write(`\nTỉ lệ thắng phe làng theo preset (${games} ván/preset)\n`);
  for (const [count, rate] of baselines) {
    const bar = "#".repeat(Math.round(rate * 40));
    process.stdout.write(`  ${String(count).padStart(2)} người  ${(rate * 100).toFixed(1).padStart(5)}%  ${bar}\n`);
  }

  // Neo vào vai LÀNG mạnh nhất, không phải vai mạnh nhất nói chung: Sói Con,
  // Sói Pháp Sư và Sói Alpha thuộc phe kia, và một thang dựng trên chúng sẽ
  // nén toàn bộ bảng vai làng.
  // Bảng cũ chỉ có nghĩa ở TỈ LỆ giữa các vai (điểm cân bằng dựng trên hiệu số),
  // nên giữ nguyên một điểm neo là cách đổi thang mà không phá mọi ngưỡng đã hiệu chỉnh.
  const entries = [...deltas.entries()].map(([role, xs]) => [role, mean(xs)] as const);
  const anchor = entries
    .filter(([role]) => role !== "WOLF_CUB" && role !== "SORCERER" && role !== "ALPHA_WOLF")
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
