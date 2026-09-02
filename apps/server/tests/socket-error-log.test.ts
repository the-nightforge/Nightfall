import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GameError } from "@masoi/game-engine";

// Cùng bộ mock với socket-error-message.test.ts: ws.ts kéo theo prisma và
// ioredis thật ở tầng module, còn test này chỉ cần một hàm thuần trong đó.
vi.mock("../src/rooms/store", () => ({
  allRooms: () => [],
  getRoom: () => undefined,
  persistRoom: async () => undefined,
  createRoom: () => { throw new Error("không dùng"); },
  deletePersistedRoom: async () => undefined,
  removeRoom: () => undefined,
  setAbandonCheckTimer: () => undefined,
  setRoomTimer: () => undefined,
  clearRoomTimers: () => undefined,
}));
vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
  trackSocket: () => undefined,
  untrackSocket: () => undefined,
  hasConnection: () => false,
  setIo: () => undefined,
}));
vi.mock("../src/db", () => ({ prisma: { player: { findUnique: vi.fn() } } }));
vi.mock("../src/redis", () => ({
  redis: { get: async () => null, set: async () => undefined, del: async () => undefined },
  getPlayerRoom: async () => null,
  updateSessionRoom: async () => undefined,
}));
vi.mock("../src/voice/service", () => ({
  issueVoiceToken: async () => ({ ok: false, error: "tắt" }),
  syncVoiceForPlayer: async () => undefined,
  destroyVoiceRoom: async () => undefined,
  syncVoicePermissions: async () => undefined,
  voiceViewFor: () => null,
  dropVoiceParticipant: async () => undefined,
}));

const { RoomError } = await import("../src/rooms/service");
const { socketErrorLog } = await import("../src/ws");

/*
 * Lỗi NGHIỆP VỤ và lỗi LẬP TRÌNH phải đi hai đường khác nhau.
 *
 * Lỗi nghiệp vụ ("Phòng đã đầy") xảy ra hàng trăm lần mỗi ngày và là hành vi
 * đúng - log chúng là tự dìm chết log của mình. Lỗi lập trình thì hiện tại
 * KHÔNG để lại dấu vết nào: chúng đi qua socketErrorMessage rồi thành một câu
 * tiếng Việt gửi cho người chơi, còn phía server im lặng tuyệt đối.
 */
describe("socketErrorLog", () => {
  it("KHÔNG log lỗi nghiệp vụ - chúng là hành vi đúng, không phải sự cố", () => {
    expect(socketErrorLog("room:join", "p1", new RoomError("Phòng đã đầy"))).toBeNull();
    expect(socketErrorLog("game:vote", "p1", new GameError("Chưa tới lượt"))).toBeNull();
  });

  it("KHÔNG log payload sai schema - đó là client cũ, không phải bug", () => {
    const zodErr = z.object({ a: z.string() }).safeParse({ a: 1 });
    expect(zodErr.success).toBe(false);
    if (!zodErr.success) {
      expect(socketErrorLog("room:update-avatar", "p1", zodErr.error)).toBeNull();
    }
  });

  it("CÓ log lỗi không xác định, kèm sự kiện và người chơi", () => {
    const line = socketErrorLog("game:action", "p7", new TypeError("x is not a function"));

    expect(line).not.toBeNull();
    expect(line!.event).toBe("socket.unexpected-error");
    expect(line!.socketEvent).toBe("game:action");
    expect(line!.playerId).toBe("p7");
    expect(line!.name).toBe("TypeError");
  });

  it("không mang theo dữ liệu nhạy cảm - chỉ có đúng các khoá đã khai", () => {
    const line = socketErrorLog("chat:send", "p7", new Error("bể"));

    // Khoá cố định: không có đường nào để payload, chat hay token lọt vào.
    expect(Object.keys(line!).sort()).toEqual(
      ["event", "message", "name", "playerId", "socketEvent", "stack"].sort(),
    );
  });

  it("chịu được thứ bị ném không phải Error", () => {
    const line = socketErrorLog("room:start", "p1", "một chuỗi trần");

    expect(line).not.toBeNull();
    expect(line!.name).toBe("UnknownThrown");
  });
});
