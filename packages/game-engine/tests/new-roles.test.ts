import { describe, expect, it } from "vitest";
import { GameEngine } from "../src/engine";
import type { EnginePlayer, GameState, NightState } from "../src/types";
import { DEFAULT_ROOM_CONFIG, type Role } from "@masoi/shared";

/**
 * Trưởng Lão và Kẻ Song Trùng.
 *
 * Hai lá thêm vào để bàn 17-20 người bớt dân thường. Lá đầu là cơ chế mới
 * hoàn toàn; lá thứ hai là lần thứ TƯ của một khuôn đã có (Nguyền Rủa, Phản Bội,
 * Báo Thù đều đổi `role` giữa ván), nên phần lớn test ở đây hỏi đúng một câu:
 * khuôn đó có còn đúng khi vai mới đi qua nó không.
 *
 * (Bà Đồng đã bị xóa cứng khỏi engine cùng Linh Mục — xem plan Sorcerer+Alpha.)
 */

function emptyNight(): NightState {
  return {
    wolfVotes: {},
    killTarget: null,
    wolvesLocked: false,
    guardTarget: null,
    guardSecondTarget: null,
    healTonight: false,
    poisonTarget: null,
    witchSkipped: false,
    seerResults: {},
    wolfSecondaryTarget: null,
    wolfCubRageTonight: false,
    guardianAngelTarget: null,
    detectiveTargets: null,
    detectiveResults: {},
    sorcererResults: {},
  };
}

function stateWith(players: Array<[string, Role, boolean?]>): GameState {
  return {
    deadCanSpeakChosenId: null,
    phase: "NIGHT",
    round: 1,
    phaseEndsAt: 30_000,
    phaseStartedAt: 0,
    voteMutations: [],
    dayVoteHistory: [],
    trial: null,
    lastTrial: null,
    players: players.map(([id, role, alive]) => ({
      id,
      name: id,
      role,
      alive: alive ?? true,
      isBot: false,
    })) as EnginePlayer[],
    config: { ...DEFAULT_ROOM_CONFIG, werewolves: 1, hunter: false },
    winner: null,
    night: emptyNight(),
    votes: {},
    guardPrevious: null,
    healUsed: false,
    poisonUsed: false,
    lastNightDeaths: [],
    nightHistory: [],
    lastEliminated: null,
    hunterReaction: null,
    hunterShots: [],
    guardianAngelPrevious: null,
    guardianAngelCharges: {},
    alphaShieldUsed: {},
    apprenticeAwakened: false,
    wolfCubRageNextNight: false,
    activeEvent: null,
    eventHistory: [],
    log: [],
    pendingLastStandVictim: null,
    bloodMoonArmed: false,
    bloodMoonUsed: false,
    deadCanSpeakUsed: false,
    howlBonusDay: null,
    dayOfTruthClaims: {},
  } as GameState;
}

const engineWith = (players: Array<[string, Role, boolean?]>) =>
  new GameEngine(stateWith(players));

/** Treo cổ một người: đề cử, biện hộ, rồi cả làng bỏ phiếu Treo. */
function lynch(e: GameEngine, targetId: string): void {
  e.setPhase("VOTING", 30_000);
  for (const voter of e.state.players.filter((p) => p.alive && p.id !== targetId)) {
    e.submitVote(voter.id, targetId);
  }
  e.resolveNomination(25_000, 30_000);
  e.beginFinalVote(20_000);
  for (const voter of e.finalVoters()) e.submitFinalVote(voter.id, true);
  e.resolveFinalVote();
}

const roleOf = (e: GameEngine, id: string) =>
  e.state.players.find((p) => p.id === id)!.role;
const aliveOf = (e: GameEngine, id: string) =>
  e.state.players.find((p) => p.id === id)!.alive;

