import { describe, expect, it } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { buildSnapshot } from "../src/rooms/snapshot";
import type { Room } from "../src/rooms/store";

function recapRoom(phase: GameState["phase"]): Room {
  const state: GameState = {
    phase,
    round: 1,
    phaseEndsAt: null,
    players: [
      { id: "a", name: "An", role: "VILLAGER", alive: true, isBot: false },
      { id: "b", name: "Bình", role: "WEREWOLF", alive: false, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    winner: null,
    night: {
      killTarget: "b",
      actedWolves: [],
      skippedWolves: [],
      guardTarget: null,
      healTonight: false,
      poisonTarget: null,
      witchSkipped: false,
      seerResults: {},
    },
    votes: {},
    guardPrevious: null,
    healUsed: false,
    poisonUsed: false,
    lastNightDeaths: [{ playerId: "b", name: "Bình" }],
    nightHistory: [
      {
        round: 1,
        wolfTarget: { id: "b", name: "Bình" },
        guardTarget: null,
        seerChecks: [],
        witch: { usedHeal: false, healedTarget: null, poisonTarget: null },
        deaths: [{ player: { id: "b", name: "Bình" }, cause: "wolf" }],
      },
    ],
    lastEliminated: null,
    log: [],
  };

  return {
    code: "RECAP",
    hostId: "a",
    status: "IN_GAME",
    members: [
      { playerId: "a", name: "An", ready: true, connected: true, isBot: false },
      { playerId: "b", name: "Bình", ready: true, connected: true, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: new GameEngine(state),
    chatLog: [],
    createdAt: 0,
  };
}

describe("snapshot lịch sử đêm", () => {
  it("không gửi recap trong khi ván đang diễn ra", () => {
    const room = recapRoom("DAY_DISCUSSION");
    expect(buildSnapshot(room, "a").nightHistory).toEqual([]);
  });

  it("gửi toàn bộ recap khi ván kết thúc", () => {
    const room = recapRoom("GAME_OVER");
    expect(buildSnapshot(room, "a").nightHistory).toEqual([
      expect.objectContaining({ round: 1 }),
    ]);
  });

  it("snapshot phòng chờ có recap rỗng", () => {
    const room = recapRoom("GAME_OVER");
    room.status = "LOBBY";
    room.engine = null;
    expect(buildSnapshot(room, "a").nightHistory).toEqual([]);
  });
});
