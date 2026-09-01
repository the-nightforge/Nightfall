import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";
import { ROOM_SCAFFOLD } from "./helpers/room";

vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: () => undefined,
  persistRoom: async () => undefined,
  // Không tự chạy: test tự gọi runPendingStep để kiểm soát từng bước một.
  setRoomTimer: () => undefined,
}));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));

vi.mock("../src/db", () => ({ prisma: { gameResult: { create: () => Promise.resolve() } } }));

const { startGame } = await import("../src/game/machine");
const { runPendingStep } = await import("../src/game/steps");

function lobby(): Room {
  return {
    ...ROOM_SCAFFOLD,
    code: "WIRED",
    hostId: "p1",
    status: "LOBBY",
    members: Array.from({ length: 6 }, (_, i) => ({
      playerId: `p${i + 1}`,
      name: `Người ${i + 1}`,
      ready: true,
      connected: true,
      isBot: false,
    })),
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: null,
    chatLog: [],
    createdAt: 0,
    gameId: null,
    resultWritten: false,
    pendingStep: null,
    phaseSeq: 0,
  };
}

let room: Room;

beforeEach(() => {
  room = lobby();
});

describe("machine để lại bước chuyển pha lưu được", () => {
  it("startGame sinh gameId và hẹn bước vào đêm", () => {
    startGame(room);

    expect(room.gameId).toMatch(/^[0-9a-f-]{36}$/);
    expect(room.resultWritten).toBe(false);
    expect(room.pendingStep?.name).toBe("beginNight");
    expect(room.pendingStep?.runAt).toBeGreaterThan(Date.now());
  });

  it("chuỗi đêm đi qua đúng thứ tự lockWolves rồi endNight", () => {
    startGame(room);

    runPendingStep(room, room.pendingStep!);
    expect(room.engine!.state.phase).toBe("NIGHT");
    expect(room.pendingStep?.name).toBe("lockWolves");

    runPendingStep(room, room.pendingStep!);
    // Không có Phù Thuỷ chờ thì lockWolves đi thẳng sang kết quả đêm.
    expect(["endNight", "afterDeathResult"]).toContain(room.pendingStep!.name);
  });

  it("bước cũ không chạy lại được sau khi pha đã tiến", () => {
    startGame(room);
    const first = room.pendingStep!;

    runPendingStep(room, first);
    const phaseAfter = room.engine!.state.phase;
    const seqAfter = room.phaseSeq;

    runPendingStep(room, first);

    expect(room.engine!.state.phase).toBe(phaseAfter);
    expect(room.phaseSeq).toBe(seqAfter);
  });

  it("bước sau kết quả đêm mang đúng nguồn", () => {
    startGame(room);
    runPendingStep(room, room.pendingStep!); // beginNight
    runPendingStep(room, room.pendingStep!); // lockWolves

    let guard = 0;
    while (room.pendingStep && room.pendingStep.name !== "afterDeathResult" && guard < 5) {
      runPendingStep(room, room.pendingStep);
      guard += 1;
    }

    expect(room.pendingStep?.name).toBe("afterDeathResult");
    expect(room.pendingStep?.source).toBe("night");
  });
});
