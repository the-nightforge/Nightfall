import { describe, expect, it } from "vitest";
import { computePlayerStats, type MatchHistoryEntry } from "../src/index";

let seq = 0;
function entry(over: Partial<MatchHistoryEntry>): MatchHistoryEntry {
  seq += 1;
  return {
    id: `m${seq}`,
    roomCode: "ABCDE",
    winner: "village",
    rounds: 3,
    durationSec: 600,
    endedAt: 1_000_000 - seq * 1000,
    myRole: "VILLAGER",
    mySurvived: true,
    myPersonalWin: null,
    players: [],
    caseFile: null,
    ...over,
  };
}

describe("computePlayerStats", () => {
  it("không có ván nào thì mọi số là 0 và không có vai", () => {
    const s = computePlayerStats([]);
    expect(s.games).toBe(0);
    expect(s.winRate).toBe(0);
    expect(s.byRole).toEqual([]);
    expect(s.lastPlayedAt).toBeNull();
  });

  it("thắng đọc theo phe của vai so với kết cục, đúng luật của lịch sử", () => {
    const s = computePlayerStats([
      entry({ myRole: "SEER", winner: "village" }),
      entry({ myRole: "WEREWOLF", winner: "village" }),
      entry({ myRole: "WEREWOLF", winner: "wolves" }),
    ]);
    expect(s.games).toBe(3);
    expect(s.wins).toBe(2);
    expect(s.winRate).toBeCloseTo(2 / 3, 5);
    expect(s.byTeam.village).toEqual({ games: 1, wins: 1 });
    expect(s.byTeam.wolves).toEqual({ games: 2, wins: 1 });
  });

  it("thắng cá nhân là thắng, kể cả khi phe thua hay ván hoà", () => {
    const s = computePlayerStats([
      entry({ myRole: "JESTER", winner: "wolves", myPersonalWin: { condition: "JESTER_LYNCHED", round: 2 } }),
      entry({ myRole: "EXECUTIONER", winner: "draw", myPersonalWin: { condition: "EXECUTIONER_TARGET_LYNCHED", round: 1 } }),
      entry({ myRole: "JESTER", winner: "village" }),
    ]);
    expect(s.wins).toBe(2);
    expect(s.personalWins).toBe(2);
    expect(s.byTeam.neutral).toEqual({ games: 3, wins: 2 });
  });

  it("Sát Nhân thắng cả ván là thắng của vai đó, không phải của phe trung lập nào khác", () => {
    const s = computePlayerStats([
      entry({ myRole: "SERIAL_KILLER", winner: "serial_killer" }),
      entry({ myRole: "JESTER", winner: "serial_killer" }),
    ]);
    expect(s.wins).toBe(1);
  });

  it("ván cũ không có vai của mình, hoặc kết cục không đọc được, bị bỏ qua", () => {
    const s = computePlayerStats([
      entry({ myRole: null, mySurvived: null }),
      entry({ myRole: "SEER", winner: "unknown" }),
      entry({ myRole: "SEER", winner: "village" }),
    ]);
    expect(s.games).toBe(1);
    expect(s.wins).toBe(1);
  });

  it("chuỗi thắng hiện tại đếm từ ván mới nhất; chuỗi dài nhất tính theo thời gian", () => {
    // Thứ tự vào cố ý lộn xộn: hàm phải tự sắp theo endedAt.
    const s = computePlayerStats([
      entry({ endedAt: 5, winner: "village" }),
      entry({ endedAt: 1, winner: "village" }),
      entry({ endedAt: 2, winner: "village" }),
      entry({ endedAt: 3, winner: "village" }),
      entry({ endedAt: 4, winner: "wolves" }),
      entry({ endedAt: 6, winner: "village" }),
    ]);
    expect(s.currentStreak).toBe(2);
    expect(s.bestStreak).toBe(3);
    expect(s.lastPlayedAt).toBe(6);
  });

  it("thua ván mới nhất thì chuỗi hiện tại là 0", () => {
    const s = computePlayerStats([
      entry({ endedAt: 2, winner: "wolves" }),
      entry({ endedAt: 1, winner: "village" }),
    ]);
    expect(s.currentStreak).toBe(0);
    expect(s.bestStreak).toBe(1);
  });

  it("sống sót đếm theo mySurvived; ván không biết thì không tính vào mẫu", () => {
    const s = computePlayerStats([
      entry({ mySurvived: true }),
      entry({ mySurvived: false }),
      entry({ mySurvived: false }),
    ]);
    expect(s.survived).toBe(1);
    expect(s.survivalRate).toBeCloseTo(1 / 3, 5);
  });

  it("theo vai: xếp theo số ván giảm dần, rồi số thắng", () => {
    const s = computePlayerStats([
      entry({ myRole: "SEER", winner: "village" }),
      entry({ myRole: "SEER", winner: "wolves" }),
      entry({ myRole: "WEREWOLF", winner: "wolves" }),
      entry({ myRole: "WEREWOLF", winner: "wolves" }),
      entry({ myRole: "GUARD", winner: "village" }),
    ]);
    expect(s.byRole.map((r) => [r.role, r.games, r.wins])).toEqual([
      ["WEREWOLF", 2, 2],
      ["SEER", 2, 1],
      ["GUARD", 1, 1],
    ]);
  });
});
