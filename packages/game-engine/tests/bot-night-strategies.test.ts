import { describe, expect, it } from "vitest";
import { strategyFor } from "../src/bot/roles/registry";
import { BOT_WEIGHTS_V14, BOT_WEIGHTS_V15 } from "../src/bot/config/weights";
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
    GUARDIAN_PROTECT: [],
    HOLY_WATER: [],
    SERIAL_KILL: [],
    MEDIUM_CHECK: [],
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
      selfRole: "VILLAGER",
      players: PLAYERS.map((id) => ({ id, name: id.toUpperCase(), alive: true })),
      knownRoles: {},
      seerResult: null,
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

describe("Tiên Tri", () => {
  const seer = () => strategyFor("SEER");

  it("soi trong danh sách hợp lệ và trả về hành động SEE", () => {
    const decision = seer().decideNight(
      context({ legalActions: ["SEE"], legalTargets: { ...emptyTargets(), SEE: ["a", "b"] } }),
      stateFor(),
      rng(),
    );

    expect(decision!.action).toBe("SEE");
    expect(["a", "b"]).toContain(decision!.targetId);
  });

  it("không soi lại người đã soi rồi", () => {
    // Lượt soi là tài nguyên khan hiếm nhất của phe làng; soi lại là mất trắng.
    const state = stateFor();
    state.seenEventIds.push("seer:a");
    state.knownInformation.seerResults.push({
      id: "SEER_RESULT:seer:a:me",
      sourceId: "seer:a",
      round: 1,
      phase: "NIGHT",
      type: "SEER_RESULT",
      actorId: "me",
      targetId: "a",
      importance: 10,
      pinned: true,
      data: { isWolf: false },
    });

    const decision = seer().decideNight(
      context({ legalActions: ["SEE"], legalTargets: { ...emptyTargets(), SEE: ["a", "b"] } }),
      state,
      rng(),
    );

    expect(decision!.targetId).toBe("b");
  });

  it("bỏ lượt khi mọi người đều đã soi rồi", () => {
    const state = stateFor();
    state.seenEventIds.push("seer:a");
    state.knownInformation.seerResults.push({
      id: "SEER_RESULT:seer:a:me",
      sourceId: "seer:a",
      round: 1,
      phase: "NIGHT",
      type: "SEER_RESULT",
      actorId: "me",
      targetId: "a",
      importance: 10,
      pinned: true,
      data: { isWolf: false },
    });

    const decision = seer().decideNight(
      context({ legalActions: ["SEE"], legalTargets: { ...emptyTargets(), SEE: ["a"] } }),
      state,
      rng(),
    );

    expect(decision).toBeNull();
  });
});

describe("Bảo Vệ", () => {
  const guard = () => strategyFor("GUARD");

  it("không bao giờ chọn mục tiêu của đêm trước", () => {
    const decision = guard().decideNight(
      context({
        legalActions: ["GUARD"],
        legalTargets: { ...emptyTargets(), GUARD: ["a", "b"] },
        guardPrevious: "a",
      }),
      stateFor(),
      rng(),
    );

    expect(decision!.targetId).not.toBe("a");
  });

  it("ưu tiên đỡ người mình tin nhất", () => {
    const state = stateFor();
    state.trust.b = { score: 90, reasons: [], lastUpdatedRound: 2 };
    state.trust.a = { score: 5, reasons: [], lastUpdatedRound: 2 };

    const decision = guard().decideNight(
      context({
        legalActions: ["GUARD"],
        legalTargets: { ...emptyTargets(), GUARD: ["a", "b"] },
      }),
      state,
      rng(),
    );

    expect(decision!.targetId).toBe("b");
  });

});

