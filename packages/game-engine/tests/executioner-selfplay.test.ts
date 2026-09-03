import { describe, expect, it } from "vitest";
import { runSelfPlay, type SelfPlayGame } from "../src/bot/evaluation/selfplay";
import { collectMetrics } from "../src/bot/evaluation/metrics";
import type { RoomConfig } from "@masoi/shared";

/**
 * Ván trọn vẹn có Kẻ Báo Thù, chạy qua đúng nhân mô phỏng của self-play.
 *
 * Các bài khác gọi thẳng từng hàm quyết định; bài này là lớp còn thiếu - nó
 * khẳng định rằng khi ghép tất cả lại thành một ván thật, vai này không kẹt,
 * không sinh nước đi bị engine từ chối, và cả hai đường kết thúc của nó (thắng
 * bằng nhiệm vụ, và hoá Thằng Hề) thật sự xảy ra trên bàn chứ không chỉ tồn tại
 * trong kiểu dữ liệu.
 *
 * 40 ván × seed cố định: tất định từng bit.
 */
const DECK: Partial<RoomConfig> = {
  werewolves: 2,
  seer: true,
  guard: true,
  witch: true,
  hunter: true,
  executioner: true,
};

const SEEDS = Array.from({ length: 40 }, (_, i) => `ex-${i}`);

function runBatch(config: Partial<RoomConfig>): SelfPlayGame[] {
  return SEEDS.map((seed) => runSelfPlay({ seed, playerCount: 9, config, maxRounds: 20 }));
}

const WITH_EXEC = runBatch(DECK);
const WITHOUT_EXEC = runBatch({ ...DECK, executioner: false });

function execIdOf(game: SelfPlayGame): string | undefined {
  // `game.roles` là bảng vai CUỐI ván, nên một Kẻ Báo Thù đã chuyển vai không
  // còn ở đây - đúng thứ hai bài dưới đây dựa vào để đếm hai đường riêng.
  return Object.entries(game.roles).find(([, role]) => role === "EXECUTIONER")?.[0];
}

describe("Kẻ Báo Thù trong ván self-play trọn vẹn", () => {
  it("không vi phạm bất biến nào", () => {
    /*
     * Bộ kiểm bất biến gồm cả ROLE_LEAK, DEAD_ROLE_REVEALED và SEER_RESULT_SCOPE,
     * nên dòng này cũng là phép kiểm "nhiệm vụ không rò ra chỗ nào nó không
     * được phép", chạy trên 40 ván đầy đủ thay vì một fixture dựng tay.
     */
    expect(WITH_EXEC.flatMap((game) => game.violations.map((item) => item.id))).toEqual([]);
  });

  it("mọi ván đều KẾT THÚC, không ván nào chạm trần vòng", () => {
    // Vai này không thêm nhánh nào vào `checkWin`, nên nó KHÔNG được kéo dài
    // ván - một con số khác 0 ở đây nghĩa là `settleExecutioner` đã cản đường
    // một kết cục.
    for (const game of WITH_EXEC) {
      expect(game.winner, game.record.seed).not.toBeNull();
    }
  });

  it("không sinh nước đi nào bị engine từ chối", () => {
    expect(WITH_EXEC.reduce((sum, game) => sum + game.rejected, 0)).toBe(0);
  });

  it("KHÔNG thêm một kết cục chung nào - vẫn đúng bốn giá trị cũ", () => {
    for (const game of WITH_EXEC) {
      expect(["village", "wolves", "serial_killer", "draw"], game.record.seed).toContain(
        game.winner,
      );
    }
    // Và bộ bài này không có Sát Nhân, nên kết cục đó không được xuất hiện.
    expect(WITH_EXEC.filter((game) => game.winner === "serial_killer")).toEqual([]);
  });

  it("cả hai đường của vai này đều xảy ra thật: thắng nhiệm vụ, và hoá Thằng Hề", () => {
    let targetLynched = 0;
    let turnedJester = 0;

    for (const game of WITH_EXEC) {
      if ((game.personalWins ?? []).some((win) => win.condition === "EXECUTIONER_TARGET_LYNCHED")) {
        targetLynched += 1;
      }
      // Chuyển vai đọc từ bảng vai cuối ván: không còn ai mang `EXECUTIONER`
      // nghĩa là người cầm lá đó đã hoá Thằng Hề giữa chừng.
      if (execIdOf(game) === undefined) turnedJester += 1;
    }

    /*
     * Nếu một trong hai con số này về 0 thì bàn cờ đã thoái hoá theo một hướng
     * đọc được: nhiệm vụ không bao giờ hoàn thành được, hoặc mục tiêu không bao
     * giờ chết bởi nguồn khác - và một trong hai nửa luật đang là chữ chết.
     */
    expect(targetLynched, "mục tiêu bị treo").toBeGreaterThan(0);
    expect(turnedJester, "hoá Thằng Hề").toBeGreaterThan(0);
  });

  it("thắng lợi cá nhân KHÔNG kết thúc ván", () => {
    // Ván có thành tích vẫn phải chạy tới một kết cục chung bình thường.
    const withWin = WITH_EXEC.filter((game) =>
      (game.personalWins ?? []).some((win) => win.condition === "EXECUTIONER_TARGET_LYNCHED"),
    );
    expect(withWin.length).toBeGreaterThan(0);
    for (const game of withWin) {
      expect(["village", "wolves", "draw"], game.record.seed).toContain(game.winner);
    }
  });

  it("mỗi người tối đa một thành tích, cả ván", () => {
    for (const game of WITH_EXEC) {
      const ids = (game.personalWins ?? []).map((win) => win.playerId);
      expect(new Set(ids).size, game.record.seed).toBe(ids.length);
    }
  });

  it("tái lập được: cùng seed cho cùng chuỗi sự kiện", () => {
    const again = runSelfPlay({ seed: SEEDS[0], playerCount: 9, config: DECK, maxRounds: 20 });
    expect(JSON.stringify(again.events)).toBe(JSON.stringify(WITH_EXEC[0].events));
    expect(again.winner).toBe(WITH_EXEC[0].winner);
    expect(JSON.stringify(again.personalWins)).toBe(JSON.stringify(WITH_EXEC[0].personalWins));
  });

  it("ván KHÔNG bật vai này chạy y như trước", () => {
    for (const game of WITHOUT_EXEC) {
      expect(["village", "wolves"], game.record.seed).toContain(game.winner);
      expect(game.personalWins ?? [], game.record.seed).toEqual([]);
    }
    expect(WITHOUT_EXEC.reduce((sum, game) => sum + game.rejected, 0)).toBe(0);
    expect(WITHOUT_EXEC.flatMap((game) => game.violations)).toEqual([]);
  });
});

