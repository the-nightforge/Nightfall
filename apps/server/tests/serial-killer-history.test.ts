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

/** Ván đã xong với một kết cục cho trước. */
function finishedRoom(winner: "serial_killer" | "draw"): Room {
  const players = Array.from({ length: 6 }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Người ${i + 1}`,
    isBot: false,
  }));
  const config = { ...DEFAULT_ROOM_CONFIG, werewolves: 1, serialKiller: true };
  const engine = GameEngine.create(players, config, 1_000);
  engine.state.players[0].role = "WEREWOLF";
  engine.state.players[1].role = "SERIAL_KILLER";
  for (const player of engine.state.players.slice(2)) player.role = "VILLAGER";

  engine.state.round = 4;
  for (const player of engine.state.players) {
    // Sát Nhân thắng: chỉ nó còn sống. Hoà: không còn ai.
    player.alive = winner === "serial_killer" && player.id === "p2";
  }
  engine.finishGame(winner, 5_000);

  return {
    ...ROOM_SCAFFOLD,
    code: "SKRES",
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
    gameId: `game-${winner}`,
    resultWritten: false,
    pendingStep: null,
    phaseSeq: 0,
  };
}

beforeEach(() => {
  db.created.length = 0;
});

describe("ghi kết quả ván với kết cục mới", () => {
  it("ván Sát Nhân thắng ĐƯỢC ghi xuống DB", async () => {
    await writeGameResultOnce(finishedRoom("serial_killer"));

    expect(db.created).toHaveLength(1);
    expect(db.created[0].winner).toBe("serial_killer");
  });

  it("ván HOÀ cũng được ghi, không bị nuốt mất", async () => {
    /*
     * Cổng duy nhất của hàm này là `if (!state.winner) return` - nghĩa là "ván
     * chưa xong". `"draw"` là một chuỗi truthy nên nó đi qua được, và đó là lý
     * do kết cục hoà phải là một GIÁ TRỊ chứ không phải `null`: một ván hoà ghi
     * thành `null` sẽ biến mất khỏi lịch sử của cả sáu người chơi.
     */
    await writeGameResultOnce(finishedRoom("draw"));

    expect(db.created).toHaveLength(1);
    expect(db.created[0].winner).toBe("draw");
  });
});

function row(winner: string) {
  return {
    roomCode: "ABCDE",
    winner,
    round: 4,
    durationSec: 620,
    playerRoles: [
      { id: "me", name: "Tôi", role: "SERIAL_KILLER", alive: true },
      { id: "other", name: "Người khác", role: "VILLAGER", alive: false },
    ],
    caseFile: null,
    createdAt: new Date("2026-09-03T10:00:00Z"),
  };
}

describe("lịch sử trận đọc đúng kết cục mới", () => {
  it("giữ nguyên serial_killer và draw", () => {
    expect(toHistoryEntry(row("serial_killer"), "me").winner).toBe("serial_killer");
    expect(toHistoryEntry(row("draw"), "me").winner).toBe("draw");
    expect(toHistoryEntry(row("village"), "me").winner).toBe("village");
  });

  it("một kết cục bản build này không hiểu rơi về 'unknown', không làm hỏng trang", () => {
    /*
     * Cột `winner` là CHUỖI TỰ DO do một bản build nào đó ghi ra, đúng như cột
     * `playerRoles`. Ép kiểu thẳng sẽ đẩy một chuỗi lạ vào bảng nhãn ở TRANG
     * CHỦ, và nạn nhân gặp lại đúng màn hình hỏng đó mọi lần vào.
     */
    const entry = toHistoryEntry(row("một_kết_cục_của_tương_lai"), "me");
    expect(entry.winner).toBe("unknown");
    // Dòng lịch sử vẫn còn nguyên đội hình, chỉ là không nói được ai thắng.
    expect(entry.myRole).toBe("SERIAL_KILLER");
    expect(entry.players).toHaveLength(2);
  });
});
