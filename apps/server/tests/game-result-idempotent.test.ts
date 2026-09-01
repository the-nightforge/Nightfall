import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { GameEngine } from "@masoi/game-engine";
import type { Room } from "../src/rooms/store";

const db = vi.hoisted(() => ({
  created: [] as Array<Record<string, unknown>>,
  failWith: null as { code: string } | null,
}));

vi.mock("../src/db", () => ({
  prisma: {
    gameResult: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (db.failWith) throw db.failWith;
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

function finishedRoom(gameId: string | null = "game-1"): Room {
  const players = Array.from({ length: 6 }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Người ${i + 1}`,
    isBot: false,
  }));
  const engine = GameEngine.create(players, { ...DEFAULT_ROOM_CONFIG });
  engine.finishGame("village");

  return {
    code: "RSULT",
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
    createdAt: Date.now() - 60_000,
    gameId,
    resultWritten: false,
    pendingStep: null,
    phaseSeq: 0,
  };
}

beforeEach(() => {
  db.created.length = 0;
  db.failWith = null;
});

describe("ghi GameResult đúng một lần", () => {
  it("ghi kèm gameId và đánh dấu đã ghi", async () => {
    const room = finishedRoom();

    await writeGameResultOnce(room);

    expect(db.created).toHaveLength(1);
    expect(db.created[0]!.gameId).toBe("game-1");
    expect(db.created[0]!.winner).toBe("village");
    expect(room.resultWritten).toBe(true);
  });

  it("gọi hai lần chỉ ghi một bản ghi", async () => {
    const room = finishedRoom();

    await writeGameResultOnce(room);
    await writeGameResultOnce(room);

    expect(db.created).toHaveLength(1);
  });

  it("coi lỗi trùng khoá là đã ghi xong", async () => {
    const room = finishedRoom();
    db.failWith = { code: "P2002" };

    await writeGameResultOnce(room);

    expect(room.resultWritten).toBe(true);
  });

  it("lỗi khác không đánh dấu đã ghi, để lần khôi phục sau thử lại", async () => {
    const room = finishedRoom();
    db.failWith = { code: "P1001" };

    await writeGameResultOnce(room);

    expect(room.resultWritten).toBe(false);
  });

  it("không ghi khi phòng chưa có gameId", async () => {
    const room = finishedRoom(null);

    await writeGameResultOnce(room);

    expect(db.created).toHaveLength(0);
    expect(room.resultWritten).toBe(false);
  });

  it("không ghi khi ván chưa kết thúc", async () => {
    const room = finishedRoom();
    room.engine!.state.winner = null;

    await writeGameResultOnce(room);

    expect(db.created).toHaveLength(0);
  });
});
