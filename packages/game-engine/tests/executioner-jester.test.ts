import { describe, expect, it } from "vitest";
import { GameEngine } from "../src/engine";
import type { GameState, NightState } from "../src/types";
import { DEFAULT_ROOM_CONFIG, sameFaction, type RoomConfig } from "@masoi/shared";

/**
 * Chuyển vai, chuỗi chết, và hai Thằng Hề cùng một bàn.
 *
 * Tách khỏi `executioner.test.ts` vì nó nói về một chủ đề khác: file kia hỏi
 * "nhiệm vụ được cấp và hoàn thành đúng không", file này hỏi "chuyện gì xảy ra
 * khi nhiệm vụ đổ vỡ". Hai nhóm dùng chung một bàn nhưng khác hẳn nhau ở phần
 * quan trọng nhất - ở đây mọi bài test đều đi qua `settleExecutioner`, tức đúng
 * cái điểm mà server và harness chốt một đợt chết.
 */

const CONFIG: RoomConfig = {
  ...DEFAULT_ROOM_CONFIG,
  werewolves: 1,
  hunter: true,
  cursed: false,
  executioner: true,
};

function emptyNight(): NightState {
  return {
    wolfVotes: {},
    killTarget: null,
    wolvesLocked: false,
    guardTarget: null,
    healTonight: false,
    poisonTarget: null,
    witchSkipped: false,
    seerResults: {},
    wolfSecondaryTarget: null,
    wolfCubRageTonight: false,
    guardianAngelTarget: null,
    detectiveTargets: null,
    detectiveResults: {},
  };
}

function baseState(over: Partial<GameState> = {}): GameState {
  return {
    phase: "NIGHT",
    round: 1,
    phaseEndsAt: 30_000,
    phaseStartedAt: 0,
    voteMutations: [],
    dayVoteHistory: [],
    trial: null,
    lastTrial: null,
    players: [
      { id: "wolf", name: "Sói", role: "WEREWOLF", alive: true, isBot: false },
      { id: "exec", name: "Báo Thù", role: "EXECUTIONER", alive: true, isBot: false },
      { id: "target", name: "Mục Tiêu", role: "VILLAGER", alive: true, isBot: false },
      { id: "witch", name: "Phù Thuỷ", role: "WITCH", alive: true, isBot: false },
      { id: "villager", name: "Dân", role: "VILLAGER", alive: true, isBot: false },
      { id: "villager2", name: "Dân 2", role: "VILLAGER", alive: true, isBot: false },
      { id: "villager3", name: "Dân 3", role: "VILLAGER", alive: true, isBot: false },
    ],
    config: { ...CONFIG },
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
    apprenticeAwakened: false,
    wolfCubRageNextNight: false,
    activeEvent: null,
    eventHistory: [],
    log: [],
    pendingLastStandVictim: null,
    bloodMoonArmed: false,
    bloodMoonUsed: false,
    deadCanSpeakUsed: false,
    deadCanSpeakChosenId: null,
    howlBonusDay: null,
    dayOfTruthClaims: {},
    personalWins: [],
    executionerTargets: { exec: "target" },
    ...over,
  };
}

function engineWith(over: Partial<GameState> = {}): GameEngine {
  return new GameEngine(baseState(over));
}

function playerOf(engine: GameEngine, id: string) {
  return engine.state.players.find((p) => p.id === id)!;
}

/**
 * Đúng chuỗi server chạy sau một đợt chết, kể cả phản ứng Thợ Săn.
 *
 * `hunterShot` mô phỏng lượt bắn: `undefined` là không có Thợ Săn nào phải bắn,
 * `null` là bắn trượt có chủ đích, một id là bắn người đó. Chuyển vai được chốt
 * SAU khi lượt bắn khép lại - đó chính là thứ thứ tự này tồn tại để kiểm.
 */
function settleDeaths(engine: GameEngine, hunterShot?: string | null) {
  if (engine.hasPendingHunterShot()) {
    engine.beginHunterShot(15_000, 50_000);
    engine.submitHunterShot(engine.state.hunterReaction!.hunterId, hunterShot ?? null);
    engine.completeHunterReaction();
  }
  engine.settleExecutioner();
  return engine.checkWin();
}

