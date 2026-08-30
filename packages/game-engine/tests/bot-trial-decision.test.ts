import { describe, expect, it } from "vitest";
import { GameEngine } from "../src/engine";
import { BotRuntime } from "../src/bot/BotRuntime";
import { createSeededRng } from "../src/bot/rng";
import { createBotPersonality } from "../src/bot/personality/personality";
import { createBotBrainState } from "../src/bot/memory/memory-store";
import { decideFinalVote, decideHunterShot } from "../src/bot/decision/trial-decision";
import { DEFAULT_ROOM_CONFIG, type RoomConfig } from "@masoi/shared";
import type {
  BotBrainState,
  BotDecisionContext,
  BotKnowledgeView,
} from "../src/bot/types";

const PLAYERS = ["me", "a", "b", "c"];

function stateFor(seed = "trial"): BotBrainState {
  return createBotBrainState("me", createBotPersonality(createSeededRng(seed)), PLAYERS);
}

function context(over: Partial<BotKnowledgeView> = {}): BotDecisionContext {
  return {
    knowledge: {
      dayOfTruthClaims: {},
      activeEventId: null,
      botId: "me",
      round: 2,
      phase: "FINAL_VOTE",
      phaseStartedAt: 0,
      phaseEndsAt: 30_000,
      selfRole: "VILLAGER",
      players: PLAYERS.map((id) => ({ id, name: id.toUpperCase(), alive: true })),
      knownRoles: { me: "VILLAGER" },
      seerResult: null,
      night: null,
      trialAccusedId: "a",
      canFinalVote: true,
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

describe("decideFinalVote", () => {
  it("Treo khi nghi ngờ vượt ngưỡng", () => {
    const state = stateFor();
    state.suspicion.a = { score: 95, reasons: [], lastUpdatedRound: 2 };

    expect(decideFinalVote(context(), state, rng()).guilty).toBe(true);
  });

  it("TREO khi không biết gì, vì tới được phiên toà nghĩa là làng đã chỉ vào người này", () => {
    // Test này từng khẳng định điều NGƯỢC LẠI ("không biết gì thì tha"), với lý
    // do mặc định Treo sẽ biến phiên toà thành một vụ hành quyết.
    //
    // Harness ở Task 9 bác bỏ: với mặc định Tha, phe làng thua 30/30 ván. Không
    // ai bị kết án nên không có lịch sử phiếu, nên nghi ngờ mãi bằng 0, nên
    // không ai bị kết án - một vòng lặp chết. Điều bị bỏ sót là đa số làng ĐÃ
    // chỉ vào bị cáo trước khi tới đây; tha vì bản thân chưa có bằng chứng
    // riêng là vứt bỏ phán đoán tập thể và tiêu một ngày.
    expect(decideFinalVote(context(), stateFor(), rng()).guilty).toBe(true);
  });

  it("THA khi có lý do TÍCH CỰC tin bị cáo vô tội", () => {
    const state = stateFor();
    state.trust.a = { score: 100, reasons: [], lastUpdatedRound: 2 };

    expect(decideFinalVote(context(), state, rng()).guilty).toBe(false);
  });

  it("Tiên Tri soi sạch thì tha, dù cả làng đã đề cử", () => {
    const bot = new BotRuntime({
      playerId: "me",
      rng: createSeededRng("clear"),
      playerIds: PLAYERS,
    });
    bot.observe(
      context({
        selfRole: "SEER",
        seerResult: { targetId: "a", targetName: "A", isWolf: false },
      }),
    );

    expect(decideFinalVote(context({ selfRole: "SEER" }), bot.state, rng()).guilty).toBe(
      false,
    );
  });

  it("Sói KHÔNG BAO GIỜ treo đồng bọn, kể cả khi đồng bọn bị nghi kịch trần", () => {
    const state = stateFor();
    state.suspicion.a = { score: 100, reasons: [], lastUpdatedRound: 2 };

    const decision = decideFinalVote(
      context({
        selfRole: "WEREWOLF",
        knownRoles: { me: "WEREWOLF", a: "WEREWOLF" },
      }),
      state,
      rng(),
    );

    expect(decision.guilty).toBe(false);
  });

  it("Tiên Tri soi trúng Sói thì Treo chắc chắn", () => {
    const state = stateFor();
    const bot = new BotRuntime({
      playerId: "me",
      rng: createSeededRng("seer"),
      playerIds: PLAYERS,
    });
    bot.observe(
      context({
        selfRole: "SEER",
        seerResult: { targetId: "a", targetName: "A", isWolf: true },
      }),
    );
    void state;

    expect(decideFinalVote(context({ selfRole: "SEER" }), bot.state, rng()).guilty).toBe(
      true,
    );
  });

  it("không có bị cáo thì Tha, không ném", () => {
    expect(
      decideFinalVote(context({ trialAccusedId: null }), stateFor(), rng()).guilty,
    ).toBe(false);
  });

  it("cùng seed cho cùng phán quyết", () => {
    const run = () => decideFinalVote(context(), stateFor("same"), createSeededRng("s"));
    expect(run()).toEqual(run());
  });
});

describe("decideHunterShot", () => {
  const hunterContext = (targets: string[], over: Partial<BotKnowledgeView> = {}) =>
    context({
      phase: "HUNTER_SHOT",
      selfRole: "HUNTER",
      knownRoles: { me: "HUNTER" },
      hunterShot: { canAct: true, legalTargets: targets },
      ...over,
    });

  it("bắn người bị nghi nặng nhất", () => {
    const state = stateFor();
    state.suspicion.b = { score: 95, reasons: [], lastUpdatedRound: 2 };
    state.suspicion.a = { score: 10, reasons: [], lastUpdatedRound: 2 };

    expect(decideHunterShot(hunterContext(["a", "b"]), state, rng()).targetId).toBe("b");
  });

  it("KHÔNG bắn khi không ai vượt ngưỡng", () => {
    // Bắn bừa lúc chết là cách nhanh nhất để phe làng tự sát.
    expect(decideHunterShot(hunterContext(["a", "b"]), stateFor(), rng()).targetId).toBeNull();
  });

  it("không tự bắn mình", () => {
    const state = stateFor();
    state.suspicion.me = { score: 100, reasons: [], lastUpdatedRound: 2 };

    expect(
      decideHunterShot(hunterContext(["me", "a"]), state, rng()).targetId,
    ).not.toBe("me");
  });

  it("Sói không bắn đồng bọn", () => {
    const state = stateFor();
    state.suspicion.a = { score: 100, reasons: [], lastUpdatedRound: 2 };

    const decision = decideHunterShot(
      hunterContext(["a"], { knownRoles: { me: "WEREWOLF", a: "WEREWOLF" } }),
      state,
      rng(),
    );

    expect(decision.targetId).toBeNull();
  });

  it("không có lượt bắn thì trả null", () => {
    expect(
      decideHunterShot(context({ hunterShot: null }), stateFor(), rng()).targetId,
    ).toBeNull();
  });
});

describe("BotRuntime · phương thức mới", () => {
  const runtime = () =>
    new BotRuntime({ playerId: "me", rng: createSeededRng("rt"), playerIds: PLAYERS });

  it("decideNight uỷ quyền cho strategy của đúng vai", () => {
    const bot = runtime();
    const decision = bot.decideNight(
      context({
        phase: "NIGHT",
        selfRole: "SEER",
        night: {
          bonusSecondTargetFor: null,
          canAct: true,
          legalActions: ["SEE"],
          legalTargets: {
            KILL: [],
            SEE: ["a", "b"],
            GUARD: [],
            HEAL: [],
            POISON: [],
            SKIP: [],
            DETECTIVE_CHECK: [],
            GUARDIAN_PROTECT: [],
            HOLY_WATER: [],
          },
          wolfTarget: null,
          guardPrevious: null,
          healUsed: false,
          poisonUsed: false,
          wolvesLocked: false,
        },
      }),
    );

    expect(decision!.action).toBe("SEE");
  });

  it("decideNight trả null cho vai không có hành động đêm", () => {
    expect(runtime().decideNight(context({ phase: "NIGHT" }))).toBeNull();
  });

  it("decideFinalVote và decideHunterShot có trên runtime", () => {
    const bot = runtime();
    expect(bot.decideFinalVote(context())).toHaveProperty("guilty");
    expect(bot.decideHunterShot(context())).toHaveProperty("targetId");
  });
});

describe("engine cấp thông tin phiên toà và Thợ Săn", () => {
  const CONFIG: RoomConfig = {
    ...DEFAULT_ROOM_CONFIG,
    werewolves: 2,
    seer: true,
    guard: true,
    witch: true,
    hunter: false,
  };

  function engineAtTrial() {
    const engine = GameEngine.create(
      Array.from({ length: 6 }, (_, i) => ({ id: `p${i + 1}`, name: `N${i + 1}`, isBot: true })),
      CONFIG,
    );
    (["WEREWOLF", "WEREWOLF", "SEER", "GUARD", "WITCH", "VILLAGER"] as const).forEach(
      (role, i) => {
        engine.state.players[i].role = role;
      },
    );
    engine.setPhase("NIGHT", 30_000, 0);
    engine.setPhase("DAY_DISCUSSION", 60_000, 0);
    engine.setPhase("VOTING", 30_000, 0);
    for (const voter of engine.alivePlayers()) {
      if (voter.id !== "p6") engine.submitVote(voter.id, "p6", 10_000);
    }
    engine.resolveNomination(25_000, 30_000);
    return engine;
  }

  it("bị cáo là thông tin công khai trong phiên toà", () => {
    const e = engineAtTrial();
    expect(e.botKnowledgeFor("p1").trialAccusedId).toBe("p6");
  });

  it("ngoài phiên toà thì không có bị cáo", () => {
    const e = engineAtTrial();
    e.setPhase("NIGHT", 30_000, 0);
    expect(e.botKnowledgeFor("p1").trialAccusedId).toBeNull();
  });

  it("phiếu Treo/Tha của người khác không bao giờ lộ", () => {
    const e = engineAtTrial();
    e.beginFinalVote(20_000, 40_000);
    e.submitFinalVote("p1", true);
    e.submitFinalVote("p2", false);

    const view = e.botKnowledgeFor("p3");
    expect(JSON.stringify(view)).not.toContain("finalVotes");
    // Không được suy ra ai bỏ phiếu gì khi phiên toà còn mở.
    expect(JSON.stringify(view)).not.toContain("guilty");
  });
});