describe("Trưởng Lão", () => {
  const roster: Array<[string, Role, boolean?]> = [
    ["wolf", "WEREWOLF"],
    ["elder", "ELDER"],
    ["seer", "SEER"],
    ["v1", "VILLAGER"],
  ];

  it("sống sót nhát cắn đầu tiên, chết ở nhát thứ hai", () => {
    const e = engineWith(roster);
    e.submitNightAction("wolf", "KILL", "elder");
    expect(e.resolveNight(Date.now(), () => 0.9)).toHaveLength(0);
    expect(aliveOf(e, "elder")).toBe(true);
    expect(e.state.elderBiteSurvived).toBe(true);

    e.setPhase("DAY_DISCUSSION", 30_000);
    e.setPhase("NIGHT", 30_000);
    e.submitNightAction("wolf", "KILL", "elder");
    expect(e.resolveNight(Date.now(), () => 0.9).map((d) => d.playerId)).toContain("elder");
  });

  it("tấm đệm chỉ chắn MỘT nhát, kể cả khi cả hai rơi vào cùng một đêm", () => {
    // Đêm Sói Con nổi giận: hai mục tiêu trong một vòng lặp. Cờ phải bật ngay
    // tại nhát đầu, nếu không thì một tấm đệm chắn được cả hai.
    const e = engineWith([
      ["wolf", "WEREWOLF"],
      ["elder", "ELDER"],
      ["v1", "VILLAGER"],
      ["v2", "VILLAGER"],
    ]);
    e.state.night.wolfCubRageTonight = true;
    e.submitNightAction("wolf", "KILL", "elder", "v1");
    const deaths = e.resolveNight(Date.now(), () => 0.9);

    expect(aliveOf(e, "elder")).toBe(true);
    expect(deaths.map((d) => d.playerId)).toContain("v1");
  });

  it("bị bầy Sói cắn chết KHÔNG tắt kỹ năng phe làng", () => {
    // Nếu mọi cái chết đều kích bẫy, bầy Sói chỉ cần cắn Trưởng Lão hai đêm là
    // tắt sạch vế làng - một nước đi trội tuyệt đối.
    const e = engineWith(roster);
    e.state.elderBiteSurvived = true;
    e.submitNightAction("wolf", "KILL", "elder");
    e.resolveNight(Date.now(), () => 0.9);

    expect(e.state.villagePowersLostRound).toBe(null);
    expect(e.hasNightAction("SEER")).toBe(true);
  });

  it("bị làng treo cổ thì tắt kỹ năng phe làng ĐÚNG một vòng, không đụng phe Sói", () => {
    const e = engineWith(roster);
    expect(e.state.round).toBe(1);
    lynch(e, "elder");

    expect(aliveOf(e, "elder")).toBe(false);
    expect(e.state.villagePowersLostRound).toBe(2);
    // Bản án rơi vào cuối ngày 1 và ngày đó kết thúc ngay sau đó, nên vòng đang
    // chạy không bị đụng - hình phạt bắt đầu từ đêm kế tiếp.
    expect(e.hasNightAction("SEER")).toBe(true);

    e.setPhase("NIGHT", 30_000);
    expect(e.state.round).toBe(2);
    expect(e.hasNightAction("SEER")).toBe(false);
    expect(e.hasNightAction("WEREWOLF")).toBe(true);
  });

  it("hình phạt HẾT HẠN sau đúng một đêm và một ngày", () => {
    // Vế quan trọng nhất của lần làm lại: bản cũ tắt tới hết ván, và đo ra 39%
    // số ván ở preset 17-20 mất sạch kỹ năng làng - gần như luôn do treo nhầm.
    const e = engineWith(roster);
    lynch(e, "elder");

    e.setPhase("NIGHT", 30_000);
    expect(e.hasNightAction("SEER")).toBe(false);
    e.setPhase("DAY_DISCUSSION", 30_000);
    expect(e.state.round).toBe(2);

    e.setPhase("NIGHT", 30_000);
    expect(e.state.round).toBe(3);
    expect(e.hasNightAction("SEER")).toBe(true);
    expect(() => e.submitNightAction("seer", "SEE", "wolf")).not.toThrow();
  });

  it("kỹ năng đã tắt thì engine từ chối hành động đêm của phe làng", () => {
    const e = engineWith(roster);
    e.state.villagePowersLostRound = e.state.round;
    expect(() => e.submitNightAction("seer", "SEE", "wolf")).toThrow(/mất hiệu lực/);
    // Bầy Sói vẫn cắn bình thường.
    expect(() => e.submitNightAction("wolf", "KILL", "v1")).not.toThrow();
  });

  it("kỹ năng đã tắt thì Thị Trưởng hết trọng số x2", () => {
    const e = engineWith([
      ["wolf", "WEREWOLF"],
      ["mayor", "MAYOR"],
      ["elder", "ELDER"],
      ["v1", "VILLAGER"],
    ]);
    e.setPhase("VOTING", 30_000);
    e.submitVote("mayor", "wolf");
    expect(e.voteTally().players.wolf).toBe(2);

    e.state.villagePowersLostRound = e.state.round;
    expect(e.voteTally().players.wolf).toBe(1);
  });
});

