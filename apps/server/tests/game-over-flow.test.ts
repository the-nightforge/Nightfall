import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";
import { ROOM_SCAFFOLD } from "./helpers/room";
import { NIGHT_SCAFFOLD } from "./helpers/night";
import { GAME_STATE_SCAFFOLD } from "./helpers/game-state";

vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: () => undefined,
  persistRoom: async () => undefined,
  setRoomTimer: (_code: string, fn: () => void, ms: number) => setTimeout(fn, ms),
}));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));

vi.mock("../src/db", () => ({
  prisma: { gameResult: { create: () => Promise.resolve() } },
}));

const { continueAfterDeathResult } = await import("../src/game/machine");

function winningRoom(): Room {
  const state: GameState = {
    ...GAME_STATE_SCAFFOLD,
    phase: "ELIMINATION",
    round: 1,
    phaseEndsAt: Date.now() + 8_000,
    players: [
      { id: "wolf", name: "Sói", role: "WEREWOLF", alive: false, isBot: false },
      { id: "villager", name: "Dân", role: "VILLAGER", alive: true, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    winner: null,
    night: {
      ...NIGHT_SCAFFOLD,
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

  return {
    ...ROOM_SCAFFOLD,
    code: "OVER1",
    hostId: "villager",
    status: "IN_GAME",
    members: state.players.map((player) => ({
      playerId: player.id,
      name: player.name,
      ready: true,
      connected: true,
      isBot: player.isBot,
    })),
    config: { ...state.config },
    engine: new GameEngine(state),
    chatLog: [],
    createdAt: Date.now(),
  };
}

describe("kết thúc ván không tự động về lobby", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("giữ nguyên GAME_OVER và phòng IN_GAME dù chờ quá lâu, chỉ chủ phòng bấm reset mới về lobby", async () => {
    const room = winningRoom();

    continueAfterDeathResult(room, "vote");

    expect(room.engine?.state.phase).toBe("GAME_OVER");
    expect(room.engine?.state.phaseEndsAt).toBeNull();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(room.engine?.state.phase).toBe("GAME_OVER");
    expect(room.status).toBe("IN_GAME");
  });
});