describe("Phù Thuỷ", () => {
  const witch = () => strategyFor("WITCH");

  it("cứu nạn nhân mình tin tưởng khi bình cứu còn", () => {
    const state = stateFor();
    state.trust.c = { score: 80, reasons: [], lastUpdatedRound: 2 };

    const decision = witch().decideNight(
      context({
        legalActions: ["HEAL", "POISON", "SKIP"],
        legalTargets: { ...emptyTargets(), POISON: ["a", "b", "c"] },
        wolfTarget: "c",
        wolvesLocked: true,
      }),
      state,
      rng(),
    );

    expect(decision!.action).toBe("HEAL");
    // Engine không nhận mục tiêu cho bình cứu.
    expect(decision!.targetId).toBeNull();
  });

  it("không cứu khi HEAL không được chào", () => {
    const state = stateFor();
    state.trust.c = { score: 80, reasons: [], lastUpdatedRound: 2 };

    const decision = witch().decideNight(
      context({
        legalActions: ["POISON", "SKIP"],
        legalTargets: { ...emptyTargets(), POISON: ["a", "b"] },
        wolfTarget: "c",
        wolvesLocked: true,
        healUsed: true,
      }),
      state,
      rng(),
    );

    expect(decision!.action).not.toBe("HEAL");
  });

  it("dùng bình độc lên người bị nghi rất nặng", () => {
    const state = stateFor();
    state.suspicion.a = { score: 100, reasons: [], lastUpdatedRound: 2 };

    const decision = witch().decideNight(
      context({
        legalActions: ["POISON", "SKIP"],
        legalTargets: { ...emptyTargets(), POISON: ["a", "b"] },
      }),
      state,
      rng(),
    );

    expect(decision!.action).toBe("POISON");
    expect(decision!.targetId).toBe("a");
  });

  it("SKIP khi không có lý do dùng bình nào", () => {
    // Bình thuốc dùng một lần cả ván. Tiêu nó vì không nghĩ ra việc gì hay hơn
    // là cách chắc chắn để không còn nó lúc thật sự cần.
    const decision = witch().decideNight(
      context({
        legalActions: ["POISON", "SKIP"],
        legalTargets: { ...emptyTargets(), POISON: ["a", "b"] },
      }),
      stateFor(),
      rng(),
    );

    expect(decision!.action).toBe("SKIP");
    expect(decision!.targetId).toBeNull();
  });

  it("không bao giờ độc người mình tin", () => {
    const state = stateFor();
    state.suspicion.a = { score: 100, reasons: [], lastUpdatedRound: 2 };
    state.trust.a = { score: 100, reasons: [], lastUpdatedRound: 2 };

    const decision = witch().decideNight(
      context({
        legalActions: ["POISON", "SKIP"],
        legalTargets: { ...emptyTargets(), POISON: ["a"] },
      }),
      state,
      rng(),
    );

    expect(decision!.action).toBe("SKIP");
  });
});

