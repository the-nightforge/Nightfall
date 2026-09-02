import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";
import { ROOM_SCAFFOLD } from "./helpers/room";

const calls = vi.hoisted(() => ({ persist: 0, broadcast: 0 }));

const rooms = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("../src/rooms/store", () => ({
  allRooms: () => (rooms.current ? [rooms.current] : []),
  getRoom: () => rooms.current,
  persistRoom: async () => {
    calls.persist++;
  },
  removeRoom: () => undefined,
  createRoom: () => { throw new Error("không dùng"); },
  deletePersistedRoom: async () => undefined,
  setAbandonCheckTimer: () => undefined,
  clearRoomTimers: () => undefined,
  setRoomTimer: () => undefined,
  roomCodeTaken: async () => false,
}));
vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => {
    calls.broadcast++;
  },
  emitToPlayers: () => undefined,
}));
vi.mock("../src/db", () => ({ prisma: { player: { findUnique: async () => null } } }));
vi.mock("../src/redis", () => ({
  redis: { get: async () => null, set: async () => undefined, del: async () => undefined },
  getPlayerRoom: async () => null,
  updateSessionRoom: async () => undefined,
}));
vi.mock("../src/voice/service", () => ({
  destroyVoiceRoom: async () => undefined,
  syncVoicePermissions: async () => undefined,
  voiceViewFor: () => null,
  dropVoiceParticipant: async () => undefined,
}));

const { roomService } = await import("../src/rooms/service");

/*
 * Rate limit một mình KHÔNG đủ.
 *
 * `set-ready` chỉ đòi tư cách THÀNH VIÊN, không đòi quyền chủ phòng, và mỗi
 * lượt gọi tốn một lần ghi Redis cộng một vòng dựng snapshot cho MỌI thành
 * viên. Gửi lại đúng giá trị đang có không đổi gì cả, nên nó không được phép
 * tốn gì cả - chặn ở đây rẻ hơn và đúng nghĩa hơn là chỉ đếm số lượt.
 */
function lobbyRoom(): Room {
  return {
    ...ROOM_SCAFFOLD,
    code: "NOOP1",
    hostId: "host",
    status: "LOBBY",
    members: [
      { playerId: "host", name: "Host", ready: false, connected: true, isBot: false },
      { playerId: "p2", name: "Người 2", ready: false, connected: true, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: null,
    chatLog: [],
    createdAt: Date.now(),
  } as Room;
}

beforeEach(() => {
  calls.persist = 0;
  calls.broadcast = 0;
  rooms.current = lobbyRoom();
});

describe("thao tác không đổi trạng thái", () => {
  it("set-ready lặp lại cùng giá trị chỉ tốn MỘT lượt ghi và MỘT lượt phát", async () => {
    roomService.setReady("p2", true);
    await Promise.resolve();
    await Promise.resolve();

    for (let i = 0; i < 20; i++) roomService.setReady("p2", true);
    await Promise.resolve();
    await Promise.resolve();

    expect(calls.persist).toBe(1);
    expect(calls.broadcast).toBe(1);
  });

  it("đổi thật thì vẫn ghi và phát bình thường", async () => {
    roomService.setReady("p2", true);
    roomService.setReady("p2", false);
    await Promise.resolve();
    await Promise.resolve();

    expect(calls.persist).toBe(2);
  });

  it("cấu hình gửi lại y hệt không tốn lượt ghi nào", async () => {
    const same = { ...DEFAULT_ROOM_CONFIG };
    roomService.updateConfig("host", same);
    await Promise.resolve();
    await Promise.resolve();

    expect(calls.persist).toBe(0);
    expect(calls.broadcast).toBe(0);
  });

  it("cấu hình đổi thật thì vẫn ghi", async () => {
    roomService.updateConfig("host", { ...DEFAULT_ROOM_CONFIG, nightSeconds: 45 });
    await Promise.resolve();
    await Promise.resolve();

    expect(calls.persist).toBe(1);
  });
});
