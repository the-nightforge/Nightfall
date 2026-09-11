import { describe, expect, it } from "vitest";
import { strategyFor } from "../src/bot/roles/registry";
import { applyPrivateInformation } from "../src/bot/belief/private-info";
import { createSeededRng } from "../src/bot/rng";
import { createBotPersonality } from "../src/bot/personality/personality";
import { createBotBrainState, remember } from "../src/bot/memory/memory-store";
import type {
  BotBrainState,
  BotDecisionContext,
  BotKnowledgeView,
  NightKnowledge,
} from "../src/bot/types";

const PLAYERS = ["me", "a", "b", "c", "d"];

function stateFor(seed = "sorcerer"): BotBrainState {
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

function knowledge(over: Partial<BotKnowledgeView> = {}): BotKnowledgeView {
  return {
    dayOfTruthClaims: {},
    neutralRolesInPlay: [],
    activeEventId: null,
    botId: "me",
    round: 2,
    phase: "NIGHT",
    phaseStartedAt: 0,
    phaseEndsAt: 30_000,
    selfRole: "SORCERER",
    players: PLAYERS.map((id) => ({ id, name: id.toUpperCase(), alive: true })),
    knownRoles: { me: "SORCERER", a: "WEREWOLF" },
    seerResult: null,
    sorcererResult: null,
    night: null,
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
  };
}

function context(over: Partial<BotKnowledgeView> = {}): BotDecisionContext {
  return { knowledge: knowledge(over), visibleChat: [] };
}

function nightContext(targets: string[], over: Partial<BotKnowledgeView> = {}): BotDecisionContext {
  return context({
    night: {
      bonusSecondTargetFor: null,
      canAct: true,
      legalActions: ["SORCERER_CHECK"],
      legalTargets: { ...emptyTargets(), SORCERER_CHECK: targets },
      wolfTarget: null,
      guardPrevious: null,
      healUsed: false,
      poisonUsed: false,
      wolvesLocked: false,
    },
    ...over,
  });
}

function claimAs(state: BotBrainState, actorId: string, role: "SEER" | "APPRENTICE_SEER"): void {
  state.seenEventIds.push(`m-${actorId}`);
  remember(state, {
    id: `claim-${actorId}`,
    sourceId: `m-${actorId}`,
    round: 1,
    phase: "DAY_DISCUSSION",
    type: "ROLE_CLAIM",
    actorId,
    importance: 5,
    pinned: false,
    data: { role },
  });
}

describe("registry Sói Pháp Sư", () => {
  it("SORCERER có chiến lược riêng mang đúng tên vai", () => {
    expect(strategyFor("SORCERER").role).toBe("SORCERER");
  });
});

describe("chiến lược đêm Sói Pháp Sư", () => {
  it("check đúng một người trong danh sách hợp lệ", () => {
    const decision = strategyFor("SORCERER").decideNight(
      nightContext(["b", "c", "d"]),
      stateFor(),
      createSeededRng("one"),
    );

    expect(decision?.action).toBe("SORCERER_CHECK");
    expect(["b", "c", "d"]).toContain(decision?.targetId);
  });

  it("không có lượt soi thì bỏ qua", () => {
    expect(
      strategyFor("SORCERER").decideNight(context(), stateFor(), createSeededRng("x")),
    ).toBeNull();
  });

  it("không bao giờ soi đồng bọn đã biết", () => {
    const decision = strategyFor("SORCERER").decideNight(
      nightContext(["a", "b"]),
      stateFor(),
      createSeededRng("ally"),
    );

    expect(decision?.targetId).toBe("b");
  });

  it("ưu tiên người đang claim dòng Tiên Tri", () => {
    const state = stateFor();
    claimAs(state, "c", "SEER");

    const decision = strategyFor("SORCERER").decideNight(
      nightContext(["b", "c", "d"]),
      state,
      createSeededRng("claim"),
    );

    expect(decision?.targetId).toBe("c");
  });

  it("không claim thì soi người được làng tin nhất", () => {
    const state = stateFor();
    state.trust.b = { score: 40, reasons: [], lastUpdatedRound: 1 };

    const decision = strategyFor("SORCERER").decideNight(
      nightContext(["b", "c", "d"]),
      state,
      createSeededRng("trust"),
    );

    expect(decision?.targetId).toBe("b");
  });

  it("không soi lại người đã xác định dòng Tiên Tri", () => {
    const state = stateFor();
    applyPrivateInformation(
      state,
      knowledge({
        sorcererResult: { targetId: "b", targetName: "B", isSeerLine: true },
      }),
    );

    const decision = strategyFor("SORCERER").decideNight(
      nightContext(["b", "c", "d"]),
      state,
      createSeededRng("seen"),
    );

    expect(decision?.targetId).not.toBe("b");
  });

  it("cùng seed cho cùng mục tiêu", () => {
    const run = () =>
      strategyFor("SORCERER").decideNight(
        nightContext(["b", "c", "d"]),
        stateFor(),
        createSeededRng("same"),
      )?.targetId;

    expect(run()).toBe(run());
  });
});

describe("niềm tin riêng Sói Pháp Sư", () => {
  it("soi trúng dòng Tiên Tri thì gắn cờ seer-line cho mục tiêu", () => {
    const state = stateFor();

    applyPrivateInformation(
      state,
      knowledge({
        sorcererResult: { targetId: "b", targetName: "B", isSeerLine: true },
      }),
    );

    const sighting = state.knownInformation.seerResults.find((m) => m.targetId === "b");
    expect(sighting?.data.seerLine).toBe(true);
  });

  it("soi không trúng thì không gắn gì", () => {
    const state = stateFor();

    applyPrivateInformation(
      state,
      knowledge({
        sorcererResult: { targetId: "b", targetName: "B", isSeerLine: false },
      }),
    );

    expect(state.knownInformation.seerResults).toEqual([]);
  });

  it("áp lại nhiều lần vẫn chỉ một bản ghi", () => {
    const state = stateFor();
    const view = knowledge({
      sorcererResult: { targetId: "b", targetName: "B", isSeerLine: true },
    });

    applyPrivateInformation(state, view);
    applyPrivateInformation(state, view);

    expect(state.knownInformation.seerResults.filter((m) => m.targetId === "b")).toHaveLength(1);
  });

  it("người bị gắn cờ seer-line thì bị đẩy phiếu về phía mình", () => {
    const state = stateFor();
    applyPrivateInformation(
      state,
      knowledge({
        sorcererResult: { targetId: "b", targetName: "B", isSeerLine: true },
      }),
    );

    const bias = strategyFor("SORCERER").voteBias(context(), state);

    expect(bias.b ?? 0).toBeGreaterThan(0);
  });
});
