import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { z } from "zod";
import { GameError } from "@masoi/game-engine";
import { updateAvatarPayload } from "@masoi/shared";

// ws.ts (qua rooms/store, rooms/service, ...) kéo theo prisma và ioredis thật
// ở tầng module - đúng lý do hunter-flow.test.ts mock sẵn bốn module dưới đây
// trước khi import "../src/ws". Test này chỉ cần socketErrorMessage (một hàm
// thuần đã tách khỏi setupSocket để test được) nên không cần các mock đó chạy
// đúng logic gì, chỉ cần chúng có mặt để import không chạm mạng/DB thật.
vi.mock("../src/rooms/store", () => ({
  allRooms: () => [],
  getRoom: () => undefined,
  loadRoomFromRedis: async () => null,
  persistRoom: async () => undefined,
  createRoom: () => {
    throw new Error("không dùng trong test này");
  },
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

vi.mock("../src/db", () => ({
  prisma: { player: { findUnique: vi.fn() } },
}));

vi.mock("../src/redis", () => ({
  getPlayerRoom: async () => null,
  updateSessionRoom: async () => undefined,
}));

const { socketErrorMessage } = await import("../src/ws");
const { RoomError } = await import("../src/rooms/service");

describe("socketErrorMessage", () => {
  it("RoomError: dùng nguyên câu tiếng Việt của lỗi nghiệp vụ", () => {
    expect(socketErrorMessage(new RoomError("Phòng đã đầy"))).toBe("Phòng đã đầy");
  });

  it("GameError: dùng nguyên câu tiếng Việt của lỗi nghiệp vụ", () => {
    expect(socketErrorMessage(new GameError("Chưa tới lượt bạn"))).toBe("Chưa tới lượt bạn");
  });

  it("ZodError (client cũ gửi sai hình dạng payload): bảo người dùng tải lại trang", () => {
    // Tái tạo đúng đường thật: client cache cũ gửi room:update-avatar kèm một
    // chuỗi thay vì payload rỗng mà schema hiện tại yêu cầu. updateAvatarPayload
    // đến từ @masoi/shared - một package workspace RIÊNG, build/nạp module
    // theo đường khác với "zod" mà ws.ts tự import. Xác nhận bằng err.name
    // (thứ socketErrorMessage thực sự dùng) chứ không phải instanceof ZodError
    // nhập trực tiếp ở đây: hai "zod" có thể là hai bản build (ESM/CJS) khác
    // nhau tuỳ cách mỗi phía nạp module, nên instanceof xuyên gói có thể sai
    // trong một số cách chạy (ví dụ `tsx` ở dev) dù cùng version - đúng cái
    // bẫy mà socketErrorMessage cố tình né bằng cách so err.name thay vì
    // instanceof.
    let err: unknown;
    try {
      updateAvatarPayload.parse("data:image/png;base64,xxxx");
    } catch (caught) {
      err = caught;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe("ZodError");
    expect(socketErrorMessage(err)).toBe("Phiên bản trang đã cũ, hãy tải lại trang rồi thử lại");
  });

  it("ZodError bất kỳ khác cũng ra cùng câu, không phải câu chung chung vô nghĩa", () => {
    let err: unknown;
    try {
      z.object({ a: z.string() }).parse({});
    } catch (caught) {
      err = caught;
    }
    expect(socketErrorMessage(err)).toBe("Phiên bản trang đã cũ, hãy tải lại trang rồi thử lại");
  });

  it("lỗi thô không xác định: câu chung chung, không rò chi tiết", () => {
    expect(socketErrorMessage(new Error("chi tiết nội bộ không nên lộ ra"))).toBe(
      "Có lỗi xảy ra, vui lòng thử lại",
    );
  });
});
