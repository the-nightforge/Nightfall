import { describe, expect, it } from "vitest";
import { collectMetrics } from "../src/bot/evaluation/metrics";
import { runSelfPlay, type SelfPlayGame } from "../src/bot/evaluation/selfplay";
import type { RoomConfig } from "@masoi/shared";

const DECK: Partial<RoomConfig> = {
  werewolves: 2,
  seer: true,
  guard: true,
  witch: true,
  hunter: true,
  jester: true,
};

function play(seed: string): SelfPlayGame {
  return runSelfPlay({ seed, playerCount: 9, config: DECK, maxRounds: 20 });
}

function jesterOf(game: SelfPlayGame): string {
  const id = Object.entries(game.roles).find(([, role]) => role === "JESTER")?.[0];
  if (!id) throw new Error("ván này không có Thằng Hề");
  return id;
}

function jesterDeath(game: SelfPlayGame): string | null {
  const id = jesterOf(game);
  const death = game.events.find((e) => e.kind === "DEATH" && e.playerId === id);
  return death && death.kind === "DEATH" ? death.cause : null;
}

const winsOf = (games: SelfPlayGame[], role: string) =>
  collectMetrics(games).byRole.find((item) => item.role === role)?.wins;

describe("self-play mang theo thắng lợi cá nhân", () => {
  it("ván có Hề bị treo ghi lại thành tích đó", () => {
    /*
     * Ca hồi quy, tái hiện đúng seed đã đo: "jester-5", 9 người, bộ bài trên.
     * Hề p8 bị treo ở vòng 2 nhưng `SelfPlayGame` không hề mang thông tin ấy,
     * nên mọi tầng đo phía sau chỉ còn cách suy ra thắng thua từ `winner` -
     * và với một vai trung lập thì phép suy đó luôn cho ra "thua".
     */
    const game = play("jester-5");
    expect(jesterDeath(game)).toBe("lynch");
    expect(game.personalWins).toEqual([
      expect.objectContaining({ playerId: jesterOf(game), condition: "JESTER_LYNCHED", round: 2 }),
    ]);
  });

  it("ván Hề chết vì nguyên nhân khác hoặc sống tới cuối thì sổ rỗng", () => {
    const others = ["jester-0", "jester-1", "jester-2", "jester-3", "jester-4", "jester-6"]
      .map(play)
      .filter((game) => jesterDeath(game) !== "lynch");

    expect(others.length).toBeGreaterThan(0);
    for (const game of others) expect(game.personalWins).toEqual([]);
  });
});

describe("thống kê self-play tính đúng thắng của Thằng Hề", () => {
  it("Hề bị treo được tính là THẮNG, dù phe thắng chung là phe khác", () => {
    const game = play("jester-5");
    // Tiền đề của bài test: đây đúng là ván mà phe của Hề KHÔNG về nhất, nên
    // phép so `roleTeam(role) === winner` chắc chắn cho ra "thua".
    expect(game.winner).not.toBeNull();

    expect(winsOf([game], "JESTER")).toEqual(
      expect.objectContaining({ numerator: 1, denominator: 1 }),
    );
  });

  it("Hề KHÔNG bị treo thì không được tính thắng", () => {
    const game = ["jester-0", "jester-1", "jester-2", "jester-3", "jester-4", "jester-6"]
      .map(play)
      .find((item) => jesterDeath(item) !== "lynch")!;

    expect(winsOf([game], "JESTER")).toEqual(
      expect.objectContaining({ numerator: 0, denominator: 1 }),
    );
  });

  it("không đếm trùng: một ván là một lần thắng, không phải hai", () => {
    // `roleWins` đếm theo VÁN chứ không theo người chơi (xem chú thích ở
    // `collectMetrics`), và thắng cá nhân không được phá quy tắc đó.
    const games = [play("jester-5")];
    const wins = winsOf(games, "JESTER")!;

    expect(wins.numerator).toBe(1);
    expect(wins.numerator).toBeLessThanOrEqual(wins.denominator);
  });

  it("tỉ lệ thắng CHUNG của Dân và Sói không đổi vì thành tích cá nhân", () => {
    /*
     * Đây là ranh giới phải giữ: thắng cá nhân là một sổ riêng, nó không được
     * chảy vào `winRate` - con số trả lời câu hỏi "phe nào về nhất".
     */
    const games = ["jester-5", "jester-0", "jester-1", "jester-2"].map(play);
    const metrics = collectMetrics(games);
    const finished = games.filter((game) => game.winner !== null).length;
    const villageWins = games.filter((game) => game.winner === "village").length;

    expect(metrics.overall.winRate.village.numerator).toBe(villageWins);
    expect(metrics.overall.winRate.village.denominator).toBe(finished);
    expect(
      metrics.overall.winRate.village.numerator + metrics.overall.winRate.wolves.numerator,
    ).toBe(finished);
  });

  it("vai phe làng và phe Sói vẫn tính thắng theo phe như cũ", () => {
    const games = ["jester-5", "jester-0", "jester-1", "jester-2"].map(play);
    const metrics = collectMetrics(games);

    for (const role of ["SEER", "WEREWOLF"]) {
      const expectedWins = games.filter(
        (game) =>
          Object.values(game.roles).includes(role as never) &&
          game.winner === (role === "WEREWOLF" ? "wolves" : "village"),
      ).length;
      expect(metrics.byRole.find((item) => item.role === role)?.wins.numerator).toBe(expectedWins);
    }
  });

  it("dữ liệu cũ không có personalWins vẫn đọc được, chỉ là không ai thắng riêng", () => {
    // `SelfPlayGame` được ghi ra file JSON bởi `npm run selfplay -- --out`, nên
    // một báo cáo lưu trước bản này thiếu hẳn trường đó.
    const game = play("jester-5");
    const legacy = { ...game };
    delete (legacy as { personalWins?: unknown }).personalWins;

    expect(() => collectMetrics([legacy])).not.toThrow();
    expect(winsOf([legacy], "JESTER")).toEqual(
      expect.objectContaining({ numerator: 0, denominator: 1 }),
    );
  });
});
