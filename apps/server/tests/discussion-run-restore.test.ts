import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";
import { clearBotSession } from "../src/bots/session-registry";
import { ROOM_SCAFFOLD } from "./helpers/room";

vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: () => undefined,
  persistRoom: async () => undefined,
  setRoomTimer: (_code: string, fn: () => void, ms: number) => setTimeout(fn, ms),
}));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));

vi.mock("../src/db", () => ({ prisma: {} }));

vi.mock("../src/bots", async () => {
  const actual = await vi.importActual<typeof import("../src/bots")>("../src/bots");
  return {
    ...actual,
    botBrain: () => ({ name: "no-provider", renderDaySpeech: async () => ({ ok: false as const }) }),
  };
});

const { runDiscussionScheduler, cancelDiscussionScheduler, serializeDiscussionRun } =
  await import("../src/game/discussion-scheduler");

function discussionRoom(code = "ROOMR"): Room {
  const players = [
    { id: "human", name: "Người thật", role: "VILLAGER" as const, isBot: false },
    ...Array.from({ length: 4 }, (_, i) => ({
      id: `bot${i + 1}`,
      name: `Bot ${i + 1}`,
      role: (i === 0 ? "WEREWOLF" : "VILLAGER") as "WEREWOLF" | "VILLAGER",
      isBot: true,
    })),
  ];

  const state = {
    phase: "DAY_DISCUSSION",
    round: 2,
    phaseEndsAt: Date.now() + DEFAULT_ROOM_CONFIG.discussionSeconds * 1_000,
    phaseStartedAt: Date.now(),
    players: players.map((p) => ({ id: p.id, name: p.name, role: p.role, alive: true, isBot: p.isBot })),
    config: { ...DEFAULT_ROOM_CONFIG },
    winner: null,
    night: {
      wolfVotes: {},
      killTarget: null,
      wolfSecondaryTarget: null,
      wolfCubRageTonight: false,
      wolvesLocked: false,
      guardTarget: null,
      healTonight: false,
      poisonTarget: null,
      witchSkipped: false,
      seerResults: {},
      sorcererResults: {},
      detectiveTargets: null,
      detectiveResults: {},
    },
    votes: {},
    voteMutations: [],
    dayVoteHistory: [],
    guardPrevious: null,
    alphaShieldUsed: {},
    apprenticeAwakened: false,
    wolfCubRageNextNight: false,
    healUsed: false,
    poisonUsed: false,
    lastNightDeaths: [],
    nightHistory: [],
    lastEliminated: null,
    trial: null,
    lastTrial: null,
    hunterReaction: null,
    hunterShots: [],
    activeEvent: null,
    eventHistory: [],
    log: [],
    pendingLastStandVictim: null,
    bloodMoonArmed: false,
    bloodMoonUsed: false,
    deadCanSpeakUsed: false,
    deadCanSpeakChosenId: null,
    howlBonusDay: null,
    dayOfTruthClaims: {},
  } as unknown as GameState;

  return {
    ...ROOM_SCAFFOLD,
    code,
    hostId: "human",
    status: "IN_GAME",
    members: players.map((p) => ({
      playerId: p.id,
      name: p.name,
      ready: true,
      connected: true,
      isBot: p.isBot,
    })),
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: new GameEngine(state),
    chatLog: [],
    createdAt: 0,
    gameId: "g-1",
    resultWritten: false,
    pendingStep: null,
    phaseSeq: 0,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllTimers();
});

describe("khôi phục phiên thảo luận", () => {
  it("trả null khi phòng chưa mở phiên nào", () => {
    expect(serializeDiscussionRun("KHONG")).toBeNull();
  });

  it("ghi lại bộ đếm đúng bằng số câu bot đã phát", async () => {
    const room = discussionRoom("RUNAA");
    clearBotSession(room.code);

    runDiscussionScheduler(room);
    await vi.advanceTimersByTimeAsync(20_000);

    const dumped = serializeDiscussionRun(room.code)!;
    const botLines = room.chatLog.filter((m) => m.playerId.startsWith("bot"));

    expect(dumped.round).toBe(2);
    expect(dumped.total).toBe(botLines.length);
    expect(botLines.length).toBeGreaterThan(0);
  });

  it("phiên khôi phục tiếp tục bộ đếm nên không sinh id tin nhắn trùng", async () => {
    const room = discussionRoom("RUNBB");
    clearBotSession(room.code);

    runDiscussionScheduler(room);
    await vi.advanceTimersByTimeAsync(20_000);
    const dumped = serializeDiscussionRun(room.code)!;
    cancelDiscussionScheduler(room.code);

    // Process "chết" rồi sống lại: phiên mới mở với bộ đếm đã khôi phục.
    runDiscussionScheduler(room, dumped);
    await vi.advanceTimersByTimeAsync(30_000);

    const ids = room.chatLog.filter((m) => m.playerId.startsWith("bot")).map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(dumped.total);
  });

  it("bỏ qua ảnh chụp của vòng khác", async () => {
    const room = discussionRoom("RUNCC");
    clearBotSession(room.code);

    runDiscussionScheduler(room, {
      round: 99,
      phaseEndsAt: null,
      total: 5,
      lastAt: 0,
      spoken: { bot1: 3 },
      lastSpokenAt: {},
      messageDepths: {},
      replyCounts: {},
    });

    expect(serializeDiscussionRun(room.code)!.total).toBe(0);
  });
});
