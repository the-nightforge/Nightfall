import { describe, expect, it } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { NIGHT_SCAFFOLD } from "./helpers/night";
import { GAME_STATE_SCAFFOLD } from "./helpers/game-state";

function nightState(guardPrevious: string | null): GameState {
  return {
    ...GAME_STATE_SCAFFOLD,
    phase: "NIGHT",
    round: 2,
    phaseEndsAt: null,
    players: [
      { id: "wolf", name: "Sói", role: "WEREWOLF", alive: true, isBot: false },
      { id: "guard", name: "Vệ", role: "GUARD", alive: true, isBot: true },
      { id: "seer", name: "Tiên", role: "SEER", alive: true, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    winner: null,
    night: {
      ...NIGHT_SCAFFOLD,
      killTarget: null,
      guardTarget: null,
      healTonight: false,
      poisonTarget: null,
      witchSkipped: false,
      seerResults: {},
    },
    votes: {},
    guardPrevious,
    healUsed: false,
    poisonUsed: false,
    lastNightDeaths: [],
    nightHistory: [],
    lastEliminated: null,
    log: [],
  };
}

describe("guardPrevious trong snapshot", () => {
  it("cho Bảo Vệ thấy mục tiêu đêm trước của chính mình", () => {
    const engine = new GameEngine(nightState("seer"));
    expect(engine.snapshotFor("guard").nightInfo?.guardPrevious).toBe("seer");
  });

  it("để null khi Bảo Vệ chưa đỡ ai đêm nào", () => {
    const engine = new GameEngine(nightState(null));
    expect(engine.snapshotFor("guard").nightInfo?.guardPrevious).toBeNull();
  });

  it("không lộ cho vai khác", () => {
    const engine = new GameEngine(nightState("seer"));
    expect(engine.snapshotFor("wolf").nightInfo?.guardPrevious).toBeUndefined();
    expect(engine.snapshotFor("seer").nightInfo?.guardPrevious).toBeUndefined();
  });
});
