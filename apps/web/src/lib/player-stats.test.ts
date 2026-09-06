import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerStats } from "@masoi/shared";
import { bestRoles, formatPercent, streakLabel, teamLine } from "./player-stats";

function stats(over: Partial<PlayerStats> = {}): PlayerStats {
  return {
    games: 10,
    wins: 6,
    winRate: 0.6,
    survived: 4,
    survivalRate: 0.4,
    currentStreak: 2,
    bestStreak: 3,
    personalWins: 1,
    byTeam: {
      village: { games: 6, wins: 4 },
      wolves: { games: 3, wins: 2 },
      neutral: { games: 1, wins: 0 },
    },
    byRole: [
      { role: "VILLAGER", games: 4, wins: 2 },
      { role: "SEER", games: 2, wins: 2 },
      { role: "WEREWOLF", games: 3, wins: 2 },
      { role: "JESTER", games: 1, wins: 0 },
    ],
    lastPlayedAt: 1,
    ...over,
  };
}

describe("formatPercent", () => {
  it("làm tròn về số nguyên, không có phần thập phân", () => {
    assert.equal(formatPercent(0.6), "60%");
    assert.equal(formatPercent(2 / 3), "67%");
    assert.equal(formatPercent(0), "0%");
  });
});

describe("bestRoles", () => {
  it("xếp theo số thắng, rồi tỉ lệ thắng; tối đa n vai; bỏ vai chưa thắng", () => {
    assert.deepEqual(
      bestRoles(stats(), 3).map((r) => r.role),
      ["SEER", "WEREWOLF", "VILLAGER"],
    );
    assert.deepEqual(bestRoles(stats(), 2).map((r) => r.role), ["SEER", "WEREWOLF"]);
  });

  it("chưa thắng vai nào thì rỗng", () => {
    assert.deepEqual(bestRoles(stats({ byRole: [{ role: "JESTER", games: 2, wins: 0 }] }), 3), []);
  });
});

describe("streakLabel", () => {
  it("đang có chuỗi thì nói chuỗi và kỷ lục", () => {
    assert.equal(streakLabel(stats()), "2 · kỷ lục 3");
  });
  it("hết chuỗi thì chỉ còn kỷ lục", () => {
    assert.equal(streakLabel(stats({ currentStreak: 0 })), "0 · kỷ lục 3");
  });
});

describe("teamLine", () => {
  it("chỉ kể phe đã chơi, theo thứ tự Dân, Sói, trung lập", () => {
    assert.deepEqual(teamLine(stats()), [
      { team: "village", label: "Dân", games: 6, wins: 4 },
      { team: "wolves", label: "Sói", games: 3, wins: 2 },
      { team: "neutral", label: "Trung lập", games: 1, wins: 0 },
    ]);
    const noNeutral = stats({
      byTeam: { village: { games: 1, wins: 1 }, wolves: { games: 0, wins: 0 }, neutral: { games: 0, wins: 0 } },
    });
    assert.deepEqual(teamLine(noNeutral).map((t) => t.team), ["village"]);
  });
});
