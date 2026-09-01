import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { CLIENT_EVENTS, DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";

const storeMocks = vi.hoisted(() => {
  const rooms = new Map<string, Room>();
  return {
    rooms,
    persistRoom: vi.fn(async () => undefined),
  };
});

vi.mock("../src/rooms/store", () => ({
  allRooms: () => [...storeMocks.rooms.values()],
  clearRoomTimers: () => undefined,
  getRoom: (code: string) => storeMocks.rooms.get(code),
  loadRoomFromRedis: async () => null,
  persistRoom: storeMocks.persistRoom,
  setRoomTimer: (_code: string, fn: () => void, ms: number) => setTimeout(fn, ms),
}));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
  trackSocket: () => undefined,
  untrackSocket: () => undefined,
}));

vi.mock("../src/db", () => ({
  prisma: { player: { findUnique: vi.fn() } },
}));

vi.mock("../src/redis", () => ({
  getPlayerRoom: async () => null,
  updateSessionRoom: async () => undefined,
}));

import { continueAfterDeathResult, submitHunterShot } from "../src/game/machine";
import { setupSocket } from "../src/ws";
import { NIGHT_SCAFFOLD } from "./helpers/night";
import { GAME_STATE_SCAFFOLD } from "./helpers/game-state";
import { ROOM_SCAFFOLD } from "./helpers/room";

function reactionRoom(source: "night" | "vote", code = "HUNT1"): Room {
  const state: GameState = {
    ...GAME_STATE_SCAFFOLD,
    phase: source === "night" ? "NIGHT_RESULT" : "ELIMINATION",
    round: 1,
    phaseEndsAt: Date.now() + 8_000,
    players: [
      { id: "hunter", name: "Thợ Săn", role: "HUNTER", alive: false, isBot: false },
      { id: "wolf", name: "Sói", role: "WEREWOLF", alive: true, isBot: false },
      { id: "villager-1", name: "Dân 1", role: "VILLAGER", alive: true, isBot: false },
      { id: "villager-2", name: "Dân 2", role: "VILLAGER", alive: true, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG, hunter: true },
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
    hunterReaction: { hunterId: "hunter", source, resolved: false },
    hunterShots: [],
    log: [],
  };

  return {
    ...ROOM_SCAFFOLD,
    code,
    hostId: "villager-1",
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

describe("server Hunter reaction flow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    storeMocks.rooms.clear();
    storeMocks.persistRoom.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the Hunter phase after a night result, times out to skip, then starts discussion", async () => {
    const room = reactionRoom("night");

    continueAfterDeathResult(room, "night");

    expect(room.engine?.state.phase).toBe("HUNTER_SHOT");
    expect(room.engine?.state.phaseEndsAt).toBe(Date.now() + 15_000);

    await vi.advanceTimersByTimeAsync(15_501);

    expect(room.engine?.state.hunterShots).toHaveLength(1);
    expect(room.engine?.state.hunterShots[0].target).toBeNull();
    expect(room.engine?.state.phase).toBe("DAY_DISCUSSION");
  });

  it("finishes a manual vote-source skip after 800 ms and starts night", async () => {
    const room = reactionRoom("vote");
    continueAfterDeathResult(room, "vote");

    submitHunterShot(room, "hunter", null);
    expect(room.engine?.state.phase).toBe("HUNTER_SHOT");

    await vi.advanceTimersByTimeAsync(799);
    expect(room.engine?.state.phase).toBe("HUNTER_SHOT");

    await vi.advanceTimersByTimeAsync(1);
    expect(room.engine?.state.hunterShots).toHaveLength(1);
    expect(room.engine?.state.phase).toBe("NIGHT");
  });

  it("creates exactly one recap when a manual action races the timeout", async () => {
    const room = reactionRoom("night");
    continueAfterDeathResult(room, "night");

    await vi.advanceTimersByTimeAsync(14_900);
    submitHunterShot(room, "hunter", null);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(room.engine?.state.hunterShots).toHaveLength(1);
    expect(room.engine?.state.phase).toBe("DAY_DISCUSSION");
  });

  it("routes the dedicated socket action through the engine-authoritative submit flow", async () => {
    const room = reactionRoom("night", "SOCK1");
    continueAfterDeathResult(room, "night");
    storeMocks.rooms.set(room.code, room);

    const socketHandlers = new Map<string, (payload: unknown) => Promise<void> | void>();
    let connect: ((socket: unknown) => void) | undefined;
    const io = {
      use: vi.fn(),
      on: vi.fn((event: string, callback: (socket: unknown) => void) => {
        if (event === "connection") connect = callback;
      }),
    };
    const socket = {
      data: { playerId: "hunter" },
      handshake: { auth: {} },
      emit: vi.fn(),
      join: vi.fn(async () => undefined),
      leave: vi.fn(async () => undefined),
      on: vi.fn((event: string, callback: (payload: unknown) => Promise<void> | void) => {
        socketHandlers.set(event, callback);
      }),
    };

    setupSocket(io as never);
    connect?.(socket);

    const handler = socketHandlers.get(CLIENT_EVENTS.GAME_HUNTER_SHOT);
    expect(handler).toBeTypeOf("function");
    await handler?.({ targetId: "wolf" });

    expect(room.engine?.state.hunterShots).toHaveLength(1);
    expect(room.engine?.state.hunterShots[0].target?.id).toBe("wolf");
  });
});
