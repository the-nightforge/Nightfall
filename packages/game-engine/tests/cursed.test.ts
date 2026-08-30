import { describe, expect, it } from "vitest";
import { GameEngine } from "../src/engine";
import { buildRoleDeck } from "../src/assignRoles";
import { GameError, type GameState, type NightState } from "../src/types";
import { DEFAULT_ROOM_CONFIG, type RoomConfig } from "@masoi/shared";

const CONFIG: RoomConfig = {
  ...DEFAULT_ROOM_CONFIG,
  werewolves: 1,
  hunter: false,
  cursed: true,
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
    priestSkipped: false,
    seerResults: {},
    wolfSecondaryTarget: null,
    wolfCubRageTonight: false,
    guardianAngelTarget: null,
    priestTarget: null,
    detectiveTargets: null,
    detectiveResults: {},
    priestResults: {},
  };
}

/** Bàn cờ cố định: một Sói, một Kẻ Nguyền Rủa và đủ vai để thử mọi lối chết. */
function cursedState(over: Partial<GameState> = {}): GameState {
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
    players: [
      { id: "wolf", name: "Sói", role: "WEREWOLF", alive: true, isBot: false },
      { id: "cursed", name: "Nguyền", role: "CURSED", alive: true, isBot: false },
      { id: "seer", name: "Tiên Tri", role: "SEER", alive: true, isBot: false },
      { id: "guard", name: "Bảo Vệ", role: "GUARD", alive: true, isBot: false },
      { id: "witch", name: "Phù Thuỷ", role: "WITCH", alive: true, isBot: false },
      { id: "villager", name: "Dân", role: "VILLAGER", alive: true, isBot: false },
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
    priestHolyWaterUsed: {},
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
    ...over,
  };
}

function cursedEngine(over: Partial<GameState> = {}): GameEngine {
  return new GameEngine(cursedState(over));
}

function playerOf(engine: GameEngine, id: string) {
  return engine.state.players.find((p) => p.id === id)!;
}

/** Một đêm bầy Sói cắn Kẻ Nguyền Rủa, không ai đỡ và Phù Thuỷ không can thiệp. */
function biteCursed(engine: GameEngine): void {
  engine.submitNightAction("wolf", "KILL", "cursed");
  engine.lockWolves(() => 0);
  engine.resolveNight();
}

describe("Cấu hình Kẻ Nguyền Rủa", () => {
  it("mặc định tắt trong RoomConfig", () => {
    expect(DEFAULT_ROOM_CONFIG.cursed).toBe(false);
  });

  it("chia tối đa một Kẻ Nguyền Rủa mỗi ván", () => {
    const deck = buildRoleDeck({ ...CONFIG, cursed: true }, 8);
    expect(deck.filter((role) => role === "CURSED")).toHaveLength(1);
  });

  it("không chia Kẻ Nguyền Rủa khi role bị tắt", () => {
    const deck = buildRoleDeck({ ...CONFIG, cursed: false }, 8);
    expect(deck.filter((role) => role === "CURSED")).toHaveLength(0);
  });

  it("không có hành động ban đêm riêng", () => {
    const engine = cursedEngine();
    expect(engine.hasNightAction("CURSED")).toBe(false);
    expect(() => engine.submitNightAction("cursed", "KILL", "villager")).toThrow(GameError);
  });
});

describe("Sói cắn Kẻ Nguyền Rủa", () => {
  it("không chết mà chuyển sang phe Ma Sói sau khi xử lý kết quả đêm", () => {
    const engine = cursedEngine();
    biteCursed(engine);

    const cursed = playerOf(engine, "cursed");
    expect(cursed.alive).toBe(true);
    expect(cursed.cursedTurned).toBe(true);
    expect(cursed.role).toBe("WEREWOLF");
    expect(engine.state.lastNightDeaths).toEqual([]);
  });

  it("ghi lại diễn biến 'đã bị nguyền' trong lịch sử đêm", () => {
    const engine = cursedEngine();
    biteCursed(engine);

    expect(engine.state.nightHistory[0].cursedTurned).toEqual({ id: "cursed", name: "Nguyền" });
  });

  it("không đưa đòn cắn hụt vào log công khai", () => {
    const engine = cursedEngine();
    biteCursed(engine);

    expect(engine.state.log.join(" ")).not.toMatch(/Nguyền|nguyền/);
  });

  it("tính là Ma Sói từ đêm tiếp theo", () => {
    const engine = cursedEngine();
    biteCursed(engine);

    expect(engine.aliveWolves().map((p) => p.id).sort()).toEqual(["cursed", "wolf"]);
    engine.setPhase("NIGHT", 30_000);
    expect(() => engine.submitNightAction("cursed", "KILL", "villager")).not.toThrow();
  });
});

