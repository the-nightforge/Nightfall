import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG, type RoomSnapshot } from "@masoi/shared";
import type { Room } from "../src/rooms/store";
import { FallbackBrain } from "../src/bots/fallback-brain";
import { GeminiBrain } from "../src/bots/gemini-brain";
import { BotGovernor, Cooldown } from "../src/bots/governor";
import { OpenAiCompatBrain } from "../src/bots/openai-compat-brain";
import { RandomBrain } from "../src/bots/random-brain";
import type {
  Attempt,
  BotBrain,
  DayDecision,
  HunterShotDecision,
  NightDecision,
} from "../src/bots/types";
import { interpretHunterShot } from "../src/bots/decide";
import { buildHunterPrompt } from "../src/bots/prompt";
import { legalHunterTargets } from "../src/bots/targets";

const brainControl = vi.hoisted(() => ({
  decideHunterShot: vi.fn(),
}));

vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: () => undefined,
  persistRoom: async () => undefined,
  setRoomTimer: (_code: string, fn: () => void, ms: number) => setTimeout(fn, ms),
}));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));

vi.mock("../src/db", () => ({
  prisma: {
    gameResult: {
      create: async () => undefined,
    },
  },
}));

vi.mock("../src/bots", async () => {
  const actual = await vi.importActual<typeof import("../src/bots")>("../src/bots");
  return {
    ...actual,
    botBrain: () => ({
      name: "controlled",
      decideNight: async () => ({ ok: true, value: null }),
      decideDay: async () => ({ ok: true, value: null }),
      decideHunterShot: brainControl.decideHunterShot,
    }),
  };
});

import { continueAfterDeathResult } from "../src/game/machine";

function hunterView(over: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "HUNT1",
    hostId: "villager",
    phase: "HUNTER_SHOT",
    config: { ...DEFAULT_ROOM_CONFIG, hunter: true },
    round: 2,
    phaseEndsAt: Date.now() + 15_000,
    you: {
      id: "hunter",
      name: "Thợ Săn",
      ready: true,
      connected: false,
      role: "HUNTER",
      alive: false,
    },
    players: [
      { id: "hunter", name: "Thợ Săn", alive: false, isBot: true },
      { id: "wolf", name: "Sói", alive: true, isBot: false },
      { id: "villager", name: "Dân", alive: true, isBot: false },
      { id: "dead", name: "Người chết", alive: false, isBot: false },
    ],
    night: null,
    hunterShot: {
      hunterId: "hunter",
      hunterName: "Thợ Săn",
      canAct: true,
      resolved: false,
      target: null,
    },
    hasVoted: false,
    myVote: null,
    noEliminationVoteCount: 0,
    discussionSkip: null,
    votesRevealed: false,
    nightHistory: [],
    hunterShots: [],
    lastNightDeaths: [],
    lastEliminated: null,
    winner: null,
    chatLog: [],
    log: [],
    ...over,
  };
}

