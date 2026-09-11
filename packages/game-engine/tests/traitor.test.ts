import { describe, expect, it } from "vitest";
import { GameEngine } from "../src/engine";
import { buildRoleDeck } from "../src/assignRoles";
import type { GameState, NightState } from "../src/types";
import { DEFAULT_ROOM_CONFIG, validateRoomConfig, type RoomConfig } from "@masoi/shared";

const CONFIG: RoomConfig = {
  ...DEFAULT_ROOM_CONFIG,
  werewolves: 1,
  hunter: false,
  cursed: false,
  traitor: true,
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
    detectiveTargets: null,
    detectiveResults: {},
    sorcererResults: {},
    trackerTargets: {},
    trackerResults: {},
  };
}

/**
 * Bàn cố định có đúng một Kẻ Phản Bội và đúng một con Sói.
 *
 * Vai gán TAY, cùng lý do với test Thằng Hề: mọi khẳng định ở đây nói về
 * "chuyện gì xảy ra với Kẻ Phản Bội", nên ai cầm lá nào phải là hằng số của bài
 * test chứ không phải kết quả một lần xáo bài.
 */
function traitorState(over: Partial<GameState> = {}): GameState {
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
      { id: "traitor", name: "Phản Bội", role: "TRAITOR", alive: true, isBot: false },
      { id: "seer", name: "Tiên Tri", role: "SEER", alive: true, isBot: false },
      { id: "extra", name: "Dân Thêm", role: "VILLAGER", alive: true, isBot: false },
      { id: "witch", name: "Phù Thuỷ", role: "WITCH", alive: true, isBot: false },
      { id: "detective", name: "Thám Tử", role: "DETECTIVE", alive: true, isBot: false },
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
    ...over,
  };
}

function traitorEngine(over: Partial<GameState> = {}): GameEngine {
  return new GameEngine(traitorState(over));
}

function playerOf(engine: GameEngine, id: string) {
  return engine.state.players.find((p) => p.id === id)!;
}

describe("Kẻ Phản Bội", () => {
  it("thắng cùng phe Sói: được đếm vào phe Sói ở luật thắng", () => {
    // Sói + Phản Bội còn sống, phía kia chỉ còn 2 người: 2 >= 2 nên Sói thắng.
    // Không có Kẻ Phản Bội thì đây mới là 1 so với 2, tức ván còn đang chơi.
    const engine = traitorEngine({
      phase: "DAY_DISCUSSION",
      players: traitorState().players.map((p) =>
        p.id === "witch" || p.id === "detective" || p.id === "villager"
          ? { ...p, alive: false }
          : p,
      ),
    });
    expect(engine.checkWin()).toBe("wolves");
  });

  it("KHÔNG nằm trong bầy: không thấy vai của Sói và không bỏ được phiếu cắn", () => {
    const engine = traitorEngine();
    const view = engine.snapshotFor("traitor");
    expect(view.players.find((p) => p.id === "wolf")?.role).toBeUndefined();
    expect(() => engine.submitNightAction("traitor", "KILL", "seer")).toThrow();
  });

  it("bầy KHÔNG thấy nó, và cắn được nó", () => {
    const engine = traitorEngine();
    const wolfView = engine.snapshotFor("wolf");
    expect(wolfView.players.find((p) => p.id === "traitor")?.role).toBeUndefined();
    // Không ném: một lời từ chối ở đây chính là một lời khai cho bầy.
    expect(() => engine.submitNightAction("wolf", "KILL", "traitor")).not.toThrow();
  });

  it("Tiên Tri soi ra PHE LÀNG, không phải phe Sói", () => {
    const engine = traitorEngine();
    engine.submitNightAction("seer", "SEE", "traitor");
    const result = engine.state.night.seerResults["seer"];
    expect(result.isWolf).toBe(false);
    expect(result.team).toBe("village");
  });

  it("con Sói cuối chết thì nó hoá Ma Sói", () => {
    const engine = traitorEngine({
      players: traitorState().players.map((p) =>
        p.id === "wolf" ? { ...p, alive: false } : p,
      ),
    });
    engine.settleTraitor();
    expect(playerOf(engine, "traitor").role).toBe("WEREWOLF");
    expect(playerOf(engine, "traitor").traitorTurned).toBe(true);
  });

  it("đã chết thì KHÔNG hoá Sói, và bầy còn sống thì cũng không", () => {
    const stillPack = traitorEngine();
    stillPack.settleTraitor();
    expect(playerOf(stillPack, "traitor").role).toBe("TRAITOR");

    const dead = traitorEngine({
      players: traitorState().players.map((p) =>
        p.id === "wolf" || p.id === "traitor" ? { ...p, alive: false } : p,
      ),
    });
    dead.settleTraitor();
    expect(playerOf(dead, "traitor").role).toBe("TRAITOR");
  });
});
