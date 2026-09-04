import { describe, expect, it } from "vitest";
import { runSelfPlay, type SelfPlayGame } from "../src/bot/evaluation/selfplay";
import { collectMetrics } from "../src/bot/evaluation/metrics";
import { formatReportText, buildReport } from "../src/bot/evaluation/report";
import type { RoomConfig } from "@masoi/shared";

/**
 * Ván trọn vẹn có Sát Nhân, chạy qua đúng nhân mô phỏng của self-play.
 *
 * Các bài khác trong thư mục này gọi thẳng từng hàm quyết định; bài này là lớp
 * còn thiếu - nó khẳng định rằng khi ghép tất cả lại thành một ván thật, BOT Sát
 * Nhân không kẹt, không sinh nước đi bị engine từ chối, và ba kết cục mới thật
 * sự xảy ra trên bàn chứ không chỉ tồn tại trong kiểu dữ liệu.
 *
 * 40 ván × seed cố định: tất định từng bit.
 */
const DECK: Partial<RoomConfig> = {
  werewolves: 2,
  seer: true,
  guard: true,
  witch: true,
  hunter: true,
  serialKiller: true,
};

const SEEDS = Array.from({ length: 40 }, (_, i) => `sk-${i}`);

function runBatch(config: Partial<RoomConfig>): SelfPlayGame[] {
  return SEEDS.map((seed) => runSelfPlay({ seed, playerCount: 9, config, maxRounds: 20 }));
}

const WITH_KILLER = runBatch(DECK);
const WITHOUT_KILLER = runBatch({ ...DECK, serialKiller: false });

function killerIdOf(game: SelfPlayGame): string | undefined {
  return Object.entries(game.roles).find(([, role]) => role === "SERIAL_KILLER")?.[0];
}

describe("Sát Nhân trong ván self-play trọn vẹn", () => {
  it("không vi phạm bất biến nào", () => {
    /*
     * Bộ kiểm bất biến gồm cả ROLE_LEAK, DEAD_ROLE_REVEALED và SEER_RESULT_SCOPE,
     * nên dòng này cũng là phép kiểm "một vai trung lập giết người không rò ra
     * chỗ nào nó không được phép" - và cả "nó không bao giờ được cấp danh sách
     * đồng bọn nào".
     */
    expect(WITH_KILLER.flatMap((game) => game.violations.map((item) => item.id))).toEqual([]);
  });

  it("mọi ván đều KẾT THÚC, không ván nào chạm trần vòng", () => {
    /*
     * Đây là bài kiểm nhạy nhất của luật thắng mới. Nhánh "Sát Nhân còn sống thì
     * ván chạy tiếp" chèn thêm một điều kiện vào đúng chỗ ván đấu kết thúc; viết
     * hụt nó là một ván không bao giờ dừng, và trần vòng là thứ duy nhất bắt
     * được điều đó.
     */
    for (const game of WITH_KILLER) {
      expect(game.winner, game.record.seed).not.toBeNull();
    }
  });

  it("không sinh nước đi nào bị engine từ chối", () => {
    // `rejected` đếm những nước đi engine ném ra - tức lõi AI đã đề xuất một
    // thứ mà luật không cho.
    const rejected = WITH_KILLER.reduce((sum, game) => sum + game.rejected, 0);
    expect(rejected).toBe(0);
  });

  it("Sát Nhân THẬT SỰ giết người mỗi đêm", () => {
    const stabs = WITH_KILLER.reduce(
      (sum, game) =>
        sum +
        game.events.filter(
          (event) => event.kind === "NIGHT_ACTION" && event.action === "SERIAL_KILL",
        ).length,
      0,
    );
    // Trung bình phải hơn một nhát mỗi ván: một con số gần 0 nghĩa là lượt đêm
    // của vai này đang rơi vào khoảng không.
    expect(stabs).toBeGreaterThan(SEEDS.length);
  });

  it("cả ba kết cục đều xảy ra: Sát Nhân thắng, và nó cũng thua", () => {
    const outcomes = WITH_KILLER.map((game) => game.winner);
    const killerWins = outcomes.filter((winner) => winner === "serial_killer").length;

    // Chiến thuật CHẠY: nó thắng được thật.
    expect(killerWins).toBeGreaterThan(0);
    // Và nó KHÔNG thống trị: làng và Sói vẫn thắng được.
    expect(outcomes.filter((winner) => winner === "village").length).toBeGreaterThan(0);
    expect(outcomes.filter((winner) => winner === "wolves").length).toBeGreaterThan(0);
    expect(killerWins).toBeLessThan(SEEDS.length);
  });

  it("Sát Nhân vừa chết vì đêm, vừa bị treo, vừa sống sót", () => {
    let lynched = 0;
    let killedAtNight = 0;
    let survived = 0;

    for (const game of WITH_KILLER) {
      const killerId = killerIdOf(game);
      if (!killerId) continue;
      const death = game.events.find(
        (event) => event.kind === "DEATH" && event.playerId === killerId,
      );
      if (!death) survived += 1;
      else if (death.kind === "DEATH" && death.cause === "lynch") lynched += 1;
      else killedAtNight += 1;
    }

    /*
     * Nếu một trong ba con số này về 0 thì bàn cờ đã thoái hoá theo một hướng
     * đọc được: nó vô hình tuyệt đối (không bao giờ bị treo), nó lộ liễu tới
     * mức luôn bị treo trước khi ai kịp chạm tới, hoặc nó bất tử.
     */
    expect(lynched, "bị treo").toBeGreaterThan(0);
    expect(survived, "sống tới cuối").toBeGreaterThan(0);
    expect(lynched + killedAtNight + survived).toBe(SEEDS.length);
  });

  it("tái lập được: cùng seed cho cùng chuỗi sự kiện", () => {
    const again = runSelfPlay({ seed: SEEDS[0], playerCount: 9, config: DECK, maxRounds: 20 });
    expect(JSON.stringify(again.events)).toBe(JSON.stringify(WITH_KILLER[0].events));
    expect(again.winner).toBe(WITH_KILLER[0].winner);
  });

  it("ván KHÔNG bật Sát Nhân không mọc thêm kết cục nào", () => {
    for (const game of WITHOUT_KILLER) {
      expect(["village", "wolves"], game.record.seed).toContain(game.winner);
    }
    expect(WITHOUT_KILLER.reduce((sum, game) => sum + game.rejected, 0)).toBe(0);
  });
});