describe("Kẻ Nguyền Rủa không bị nguyền", () => {
  it("được Bảo Vệ đỡ thì không kích hoạt nguyền", () => {
    const engine = cursedEngine();
    engine.submitNightAction("guard", "GUARD", "cursed");
    biteCursed(engine);

    const cursed = playerOf(engine, "cursed");
    expect(cursed.alive).toBe(true);
    expect(cursed.role).toBe("CURSED");
    expect(cursed.cursedTurned).toBe(false);
    expect(engine.state.nightHistory[0].cursedTurned).toBeNull();
  });

  it("được Phù Thuỷ cứu thì không kích hoạt nguyền", () => {
    const engine = cursedEngine();
    engine.submitNightAction("wolf", "KILL", "cursed");
    engine.lockWolves(() => 0);
    engine.submitNightAction("witch", "HEAL", null);
    engine.resolveNight();

    const cursed = playerOf(engine, "cursed");
    expect(cursed.alive).toBe(true);
    expect(cursed.role).toBe("CURSED");
    expect(cursed.cursedTurned).toBe(false);
  });

  it("bị Phù Thuỷ đầu độc thì chết bình thường và giữ nguyên phe", () => {
    const engine = cursedEngine();
    engine.lockWolves(() => 0);
    engine.submitNightAction("witch", "POISON", "cursed");
    engine.resolveNight();

    const cursed = playerOf(engine, "cursed");
    expect(cursed.alive).toBe(false);
    expect(cursed.role).toBe("CURSED");
    expect(cursed.cursedTurned).toBe(false);
    expect(engine.state.lastNightDeaths).toEqual([{ playerId: "cursed", name: "Nguyền" }]);
  });

  it("vừa bị cắn vừa trúng độc thì chết, không chuyển phe", () => {
    const engine = cursedEngine();
    engine.submitNightAction("wolf", "KILL", "cursed");
    engine.lockWolves(() => 0);
    engine.submitNightAction("witch", "POISON", "cursed");
    engine.resolveNight();

    const cursed = playerOf(engine, "cursed");
    expect(cursed.alive).toBe(false);
    expect(cursed.role).toBe("CURSED");
    expect(cursed.cursedTurned).toBe(false);
    expect(engine.state.nightHistory[0].cursedTurned).toBeNull();
  });

  it("bị dân làng treo cổ thì chết bình thường", () => {
    const engine = cursedEngine({ phase: "VOTING" });
    engine.submitVote("wolf", "cursed");
    engine.submitVote("seer", "cursed");
    engine.submitVote("guard", "cursed");
    engine.submitVote("witch", "villager");
    engine.submitVote("villager", "witch");
    engine.submitVote("cursed", "wolf");
    // Vote sơ bộ chỉ đề cử; cái chết nằm ở vòng xác nhận.
    expect(engine.resolveNomination(25_000)).toEqual({ kind: "TRIAL", accusedId: "cursed" });
    engine.beginFinalVote(20_000);
    for (const voter of engine.finalVoters()) engine.submitFinalVote(voter.id, true);
    engine.resolveFinalVote();

    const cursed = playerOf(engine, "cursed");
    expect(cursed.alive).toBe(false);
    expect(cursed.role).toBe("CURSED");
    expect(cursed.cursedTurned).toBe(false);
  });
});

describe("Chỉ chuyển phe một lần", () => {
  it("bầy Sói không được nhắm lại đồng bọn vừa bị nguyền", () => {
    const engine = cursedEngine();
    biteCursed(engine);
    engine.setPhase("NIGHT", 30_000);

    expect(() => engine.submitNightAction("wolf", "KILL", "cursed")).toThrow(GameError);
  });

  it("đòn cắn tiếp theo giết chứ không nguyền lại", () => {
    const engine = cursedEngine();
    biteCursed(engine);
    engine.setPhase("NIGHT", 30_000);
    // Ép mục tiêu ở tầng state: bỏ qua cổng kiểm tra của submitNightAction để
    // chứng minh chính resolveNight mới là nơi chặn lần chuyển phe thứ hai.
    engine.state.night.killTarget = "cursed";
    engine.state.night.wolvesLocked = true;
    engine.resolveNight();

    const cursed = playerOf(engine, "cursed");
    expect(cursed.alive).toBe(false);
    expect(engine.state.nightHistory[1].cursedTurned).toBeNull();
  });
});

