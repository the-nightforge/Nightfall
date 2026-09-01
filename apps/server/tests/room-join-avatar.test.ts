import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";

/**
 * Bug thật: rejoin (existing member) dùng
 * `avatarUrl ?? existing.avatarUrl ?? null`, coi avatarUrl null từ DB là
 * "chưa biết" thay vì "người này không có avatar" - và rớt về bản ghi phòng
 * cũ, thứ có thể còn giữ URL của một avatar đã bị xoá thật sự khỏi DB lẫn
 * bucket (ví dụ khi applyAvatarToRoom no-op lúc server vừa restart và phòng
 * chỉ mới được nạp lại từ Redis). Test này tái tạo đúng tình huống đó ở tầng
 * roomService.join - chỗ duy nhất chứng minh lỗi thật sự lọt ra ngoài, không
 * chỉ ở đơn vị resolveMemberAvatar (đã test riêng ở avatar-legacy.test.ts và
 * luôn trả null đúng - lỗi nằm ở chỗ join() SAU ĐÓ dùng kết quả đó thế nào).
 */

const roomHolder = vi.hoisted(() => ({ room: null as Room | null }));

vi.mock("../src/rooms/store", () => ({
  allRooms: () => (roomHolder.room ? [roomHolder.room] : []),
  createRoom: () => {
    throw new Error("không dùng trong test này");
  },
  deletePersistedRoom: async () => undefined,
  getRoom: (code: string) => (roomHolder.room?.code === code ? roomHolder.room : undefined),
  loadRoomFromRedis: async () => null,
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
  emitToPlayers: () => undefined,
}));

vi.mock("../src/voice/service", () => ({
  dropVoiceParticipant: async () => undefined,
  destroyVoiceRoom: async () => undefined,
}));

// DB là nguồn sự thật: player "p1" đã xoá avatar (avatarUrl null), nhưng bản
// ghi phòng persisted (roomHolder) vẫn còn URL cũ - đúng khoảng lệch mà bug
// khai thác.
const db = vi.hoisted(() => ({
  players: new Map<string, { id: string; avatarUrl: string | null }>(),
}));

vi.mock("../src/db", () => ({
  prisma: {
    player: {
      findUnique: async ({ where }: { where: { id: string } }) => db.players.get(where.id) ?? null,
    },
  },
}));

const { roomService } = await import("../src/rooms/service");

function roomWith(members: Array<{ id: string; avatarUrl: string | null }>): Room {
  return {
    code: "JOIN1",
    hostId: members[0].id,
    status: "LOBBY",
    members: members.map((m) => ({
      playerId: m.id,
      name: m.id,
      ready: false,
      connected: false,
      disconnectedAt: Date.now(),
      isBot: false,
      avatarUrl: m.avatarUrl,
    })),
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: null,
    chatLog: [],
    createdAt: 0,
  };
}

afterEach(() => {
  roomHolder.room = null;
  db.players.clear();
});

describe("roomService.join - avatar null trong DB là sự thật, không phải giá trị thiếu", () => {
  it("người chơi đã xoá avatar (DB null) rejoin phòng còn URL cũ: phải về null, không phục sinh URL cũ", async () => {
    const room = roomWith([{ id: "p1", avatarUrl: "https://cdn.test/masoi/avatars/p1/old.webp" }]);
    roomHolder.room = room;
    db.players.set("p1", { id: "p1", avatarUrl: null });

    await roomService.join("p1", "P1", "join1");

    const member = room.members.find((m) => m.playerId === "p1");
    expect(member?.avatarUrl).toBeNull();
  });

  it("người chơi vẫn còn avatar hợp lệ trong DB rejoin: URL mới từ DB thắng, không phải URL cũ trong phòng", async () => {
    const room = roomWith([{ id: "p1", avatarUrl: "https://cdn.test/masoi/avatars/p1/old.webp" }]);
    roomHolder.room = room;
    db.players.set("p1", { id: "p1", avatarUrl: "https://cdn.test/masoi/avatars/p1/new.webp" });

    await roomService.join("p1", "P1", "join1");

    const member = room.members.find((m) => m.playerId === "p1");
    expect(member?.avatarUrl).toBe("https://cdn.test/masoi/avatars/p1/new.webp");
  });
});
