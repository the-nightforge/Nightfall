import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ROOM_CONFIG, PRESET_DECKS, type RoomConfig } from "@masoi/shared";
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
  createRoom: () => {
    throw new Error("không dùng");
  },
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

/**
 * Cổng cân bằng và cổng cỡ bàn của `updateConfig` chỉ được gác BỘ BÀI.
 *
 * Kịch bản thật: phòng 10 người áp preset 10, người thứ 11 vào. Bộ bài giờ
 * lệch (điểm 38, dưới ngưỡng 40) và thiếu một ghế. Chuyện đó đúng - host phải
 * sửa bộ bài trước khi bắt đầu, và `start` vẫn chặn. Nhưng bản cũ chấm cân
 * bằng cho MỌI lượt đổi cấu hình, nên ngay cả gạt Phong thư sau cùng hay đổi
 * giây thảo luận cũng bị từ chối bằng BALANCE_UNSTABLE - trong khi lỗi ấy hiện
 * ở cột chính, không ở lớp phủ thiết lập đang mở. Với host, công tắc chỉ đơn
 * giản là không ăn.
 */
function room(members: number, config: RoomConfig): Room {
  return {
    ...ROOM_SCAFFOLD,
    code: "GATE1",
    hostId: "host",
    status: "LOBBY",
    members: Array.from({ length: members }, (_, i) => ({
      playerId: i === 0 ? "host" : `p${i + 1}`,
      name: `P${i + 1}`,
      ready: true,
      connected: true,
      isBot: i > 0,
    })),
    config,
    engine: null,
    chatLog: [],
    createdAt: Date.now(),
  } as Room;
}

/** Preset 10 ở bàn 11 người: lệch về Sói VÀ thiếu ghế - cả hai cổng đều đỏ. */
const STALE_DECK: RoomConfig = { ...PRESET_DECKS[10], mode: "ranked" };

beforeEach(() => {
  calls.persist = 0;
  calls.broadcast = 0;
  rooms.current = room(11, STALE_DECK);
});

describe("updateConfig với bộ bài đang lệch (Ranked)", () => {
  it("vẫn cho gạt add-on Phong thư sau cùng", () => {
    expect(() => roomService.updateConfig("host", { ...STALE_DECK, lastLetter: true })).not.toThrow();
    expect((rooms.current as Room).config.lastLetter).toBe(true);
    expect(calls.persist).toBe(1);
  });

  it("vẫn cho đổi thời gian từng pha", () => {
    expect(() => roomService.updateConfig("host", { ...STALE_DECK, discussionSeconds: 120 })).not.toThrow();
    expect((rooms.current as Room).config.discussionSeconds).toBe(120);
  });

  it("vẫn cho bật voice", () => {
    expect(() => roomService.updateConfig("host", { ...STALE_DECK, voice: true })).not.toThrow();
    expect((rooms.current as Room).config.voice).toBe(true);
  });

  it("cho chuyển Chaos -> Ranked: nút Bắt đầu và thẻ cảnh báo mới là chỗ nói bộ bài lệch", () => {
    rooms.current = room(11, { ...STALE_DECK, mode: "chaos" });
    expect(() => roomService.updateConfig("host", { ...STALE_DECK, mode: "ranked" })).not.toThrow();
    expect((rooms.current as Room).config.mode).toBe("ranked");
  });

  it("vẫn CHẶN một bộ bài mới mà lệch, ở Ranked", () => {
    const worse: RoomConfig = { ...STALE_DECK, werewolves: 4 };
    expect(() => roomService.updateConfig("host", worse)).toThrow(/BALANCE_UNSTABLE/);
    expect(calls.persist).toBe(0);
  });

  it("vẫn CHẶN một bộ bài mới không vừa bàn", () => {
    // Đổi một lá nhưng vẫn giữ tổng 10 lá cho bàn 11 người: cân bằng có thể
    // qua nhưng cỡ bàn thì không.
    const resized: RoomConfig = { ...PRESET_DECKS[11], villagers: (PRESET_DECKS[11].villagers ?? 1) - 1 };
    expect(() => roomService.updateConfig("host", resized)).toThrow();
    expect(calls.persist).toBe(0);
  });

  it("cho áp preset đúng cỡ bàn", () => {
    expect(() => roomService.updateConfig("host", { ...PRESET_DECKS[11], lastLetter: true })).not.toThrow();
    expect((rooms.current as Room).config.werewolves).toBe(PRESET_DECKS[11].werewolves);
    expect((rooms.current as Room).config.lastLetter).toBe(true);
  });
});

describe("updateConfig ở bàn 6-7 người", () => {
  it("cho gạt add-on dù chưa đủ người bắt đầu", () => {
    rooms.current = room(7, { ...DEFAULT_ROOM_CONFIG });
    expect(() => roomService.updateConfig("host", { ...DEFAULT_ROOM_CONFIG, lastLetter: true })).not.toThrow();
    expect((rooms.current as Room).config.lastLetter).toBe(true);
  });
});
