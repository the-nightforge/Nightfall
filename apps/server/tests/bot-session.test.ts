import { afterEach, describe, expect, it, vi } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";
import {
  botSessionFor,
  clearBotSession,
  startBotSession,
} from "../src/bots/session-registry";
import { cleanupRoomBotState } from "../src/game/bot-room-state";

vi.mock("../src/redis", () => ({ redis: { set: async () => undefined, get: async () => null, del: async () => undefined } }));
vi.mock("../src/db", () => ({ prisma: {} }));

function room(code = "ROOM1", createdAt = 1_000): Room {
  const state: GameState = {
    phase: "VOTING",
    round: 1,
    phaseEndsAt: 30_000,
    phaseStartedAt: 0,
    players: [
      { id: "bot-a", name: "Bot A", role: "VILLAGER", alive: true, isBot: true },
      { id: "bot-b", name: "Bot B", role: "WEREWOLF", alive: true, isBot: true },
      { id: "human", name: "Người", role: "SEER", alive: true, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
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
    voteMutations: [],
    dayVoteHistory: [],
    guardPrevious: null,
    healUsed: false,
    poisonUsed: false,
    lastNightDeaths: [],
    nightHistory: [],
    lastEliminated: null,
    trial: null,
    lastTrial: null,
    hunterReaction: null,
    hunterShots: [],
    log: [],
  };

  return {
    code,
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
    createdAt,
  };
}

afterEach(() => {
  clearBotSession("ROOM1");
  clearBotSession("ROOM2");
});

describe("bot session lifecycle", () => {
  it("returns a stable runtime per bot and drops it on cleanup", () => {
    const target = room();

    const first = botSessionFor(target).runtimeFor("bot-a");
    expect(botSessionFor(target).runtimeFor("bot-a")).toBe(first);

    cleanupRoomBotState(target.code);

    expect(botSessionFor(target).runtimeFor("bot-a")).not.toBe(first);
  });

  it("keeps separate runtimes for separate bots", () => {
    const target = room();
    const session = botSessionFor(target);

    expect(session.runtimeFor("bot-a")).not.toBe(session.runtimeFor("bot-b"));
    expect(session.runtimeFor("bot-a").state.playerId).toBe("bot-a");
  });

  it("lazily creates a session so a legacy room never crashes", () => {
    expect(botSessionFor(room("ROOM2", 5)).runtimeFor("bot-a")).toBeDefined();
  });

  it("replaces the session when a new game starts in the same room", () => {
    const target = room();
    const first = botSessionFor(target).runtimeFor("bot-a");

    startBotSession(target);

    expect(botSessionFor(target).runtimeFor("bot-a")).not.toBe(first);
  });

  it("seeds identically for the same room code and creation time", () => {
    const left = botSessionFor(room("ROOM1", 42)).rngFor("bot-a", "vote-schedule");
    clearBotSession("ROOM1");
    const right = botSessionFor(room("ROOM1", 42)).rngFor("bot-a", "vote-schedule");

    expect([left(), left(), left()]).toEqual([right(), right(), right()]);
  });

  it("gives different bots and different channels different streams", () => {
    const session = botSessionFor(room("ROOM1", 42));
    const a = session.rngFor("bot-a", "vote-schedule");
    const b = session.rngFor("bot-b", "vote-schedule");
    const other = session.rngFor("bot-a", "speech");

    expect(a()).not.toBe(b());
    expect(session.rngFor("bot-a", "vote-schedule")).toBe(a);
    expect(other).not.toBe(a);
  });

  it("gives different rooms different streams", () => {
    const one = botSessionFor(room("ROOM1", 42)).rngFor("bot-a", "vote-schedule");
    const two = botSessionFor(room("ROOM2", 42)).rngFor("bot-a", "vote-schedule");

    expect(one()).not.toBe(two());
  });

  it("produces a reproducible brain for the same seed", () => {
    const left = botSessionFor(room("ROOM1", 7)).runtimeFor("bot-a").state.personality;
    clearBotSession("ROOM1");
    const right = botSessionFor(room("ROOM1", 7)).runtimeFor("bot-a").state.personality;

    expect(left).toEqual(right);
  });
});
