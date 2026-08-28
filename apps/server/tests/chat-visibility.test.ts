import { describe, expect, it } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG, type ChatMessage } from "@masoi/shared";
import { buildSnapshot, resolveChat, visibleChatLog } from "../src/rooms/snapshot";
import type { Room } from "../src/rooms/store";

const messages: ChatMessage[] = [
  { id: "lobby", channel: "lobby", playerId: "wolf", playerName: "Sói", text: "lobby", at: 1 },
  { id: "day", channel: "day", playerId: "villager", playerName: "Dân", text: "day", at: 2 },
  { id: "wolves", channel: "wolves", playerId: "wolf", playerName: "Sói", text: "wolves", at: 3 },
  { id: "dead", channel: "dead", playerId: "dead", playerName: "Ma", text: "dead", at: 4 },
];

function gameState(phase: GameState["phase"]): GameState {
  return {
    phase,
    round: 1,
    phaseEndsAt: null,
    players: [
      { id: "wolf", name: "Sói", role: "WEREWOLF", alive: true, isBot: false },
      { id: "villager", name: "Dân", role: "VILLAGER", alive: true, isBot: false },
      { id: "dead", name: "Ma", role: "SEER", alive: false, isBot: false },
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
}

function room(phase: GameState["phase"] | "LOBBY"): Room {
  const inLobby = phase === "LOBBY";
  return {
    code: "ABCDE",
    hostId: "wolf",
    status: inLobby ? "LOBBY" : "IN_GAME",
    members: [
      { playerId: "wolf", name: "Sói", ready: true, connected: true, isBot: false },
      { playerId: "villager", name: "Dân", ready: true, connected: true, isBot: false },
      { playerId: "dead", name: "Ma", ready: true, connected: true, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: inLobby ? null : new GameEngine(gameState(phase)),
    chatLog: [...messages],
    createdAt: 0,
  };
}

function channels(value: ChatMessage[]): string[] {
  return value.map((message) => message.channel);
}

function pendingHunterRoom(source: "night" | "vote"): Room {
  const state: GameState = {
    phase: source === "night" ? "NIGHT" : "VOTING",
    round: 1,
    phaseEndsAt: null,
    players: [
      { id: "hunter", name: "Thợ Săn", role: "HUNTER", alive: true, isBot: false },
      { id: "wolf", name: "Sói", role: "WEREWOLF", alive: true, isBot: false },
      { id: "villager", name: "Dân", role: "VILLAGER", alive: true, isBot: false },
      { id: "dead", name: "Ma", role: "SEER", alive: false, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG, werewolves: 1, hunter: true },
    winner: null,
    night: {
      wolfVotes: {},
      killTarget: null,
      wolvesLocked: false,
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
    hunterReaction: null,
    hunterShots: [],
    log: [],
  };
  const engine = new GameEngine(state);
  if (source === "night") {
    engine.state.night.killTarget = "hunter";
    engine.state.night.wolvesLocked = true;
    engine.resolveNight(1_000);
  } else {
    engine.state.votes = { hunter: "wolf", wolf: "hunter", villager: "hunter" };
    // Cái chết ban ngày giờ nằm ở vòng xác nhận, không còn ở vote sơ bộ.
    engine.resolveNomination(25_000, 1_000);
    engine.beginFinalVote(20_000, 1_000);
    for (const voter of engine.finalVoters()) engine.submitFinalVote(voter.id, true);
    engine.resolveFinalVote(1_000);
  }

  return {
    code: source === "night" ? "HNITE" : "HVOTE",
    hostId: "villager",
    status: "IN_GAME",
    members: state.players.map((player) => ({
      playerId: player.id,
      name: player.name,
      ready: true,
      connected: true,
      isBot: false,
    })),
    config: { ...state.config },
    engine,
    chatLog: [...messages],
    createdAt: 0,
  };
}

describe("visibleChatLog", () => {
  it("only returns lobby chat while waiting", () => {
    expect(channels(visibleChatLog(room("LOBBY"), "villager"))).toEqual(["lobby"]);
  });

  it("only returns wolf chat to a living wolf at night", () => {
    expect(channels(visibleChatLog(room("NIGHT"), "wolf"))).toEqual(["wolves"]);
  });

  it("returns no chat to a living non-wolf at night", () => {
    expect(channels(visibleChatLog(room("NIGHT"), "villager"))).toEqual([]);
  });

  it("returns every in-game channel to a dead player", () => {
    expect(channels(visibleChatLog(room("NIGHT"), "dead"))).toEqual(["day", "wolves", "dead"]);
  });

  it("only returns day chat to a living player during the day", () => {
    expect(channels(visibleChatLog(room("DAY_DISCUSSION"), "villager"))).toEqual(["day"]);
  });

  it("only returns lobby chat after the game", () => {
    expect(channels(visibleChatLog(room("GAME_OVER"), "villager"))).toEqual(["lobby"]);
  });
});

describe("resolveChat", () => {
  it("also sends living-player daytime chat to dead spectators", () => {
    const result = resolveChat(room("DAY_DISCUSSION"), "villager");

    expect(result).toEqual({
      ok: true,
      channel: "day",
      recipients: ["wolf", "villager", "dead"],
    });
  });

  it("also sends wolf chat to dead spectators", () => {
    expect(resolveChat(room("NIGHT"), "wolf")).toEqual({
      ok: true,
      channel: "wolves",
      recipients: ["wolf", "dead"],
    });
  });

  it("still refuses to let a dead player talk to the living", () => {
    expect(resolveChat(room("DAY_DISCUSSION"), "dead")).toEqual({
      ok: true,
      channel: "dead",
      recipients: ["dead"],
    });
  });

  const reactionCases = [
    { source: "night" as const, resultPhase: "NIGHT_RESULT" as const, nextPhase: "DAY_DISCUSSION" as const },
    { source: "vote" as const, resultPhase: "ELIMINATION" as const, nextPhase: "NIGHT" as const },
  ];

  it.each(reactionCases)(
    "hides roles and dead-chat history from the pending Hunter after $source death",
    ({ source }) => {
      const hunterRoom = pendingHunterRoom(source);
      const engine = hunterRoom.engine!;

      const assertHidden = () => {
        const hunterView = buildSnapshot(hunterRoom, "hunter");
        expect(hunterView.players.find((player) => player.id === "wolf")?.role).toBeUndefined();
        expect(hunterView.chatLog).toEqual([]);
      };

      assertHidden();
      engine.beginHunterShot(15_000, 2_000);
      assertHidden();
      engine.submitHunterShot("hunter", null);
      assertHidden();
    },
  );

  it.each(reactionCases)(
    "rejects pending Hunter dead-chat sends after $source death",
    ({ source }) => {
      const hunterRoom = pendingHunterRoom(source);
      const engine = hunterRoom.engine!;
      const assertRejected = () => {
        expect(resolveChat(hunterRoom, "hunter")).toEqual({
          ok: false,
          error: "Thợ Săn chưa thể dùng kênh chat người chết",
        });
      };

      assertRejected();
      engine.beginHunterShot(15_000, 2_000);
      assertRejected();
      engine.submitHunterShot("hunter", null);
      assertRejected();
    },
  );

  it.each(reactionCases)(
    "excludes the pending Hunter from live dead-chat recipients after $source death",
    ({ source }) => {
      const hunterRoom = pendingHunterRoom(source);
      const engine = hunterRoom.engine!;
      const assertExcluded = () => {
        expect(resolveChat(hunterRoom, "dead")).toEqual({
          ok: true,
          channel: "dead",
          recipients: ["dead"],
        });
      };

      assertExcluded();
      engine.beginHunterShot(15_000, 2_000);
      assertExcluded();
      engine.submitHunterShot("hunter", null);
      assertExcluded();
    },
  );

  it.each(reactionCases)(
    "preserves ordinary dead-player visibility during the $source Hunter reaction",
    ({ source }) => {
      const hunterRoom = pendingHunterRoom(source);
      const engine = hunterRoom.engine!;
      const assertOrdinaryDeadAccess = () => {
        const ordinaryDeadView = buildSnapshot(hunterRoom, "dead");
        expect(ordinaryDeadView.players.find((player) => player.id === "wolf")?.role).toBe("WEREWOLF");
        expect(channels(ordinaryDeadView.chatLog)).toEqual(["day", "wolves", "dead"]);
      };

      assertOrdinaryDeadAccess();
      engine.beginHunterShot(15_000, 2_000);
      assertOrdinaryDeadAccess();
    },
  );

  it.each(reactionCases)(
    "restores normal dead-player rules after the $source Hunter reaction completes",
    ({ source, nextPhase }) => {
      const hunterRoom = pendingHunterRoom(source);
      const engine = hunterRoom.engine!;
      engine.beginHunterShot(15_000, 2_000);
      engine.submitHunterShot("hunter", null);

      expect(engine.completeHunterReaction()).toBe(source);
      engine.setPhase(nextPhase, 30_000, 3_000);
      expect(buildSnapshot(hunterRoom, "hunter").players.find((player) => player.id === "wolf")?.role).toBe("WEREWOLF");
      expect(channels(visibleChatLog(hunterRoom, "hunter"))).toEqual(["day", "wolves", "dead"]);
      expect(resolveChat(hunterRoom, "hunter")).toEqual({
        ok: true,
        channel: "dead",
        recipients: ["hunter", "dead"],
      });
    },
  );
});
