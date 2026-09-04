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

vi.mock("../src/redis", () => ({ redis: { status: "ready" } }));

const { writeGameResultOnce } = await import("../src/game/game-result");
const { toHistoryEntry } = await import("../src/http");

/** Ván đã xong, Kẻ Báo Thù đã hoàn thành nhiệm vụ và làng về nhất. */
function finishedRoom(): Room {
  const players = Array.from({ length: 6 }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Người ${i + 1}`,
    isBot: false,
  }));
  const config = { ...DEFAULT_ROOM_CONFIG, werewolves: 1, executioner: true };
  const engine = GameEngine.create(players, config, 1_000);
  engine.state.players[0].role = "WEREWOLF";
  engine.state.players[1].role = "EXECUTIONER";
  for (const player of engine.state.players.slice(2)) player.role = "VILLAGER";
  engine.state.executionerTargets = { p2: "p4" };
  engine.state.round = 3;
  engine.state.personalWins = [
    {
      playerId: "p2",
      name: "Người 2",
      role: "EXECUTIONER",
      condition: "EXECUTIONER_TARGET_LYNCHED",
      round: 2,
    },
  ];
  engine.state.players[0].alive = false;
  engine.state.players[3].alive = false;
  engine.finishGame("village", 5_000);

  return {
    ...ROOM_SCAFFOLD,
    code: "EXRES",
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
    gameId: "game-exec",
    resultWritten: false,
    pendingStep: null,
    phaseSeq: 0,
  };
}

beforeEach(() => {
  db.created.length = 0;
});

describe("kết quả ván ghi lại thắng lợi của Kẻ Báo Thù", () => {
  it("kết cục CHUNG vẫn là village - thắng cá nhân không đổi nó", () => {
    // Câu khẳng định quan trọng nhất của cả nhóm này: sổ thắng cá nhân là một
    // sổ RIÊNG, và nó không được thêm một kết cục thứ năm vào cột `winner`.
    expect(finishedRoom().engine!.state.winner).toBe("village");
  });

  it("thành tích đi vào cột playerRoles cùng đúng điều kiện", async () => {
    await writeGameResultOnce(finishedRoom());

    expect(db.created).toHaveLength(1);
    expect(db.created[0].winner).toBe("village");
    const roles = db.created[0].playerRoles as Array<Record<string, unknown>>;
    const exec = roles.find((p) => p.id === "p2")!;
    expect(exec.role).toBe("EXECUTIONER");
    expect(exec.personalWin).toEqual({
      condition: "EXECUTIONER_TARGET_LYNCHED",
      round: 2,
    });
    // Không ai khác mọc thêm một thành tích.
    expect(roles.filter((p) => p.personalWin !== undefined)).toHaveLength(1);
  });

  it("người đã hoá Thằng Hề được ghi bằng vai CUỐI ván", async () => {
    const room = finishedRoom();
    room.engine!.state.personalWins = [];
    room.engine!.player("p2")!.role = "JESTER";
    room.engine!.player("p2")!.executionerTurned = true;
    room.gameId = "game-exec-turned";

    await writeGameResultOnce(room);

    const roles = db.created[0].playerRoles as Array<Record<string, unknown>>;
    expect(roles.find((p) => p.id === "p2")!.role).toBe("JESTER");
  });
});

function row(personalWin?: { condition: string; round: number }) {
  return {
    roomCode: "ABCDE",
    winner: "village",
    round: 4,
    durationSec: 620,
    playerRoles: [
      { id: "me", name: "Tôi", role: "EXECUTIONER", alive: true, ...(personalWin ? { personalWin } : {}) },
      { id: "other", name: "Người khác", role: "VILLAGER", alive: false },
    ],
    caseFile: null,
    createdAt: new Date("2026-09-03T10:00:00Z"),
  };
}

describe("lịch sử trận đọc đúng thành tích mới", () => {
  it("giữ nguyên điều kiện EXECUTIONER_TARGET_LYNCHED", () => {
    const entry = toHistoryEntry(
      row({ condition: "EXECUTIONER_TARGET_LYNCHED", round: 2 }),
      "me",
    );

    expect(entry.myRole).toBe("EXECUTIONER");
    expect(entry.players[0].personalWin).toEqual({
      condition: "EXECUTIONER_TARGET_LYNCHED",
      round: 2,
    });
  });

  it("một điều kiện bản build này không hiểu bị bỏ, không làm hỏng trang", () => {
    const entry = toHistoryEntry(
      row({ condition: "EXECUTIONER_CỦA_TƯƠNG_LAI", round: 2 }),
      "me",
    );

    expect(entry.players[0].personalWin).toBeUndefined();
    // Dòng lịch sử vẫn còn nguyên đội hình, chỉ thiếu một cái huy hiệu.
    expect(entry.players).toHaveLength(2);
    expect(entry.myRole).toBe("EXECUTIONER");
  });

  it("ván cũ không có thành tích nào đọc lên vẫn đúng", () => {
    expect(toHistoryEntry(row(), "me").players[0].personalWin).toBeUndefined();
  });
});