describe("Tiên Tri soi Kẻ Nguyền Rủa", () => {
  it("thấy là dân làng trước khi chuyển phe", () => {
    const engine = cursedEngine();
    engine.submitNightAction("seer", "SEE", "cursed");
    expect(engine.state.night.seerResults.seer).toEqual({ targetId: "cursed", isWolf: false });
  });

  it("thấy là Ma Sói sau khi chuyển phe", () => {
    const engine = cursedEngine();
    engine.submitNightAction("seer", "SEE", "cursed");
    biteCursed(engine);
    // Kết quả soi của chính đêm bị cắn vẫn là dân làng: lúc soi chưa chuyển phe.
    expect(engine.state.nightHistory[0].seerChecks[0].isWolf).toBe(false);

    engine.setPhase("NIGHT", 30_000);
    engine.submitNightAction("seer", "SEE", "cursed");
    expect(engine.state.night.seerResults.seer).toEqual({ targetId: "cursed", isWolf: true });
  });
});

describe("Điều kiện thắng sau khi chuyển phe", () => {
  it("Kẻ Nguyền Rủa chưa chuyển phe vẫn tính cho phe làng", () => {
    const engine = cursedEngine();
    playerOf(engine, "wolf").alive = false;
    expect(engine.checkWin()).toBe("village");
  });

  it("Kẻ Nguyền Rủa đã chuyển phe tính cho bầy Sói", () => {
    const engine = cursedEngine();
    biteCursed(engine);
    for (const id of ["seer", "guard", "witch"]) playerOf(engine, id).alive = false;
    // Còn lại: Sói + Kẻ Nguyền Rủa (2 Sói) so với đúng một Dân Làng.
    expect(engine.checkWin()).toBe("wolves");
  });
});

describe("Trạng thái nguyền rủa giữa các ván", () => {
  it("ván mới chia lại từ đầu, không giữ cờ đã chuyển phe", () => {
    const players = Array.from({ length: 8 }, (_, i) => ({
      id: `p${i + 1}`,
      name: `Người ${i + 1}`,
      isBot: false,
    }));
    const engine = GameEngine.create(players, { ...CONFIG, cursed: true });

    expect(engine.state.players.every((p) => p.cursedTurned === false)).toBe(true);
    expect(engine.state.players.filter((p) => p.role === "CURSED")).toHaveLength(1);
    expect(engine.state.nightHistory).toEqual([]);
  });

  it("nạp state cũ thiếu field mới với giá trị mặc định an toàn", () => {
    const legacy = cursedState();
    for (const player of legacy.players) delete (player as { cursedTurned?: boolean }).cursedTurned;
    delete (legacy.config as { cursed?: boolean }).cursed;

    const engine = new GameEngine(legacy);
    expect(engine.state.config.cursed).toBe(false);
    expect(engine.state.players.every((p) => p.cursedTurned === false)).toBe(true);
  });
});

describe("Bí mật của Kẻ Nguyền Rủa trong snapshot", () => {
  it("người chơi khác không thấy vai lẫn trạng thái đã chuyển phe", () => {
    const engine = cursedEngine();
    biteCursed(engine);
    engine.setPhase("DAY_DISCUSSION", 60_000);

    const view = engine.snapshotFor("villager");
    const cursed = view.players.find((p) => p.id === "cursed")!;
    expect(cursed.role).toBeUndefined();
    expect(cursed.cursedTurned).toBeUndefined();
  });

  it("chính Kẻ Nguyền Rủa biết mình đã hoá Sói", () => {
    const engine = cursedEngine();
    biteCursed(engine);
    engine.setPhase("DAY_DISCUSSION", 60_000);

    const view = engine.snapshotFor("cursed");
    expect(view.you?.role).toBe("WEREWOLF");
    expect(view.you?.cursedTurned).toBe(true);
  });

  it("đồng bọn Sói thấy đồng minh mới nhưng không thấy gốc nguyền rủa", () => {
    const engine = cursedEngine();
    biteCursed(engine);
    engine.setPhase("DAY_DISCUSSION", 60_000);

    const cursed = engine.snapshotFor("wolf").players.find((p) => p.id === "cursed")!;
    expect(cursed.role).toBe("WEREWOLF");
    expect(cursed.cursedTurned).toBeUndefined();
  });

  it("lộ đầy đủ khi ván kết thúc", () => {
    const engine = cursedEngine();
    biteCursed(engine);
    engine.finishGame("wolves");

    const cursed = engine.snapshotFor("villager").players.find((p) => p.id === "cursed")!;
    expect(cursed.role).toBe("WEREWOLF");
    expect(cursed.cursedTurned).toBe(true);
  });

  it("chỉ trả lịch sử đêm của ván hiện tại khi game kết thúc", () => {
    const engine = cursedEngine();
    biteCursed(engine);

    expect(engine.snapshotFor("villager").nightHistory).toEqual([]);
    engine.finishGame("wolves");
    const history = engine.snapshotFor("villager").nightHistory;
    expect(history).toHaveLength(1);
    expect(history[0].cursedTurned).toEqual({ id: "cursed", name: "Nguyền" });
  });
});