describe("thống kê đếm hai thành tích RIÊNG nhau", () => {
  const bundle = collectMetrics(WITH_EXEC);

  it("thắng cá nhân của Kẻ Báo Thù KHÔNG bị cộng vào ô nào của bảng win rate", () => {
    const { winRate, finished } = bundle.overall;
    expect(
      winRate.village.numerator +
        winRate.wolves.numerator +
        winRate.serial_killer.numerator +
        winRate.draw.numerator,
    ).toBe(finished);
  });

  it("tỉ lệ thắng THEO VAI của Kẻ Báo Thù đọc từ sổ riêng, không từ phe", () => {
    /*
     * `roleTeam("EXECUTIONER")` là `"neutral"`, không bao giờ bằng `game.winner`.
     * Một phép so theo phe cho ra 0% cho một vai vẫn thắng được - và một con số
     * 0 trông y hệt một sự thật.
     */
    const row = bundle.byRole.find((item) => item.role === "EXECUTIONER");
    expect(row).toBeDefined();
    expect(row!.wins.numerator).toBeGreaterThan(0);
  });

  it("thành tích của Kẻ Báo Thù KHÔNG bị đếm thành thắng của Thằng Hề", () => {
    /*
     * Đây là điều kiện mà một phép đếm "mọi personalWin đều là của Hề" sẽ phá
     * vỡ. Bộ bài này KHÔNG bật Thằng Hề, nên mọi lá Hề trên bàn đều là kết quả
     * của một lần chuyển vai - và số ván có thành tích của Hề phải đếm đúng
     * những ván mà một con Hề (gốc hay chuyển vai) thật sự bị treo.
     */
    const execWinGames = WITH_EXEC.filter((game) =>
      (game.personalWins ?? []).some((win) => win.condition === "EXECUTIONER_TARGET_LYNCHED"),
    ).length;
    const jesterWinGames = WITH_EXEC.filter((game) =>
      (game.personalWins ?? []).some((win) => win.condition === "JESTER_LYNCHED"),
    ).length;

    const execRow = bundle.byRole.find((item) => item.role === "EXECUTIONER");
    expect(execRow!.wins.numerator).toBe(execWinGames);

    const jesterRow = bundle.byRole.find((item) => item.role === "JESTER");
    if (jesterRow) {
      // Hề chỉ có mặt qua chuyển vai ở bộ bài này, nên mọi thắng lợi của nó
      // đều là `JESTER_LYNCHED` - không có ván nào cộng nhầm sang.
      expect(jesterRow.wins.numerator).toBe(jesterWinGames);
    } else {
      expect(jesterWinGames).toBe(0);
    }
  });

  it("hai điều kiện không bao giờ trùng người trong một ván", () => {
    for (const game of WITH_EXEC) {
      for (const win of game.personalWins ?? []) {
        expect(["JESTER_LYNCHED", "EXECUTIONER_TARGET_LYNCHED"]).toContain(win.condition);
      }
    }
  });
});
