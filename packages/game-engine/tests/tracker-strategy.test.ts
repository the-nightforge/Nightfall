import { describe, expect, it } from "vitest";
import { strategyFor } from "../src/bot/roles/registry";
import { createSeededRng } from "../src/bot/rng";
import { createBotPersonality } from "../src/bot/personality/personality";
import { createBotBrainState } from "../src/bot/memory/memory-store";
import type {
  BotBrainState,
  BotDecisionContext,
  BotKnowledgeView,
  NightKnowledge,
} from "../src/bot/types";

const PLAYERS = ["me", "a", "b", "c", "d"];

function stateFor(seed = "night"): BotBrainState {
  return createBotBrainState("me", createBotPersonality(createSeededRng(seed)), PLAYERS);
}

function emptyTargets(): NightKnowledge["legalTargets"] {
  return {
    KILL: [],
    SEE: [],
    GUARD: [],
    HEAL: [],
    POISON: [],
    SKIP: [],
    DETECTIVE_CHECK: [],
    SERIAL_KILL: [],
    SORCERER_CHECK: [],
    TRACK: [],
  };
}

function context(
  night: Partial<NightKnowledge>,
  over: Partial<BotKnowledgeView> = {},
): BotDecisionContext {
  return {
    knowledge: {
      dayOfTruthClaims: {},
      neutralRolesInPlay: [],
      activeEventId: null,
      botId: "me",
      round: 2,
      phase: "NIGHT",
      phaseStartedAt: 0,
      phaseEndsAt: 30_000,
      selfRole: "TRACKER",
      players: PLAYERS.map((id) => ({ id, name: id.toUpperCase(), alive: true })),
      knownRoles: {},
      seerResult: null,
      sorcererResult: null,
      night: {
        bonusSecondTargetFor: null,
        canAct: true,
        legalActions: [],
        legalTargets: emptyTargets(),
        wolfTarget: null,
        guardPrevious: null,
        healUsed: false,
        poisonUsed: false,
        wolvesLocked: false,
        ...night,
      },
      trialAccusedId: null,
      canFinalVote: false,
      hunterShot: null,
      publicVoteHistory: [],
      currentVoteCounts: { players: {}, noElimination: 0 },
      hasVoted: false,
      myVote: null,
      legalVoteChoices: [],
      lastNightDeaths: [],
      ...over,
    },
    visibleChat: [],
  };
}

const rng = () => createSeededRng("fixed");

describe("chiến thuật Kẻ Theo Dõi", () => {
  const tracker = () => strategyFor("TRACKER");

  it("theo dõi người ĐÁNG NGỜ nhất - ngược dấu với Thiên Thần cũ", () => {
    // Thiên Thần ưu tiên người đáng tin để che; Kẻ Theo Dõi ưu tiên người đáng
    // ngờ để xác nhận.
    const state = stateFor();
    state.suspicion.a = { score: 5, reasons: [], lastUpdatedRound: 2 };
    state.suspicion.b = { score: 60, reasons: [], lastUpdatedRound: 2 };

    const decision = tracker().decideNight(
      context({ legalActions: ["TRACK"], legalTargets: { ...emptyTargets(), TRACK: ["a", "b"] } }),
      state,
      rng(),
    );

    expect(decision).toEqual(expect.objectContaining({ action: "TRACK", targetId: "b" }));
  });

  it("không có lượt TRACK thì bỏ lượt, không ném", () => {
    const decision = tracker().decideNight(
      context({ legalActions: [], legalTargets: { ...emptyTargets(), TRACK: [] } }),
      stateFor(),
      rng(),
    );

    expect(decision).toBeNull();
  });
});
