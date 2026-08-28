import { describe, expect, it } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { buildSnapshot } from "../src/rooms/snapshot";
import type { Room } from "../src/rooms/store";

function votingRoom(): Room {
  const state: GameState = {
    phase: "VOTING",
    round: 2,
    phaseEndsAt: Date.now() + 30_000,
    players: [
      { id: "a", name: "Anh", role: "VILLAGER", alive: true, isBot: false },
      { id: "b", name: "Bình", role: "SEER", alive: true, isBot: false },
      { id: "c", name: "Chi", role: "WEREWOLF", alive: true, isBot: false },
      { id: "dead", name: "Dũng", role: "VILLAGER", alive: false, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    winner: null,
    night: {
      killTarget: null,
      actedWolves: [],
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
    code: "VOTED",
    hostId: "a",
    status: "IN_GAME",
    members: [
      { playerId: "a", name: "Anh", ready: true, connected: true, isBot: false },
      { playerId: "b", name: "Bình", ready: true, connected: true, isBot: false },
      { playerId: "c", name: "Chi", ready: true, connected: true, isBot: false },
      { playerId: "dead", name: "Dũng", ready: true, connected: true, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: new GameEngine(state),
    chatLog: [],
    createdAt: 0,
  };
}

describe("snapshot phiếu không treo ai", () => {
  // myVote === null có hai nghĩa hoàn toàn khác nhau, nên client không thể dựa
  // vào nó để biết đã vote hay chưa; hasVoted là thứ duy nhất phân biệt được.
  it("phân biệt chưa vote với đã chọn không treo", () => {
    const room = votingRoom();
    room.engine!.submitVote("a", null);

    expect(buildSnapshot(room, "a")).toMatchObject({
      hasVoted: true,
      myVote: null,
      noEliminationVoteCount: 1,
    });
    expect(buildSnapshot(room, "b")).toMatchObject({
      hasVoted: false,
      myVote: null,
      noEliminationVoteCount: 1,
    });
  });

  it("phiếu không treo không lọt vào voteCount của bất kỳ player nào", () => {
    const room = votingRoom();
    room.engine!.submitVote("a", null);
    room.engine!.submitVote("b", null);

    const view = buildSnapshot(room, "a");
    expect(view.players.every((player) => player.voteCount === 0)).toBe(true);
    expect(view.noEliminationVoteCount).toBe(2);
  });

  it("vote cho người chơi vẫn cho hasVoted true và myVote là id đó", () => {
    const room = votingRoom();
    room.engine!.submitVote("a", "c");

    expect(buildSnapshot(room, "a")).toMatchObject({
      hasVoted: true,
      myVote: "c",
      noEliminationVoteCount: 0,
    });
    expect(buildSnapshot(room, "a").players.find((p) => p.id === "c")?.voteCount).toBe(1);
  });

  it("người chết không bao giờ hasVoted", () => {
    const room = votingRoom();
    room.engine!.submitVote("a", null);

    expect(buildSnapshot(room, "dead")).toMatchObject({ hasVoted: false, myVote: null });
  });

  it("phòng chờ chưa có engine vẫn có giá trị mặc định", () => {
    const room = votingRoom();
    room.engine = null;
    room.status = "LOBBY";

    expect(buildSnapshot(room, "a")).toMatchObject({
      hasVoted: false,
      myVote: null,
      noEliminationVoteCount: 0,
    });
  });
});
