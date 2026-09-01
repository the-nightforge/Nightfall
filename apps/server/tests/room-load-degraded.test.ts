import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";

const store = vi.hoisted(() => ({
  data: new Map<string, string>(),
  down: false,
}));

vi.mock("../src/redis", () => ({
  redis: {
    get: async (key: string) => {
      if (store.down) throw new Error("ECONNREFUSED");
      return store.data.get(key) ?? null;
    },
    set: async (key: string, value: string) => {
      if (store.down) throw new Error("ECONNREFUSED");
      store.data.set(key, value);
      return "OK";
    },
    del: async (key: string) => {
      if (store.down) throw new Error("ECONNREFUSED");
      return store.data.delete(key) ? 1 : 0;
    },
    exists: async (key: string) => {
      if (store.down) throw new Error("ECONNREFUSED");
      return store.data.has(key) ? 1 : 0;
    },
    eval: async (_s: string, _n: number, key: string, value: string) => {
      if (store.down) throw new Error("ECONNREFUSED");
      store.data.set(key, value);
      return 1;
    },
  },
}));

vi.mock("../src/voice/service", () => ({
  destroyVoiceRoom: async () => undefined,
  syncVoicePermissions: async () => undefined,
  voiceViewFor: () => null,
  dropVoiceParticipant: async () => undefined,
}));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));

vi.mock("../src/db", () => ({
  prisma: { gameResult: { create: async () => undefined } },
}));

const { loadRoomSnapshot, persistRoom, removeRoom, roomCodeTaken } = await import(
  "../src/rooms/store"
);
const { loadAndResumeRoom } = await import("../src/rooms/load");
const { startGame } = await import("../src/game/machine");
const { runPendingStep } = await import("../src/game/steps");
const { clearBotSession } = await import("../src/bots/session-registry");

function lobby(code: string): Room {
  return {
    code,
    hostId: "p1",
    status: "LOBBY",
    members: Array.from({ length: 8 }, (_, i) => ({
      playerId: `p${i + 1}`,
      name: `Người ${i + 1}`,
      ready: true,
      connected: true,
      disconnectedAt: null,
      isBot: i >= 5,
      avatarUrl: null,
    })),
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: null,
    chatLog: [],
    createdAt: Date.now() - 30_000,
    gameId: null,
    resultWritten: false,
    pendingStep: null,
    phaseSeq: 0,
  };
}

async function persistedNightRoom(code: string): Promise<Room> {
  clearBotSession(code);
  const room = lobby(code);
  startGame(room);
  runPendingStep(room, room.pendingStep!); // vào NIGHT
  await persistRoom(room);
  removeRoom(code);
  return room;
}

beforeEach(() => {
  store.data.clear();
  store.down = false;
});

describe("nạp phòng đang chơi", () => {
  it("KHÔNG còn trả ván đang chơi về sảnh chờ", async () => {
    const before = await persistedNightRoom("LOAD1");

    const result = await loadRoomSnapshot("LOAD1");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.room.status).toBe("IN_GAME");
    expect(result.room.engine).not.toBeNull();
    expect(result.room.engine!.state.phase).toBe("NIGHT");
    expect(result.room.engine!.state.round).toBe(before.engine!.state.round);
    removeRoom("LOAD1");
  });

  it("giữ nguyên vai của từng người sau khi nạp lại", async () => {
    const before = await persistedNightRoom("LOAD2");
    const rolesBefore = before.engine!.state.players.map((p) => `${p.id}:${p.role}`);

    const result = await loadRoomSnapshot("LOAD2");

    expect(result.status === "ok" && result.room.engine!.state.players.map((p) => `${p.id}:${p.role}`)).toEqual(
      rolesBefore,
    );
    removeRoom("LOAD2");
  });

  it("loadAndResumeRoom hẹn lại bước đang chờ", async () => {
    await persistedNightRoom("LOAD3");

    const result = await loadAndResumeRoom("LOAD3");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.room.pendingStep).not.toBeNull();
    expect(result.room.pendingStep!.runAt).toBeGreaterThan(Date.now());
    removeRoom("LOAD3");
  });
});

describe("Redis không truy cập được", () => {
  it("báo unavailable chứ không báo phòng không tồn tại", async () => {
    await persistedNightRoom("LOAD4");
    store.down = true;

    expect((await loadRoomSnapshot("LOAD4")).status).toBe("unavailable");
  });

  it("không dựng phòng mới khi Redis chết", async () => {
    store.down = true;

    const result = await loadRoomSnapshot("KHONG");

    expect(result.status).toBe("unavailable");
    expect(result).not.toHaveProperty("room");
  });

  it("ghi hỏng không ném ra ngoài, ván trong RAM vẫn chạy tiếp", async () => {
    const room = lobby("LOAD5");
    store.down = true;

    await expect(persistRoom(room)).resolves.toBeUndefined();
  });
});

describe("snapshot hỏng", () => {
  it("bị cách ly và báo corrupt, không đoán state", async () => {
    store.data.set("room:LOAD6", '{"persistenceVersion":1,"opSeq":1,"room":{"code":"LOAD6"}}');

    const result = await loadRoomSnapshot("LOAD6");

    expect(result.status).toBe("corrupt");
    expect(store.data.has("room:LOAD6")).toBe(false);
    expect([...store.data.keys()].some((k) => k.includes("quarantine"))).toBe(true);
  });
});

describe("kiểm tra mã phòng đã dùng", () => {
  it("nhận ra mã đã có trong Redis mà không cần dựng lại phòng", async () => {
    await persistedNightRoom("LOAD7");

    expect(await roomCodeTaken("LOAD7")).toBe(true);
    expect(await roomCodeTaken("TRONG")).toBe(false);
  });
});
