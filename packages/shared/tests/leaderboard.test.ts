import { describe, expect, it } from "vitest";
import {
  LEADERBOARD_MIN_GAMES,
  LEADERBOARD_MIN_HUMANS,
  LEADERBOARD_POINTS,
  buildLeaderboard,
  matchPoints,
  type LeaderboardMatch,
  type MatchHistoryPlayer,
} from "../src/index";

const HUMANS = new Map([
  ["h1", { nickname: "An", avatarUrl: null }],
  ["h2", { nickname: "Bình", avatarUrl: "https://x/b.webp" }],
  ["h3", { nickname: "Chi", avatarUrl: null }],
  ["h4", { nickname: "Dũng", avatarUrl: null }],
]);

let n = 0;
function human(id: string, role: MatchHistoryPlayer["role"], alive = true, extra: Partial<MatchHistoryPlayer> = {}): MatchHistoryPlayer {
  return { id, name: HUMANS.get(id)?.nickname ?? id, role, alive, ...extra };
}
function bot(i: number): MatchHistoryPlayer {
  return { id: `bot-${i}`, name: `Bot ${i}`, role: "VILLAGER", alive: true };
}
function match(winner: string, players: MatchHistoryPlayer[], daysAgo = 1): LeaderboardMatch {
  n += 1;
  return { id: `m${n}`, winner, createdAt: new Date(Date.UTC(2026, 8, 30) - daysAgo * 86_400_000), playerRoles: players };
}

/** Bốn người thật + bot cho đủ; ai thắng tuỳ vai. */
function fullTable(winner: string, roles: Record<string, [MatchHistoryPlayer["role"], boolean]>, daysAgo = 1) {
  const humans = Object.entries(roles).map(([id, [role, alive]]) => human(id, role, alive));
  return match(winner, [...humans, bot(1), bot(2), bot(3), bot(4)], daysAgo);
}

const NOW = Date.UTC(2026, 8, 30);

describe("matchPoints", () => {
  it("thắng +10, sống sót +2, thắng cá nhân +5; thua và chết là 0", () => {
    expect(matchPoints({ role: "SEER", alive: true, winner: "village", personalWin: null })).toBe(
      LEADERBOARD_POINTS.win + LEADERBOARD_POINTS.survived,
    );
    expect(matchPoints({ role: "SEER", alive: false, winner: "village", personalWin: null })).toBe(LEADERBOARD_POINTS.win);
    expect(matchPoints({ role: "SEER", alive: false, winner: "wolves", personalWin: null })).toBe(0);
    expect(matchPoints({ role: "JESTER", alive: false, winner: "wolves", personalWin: { condition: "JESTER_LYNCHED", round: 2 } })).toBe(
      LEADERBOARD_POINTS.win + LEADERBOARD_POINTS.personalWin,
    );
  });

  it("kết cục không đọc được thì 0", () => {
    expect(matchPoints({ role: "SEER", alive: true, winner: "gibberish", personalWin: null })).toBe(0);
  });
});

describe("buildLeaderboard", () => {
  it("ván ít hơn 4 người thật không tính; ván đủ thì mỗi người thật được điểm theo vai mình", () => {
    const ok = fullTable("village", { h1: ["SEER", true], h2: ["WEREWOLF", false], h3: ["VILLAGER", true], h4: ["GUARD", false] });
    const tooFewHumans = match("village", [human("h1", "SEER"), human("h2", "SEER"), bot(1), bot(2), bot(3), bot(4), bot(5), bot(6)]);
    const rows = buildLeaderboard([ok, ok, ok, tooFewHumans], HUMANS, { now: NOW });
    const an = rows.find((r) => r.playerId === "h1")!;
    expect(an.games).toBe(3);
    expect(an.points).toBe(3 * (LEADERBOARD_POINTS.win + LEADERBOARD_POINTS.survived));
    const binh = rows.find((r) => r.playerId === "h2")!;
    expect(binh.points).toBe(0);
    expect(binh.wins).toBe(0);
  });

  it("cần đủ số ván tối thiểu mới lên bảng; xếp theo điểm, rồi tỉ lệ thắng, rồi số ván", () => {
    const t = (winner: string, daysAgo = 1) =>
      fullTable(winner, { h1: ["SEER", true], h2: ["WEREWOLF", true], h3: ["VILLAGER", false], h4: ["GUARD", false] }, daysAgo);
    // h1 thắng 3 ván sống cả 3: 36. h2 thua 3: 0. h3 thắng 3 nhưng chết: 30. h4 thắng 3 chết: 30.
    const rows = buildLeaderboard([t("village"), t("village"), t("village")], HUMANS, { now: NOW });
    expect(rows.map((r) => r.playerId)).toEqual(["h1", "h3", "h4", "h2"]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    // Hoà điểm h3/h4 -> hoà tỉ lệ -> hoà ván -> theo tên: Chi trước Dũng.
    expect(rows[1]!.nickname).toBe("Chi");

    const fewer = buildLeaderboard([t("village"), t("village")], HUMANS, { now: NOW });
    expect(fewer).toEqual([]);
    expect(LEADERBOARD_MIN_GAMES).toBe(3);
    expect(LEADERBOARD_MIN_HUMANS).toBe(4);
  });

  it("chỉ tính ván trong cửa sổ 30 ngày", () => {
    const t = (daysAgo: number) =>
      fullTable("village", { h1: ["SEER", true], h2: ["WEREWOLF", true], h3: ["VILLAGER", true], h4: ["GUARD", true] }, daysAgo);
    const rows = buildLeaderboard([t(1), t(2), t(3), t(31), t(60)], HUMANS, { now: NOW });
    expect(rows.find((r) => r.playerId === "h1")!.games).toBe(3);
  });

  it("mang biệt danh và ảnh từ bảng Player, không từ tên ghi trong ván", () => {
    const t = () => fullTable("village", { h1: ["SEER", true], h2: ["WEREWOLF", true], h3: ["VILLAGER", true], h4: ["GUARD", true] });
    const rows = buildLeaderboard([t(), t(), t()], HUMANS, { now: NOW });
    expect(rows.find((r) => r.playerId === "h2")).toMatchObject({ nickname: "Bình", avatarUrl: "https://x/b.webp" });
  });

  it("ván cũ không có id, hoặc vai lạ, bị bỏ qua mà không ném", () => {
    const weird = match("village", [
      { name: "Không id", role: "SEER", alive: true } as MatchHistoryPlayer,
      { id: "h1", name: "An", role: "GHOST" as MatchHistoryPlayer["role"], alive: true },
      human("h2", "SEER"), human("h3", "SEER"), human("h4", "SEER"),
    ]);
    expect(() => buildLeaderboard([weird], HUMANS, { now: NOW })).not.toThrow();
  });
});
