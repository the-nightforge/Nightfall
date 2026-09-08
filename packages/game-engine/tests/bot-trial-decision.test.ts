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
      neutralRolesInPlay: [],
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
      sorcererResult: null,
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

  it("THA khi TUYỆT ĐỐI không biết gì - nhưng đó là một trạng thái tổng hợp", () => {
    /*
     * Test này đã đổi đáp án HAI LẦN, và cả hai lần đều vì số đo. Đọc cả ba đời
     * trước khi đổi lần thứ ba.
     *
     * Đời 1 khẳng định "không biết gì thì THA", với lý do mặc định Treo biến mỗi
     * phiên toà thành một vụ hành quyết.
     *
     * Đời 2 lật lại thành TREO: harness Task 9 đo được rằng với mặc định Tha,
     * phe làng thua 30/30 ván - không ai bị kết án nên không có lịch sử phiếu,
     * nên nghi ngờ mãi bằng 0, nên không ai bị kết án. Một vòng lặp chết.
     *
     * Đời 3 (bây giờ) trả về THA, và KHÔNG phải vì đời 2 sai. Đời 2 đúng về
     * vòng lặp chết nhưng sửa nó bằng một liều quá tay: `spareTrustMargin` 15
     * rồi 3, trên một thang suspicion có p50 = 0 và p90 = 1.8. Ngưỡng đó không
     * chỉ bắt "không biết gì thì treo" - nó nuốt luôn mọi mức nghi ngờ THẬT nằm
     * dưới nó, nên kết quả là treo 100.0% số bị cáo, đo ở n=12 trên 900 ván.
     * v10 hạ margin về 0; xem `BOT_WEIGHTS_V10` cho bảng đo đầy đủ.
     *
     * VÒNG LẶP CHẾT KHÔNG QUAY LẠI, và đây là chỗ phải hiểu cho đúng vì sao.
     * Trạng thái trong test này - suspicion 0 VÀ trust 0 - gần như không tồn tại
     * ở một ván thật: tới được phiên toà nghĩa là đủ người đã bỏ phiếu đề cử,
     * mà mỗi lá phiếu đó sinh bằng chứng, nên bị cáo thật luôn mang suspicion
     * dương. Đo trên sáu cỡ phòng với margin 0: tỉ lệ treo 71-85%, và tỉ lệ
     * thắng của phe làng KHÔNG đổi (Δ trung bình +0.6). Làng vẫn treo, chỉ là
     * thôi treo những người mà không ai có một lý do nào.
     *
     * Vì vậy điều test này khoá là một RANH GIỚI, không phải hành vi thường gặp:
     * khi thật sự không có một mảnh bằng chứng nào về một con người, câu trả lời
     * là Tha. Nếu một lần hiệu chỉnh sau làm dòng này đỏ, hãy đo lại tỉ lệ treo
     * trước khi sửa nó - một mặc định Treo quay lại đây sẽ không báo cho ai biết
     * là nó cũng vừa kéo tỉ lệ treo về 100%.
     */
    expect(decideFinalVote(context(), stateFor(), rng()).guilty).toBe(false);
  });

  it("TREO khi có nghi ngờ dù nhỏ - đây mới là ca của một bị cáo thật", () => {
    // Ca thường gặp, và là lý do hạ margin không hồi sinh vòng lặp chết: một
    // người tới được phiên toà đã bị đủ phiếu đề cử chỉ vào, và mỗi lá phiếu ấy
    // sinh bằng chứng. Chỉ cần suspicion nhỉnh hơn trust là bản án giữ nguyên.
    const state = stateFor();
    state.suspicion.a = { score: 1.8, reasons: [], lastUpdatedRound: 2 };

    expect(decideFinalVote(context(), state, rng()).guilty).toBe(true);
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
        seerResult: { targetId: "a", targetName: "A", isWolf: false, team: "village" },
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
        seerResult: { targetId: "a", targetName: "A", isWolf: true, team: "wolves" },
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
      SERIAL_KILL: [],
      SORCERER_CHECK: [],
      TRACK: [],
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
