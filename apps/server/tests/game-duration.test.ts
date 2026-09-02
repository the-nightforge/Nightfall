import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { GameEngine } from "@masoi/game-engine";
import type { Room } from "../src/rooms/store";
import { ROOM_SCAFFOLD } from "./helpers/room";

const db = vi.hoisted(() => ({ created: [] as Array<Record<string, unknown>> }));

vi.mock("../src/db", () => ({
  prisma: {
    gameResult: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        db.created.push(data);
        return data;
      },
    },
  },
}));
vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));
vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: () => undefined,
  persistRoom: async () => undefined,
  setRoomTimer: () => undefined,
}));

const { writeGameResultOnce } = await import("../src/game/game-result");

/**
 * `durationSec` phải đo VÁN, không đo PHÒNG.
 *
 * `room.createdAt` đứng yên suốt đời phòng, nên ván thứ hai trong cùng phòng -
 * mỗi lần bấm "Chơi lại" - ghi vào lịch sử một thời lượng gồm cả thời gian chờ
 * ở sảnh CỘNG trọn ván trước. Sai đó nằm lại trong DB vĩnh viễn.
 */
function finishedRoom(overrides: Partial<Room>): Room {
  const players = Array.from({ length: 6 }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Người ${i + 1}`,
    isBot: false,
  }));
  const engine = GameEngine.create(players, { ...DEFAULT_ROOM_CONFIG });
  engine.finishGame("village");

  return {
    ...ROOM_SCAFFOLD,
    code: "DUR01",
    hostId: "p1",
    status: "IN_GAME",
    members: players.map((p) => ({
      playerId: p.id,
      name: p.name,
      ready: true,
      connected: true,
      isBot: false,
    })),
    config: { ...DEFAULT_ROOM_CONFIG },
    engine,
    chatLog: [],
    createdAt: Date.now() - 3_600_000,
    gameId: "game-1",
    resultWritten: false,
    ...overrides,
  } as Room;
}

beforeEach(() => {
  db.created = [];
});

describe("durationSec", () => {
  it("đo từ lúc VÁN bắt đầu, không từ lúc phòng được tạo", async () => {
    // Phòng mở một tiếng trước; ván này mới chạy được hai phút.
    const room = finishedRoom({ startedAt: Date.now() - 120_000 });

    await writeGameResultOnce(room);

    const duration = db.created[0].durationSec as number;
    expect(duration).toBeGreaterThanOrEqual(115);
    expect(duration).toBeLessThanOrEqual(125);
  });

  it("phòng chưa có startedAt vẫn ghi được - ảnh chụp cũ không mang trường này", async () => {
    const room = finishedRoom({ startedAt: undefined });

    await writeGameResultOnce(room);

    // Rơi về createdAt: một tiếng. Vẫn là một con số hợp lệ, không phải NaN.
    const duration = db.created[0].durationSec as number;
    expect(Number.isFinite(duration)).toBe(true);
    expect(duration).toBeGreaterThan(3_000);
  });
});