describe("P2.2 Phù Thuỷ đừng ôm bình khi làng đã mỏng", () => {
  const poisonThreshold = BOT_WEIGHTS_V15.roleThresholds.witchPoisonSuspicion;
  const discount = BOT_WEIGHTS_V15.roleThresholds.witchPoisonLosingDiscount;
  // Vừa dưới ngưỡng thường, vừa trên ngưỡng đã chiết khấu.
  const borderline = poisonThreshold - discount / 2;

  /** 5 ghế; `dead` ghế đã chết. 3 chết = 2/5 sống = làng mỏng (<= 1/2). */
  const table = (dead: readonly string[]) =>
    PLAYERS.map((id) => ({ id, name: id.toUpperCase(), alive: !dead.includes(id) }));

  const poisonNight = (dead: readonly string[]) =>
    context(
      {
        legalActions: ["POISON", "SKIP"],
        legalTargets: { ...emptyTargets(), POISON: ["a", "b"] },
      },
      { players: table(dead) },
    );

  const rngCalls = (): { rng: () => number; calls: () => number } => {
    let n = 0;
    const inner = createSeededRng("count");
    return { rng: () => (n += 1, inner()), calls: () => n };
  };

  it("v15 là chiết khấu dương; v1..v14 là 0", () => {
    expect(discount).toBeGreaterThan(0);
    expect(BOT_WEIGHTS_V14.roleThresholds.witchPoisonLosingDiscount).toBe(0);
    expect(BOT_WEIGHTS_V14.roleThresholds.witchHealLosingDiscount).toBe(0);
    expect(BOT_WEIGHTS_V15.roleThresholds.thinVillageShare).toBe(0.5);
  });

  it("cùng một mức nghi lưng chừng: làng đông thì giữ bình, làng mỏng thì dùng", () => {
    const state = stateFor();
    state.suspicion.a = { score: borderline, reasons: [], lastUpdatedRound: 2 };
    const witch = strategyFor("WITCH", BOT_WEIGHTS_V15);

    const crowded = witch.decideNight(poisonNight([]), state, rng());
    expect(crowded!.action).toBe("SKIP");

    const thin = witch.decideNight(poisonNight(["b", "c", "d"]), state, rng());
    expect(thin!.action).toBe("POISON");
    expect(thin!.targetId).toBe("a");
  });

  it("làng mỏng vẫn cần bằng chứng: nghi 0 thì vẫn giữ bình", () => {
    const witch = strategyFor("WITCH", BOT_WEIGHTS_V15);
    const thin = witch.decideNight(poisonNight(["b", "c", "d"]), stateFor(), rng());
    expect(thin!.action).toBe("SKIP");
  });

  it("v14 không chiết khấu: làng mỏng vẫn giữ bình ở mức lưng chừng", () => {
    const state = stateFor();
    state.suspicion.a = { score: borderline, reasons: [], lastUpdatedRound: 2 };
    const witch = strategyFor("WITCH", BOT_WEIGHTS_V14);
    expect(witch.decideNight(poisonNight(["b", "c", "d"]), state, rng())!.action).toBe("SKIP");
  });

  it("bình cứu cũng hạ ngưỡng tin cậy một nấc khi làng mỏng", () => {
    const healThreshold = BOT_WEIGHTS_V15.roleThresholds.witchHealTrust;
    const healDiscount = BOT_WEIGHTS_V15.roleThresholds.witchHealLosingDiscount;
    expect(healDiscount).toBeGreaterThan(0);
    const state = stateFor();
    state.trust.c = { score: healThreshold - healDiscount / 2, reasons: [], lastUpdatedRound: 2 };
    const witch = strategyFor("WITCH", BOT_WEIGHTS_V15);
    const night = (dead: readonly string[]) =>
      context(
        {
          legalActions: ["HEAL", "SKIP"],
          legalTargets: emptyTargets(),
          wolfTarget: "c",
          wolvesLocked: true,
        },
        { players: table(dead) },
      );

    expect(witch.decideNight(night([]), state, rng())!.action).toBe("SKIP");
    expect(witch.decideNight(night(["a", "b", "d"]), state, rng())!.action).toBe("HEAL");
  });

  it("không rút thêm một số ngẫu nhiên nào, ở cả hai preset", () => {
    const state = stateFor();
    state.suspicion.a = { score: borderline, reasons: [], lastUpdatedRound: 2 };
    for (const weights of [BOT_WEIGHTS_V14, BOT_WEIGHTS_V15]) {
      const counter = rngCalls();
      strategyFor("WITCH", weights).decideNight(poisonNight(["b", "c", "d"]), state, counter.rng);
      expect(counter.calls()).toBe(0);
    }
  });
});

describe("chung cho mọi chiến lược đêm", () => {
  it("mục tiêu luôn nằm trong legalTargets của đúng hành động", () => {
    const cases = [
      { role: "SEER" as const, action: "SEE" as const, targets: ["a", "b", "c"] },
      { role: "GUARD" as const, action: "GUARD" as const, targets: ["a", "b", "c"] },
    ];

    for (const item of cases) {
      const decision = strategyFor(item.role).decideNight(
        context({
          legalActions: [item.action],
          legalTargets: { ...emptyTargets(), [item.action]: item.targets },
        }),
        stateFor(),
        rng(),
      );
      expect(item.targets).toContain(decision!.targetId);
    }
  });

  it("cùng seed cho cùng quyết định", () => {
    const run = (role: "SEER" | "GUARD" | "WITCH") =>
      JSON.stringify(
        strategyFor(role).decideNight(
          context({
            legalActions: ["SEE", "GUARD", "POISON", "SKIP"],
            legalTargets: {
              ...emptyTargets(),
              SEE: ["a", "b"],
              GUARD: ["a", "b"],
              POISON: ["a", "b"],
            },
          }),
          stateFor("determinism"),
          createSeededRng("same"),
        ),
      );

    for (const role of ["SEER", "GUARD", "WITCH"] as const) {
      expect(run(role)).toBe(run(role));
    }
  });
});