function hunterRoom(): Room {
  const state: GameState = {
    phase: "NIGHT_RESULT",
    round: 2,
    phaseEndsAt: Date.now() + 8_000,
    players: [
      { id: "hunter", name: "Thợ Săn", role: "HUNTER", alive: false, isBot: true },
      { id: "wolf", name: "Sói", role: "WEREWOLF", alive: true, isBot: false },
      { id: "villager", name: "Dân", role: "VILLAGER", alive: true, isBot: false },
      { id: "villager-2", name: "Dân 2", role: "VILLAGER", alive: true, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG, hunter: true },
    winner: null,
    night: {
      wolfVotes: {},
      killTarget: null,
      wolvesLocked: true,
      guardTarget: null,
      healTonight: false,
      poisonTarget: null,
      witchSkipped: false,
      seerResults: {},
    },
    votes: {},
    guardPrevious: null,
    healUsed: false,
    poisonUsed: false,
    lastNightDeaths: [{ playerId: "hunter", name: "Thợ Săn" }],
    nightHistory: [],
    lastEliminated: null,
    hunterReaction: { hunterId: "hunter", source: "night", resolved: false },
    hunterShots: [],
    log: [],
  };

  return {
    code: "HUNT1",
    hostId: "villager",
    status: "IN_GAME",
    members: state.players.map((player) => ({
      playerId: player.id,
      name: player.name,
      ready: true,
      connected: !player.isBot,
      isBot: player.isBot,
    })),
    config: { ...state.config },
    engine: new GameEngine(state),
    chatLog: [],
    createdAt: Date.now(),
  };
}

function fakeBrain(
  name: string,
  decide: () => Promise<Attempt<HunterShotDecision>>,
): BotBrain {
  return {
    name,
    decideNight: async (): Promise<Attempt<NightDecision>> => ({ ok: true, value: null }),
    decideDay: async (): Promise<Attempt<DayDecision>> => ({ ok: true, value: null }),
    decideHunterShot: decide,
  };
}

describe("Hunter bot decision", () => {
  it("only offers living non-self targets to the acting Hunter", () => {
    expect(legalHunterTargets(hunterView())).toEqual(["wolf", "villager"]);
    expect(
      legalHunterTargets(
        hunterView({
          hunterShot: {
            hunterId: "hunter",
            hunterName: "Thợ Săn",
            canAct: false,
            resolved: false,
            target: null,
          },
        }),
      ),
    ).toEqual([]);
  });

  it("RandomBrain returns a decision object even when its target is an intentional skip", async () => {
    const brain = new RandomBrain();
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(await brain.decideHunterShot(hunterView())).toEqual({
      ok: true,
      value: { targetId: "wolf" },
    });

    const noTargets = hunterView({
      players: [{ id: "hunter", name: "Thợ Săn", alive: false, isBot: true }],
    });
    expect(await brain.decideHunterShot(noTargets)).toEqual({
      ok: true,
      value: { targetId: null },
    });
    vi.restoreAllMocks();
  });

  it("rejects an illegal AI target but preserves an intentional null skip", () => {
    const outcomes: string[] = [];
    const log = (outcome: string) => outcomes.push(outcome);

    expect(
      interpretHunterShot(hunterView(), { think: "nghi ngờ", targetId: "dead" }, log),
    ).toEqual({ ok: false });
    expect(
      interpretHunterShot(hunterView(), { think: "không chắc", targetId: null }, log),
    ).toEqual({ ok: true, value: { targetId: null } });
    expect(outcomes).toEqual(["illegal_target", "skip"]);
  });

  it("builds a prompt with only legal IDs and keeps targetId optional for skip", () => {
    const prompt = buildHunterPrompt(hunterView());
    expect(prompt?.user).toContain("Bạn vừa chết");
    expect((prompt?.schema.properties.targetId as { enum: string[] }).enum).toEqual([
      "wolf",
      "villager",
    ]);
    expect(prompt?.schema.required).toEqual(["think"]);

    const noTargets = hunterView({
      players: [{ id: "hunter", name: "Thợ Săn", alive: false, isBot: true }],
    });
    expect(buildHunterPrompt(noTargets)).toBeNull();
  });

  it("FallbackBrain tries the next provider after failure and stops on an intentional skip", async () => {
    const second = vi.fn(async () => ({
      ok: true as const,
      value: { targetId: null },
    }));
    const third = vi.fn(async () => ({
      ok: true as const,
      value: { targetId: "wolf" },
    }));
    const chain = new FallbackBrain([
      fakeBrain("bad", async () => ({ ok: false })),
      fakeBrain("skip", second),
      fakeBrain("must-not-run", third),
    ]);

    expect(await chain.decideHunterShot(hunterView())).toEqual({
      ok: true,
      value: { targetId: null },
    });
    expect(second).toHaveBeenCalledTimes(1);
    expect(third).not.toHaveBeenCalled();
  });
});

describe("Hunter provider wiring", () => {
  it("Gemini reuses the Hunter prompt and interpreter", async () => {
    const response = {
      candidates: [
        { content: { parts: [{ text: JSON.stringify({ think: "x", targetId: "wolf" }) }] } },
      ],
    };
    const brain = new GeminiBrain({
      apiKey: "key",
      model: "model",
      governor: new BotGovernor(10),
      cooldown: new Cooldown(),
      timeoutMs: 1_000,
      fetchImpl: async () => new Response(JSON.stringify(response), { status: 200 }),
    });

    expect(await brain.decideHunterShot(hunterView())).toEqual({
      ok: true,
      value: { targetId: "wolf" },
    });
  });

  it("OpenAI-compatible transport preserves an omitted target as an intentional skip", async () => {
    const response = {
      choices: [{ message: { content: JSON.stringify({ think: "không chắc" }) } }],
    };
    const brain = new OpenAiCompatBrain({
      baseUrl: "https://example.test/v1",
      apiKey: "key",
      model: "model",
      governor: new BotGovernor(10),
      cooldown: new Cooldown(),
      timeoutMs: 1_000,
      jsonMode: "prompt",
      fetchImpl: async () => new Response(JSON.stringify(response), { status: 200 }),
    });

    expect(await brain.decideHunterShot(hunterView())).toEqual({
      ok: true,
      value: { targetId: null },
    });
  });
});

describe("Hunter bot scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    brainControl.decideHunterShot.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("falls back before the 15-second phase deadline when the provider hangs and submits once", async () => {
    brainControl.decideHunterShot.mockImplementation(() => new Promise(() => undefined));
    const room = hunterRoom();
    const submit = vi.spyOn(room.engine!, "submitHunterShot");

    continueAfterDeathResult(room, "night");
    expect(brainControl.decideHunterShot).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(14_999);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(room.engine?.state.hunterShots).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("discards a provider result that arrives after the RandomBrain deadline", async () => {
    let resolveProvider!: (attempt: Attempt<HunterShotDecision>) => void;
    brainControl.decideHunterShot.mockImplementation(
      () => new Promise((resolve) => (resolveProvider = resolve)),
    );
    const room = hunterRoom();
    const submit = vi.spyOn(room.engine!, "submitHunterShot");

    continueAfterDeathResult(room, "night");
    await vi.advanceTimersByTimeAsync(14_999);
    expect(submit).toHaveBeenCalledTimes(1);

    resolveProvider({ ok: true, value: { targetId: "wolf" } });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("skips through RandomBrain without calling a provider when no legal target exists", async () => {
    brainControl.decideHunterShot.mockImplementation(() => new Promise(() => undefined));
    const room = hunterRoom();
    for (const player of room.engine!.state.players) {
      if (player.id !== "hunter") player.alive = false;
    }

    continueAfterDeathResult(room, "night");
    await vi.advanceTimersByTimeAsync(0);

    expect(brainControl.decideHunterShot).not.toHaveBeenCalled();
    expect(room.engine?.state.hunterShots).toHaveLength(1);
    expect(room.engine?.state.hunterShots[0].target).toBeNull();
  });
});
