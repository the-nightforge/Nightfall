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

/** Ván đã xong, trong đó Thằng Hề bị treo ở vòng 2 rồi làng thắng. */
function finishedRoom(): Room {
  const players = Array.from({ length: 6 }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Người ${i + 1}`,
    isBot: false,
  }));
  const config = { ...DEFAULT_ROOM_CONFIG, werewolves: 1, jester: true };
  const engine = GameEngine.create(players, config, 1_000);
  engine.state.players[0].role = "WEREWOLF";
  engine.state.players[1].role = "JESTER";
  for (const player of engine.state.players.slice(2)) player.role = "VILLAGER";

  engine.state.round = 2;
  engine.setPhase("VOTING", 30_000, 1_000);
  for (const voter of engine.alivePlayers()) {
    if (voter.id !== "p2") engine.submitVote(voter.id, "p2", 2_000);
  }
  engine.resolveNomination(25_000, 3_000);
  engine.beginFinalVote(20_000, 3_000);
  for (const voter of engine.finalVoters()) engine.submitFinalVote(voter.id, true);
  engine.resolveFinalVote(4_000);
  engine.finishGame("village", 5_000);

  return {
    ...ROOM_SCAFFOLD,
    code: "JESTR",
    hostId: "p1",
    status: "IN_GAME",
    members: players.map((p) => ({
      playerId: p.id,
      name: p.name,
      ready: true,
      connected: true,
      isBot: false,
    })),
    config,
    engine,
    chatLog: [],
    createdAt: Date.now() - 60_000,
    gameId: "game-jester",
    resultWritten: false,
    pendingStep: null,
    phaseSeq: 0,
  };
}

beforeEach(() => {
  db.created.length = 0;
});

describe("ghi kết quả ván có Thằng Hề", () => {
  it("thắng lợi cá nhân đi vào cột playerRoles, cạnh chính người đạt được nó", () => {
    // Cột Json nên không cần migration - đúng đường mà `id` đã đi trước đây.
    return writeGameResultOnce(finishedRoom()).then(() => {
      const roles = db.created[0].playerRoles as Array<Record<string, unknown>>;
      expect(roles[1]).toEqual({
        id: "p2",
        name: "Người 2",
        role: "JESTER",
        alive: false,
        personalWin: { condition: "JESTER_LYNCHED", round: 2 },
      });
    });
  });

  it("người không có thành tích thì KHÔNG mọc thêm trường rỗng", () => {
    // Một `personalWin: null` cho mọi người sẽ làm mỗi dòng lịch sử nặng thêm
    // mà không nói gì, và nó cũng làm ván cũ khác hình dạng ván mới một cách vô
    // ích - trong khi cả hai đều nghĩa là "không có".
    return writeGameResultOnce(finishedRoom()).then(() => {
      const roles = db.created[0].playerRoles as Array<Record<string, unknown>>;
      expect(roles[0]).toEqual({ id: "p1", name: "Người 1", role: "WEREWOLF", alive: true });
      expect("personalWin" in roles[0]).toBe(false);
    });
  });

  it("phe thắng chung vẫn là làng - thành tích cá nhân không đổi nó", () => {
    return writeGameResultOnce(finishedRoom()).then(() => {
      expect(db.created[0].winner).toBe("village");
    });
  });
});
