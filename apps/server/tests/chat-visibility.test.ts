import { describe, expect, it } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG, type ChatMessage } from "@masoi/shared";
import { resolveChat, visibleChatLog } from "../src/rooms/snapshot";
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

  it("only returns dead chat to a dead player", () => {
    expect(channels(visibleChatLog(room("NIGHT"), "dead"))).toEqual(["dead"]);
  });

  it("only returns day chat to a living player during the day", () => {
    expect(channels(visibleChatLog(room("DAY_DISCUSSION"), "villager"))).toEqual(["day"]);
  });

  it("only returns lobby chat after the game", () => {
    expect(channels(visibleChatLog(room("GAME_OVER"), "villager"))).toEqual(["lobby"]);
  });
});

describe("resolveChat", () => {
  it("does not send living-player daytime chat to dead players", () => {
    const result = resolveChat(room("DAY_DISCUSSION"), "villager");

    expect(result).toEqual({
      ok: true,
      channel: "day",
      recipients: ["wolf", "villager"],
    });
  });
});