function tryInCourt(engine: GameEngine, targetId: string, guilty: boolean) {
  engine.setPhase("DAY_DISCUSSION", 60_000, 0);
  engine.setPhase("VOTING", 30_000, 0);
  for (const voter of engine.alivePlayers()) {
    if (voter.id !== targetId) engine.submitVote(voter.id, targetId, 10_000);
  }
  engine.resolveNomination(25_000, 30_000);
  engine.beginFinalVote(20_000);
  for (const voter of engine.finalVoters()) engine.submitFinalVote(voter.id, guilty);
  return engine.resolveFinalVote();
}

// ---------------------------------------------------- C. Chuyển vai & chuỗi chết

describe("Kẻ Báo Thù - chuyển thành Thằng Hề", () => {
  it("mục tiêu chết vì Sói thì Kẻ Báo Thù còn sống hoá Thằng Hề", () => {
    const engine = engineWith();
    engine.submitNightAction("wolf", "KILL", "target");
    engine.resolveNight();
    settleDeaths(engine);

    expect(playerOf(engine, "exec").role).toBe("JESTER");
    expect(playerOf(engine, "exec").executionerTurned).toBe(true);
  });

  it("chuyển vai KHÔNG trao thắng lợi nào", () => {
    // Đây là ranh giới của cơ chế: chuyển vai là một CƠ HỘI thứ hai, không phải
    // một phần thưởng an ủi.
    const engine = engineWith();
    engine.submitNightAction("wolf", "KILL", "target");
    engine.resolveNight();
    settleDeaths(engine);

    expect(engine.personalWins()).toEqual([]);
  });

  it("mục tiêu chết vì độc cũng chuyển vai - luật đọc CÁI CHẾT, không đọc nguồn", () => {
    const engine = engineWith();
    engine.submitNightAction("wolf", "SKIP", null);
    engine.lockWolves();
    engine.submitNightAction("witch", "POISON", "target");
    engine.resolveNight();
    settleDeaths(engine);

    expect(playerOf(engine, "target").alive).toBe(false);
    expect(playerOf(engine, "exec").role).toBe("JESTER");
  });

  it("KHÔNG cấp mục tiêu mới", () => {
    const engine = engineWith();
    engine.submitNightAction("wolf", "KILL", "target");
    engine.resolveNight();
    settleDeaths(engine);

    // Bảng nhiệm vụ giữ nguyên bản ghi cũ và không mọc thêm ai.
    expect(engine.executionerTargets()).toEqual({ exec: "target" });
  });

  it("cùng chết trong một đợt thì KHÔNG chuyển vai", () => {
    /*
     * Bầy Sói cắn mục tiêu, Phù Thuỷ đầu độc chính Kẻ Báo Thù. Cả hai cái chết
     * nằm trong CÙNG một lần `resolveNight`, nên tới lúc chốt thì Kẻ Báo Thù đã
     * không còn sống - và một người chết thì không có ván thứ hai để chơi.
     */
    const engine = engineWith();
    engine.submitNightAction("wolf", "KILL", "target");
    engine.lockWolves();
    engine.submitNightAction("witch", "POISON", "exec");
    engine.resolveNight();
    settleDeaths(engine);

    expect(playerOf(engine, "target").alive).toBe(false);
    expect(playerOf(engine, "exec").alive).toBe(false);
    expect(playerOf(engine, "exec").role).toBe("EXECUTIONER");
    expect(playerOf(engine, "exec").executionerTurned).toBe(false);
  });

  it("Thợ Săn chết vì nguồn khác rồi bắn Kẻ Báo Thù: người đã chết không chuyển vai", () => {
    /*
     * Đây là lý do `settleExecutioner` phải đứng SAU chuỗi Thợ Săn chứ không
     * ngay sau `resolveNight`. Mục tiêu và Thợ Săn cùng ngã trong đêm; phát bắn
     * của Thợ Săn hạ nốt Kẻ Báo Thù. Nếu chốt sớm, nó đã kịp hoá Thằng Hề rồi
     * mới trúng đạn - tức một người chết mang vai của một ván mà họ không còn
     * được chơi.
     */
    const engine = engineWith({
      players: [
        { id: "wolf", name: "Sói", role: "WEREWOLF", alive: true, isBot: false },
        { id: "exec", name: "Báo Thù", role: "EXECUTIONER", alive: true, isBot: false },
        { id: "target", name: "Mục Tiêu", role: "VILLAGER", alive: true, isBot: false },
        { id: "hunter", name: "Thợ Săn", role: "HUNTER", alive: true, isBot: false },
        { id: "witch", name: "Phù Thuỷ", role: "WITCH", alive: true, isBot: false },
        { id: "villager", name: "Dân", role: "VILLAGER", alive: true, isBot: false },
        { id: "villager2", name: "Dân 2", role: "VILLAGER", alive: true, isBot: false },
      ],
    });
    engine.submitNightAction("wolf", "KILL", "target");
    engine.lockWolves();
    engine.submitNightAction("witch", "POISON", "hunter");
    engine.resolveNight();

    expect(engine.hasPendingHunterShot()).toBe(true);
    settleDeaths(engine, "exec");

    expect(playerOf(engine, "exec").alive).toBe(false);
    expect(playerOf(engine, "exec").role).toBe("EXECUTIONER");
    expect(playerOf(engine, "exec").executionerTurned).toBe(false);
    expect(engine.personalWins()).toEqual([]);
  });

  it("Thợ Săn là MỤC TIÊU, bị treo rồi bắn Kẻ Báo Thù: thắng đã ghi vẫn còn", () => {
    /*
     * Thứ tự ở đây là luật: thắng lợi được ghi trong `resolveFinalVote`, tức
     * TRƯỚC khi Thợ Săn kịp bắn. Một phát bắn sau đó giết được người, nhưng
     * không xoá được một thành tích đã vào sổ.
     */
    const engine = engineWith({
      players: [
        { id: "wolf", name: "Sói", role: "WEREWOLF", alive: true, isBot: false },
        { id: "exec", name: "Báo Thù", role: "EXECUTIONER", alive: true, isBot: false },
        { id: "target", name: "Mục Tiêu", role: "HUNTER", alive: true, isBot: false },
        { id: "witch", name: "Phù Thuỷ", role: "WITCH", alive: true, isBot: false },
        { id: "villager", name: "Dân", role: "VILLAGER", alive: true, isBot: false },
        { id: "villager2", name: "Dân 2", role: "VILLAGER", alive: true, isBot: false },
        { id: "villager3", name: "Dân 3", role: "VILLAGER", alive: true, isBot: false },
      ],
    });

    tryInCourt(engine, "target", true);
    expect(engine.personalWins().map((w) => w.condition)).toEqual([
      "EXECUTIONER_TARGET_LYNCHED",
    ]);

    settleDeaths(engine, "exec");

    expect(playerOf(engine, "exec").alive).toBe(false);
    expect(engine.personalWins()).toHaveLength(1);
    expect(engine.personalWins()[0].playerId).toBe("exec");
    // Và người đã chết không đổi vai, kể cả khi mục tiêu của họ đã nằm xuống.
    expect(playerOf(engine, "exec").role).toBe("EXECUTIONER");
  });

  it("chuyển vai rồi thì chỉ thắng khi CHÍNH MÌNH bị treo", () => {
    const engine = engineWith();
    engine.submitNightAction("wolf", "KILL", "target");
    engine.resolveNight();
    settleDeaths(engine);
    expect(playerOf(engine, "exec").role).toBe("JESTER");
    expect(engine.personalWins()).toEqual([]);

    // Treo một người KHÁC: không ai thắng gì.
    tryInCourt(engine, "villager", true);
    expect(engine.personalWins()).toEqual([]);

    // Treo chính nó: thắng, và thắng bằng điều kiện của Thằng Hề.
    engine.setPhase("NIGHT", 30_000, 100_000);
    tryInCourt(engine, "exec", true);
    expect(engine.personalWins()).toEqual([
      {
        playerId: "exec",
        name: "Báo Thù",
        role: "JESTER",
        condition: "JESTER_LYNCHED",
        round: 2,
      },
    ]);
  });

  it("chuyển vai xong, gọi lại nhiều lần không đổi gì thêm", () => {
    const engine = engineWith();
    engine.submitNightAction("wolf", "KILL", "target");
    engine.resolveNight();
    settleDeaths(engine);
    const snapshot = JSON.stringify(engine.state.players);

    engine.settleExecutioner();
    engine.settleExecutioner();

    expect(JSON.stringify(engine.state.players)).toBe(snapshot);
    expect(engine.personalWins()).toEqual([]);
  });
});