describe("Ván cũ mang vai đã xóa", () => {
  it("role lạ nạp lại thành Dân Làng và ghi log, ván vẫn chạy", () => {
    const e = engineWith([
      ["wolf", "WEREWOLF"],
      ["old", "PRIEST" as unknown as Role],
      ["older", "MEDIUM" as unknown as Role],
      ["v1", "VILLAGER"],
    ]);
    expect(roleOf(e, "old")).toBe("VILLAGER");
    expect(roleOf(e, "older")).toBe("VILLAGER");
    expect(e.state.log.some((line) => line.includes("không còn tồn tại"))).toBe(true);
    // Người bị chuyển vai hành xử đúng như Dân: không có lượt đêm nào.
    expect(e.snapshotFor("old").nightInfo).toBeNull();
    expect(() => e.submitNightAction("wolf", "KILL", "v1")).not.toThrow();
  });
});

describe("Kẻ Song Trùng", () => {
  it("hoá thành vai của người chết ĐẦU TIÊN", () => {
    const e = engineWith([
      ["wolf", "WEREWOLF"],
      ["dop", "DOPPELGANGER"],
      ["seer", "SEER"],
      ["v1", "VILLAGER"],
    ]);
    e.submitNightAction("wolf", "KILL", "seer");
    e.resolveNight(Date.now(), () => 0.9);
    e.settleDoppelganger();

    expect(roleOf(e, "dop")).toBe("SEER");
    expect(e.state.players.find((p) => p.id === "dop")!.doppelgangerTurned).toBe(true);
  });

  it("sao chép trúng phe Sói thì ĐỔI PHE thật", () => {
    const e = engineWith([
      ["wolf", "WEREWOLF"],
      ["wolf2", "WEREWOLF"],
      ["dop", "DOPPELGANGER"],
      ["seer", "SEER"],
      ["v1", "VILLAGER"],
    ]);
    lynch(e, "wolf");
    e.settleDoppelganger();

    expect(roleOf(e, "dop")).toBe("WEREWOLF");
  });

  it("sao chép trúng Kẻ Báo Thù thì hoá Thằng Hề, không phải Kẻ Báo Thù", () => {
    // Dùng lại đúng luật `settleExecutioner` đã có cho một Kẻ Báo Thù mất mục
    // tiêu: một bản sao không có tên trong `executionerTargets` chính là ca đó.
    const e = engineWith([
      ["wolf", "WEREWOLF"],
      ["dop", "DOPPELGANGER"],
      ["exe", "EXECUTIONER"],
      ["v1", "VILLAGER"],
    ]);
    e.submitNightAction("wolf", "KILL", "exe");
    e.resolveNight(Date.now(), () => 0.9);
    e.settleDoppelganger();

    expect(roleOf(e, "dop")).toBe("JESTER");
  });

  it("chưa ai chết thì chưa hoá vai", () => {
    const e = engineWith([
      ["wolf", "WEREWOLF"],
      ["dop", "DOPPELGANGER"],
      ["v1", "VILLAGER"],
      ["v2", "VILLAGER"],
    ]);
    e.settleDoppelganger();
    expect(roleOf(e, "dop")).toBe("DOPPELGANGER");
  });

  it("chính nó chết đầu tiên thì không hoá vai", () => {
    const e = engineWith([
      ["wolf", "WEREWOLF"],
      ["dop", "DOPPELGANGER"],
      ["v1", "VILLAGER"],
      ["v2", "VILLAGER"],
    ]);
    e.submitNightAction("wolf", "KILL", "dop");
    e.resolveNight(Date.now(), () => 0.9);
    e.settleDoppelganger();

    expect(roleOf(e, "dop")).toBe("DOPPELGANGER");
    expect(aliveOf(e, "dop")).toBe(false);
  });

  it("chỉ hoá MỘT lần: cái chết thứ hai không đổi vai lần nữa", () => {
    const e = engineWith([
      ["wolf", "WEREWOLF"],
      ["dop", "DOPPELGANGER"],
      ["seer", "SEER"],
      ["guard", "GUARD"],
      ["v1", "VILLAGER"],
    ]);
    e.submitNightAction("wolf", "KILL", "seer");
    e.resolveNight(Date.now(), () => 0.9);
    e.settleDoppelganger();

    e.setPhase("DAY_DISCUSSION", 30_000);
    e.setPhase("NIGHT", 30_000);
    e.submitNightAction("wolf", "KILL", "guard");
    e.resolveNight(Date.now(), () => 0.9);
    e.settleDoppelganger();

    expect(roleOf(e, "dop")).toBe("SEER");
  });
});
