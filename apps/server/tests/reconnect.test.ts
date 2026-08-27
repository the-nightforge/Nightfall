import { describe, expect, it } from "vitest";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { reconnectPlayer, type ReconnectDependencies } from "../src/rooms/reconnect";
import type { Room } from "../src/rooms/store";

function room(connected = false): Room {
  return {
    code: "ABCDE",
    hostId: "player",
    status: "LOBBY",
    members: [
      { playerId: "player", name: "Người chơi", ready: false, connected, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: null,
    chatLog: [],
    createdAt: 0,
  };
}

function dependencies(overrides: Partial<ReconnectDependencies> = {}): ReconnectDependencies {
  return {
    findCachedRoom: () => undefined,
    getPersistedRoomCode: async () => null,
    loadRoom: async () => null,
    clearPersistedRoom: async () => undefined,
    saveRoom: async () => undefined,
    ...overrides,
  };
}

describe("reconnectPlayer", () => {
  it("reconnects from memory without consulting Redis", async () => {
    const cached = room();
    let redisLookups = 0;
    let saves = 0;
    const result = await reconnectPlayer(
      "player",
      dependencies({
        findCachedRoom: () => cached,
        getPersistedRoomCode: async () => {
          redisLookups += 1;
          return null;
        },
        saveRoom: async () => {
          saves += 1;
        },
      }),
    );

    expect(result).toBe(cached);
    expect(cached.members[0].connected).toBe(true);
    expect(redisLookups).toBe(0);
    expect(saves).toBe(1);
  });

  it("loads the room through the persisted player mapping", async () => {
    const persisted = room();
    let loadedCode: string | null = null;
    const result = await reconnectPlayer(
      "player",
      dependencies({
        getPersistedRoomCode: async () => "ABCDE",
        loadRoom: async (code) => {
          loadedCode = code;
          return persisted;
        },
      }),
    );

    expect(loadedCode).toBe("ABCDE");
    expect(result).toBe(persisted);
    expect(persisted.members[0].connected).toBe(true);
  });

  it("clears a stale persisted mapping", async () => {
    let clearedPlayer: string | null = null;
    const result = await reconnectPlayer(
      "player",
      dependencies({
        getPersistedRoomCode: async () => "MISSING",
        clearPersistedRoom: async (playerId) => {
          clearedPlayer = playerId;
        },
      }),
    );

    expect(result).toBeNull();
    expect(clearedPlayer).toBe("player");
  });

  it("clears a mapping when the player is no longer a member", async () => {
    const persisted = room();
    persisted.members[0].playerId = "someone-else";
    let cleared = false;
    const result = await reconnectPlayer(
      "player",
      dependencies({
        getPersistedRoomCode: async () => "ABCDE",
        loadRoom: async () => persisted,
        clearPersistedRoom: async () => {
          cleared = true;
        },
      }),
    );

    expect(result).toBeNull();
    expect(cleared).toBe(true);
  });
});
