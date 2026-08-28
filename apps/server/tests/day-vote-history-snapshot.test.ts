import { describe, expect, it } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { buildSnapshot } from "../src/rooms/snapshot";
import type { Room } from "../src/rooms/store";

function votingRoom(): Room {
  const state: GameState = {
    phase: "VOTING",
    round: 1,
    phaseEndsAt: 30_000,
    players: [
      { id: "human", name: "Hà", role: "VILLAGER", alive: true, isBot: false },
      { id: "bot", name: "Bot", role: "WEREWOLF", alive: true, isBot: true },
      { id: "target", name: "Tú", role: "SEER", alive: true, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    winner: null,
    night: {
      killTarget: null,
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
    lastNightDeaths: [],
    nightHistory: [],
    lastEliminated: null,
    log: [],
  };

  return {
    code: "HISTORY",
    hostId: "human",
    status: "IN_GAME",
    members: state.players.map((player) => ({
      playerId: player.id,
      name: player.name,
      ready: true,
      connected: true,
      isBot: player.isBot,
    })),
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: new GameEngine(state),
    chatLog: [],
    createdAt: 0,
  };
}

describe("snapshot lịch sử phiếu ban ngày", () => {
  it("chỉ công khai recap sau khi nomination chốt, giống nhau cho người và BOT", () => {
    const room = votingRoom();
    room.engine!.submitVote("human", "bot", 10_000);
    room.engine!.submitVote("human", "target", 12_000);
    room.engine!.submitVote("bot", "target", 13_000);

    expect(buildSnapshot(room, "human").dayVoteHistory).toEqual([]);

    room.engine!.resolveNomination(25_000, 30_000);

    const humanHistory = buildSnapshot(room, "human").dayVoteHistory;
    expect(humanHistory).toEqual(buildSnapshot(room, "bot").dayVoteHistory);
    expect(humanHistory).toHaveLength(1);
    expect(humanHistory[0]?.mutations).toHaveLength(3);
    expect(JSON.stringify(humanHistory)).not.toContain("WEREWOLF");
    expect(JSON.stringify(humanHistory)).not.toContain("VILLAGER");
    expect(JSON.stringify(humanHistory)).not.toContain("SEER");
  });
});
