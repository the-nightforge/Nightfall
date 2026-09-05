import { runBatch } from "@masoi/game-engine";
import { PRESET_DECKS, type RoomConfig } from "@masoi/shared";

/**
 * Luật giấu vai người chết đang lấy đi bao nhiêu tỉ lệ thắng của phe làng?
 *
 * `ROLE_POWER` ghi lại một con số đáng báo động - mọi preset đo ra 14-41% cho
 * phe làng - rồi quy hết cho "lõi bot suy luận kém hơn người". Đó là một giả
 * thuyết hợp lý, và nó chưa từng được kiểm. Giả thuyết còn lại: chính luật
 * nghiêng. Ván này lấy đi gần hết nguồn XÁC NHẬN của phe làng - chết không lộ
 * vai, trọng số Thị Trưởng ẩn, phiếu Treo/Tha chỉ mở sau phán quyết - mà phe
 * làng sống bằng xác nhận còn phe Sói thì không cần.
 *
 * Bài đo tách được hai giả thuyết đó vì nó chỉ đổi ĐÚNG MỘT thứ: cờ
 * `revealRoleOnDeath`. Cùng preset, cùng bộ seed, cùng lõi bot. Chênh lệch còn
 * lại chỉ có thể đến từ luật.
 *
 * Đọc kết quả:
 * - Δ lớn và dương (làng nhảy lên quanh 45-50%): luật là thủ phạm chính, và
 *   "lộ vai khi chết" đáng được đưa lên bàn cân như một lựa chọn của phòng.
 * - Δ nhỏ: giả thuyết "bot yếu" đứng vững, và chỗ cần sửa là lõi suy luận chứ
 *   không phải luật.
 *
 * Cùng cảnh báo với `role-power.ts`: đây là BOT đánh BOT. Bot đọc bảng vai đã
 * lộ một cách máy móc và không biết diễn; người thật khai thác thông tin đó
 * nhiều hơn, nên Δ đo được ở đây là CẬN DƯỚI của Δ trên bàn người.
 *
 * KẾT QUẢ ĐO (2026-09-03, weights v6, 600 ván/nhánh/preset, seed cố định):
 *
 *   trung bình  28.1% -> 26.9%  (Δ -1.2 điểm), 8/10 preset ÂM.
 *
 * Trả lời: luật KHÔNG phải thủ phạm. Lộ vai người chết không kéo phe làng lên,
 * nó kéo xuống một chút - và điều đó có lý khi nhìn kỹ: thông tin lộ ra là
 * thông tin CHUNG, mà phe Sói vốn đã biết sự thật nên nó chỉ nhận thêm đúng một
 * thứ hữu ích - ai trong làng đang đọc ván tốt, tức nên cắn ai. Phe làng thì
 * nhận về một tín hiệu bị trải mỏng, vì đa số người bị treo là người phe làng.
 *
 * Vậy giả thuyết còn lại đứng vững: chỗ cần sửa là LÕI SUY LUẬN, không phải
 * luật. Đừng đưa "lộ vai khi chết" lên bàn cân như một lựa chọn cân bằng - nếu
 * có thêm nó thì thêm vì nó vui, không phải vì nó cứu phe làng.
 *
 * Lần đo đầu (trước khi có `bot/analysis/verdict-review.ts`) ra Δ = 0 TUYỆT ĐỐI
 * ở mọi preset: cờ tới được `botKnowledgeFor` nhưng không lõi nào biết dùng vai
 * người chết. Cảnh báo ở cuối hàm `main` giữ lại đúng để bắt trạng thái đó nếu
 * nó quay lại.
 *
 * Chạy: npx tsx apps/server/scripts/reveal-ab.ts [--games N]
 */

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
    // Sự kiện tắt vì cùng lý do với `role-power.ts`: chúng bơm phương sai vào
    // đúng thứ đang đo, và ranked vốn không có sự kiện nào.
    events: false,
    // Lời nói BẬT, xem chú thích dài ở `role-power.ts`: tắt nó kéo phe làng từ
    // 54.4% xuống 15.2% trên cùng bộ seed, tức đo một trò chơi khác.
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

  const rows: Array<[number, number, number]> = [];

  for (const [countRaw, preset] of Object.entries(PRESET_DECKS)) {
    const playerCount = Number(countRaw);
    // MỘT seedBase cho cả hai nhánh. Hai bộ seed khác nhau thì phần lớn chênh
    // lệch đo được là nhiễu xáo bài, không phải hiệu ứng của luật.
    const seedBase = `reveal:${playerCount}`;
    process.stderr.write(`preset ${playerCount}... `);

    const hidden = villageWinRate(playerCount, preset, games, seedBase);
    const revealed = villageWinRate(
      playerCount,
      { ...preset, revealRoleOnDeath: true },
      games,
      seedBase,
    );

    rows.push([playerCount, hidden, revealed]);
    process.stderr.write(
      `giấu ${(hidden * 100).toFixed(1)}% -> lộ ${(revealed * 100).toFixed(1)}%\n`,
    );
  }

  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

  process.stdout.write(`\nTỉ lệ thắng phe làng, giấu vai vs lộ vai (${games} ván/nhánh/preset)\n`);
  process.stdout.write(
    `  ${"cỡ phòng".padEnd(10)} ${"giấu".padStart(7)} ${"lộ".padStart(7)} ${"Δ".padStart(7)}\n`,
  );
  for (const [count, hidden, revealed] of rows) {
    const delta = revealed - hidden;
    process.stdout.write(
      `  ${(String(count) + " người").padEnd(10)} ${(hidden * 100).toFixed(1).padStart(6)}% ` +
        `${(revealed * 100).toFixed(1).padStart(6)}% ${(delta >= 0 ? "+" : "") + (delta * 100).toFixed(1)}%\n`.padStart(9),
    );
  }

  const avgHidden = mean(rows.map(([, hidden]) => hidden));
  const avgRevealed = mean(rows.map(([, , revealed]) => revealed));
  const avgDelta = avgRevealed - avgHidden;
  process.stdout.write(
    `\n  trung bình  ${(avgHidden * 100).toFixed(1)}% -> ${(avgRevealed * 100).toFixed(1)}%` +
      `  (Δ ${avgDelta >= 0 ? "+" : ""}${(avgDelta * 100).toFixed(1)} điểm)\n\n`,
  );

  // Δ đúng bằng 0 ở MỌI preset không phải là "hiệu ứng nhỏ" - nhiễu sẽ đẩy ít
  // nhất một dòng lệch đi. Nó là dấu hiệu của một bài đo không đo được gì, và
  // in ra +0.0% mà không nói gì thêm là cách chắc chắn nhất để người chạy sau
  // đọc nó thành "luật không phải thủ phạm".
  if (rows.every(([, hidden, revealed]) => hidden === revealed)) {
    process.stdout.write(
      "  ⚠ Δ bằng 0 tuyệt đối ở mọi preset: bài đo này CHƯA trả lời được câu hỏi.\n\n" +
        "  Cờ có tới nơi - `botKnowledgeFor` thật sự nhận thêm vai người chết\n" +
        "  (`revealRoleOnDeath đưa vai người chết vào knownRoles` trong\n" +
        "  packages/game-engine/tests/roles-actions.test.ts). Nhưng lõi quyết định\n" +
        "  chỉ tra `knownRoles` theo một mục tiêu ĐANG SỐNG: vote-decision,\n" +
        "  trial-decision, werewolf và claim-decision đều vậy. Không chỗ nào suy\n" +
        "  ngược từ một xác đã lộ vai - kiểu 'người này hoá ra là Dân, vậy kẻ đẩy\n" +
        "  phiếu treo họ đáng ngờ', hay 'lá soi của Tiên Tri lên xác này là đúng,\n" +
        "  vậy lời khai đó đã được kiểm chứng'.\n\n" +
        "  Nói cách khác: lõi bot hiện tại KHÔNG dùng được thông tin mà biến thể\n" +
        "  luật này cấp, nên nó đo ra 0 do cấu tạo chứ không do phát hiện. Muốn\n" +
        "  bài đo có nghĩa thì phải có suy luận hồi cố trước; chạy lại script này\n" +
        "  ngay sau đó.\n\n",
    );
  }
}

main();
