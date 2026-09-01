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
    gameId: null,
    resultWritten: false,
    pendingStep: null,
    phaseSeq: 0,
  };
}

function dependencies(overrides: Partial<ReconnectDependencies> = {}): ReconnectDependencies {
  return {
    findCachedRoom: () => undefined,
    getPersistedRoomCode: async () => null,
    loadRoom: async () => ({ status: "missing" }),
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

    expect(result).toEqual({ status: "joined", room: cached });
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
          return { status: "ok", room: persisted };
        },
      }),
    );

    expect(loadedCode).toBe("ABCDE");
    expect(result).toEqual({ status: "joined", room: persisted });
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

    expect(result).toEqual({ status: "none" });
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
        loadRoom: async () => ({ status: "ok", room: persisted }),
        clearPersistedRoom: async () => {
          cleared = true;
        },
      }),
    );

    expect(result).toEqual({ status: "none" });
    expect(cleared).toBe(true);
  });

  it("giữ nguyên đường về phòng khi Redis tạm thời không đọc được", async () => {
    let cleared = false;
    const result = await reconnectPlayer(
      "player",
      dependencies({
        getPersistedRoomCode: async () => "ABCDE",
        loadRoom: async () => ({ status: "unavailable" }),
        clearPersistedRoom: async () => {
          cleared = true;
        },
      }),
    );

    // Một lần Redis chớp mắt không được phép cắt đứt đường về phòng: người chơi
    // thử lại sau vài giây phải về đúng ván cũ.
    expect(result).toEqual({ status: "unavailable" });
    expect(cleared).toBe(false);
  });

  it("báo riêng trường hợp snapshot hỏng và dọn mapping", async () => {
    let cleared = false;
    const result = await reconnectPlayer(
      "player",
      dependencies({
        getPersistedRoomCode: async () => "ABCDE",
        loadRoom: async () => ({ status: "corrupt", reason: "schema-mismatch" }),
        clearPersistedRoom: async () => {
          cleared = true;
        },
      }),
    );

    expect(result).toEqual({ status: "corrupt" });
    expect(cleared).toBe(true);
  });
});