describe("thống kê đọc đúng kết cục mới", () => {
  const bundle = collectMetrics(WITH_KILLER);

  it("bốn ô win rate cộng lại đúng bằng số ván đã kết thúc", () => {
    const { winRate, finished } = bundle.overall;
    const total =
      winRate.village.numerator +
      winRate.wolves.numerator +
      winRate.serial_killer.numerator +
      winRate.draw.numerator;
    expect(total).toBe(finished);
    // Mỗi ô mang đúng mẫu số của nó: một tỉ lệ không có mẫu số không kiểm
    // chứng được.
    for (const ratio of Object.values(winRate)) {
      expect(ratio.denominator).toBe(finished);
    }
  });

  it("ván Sát Nhân thắng KHÔNG bị cộng vào ô của Dân hay Sói", () => {
    const killerWins = WITH_KILLER.filter((game) => game.winner === "serial_killer").length;
    expect(bundle.overall.winRate.serial_killer.numerator).toBe(killerWins);

    const villageWins = WITH_KILLER.filter((game) => game.winner === "village").length;
    expect(bundle.overall.winRate.village.numerator).toBe(villageWins);
    expect(bundle.byTeam.village.wins.numerator).toBe(villageWins);
  });

  it("tỉ lệ thắng THEO VAI của Sát Nhân đọc từ kết cục, không từ phe", () => {
    const row = bundle.byRole.find((item) => item.role === "SERIAL_KILLER");
    expect(row).toBeDefined();
    expect(row!.games).toBe(SEEDS.length);
    /*
     * `roleTeam("SERIAL_KILLER")` là `"neutral"`, không bao giờ bằng
     * `game.winner`. Một phép so theo phe cho ra 0% cho đúng vai duy nhất tự
     * thắng được cả ván - và một con số 0 trông y hệt một sự thật.
     */
    expect(row!.wins.numerator).toBeGreaterThan(0);
    expect(row!.wins.numerator).toBe(
      WITH_KILLER.filter((game) => game.winner === "serial_killer").length,
    );
  });

  it("Thằng Hề thắng cá nhân KHÔNG bị trộn vào ô nào của bảng win rate", () => {
    const jesterDeck = { ...DECK, jester: true };
    const games = SEEDS.slice(0, 20).map((seed) =>
      runSelfPlay({ seed, playerCount: 10, config: jesterDeck, maxRounds: 20 }),
    );
    const metrics = collectMetrics(games);

    const jesterWins = games.filter((game) =>
      (game.personalWins ?? []).some((win) => win.role === "JESTER"),
    ).length;
    const jesterRow = metrics.byRole.find((item) => item.role === "JESTER");

    // Sổ thành tích cá nhân đi vào `roleWins`...
    expect(jesterRow!.wins.numerator).toBeGreaterThanOrEqual(jesterWins);
    // ...nhưng KHÔNG vào bảng "phe nào về nhất".
    const { winRate, finished } = metrics.overall;
    expect(
      winRate.village.numerator +
        winRate.wolves.numerator +
        winRate.serial_killer.numerator +
        winRate.draw.numerator,
    ).toBe(finished);
  });

  it("báo cáo văn bản in ra cả hai dòng mới, kể cả khi bằng 0", () => {
    const text = formatReportText(
      buildReport({ seedBase: "sk", games: WITH_KILLER.length }, WITH_KILLER),
    );
    // In cả khi bằng 0: một dòng vắng mặt thì người đọc sẽ cộng ba con số đầu
    // rồi tưởng chúng phải bằng 100%.
    expect(text).toContain("Sát Nhân thắng");
    expect(text).toContain("Hoà");
    expect(text).toContain("SERIAL_KILLER");
  });
});
