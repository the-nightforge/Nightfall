import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
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

vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: () => undefined,
  persistRoom: async () => undefined,
  setRoomTimer: () => undefined,
}));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));

const { startGame } = await import("../src/game/machine");
const { runPendingStep } = await import("../src/game/steps");
const { RESUME_FLOOR_MS, resumeRoom } = await import("../src/game/resume");
const { clearBotSession } = await import("../src/bots/session-registry");

function lobby(code: string): Room {
  return {
    ...ROOM_SCAFFOLD,
    code,
    hostId: "p1",
    status: "LOBBY",
    members: Array.from({ length: 8 }, (_, i) => ({
      playerId: `p${i + 1}`,
      name: `Người ${i + 1}`,
      ready: true,
      connected: true,
      disconnectedAt: null,
      isBot: i >= 5,
      avatarUrl: null,
    })),
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: null,
    chatLog: [],
    createdAt: Date.now() - 30_000,
    gameId: null,
    resultWritten: false,
    pendingStep: null,
    phaseSeq: 0,
  };
}

/** Chạy các bước chờ tới khi phòng vào đúng pha muốn kiểm. */
function advanceTo(room: Room, phase: string, limit = 12): Room {
  let guard = 0;
  while (room.engine!.state.phase !== phase && room.pendingStep && guard < limit) {
    runPendingStep(room, room.pendingStep);
    guard += 1;
  }
  return room;
}

function gameAt(code: string, phase: string): Room {
  clearBotSession(code);
  const room = lobby(code);
  startGame(room);
  return advanceTo(room, phase);
}

beforeEach(() => {
  db.created.length = 0;
});

describe("resume pha còn hạn", () => {
  it("giữ nguyên phaseEndsAt và hẹn lại đúng bước đang chờ", () => {
    const room = gameAt("RSA01", "NIGHT");
    const deadlineBefore = room.engine!.state.phaseEndsAt;
    const stepBefore = room.pendingStep!.name;

    const outcome = resumeRoom(room);

    expect(outcome).toEqual({ caughtUp: false, extended: false });
    expect(room.engine!.state.phaseEndsAt).toBe(deadlineBefore);
    expect(room.pendingStep!.name).toBe(stepBefore);
  });

  it("token mới nên bước đã hẹn trước restart không chạy được nữa", () => {
    const room = gameAt("RSA02", "NIGHT");
    const stale = room.pendingStep!;

    resumeRoom(room);
    const phaseAfterResume = room.engine!.state.phase;
    runPendingStep(room, stale);

    expect(room.engine!.state.phase).toBe(phaseAfterResume);
  });
});

describe("resume pha thao tác đã hết giờ", () => {
  it("kéo hạn chót lên sàn 10 giây thay vì cắt lượt ngay", () => {
    const room = gameAt("RSB01", "NIGHT");
    room.pendingStep = { ...room.pendingStep!, runAt: Date.now() - 5 * 60_000 };
    const now = Date.now();

    const outcome = resumeRoom(room);

    expect(outcome.extended).toBe(true);
    expect(outcome.caughtUp).toBe(false);
    expect(room.engine!.state.phase).toBe("NIGHT");
    expect(room.engine!.state.phaseEndsAt).toBeGreaterThanOrEqual(now + RESUME_FLOOR_MS - 50);
    expect(room.pendingStep!.runAt).toBeGreaterThanOrEqual(now + RESUME_FLOOR_MS - 50);
  });

  it("còn dưới sàn cũng được kéo lên sàn", () => {
    const room = gameAt("RSB02", "NIGHT");
    room.pendingStep = { ...room.pendingStep!, runAt: Date.now() + 300 };

    const outcome = resumeRoom(room);

    expect(outcome.extended).toBe(true);
    expect(room.engine!.state.phaseEndsAt).toBeGreaterThan(Date.now() + RESUME_FLOOR_MS - 50);
  });

  it("áp dụng cho VOTING", () => {
    const room = gameAt("RSB03", "VOTING");
    room.pendingStep = { ...room.pendingStep!, runAt: Date.now() - 60_000 };

    const outcome = resumeRoom(room);

    expect(outcome.extended).toBe(true);
    expect(room.engine!.state.phase).toBe("VOTING");
  });

  it("giữ nguyên phiếu đã bỏ và lịch sử đổi phiếu", () => {
    const room = gameAt("RSB04", "VOTING");
    const [voter, target] = room.engine!.state.players.filter((p) => p.alive);
    room.engine!.submitVote(voter!.id, target!.id);
    room.engine!.submitVote(voter!.id, null);
    room.pendingStep = { ...room.pendingStep!, runAt: Date.now() - 1_000 };

    resumeRoom(room);

    expect(room.engine!.state.votes[voter!.id]).toBeNull();
    expect(room.engine!.state.voteMutations.length).toBeGreaterThan(0);
  });
});

describe("resume pha chuyển tiếp đã hết giờ", () => {
  it("chạy bù ngay đúng một lần", () => {
    const room = gameAt("RSC01", "NIGHT_RESULT");
    const phaseBefore = room.engine!.state.phase;
    const stale = room.pendingStep!;
    room.pendingStep = { ...stale, runAt: Date.now() - 30_000 };

    const outcome = resumeRoom(room);

    expect(outcome.caughtUp).toBe(true);
    expect(room.engine!.state.phase).not.toBe(phaseBefore);

    const phaseAfter = room.engine!.state.phase;
    runPendingStep(room, stale);
    expect(room.engine!.state.phase).toBe(phaseAfter);
  });

  it("không kéo dài ROLE_REVEAL đã quá hạn", () => {
    clearBotSession("RSC02");
    const room = lobby("RSC02");
    startGame(room);
    room.pendingStep = { ...room.pendingStep!, runAt: Date.now() - 60_000 };

    const outcome = resumeRoom(room);

    expect(outcome.caughtUp).toBe(true);
    expect(room.engine!.state.phase).toBe("NIGHT");
  });
});

describe("resume ở màn kết thúc", () => {
  it("ghi bù GameResult khi process trước chết trước khi kịp ghi", async () => {
    const room = gameAt("RSD01", "NIGHT");
    room.engine!.finishGame("village");
    room.pendingStep = null;
    room.resultWritten = false;

    resumeRoom(room);
    await Promise.resolve();

    expect(db.created).toHaveLength(1);
    expect(db.created[0]!.gameId).toBe(room.gameId);
  });

  it("không ghi lại khi process trước đã ghi xong", async () => {
    const room = gameAt("RSD02", "NIGHT");
    room.engine!.finishGame("wolves");
    room.resultWritten = true;

    resumeRoom(room);
    await Promise.resolve();

    expect(db.created).toHaveLength(0);
  });

  it("không hẹn bước nào sau khi ván đã xong", () => {
    const room = gameAt("RSD03", "NIGHT");
    room.engine!.finishGame("village");
    room.pendingStep = null;

    resumeRoom(room);

    expect(room.pendingStep).toBeNull();
  });
});

describe("resume phòng không đang chơi", () => {
  it("bỏ qua phòng ở sảnh chờ", () => {
    const room = lobby("RSE01");

    expect(resumeRoom(room)).toEqual({ caughtUp: false, extended: false });
  });
});
