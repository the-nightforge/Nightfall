import { beforeEach, describe, expect, it, vi } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";
import type { PendingStepName } from "../src/game/pending-step";
import { ROOM_SCAFFOLD } from "./helpers/room";

const timers = vi.hoisted(() => ({ scheduled: [] as Array<{ fn: () => void; ms: number }> }));

vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: () => undefined,
  persistRoom: async () => undefined,
  setRoomTimer: (_code: string, fn: () => void, ms: number) => {
    timers.scheduled.push({ fn, ms });
  },
}));

const { armStep, clearPendingStep, phaseToken, registerStepHandlers, runPendingStep } =
  await import("../src/game/steps");

const ran: string[] = [];

function handlers(): Record<PendingStepName, (room: Room) => void> {
  const names: PendingStepName[] = [
    "beginNight",
    "lockWolves",
    "endNight",
    "beginVoting",
    "endVoting",
    "beginFinalVote",
    "endFinalVote",
    "afterDeathResult",
    "timeoutHunterShot",
    "finishHunterShot",
  ];
  return Object.fromEntries(names.map((name) => [name, (_room: Room) => void ran.push(name)])) as Record<
    PendingStepName,
    (room: Room) => void
  >;
}

function inGameRoom(): Room {
  const state = {
    phase: "NIGHT",
    round: 1,
    phaseEndsAt: Date.now() + 30_000,
    phaseStartedAt: Date.now(),
    players: [{ id: "p1", name: "A", role: "VILLAGER", alive: true, isBot: false }],
    config: { ...DEFAULT_ROOM_CONFIG },
    winner: null,
    night: { wolfVotes: {}, killTarget: null, seerResults: {} },
    votes: {},
    log: [],
  } as unknown as GameState;

  return {
    ...ROOM_SCAFFOLD,
    code: "STEPS",
    hostId: "p1",
    status: "IN_GAME",
    members: [{ playerId: "p1", name: "A", ready: true, connected: true, isBot: false }],
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: new GameEngine(state),
    chatLog: [],
    createdAt: 0,
    gameId: "g1",
    resultWritten: false,
    pendingStep: null,
    phaseSeq: 0,
  };
}

beforeEach(() => {
  ran.length = 0;
  timers.scheduled.length = 0;
  registerStepHandlers(handlers());
});

describe("phase token", () => {
  it("gồm vòng, pha và số thứ tự bước", () => {
    const room = inGameRoom();
    expect(phaseToken(room)).toBe("1:NIGHT:0");
    armStep(room, { name: "lockWolves" }, 1_000);
    expect(phaseToken(room)).toBe("1:NIGHT:1");
  });
});

describe("armStep", () => {
  it("ghi lại bước đang chờ với mốc tuyệt đối", () => {
    const room = inGameRoom();
    const before = Date.now();

    armStep(room, { name: "endNight" }, 5_000);

    expect(room.pendingStep!.name).toBe("endNight");
    expect(room.pendingStep!.runAt).toBeGreaterThanOrEqual(before + 5_000);
    expect(timers.scheduled).toHaveLength(1);
    expect(timers.scheduled[0]!.ms).toBe(5_000);
  });

  it("giữ tham số source của afterDeathResult", () => {
    const room = inGameRoom();
    armStep(room, { name: "afterDeathResult", source: "vote" }, 100);
    expect(room.pendingStep!.source).toBe("vote");
  });
});

describe("chống chạy hai lần", () => {
  it("chạy bước mang token hiện tại", () => {
    const room = inGameRoom();
    armStep(room, { name: "endNight" }, 10);

    runPendingStep(room, room.pendingStep!);

    expect(ran).toEqual(["endNight"]);
  });

  it("bỏ qua bước mang token của vòng đã qua", () => {
    const room = inGameRoom();
    armStep(room, { name: "endNight" }, 10);
    const stale = room.pendingStep!;

    room.engine!.state.round = 2;
    runPendingStep(room, stale);

    expect(ran).toEqual([]);
  });

  it("bỏ qua bước mang token của pha đã qua", () => {
    const room = inGameRoom();
    armStep(room, { name: "endNight" }, 10);
    const stale = room.pendingStep!;

    room.engine!.state.phase = "DAY_DISCUSSION";
    runPendingStep(room, stale);

    expect(ran).toEqual([]);
  });

  it("một lần arm mới làm bước cũ hết hiệu lực dù cùng pha và cùng vòng", () => {
    const room = inGameRoom();
    armStep(room, { name: "lockWolves" }, 100);
    const first = room.pendingStep!;

    armStep(room, { name: "endNight" }, 100);
    runPendingStep(room, first);

    expect(ran).toEqual([]);
  });

  it("chạy cùng một bước hai lần chỉ có tác dụng một lần", () => {
    const room = inGameRoom();
    armStep(room, { name: "endNight" }, 10);
    const step = room.pendingStep!;

    runPendingStep(room, step);
    runPendingStep(room, step);

    expect(ran).toEqual(["endNight"]);
  });

  it("không chạy khi phòng không còn engine", () => {
    const room = inGameRoom();
    armStep(room, { name: "endNight" }, 10);
    const step = room.pendingStep!;

    room.engine = null;
    runPendingStep(room, step);

    expect(ran).toEqual([]);
  });
});

describe("clearPendingStep", () => {
  it("xoá bước đang chờ và làm token cũ hết hiệu lực", () => {
    const room = inGameRoom();
    armStep(room, { name: "endNight" }, 10);
    const step = room.pendingStep!;

    clearPendingStep(room);
    runPendingStep(room, step);

    expect(room.pendingStep).toBeNull();
    expect(ran).toEqual([]);
  });
});