// ------------------------------------------------------------- D. Nhiều Thằng Hề

describe("Hai Thằng Hề cùng một bàn", () => {
  /** Hề ban đầu + Kẻ Báo Thù, để phần chuyển vai sinh ra con Hề thứ hai. */
  function twoJesterEngine(): GameEngine {
    return engineWith({
      config: { ...CONFIG, jester: true },
      players: [
        { id: "wolf", name: "Sói", role: "WEREWOLF", alive: true, isBot: false },
        { id: "exec", name: "Báo Thù", role: "EXECUTIONER", alive: true, isBot: false },
        { id: "jester", name: "Hề Gốc", role: "JESTER", alive: true, isBot: false },
        { id: "target", name: "Mục Tiêu", role: "VILLAGER", alive: true, isBot: false },
        { id: "witch", name: "Phù Thuỷ", role: "WITCH", alive: true, isBot: false },
        { id: "villager", name: "Dân", role: "VILLAGER", alive: true, isBot: false },
        { id: "villager2", name: "Dân 2", role: "VILLAGER", alive: true, isBot: false },
        { id: "villager3", name: "Dân 3", role: "VILLAGER", alive: true, isBot: false },
      ],
    });
  }

  it("chuyển vai được kể cả khi cấu hình phòng KHÔNG bật Thằng Hề", () => {
    /*
     * `jester: false` nói về BỘ BÀI, không phải về những vai có thể tồn tại
     * giữa ván. Ràng buộc "tối đa một Thằng Hề" là ràng buộc của lúc chia bài;
     * một lá Hề sinh ra từ chuyển vai không đi qua bộ chia bài nào.
     */
    const engine = engineWith({ config: { ...CONFIG, jester: false } });
    engine.submitNightAction("wolf", "KILL", "target");
    engine.resolveNight();
    engine.settleExecutioner();

    expect(engine.state.config.jester).toBe(false);
    expect(playerOf(engine, "exec").role).toBe("JESTER");
  });

  it("hai Thằng Hề KHÔNG cùng phe với nhau", () => {
    // Thám Tử so hai người này phải đọc ra KHÁC PHE: họ thắng bằng hai cái chết
    // khác nhau và không ai giúp được ai.
    expect(sameFaction("JESTER", "JESTER")).toBe(false);
  });

  it("Thám Tử so hai Thằng Hề đọc ra KHÁC PHE", () => {
    const engine = twoJesterEngine();
    engine.state.players.push({
      id: "detective",
      name: "Thám Tử",
      role: "DETECTIVE",
      alive: true,
      isBot: false,
    });
    engine.submitNightAction("wolf", "KILL", "target");
    engine.resolveNight();
    engine.settleExecutioner();
    expect(playerOf(engine, "exec").role).toBe("JESTER");

    engine.setPhase("NIGHT", 30_000, 100_000);
    engine.submitNightAction("detective", "DETECTIVE_CHECK", "exec", "jester");

    expect(engine.state.night.detectiveResults.detective).toEqual({
      target1Id: "exec",
      target2Id: "jester",
      sameTeam: false,
    });
  });

  it("mỗi con Hề có chiến thắng riêng, không ai thắng ké", () => {
    const engine = twoJesterEngine();
    engine.submitNightAction("wolf", "KILL", "target");
    engine.resolveNight();
    engine.settleExecutioner();

    // Treo con Hề GỐC: chỉ nó thắng.
    tryInCourt(engine, "jester", true);
    expect(engine.personalWins().map((w) => w.playerId)).toEqual(["jester"]);

    // Treo con Hề CHUYỂN VAI ở ngày sau: nó có mục riêng của nó.
    engine.setPhase("NIGHT", 30_000, 100_000);
    tryInCourt(engine, "exec", true);
    expect(engine.personalWins().map((w) => w.playerId)).toEqual(["jester", "exec"]);
    expect(engine.personalWins().map((w) => w.condition)).toEqual([
      "JESTER_LYNCHED",
      "JESTER_LYNCHED",
    ]);
  });

  it("con Hề gốc bị treo KHÔNG làm con Hề chuyển vai thắng theo", () => {
    const engine = twoJesterEngine();
    engine.submitNightAction("wolf", "KILL", "target");
    engine.resolveNight();
    engine.settleExecutioner();

    tryInCourt(engine, "jester", true);

    expect(engine.personalWins()).toHaveLength(1);
    expect(playerOf(engine, "exec").alive).toBe(true);
  });
});
