import { describe, expect, it } from "vitest";
import { GameEngine } from "../src/engine";
import type { GameState, NightState } from "../src/types";
import { DEFAULT_ROOM_CONFIG, type RoomConfig } from "@masoi/shared";

/**
 * Ranh giới thông tin của Kẻ Báo Thù.
 *
 * Ba thứ phải nằm im trong engine cho tới khi có người ĐƯỢC PHÉP hỏi: danh tính
 * mục tiêu, việc đã chuyển vai, và thắng lợi cá nhân. Mỗi bài test dưới đây bắt
 * một đường rò cụ thể chứ không khẳng định chung chung - vì một đường rò chỉ
 * cần một chỗ quên là đủ.
 */

const CONFIG: RoomConfig = {
  ...DEFAULT_ROOM_CONFIG,
  werewolves: 1,
  hunter: false,
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
    sorcererResults: {},
  };
}

function state(over: Partial<GameState> = {}): GameState {
  return {
    phase: "DAY_DISCUSSION",
    round: 1,
    phaseEndsAt: 60_000,
    phaseStartedAt: 0,
    voteMutations: [],
    dayVoteHistory: [],
    trial: null,
    lastTrial: null,
    players: [
      { id: "wolf", name: "Sói", role: "WEREWOLF", alive: true, isBot: false },
      { id: "exec", name: "Báo Thù", role: "EXECUTIONER", alive: true, isBot: true },
      { id: "target", name: "Mục Tiêu", role: "VILLAGER", alive: true, isBot: false },
      { id: "witch", name: "Phù Thuỷ", role: "WITCH", alive: true, isBot: true },
      { id: "ghost", name: "Ma", role: "VILLAGER", alive: false, isBot: false },
      { id: "villager", name: "Dân", role: "VILLAGER", alive: true, isBot: false },
      { id: "villager2", name: "Dân 2", role: "VILLAGER", alive: true, isBot: false },
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
    deadCanSpeakChosenId: null,
    howlBonusDay: null,
    dayOfTruthClaims: {},
    personalWins: [],
    executionerTargets: { exec: "target" },
    ...over,
  };
}

function engineWith(over: Partial<GameState> = {}): GameEngine {
  return new GameEngine(state(over));
}

function playerOf(engine: GameEngine, id: string) {
  return engine.state.players.find((p) => p.id === id)!;
}

describe("nhiệm vụ chỉ hiện cho đúng chủ nhân", () => {
  it("chỉ snapshot của Kẻ Báo Thù mang mục tiêu", () => {
    const engine = engineWith();

    expect(engine.snapshotFor("exec").executioner).toEqual({
      target: { id: "target", name: "Mục Tiêu", alive: true },
      won: false,
      turnedJester: false,
    });
    for (const viewerId of ["wolf", "target", "witch", "villager", "villager2"]) {
      expect(engine.snapshotFor(viewerId).executioner).toBeNull();
    }
  });

  it("người đã chết - tức khán giả - cũng không thấy nhiệm vụ của người khác", () => {
    expect(engineWith().snapshotFor("ghost").executioner).toBeNull();
  });

  it("người ngoài phòng không có snapshot nào để rò", () => {
    expect(engineWith().snapshotFor("nguoi-la").executioner).toBeNull();
  });

  it("KHÔNG mở ra ở GAME_OVER: mục tiêu chỉ có nghĩa với đúng một người", () => {
    const engine = engineWith();
    engine.finishGame("village");

    expect(engine.snapshotFor("exec").executioner).not.toBeNull();
    expect(engine.snapshotFor("villager").executioner).toBeNull();
  });

  it("mục tiêu KHÔNG mang vai của người bị nhắm", () => {
    // Kẻ Báo Thù biết DANH TÍNH, không biết lá bài. Một trường `role` ở đây sẽ
    // biến nhiệm vụ thành một lượt soi miễn phí.
    const view = engineWith().snapshotFor("exec").executioner!;
    expect(Object.keys(view.target!).sort()).toEqual(["alive", "id", "name"]);
  });
});

describe("chuyển vai và thắng lợi không rò ra ngoài", () => {
  it("trước GAME_OVER, không ai thấy cờ đã-chuyển-vai của người khác", () => {
    const engine = engineWith();
    playerOf(engine, "target").alive = false;
    engine.settleExecutioner();
    expect(playerOf(engine, "exec").executionerTurned).toBe(true);

    for (const viewerId of ["wolf", "witch", "villager", "ghost"]) {
      const view = engine.snapshotFor(viewerId);
      expect(view.players.find((p) => p.id === "exec")?.executionerTurned).toBeUndefined();
      // Và vai mới cũng không lộ - cái chết vẫn không tiết lộ gì.
      expect(view.players.find((p) => p.id === "exec")?.role).toBeUndefined();
    }
    // Chính chủ thì biết, qua cả `you` lẫn khối nhiệm vụ.
    expect(engine.snapshotFor("exec").you?.executionerTurned).toBe(true);
    expect(engine.snapshotFor("exec").executioner?.turnedJester).toBe(true);
  });

  it("ở GAME_OVER thì cờ đã-chuyển-vai công khai cùng toàn bộ vai", () => {
    const engine = engineWith();
    playerOf(engine, "target").alive = false;
    engine.settleExecutioner();
    engine.finishGame("wolves");

    const view = engine.snapshotFor("villager");
    const exec = view.players.find((p) => p.id === "exec")!;
    expect(exec.role).toBe("JESTER");
    expect(exec.executionerTurned).toBe(true);
  });

  it("thắng cá nhân chỉ hiện cho chính người đó trước GAME_OVER", () => {
    const engine = engineWith();
    engine.setPhase("VOTING", 30_000, 0);
    for (const voter of engine.alivePlayers()) {
      if (voter.id !== "target") engine.submitVote(voter.id, "target", 10_000);
    }
    engine.resolveNomination(25_000, 30_000);
    engine.beginFinalVote(20_000);
    for (const voter of engine.finalVoters()) engine.submitFinalVote(voter.id, true);
    engine.resolveFinalVote();

    expect(engine.snapshotFor("exec").personalWins.map((w) => w.playerId)).toEqual(["exec"]);
    for (const viewerId of ["wolf", "witch", "villager", "ghost"]) {
      expect(engine.snapshotFor(viewerId).personalWins).toEqual([]);
    }
  });

  it("log công khai KHÔNG nhắc tới mục tiêu, chuyển vai hay thắng lợi", () => {
    /*
     * `state.log` đi thẳng vào snapshot của mọi người. Một dòng "X đã hoá Thằng
     * Hề" vừa lộ vai vừa chỉ đích danh mục tiêu vừa chết, và một dòng "đã thắng
     * cá nhân" lật bài của người vừa bị treo.
     */
    const engine = engineWith();
    playerOf(engine, "target").alive = false;
    engine.settleExecutioner();

    const log = engine.state.log.join("\n");
    expect(log).not.toMatch(/Báo Thù/);
    expect(log).not.toMatch(/Mục Tiêu/);
    expect(log).not.toMatch(/Thằng Hề/);
  });

  it("tới GAME_OVER thì thành tích mới được nói ra trong log", () => {
    const engine = engineWith();
    engine.setPhase("VOTING", 30_000, 0);
    for (const voter of engine.alivePlayers()) {
      if (voter.id !== "target") engine.submitVote(voter.id, "target", 10_000);
    }
    engine.resolveNomination(25_000, 30_000);
    engine.beginFinalVote(20_000);
    for (const voter of engine.finalVoters()) engine.submitFinalVote(voter.id, true);
    engine.resolveFinalVote();
    expect(engine.state.log.join("\n")).not.toMatch(/thắng cá nhân/);

    engine.finishGame("wolves");
    expect(engine.state.log.join("\n")).toMatch(/Kẻ Báo Thù Báo Thù đã đạt mục tiêu riêng/);
  });
});

describe("BOT khác không đọc được nhiệm vụ từ state nội bộ", () => {
  it("botKnowledgeFor chỉ cấp mục tiêu cho đúng con BOT sở hữu nó", () => {
    const engine = engineWith();

    expect(engine.botKnowledgeFor("exec").executionerTargetId).toBe("target");
    expect(engine.botKnowledgeFor("witch").executionerTargetId).toBeNull();
  });

  it("view của BOT khác không chứa chuỗi id mục tiêu ở bất kỳ độ sâu nào", () => {
    /*
     * Quét cả cây thay vì chỉ trường đã biết: một đường rò mới sẽ đi qua một
     * trường mà bài test này chưa từng nghe tên, và đó đúng là loại rò mà một
     * phép so bằng từng trường không bao giờ bắt được.
     */
    const engine = engineWith();
    const serialized = JSON.stringify(engine.botKnowledgeFor("witch"));

    // "target" vẫn xuất hiện như một id người chơi công khai trong `players`,
    // nên phép quét phải hỏi đúng câu: có trường nào MANG NGHĨA nhiệm vụ không.
    const view = engine.botKnowledgeFor("witch") as unknown as Record<string, unknown>;
    expect(view.executionerTargetId).toBeNull();
    expect(serialized).not.toMatch(/executionerTargets/);
    expect(serialized).not.toMatch(/executionerTurned/);
    expect(serialized).not.toMatch(/personalWins/);
  });

  it("sau khi chuyển vai, BOT khác vẫn không biết ai vừa đổi vai", () => {
    const engine = engineWith();
    playerOf(engine, "target").alive = false;
    engine.settleExecutioner();

    const view = engine.botKnowledgeFor("witch");
    expect(view.knownRoles).toEqual({ witch: "WITCH" });
    // Con BOT vừa đổi vai thì biết vai MỚI của chính mình, và không gì hơn.
    expect(engine.botKnowledgeFor("exec").selfRole).toBe("JESTER");
  });
});
