import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";

/**
 * Bug thật: `kick` gỡ người ta khỏi `room.members` và dừng ở đó.
 *
 * Phòng vẫn ở sảnh chờ, nên lần `join` ngay sau đó không tìm thấy họ trong
 * members, rơi vào nhánh "thành viên mới" và đẩy họ trở lại. Tức là bấm F5 là
 * vào lại được đúng cái phòng vừa đuổi mình - đuổi chỉ là trang trí, và chủ
 * phòng không có cách nào thật sự loại một người phá.
 */

const roomHolder = vi.hoisted(() => ({ room: null as Room | null }));
const notices = vi.hoisted(() => [] as Array<{ ids: string[]; payload: unknown }>);

vi.mock("../src/rooms/store", () => ({
  allRooms: () => (roomHolder.room ? [roomHolder.room] : []),
  createRoom: () => {
    throw new Error("không dùng trong test này");
  },
  deletePersistedRoom: async () => undefined,
  getRoom: (code: string) => (roomHolder.room?.code === code ? roomHolder.room : undefined),
  persistRoom: async () => undefined,
  removeRoom: () => undefined,
  setAbandonCheckTimer: () => undefined,
}));

vi.mock("../src/redis", () => ({
  getPlayerRoom: async () => null,
  updateSessionRoom: async () => undefined,
}));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: (ids: string[], _event: string, payload: unknown) =>
    void notices.push({ ids, payload }),
}));

vi.mock("../src/voice/service", () => ({
  dropVoiceParticipant: async () => undefined,
  destroyVoiceRoom: async () => undefined,
}));

vi.mock("../src/db", () => ({
  prisma: {
    player: {
      findUnique: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        avatarUrl: null,
      }),
    },
  },
}));

const { roomService } = await import("../src/rooms/service");

function lobby(): Room {
  return {
    code: "KICK1",
    hostId: "host",
    status: "LOBBY",
    members: [
      { playerId: "host", name: "Chủ phòng", ready: true, connected: true, isBot: false },
      { playerId: "griefer", name: "Kẻ phá", ready: false, connected: true, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: null,
    chatLog: [],
    createdAt: 0,
    gameId: null,
    resultWritten: false,
    pendingStep: null,
    phaseSeq: 0,
    kickedPlayerIds: [],
  };
}

afterEach(() => {
  roomHolder.room = null;
  notices.length = 0;
});

describe("bị đuổi khỏi phòng chờ", () => {
  it("không vào lại được bằng cách join lần nữa", async () => {
    roomHolder.room = lobby();

    await roomService.kick("host", "griefer");
    expect(roomHolder.room.members.map((m) => m.playerId)).toEqual(["host"]);

    await expect(roomService.join("griefer", "Kẻ phá", "KICK1")).rejects.toThrow(
      "Bạn đã bị loại khỏi phòng này",
    );
    expect(roomHolder.room.members.map((m) => m.playerId)).toEqual(["host"]);
  });

  it("được báo lý do, vì broadcastRoom không còn với tới họ", async () => {
    roomHolder.room = lobby();

    await roomService.kick("host", "griefer");

    expect(notices).toEqual([
      { ids: ["griefer"], payload: { message: "Bạn đã bị chủ phòng loại khỏi phòng" } },
    ]);
  });

  it("người khác vẫn vào phòng đó bình thường", async () => {
    roomHolder.room = lobby();
    await roomService.kick("host", "griefer");

    await roomService.join("newcomer", "Người mới", "KICK1");

    expect(roomHolder.room.members.map((m) => m.playerId)).toEqual(["host", "newcomer"]);
  });
});
