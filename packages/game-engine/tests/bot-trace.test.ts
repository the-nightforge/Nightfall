import { describe, expect, it } from "vitest";
import type { PublicVoteChoice, Role } from "@masoi/shared";
import { BotRuntime } from "../src/bot/BotRuntime";
import { createSeededRng } from "../src/bot/rng";
import { createTraceCollector, sumTerms } from "../src/bot/trace/trace";
import type { BotDecisionTrace } from "../src/bot/trace/trace";
import type {
  BotDecisionContext,
  BotEvidence,
  BotKnowledgeView,
  NightKnowledge,
} from "../src/bot/types";

const PLAYERS = ["me", "a", "b", "c"];

function emptyNight(over: Partial<NightKnowledge> = {}): NightKnowledge {
  return {
    bonusSecondTargetFor: null,
    canAct: true,
    legalActions: [],
    legalTargets: {
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
    },
    wolfTarget: null,
    guardPrevious: null,
    healUsed: false,
    poisonUsed: false,
    wolvesLocked: false,
    ...over,
  };
}

function knowledge(over: Partial<BotKnowledgeView> = {}): BotKnowledgeView {
  return {
    dayOfTruthClaims: {},
    neutralRolesInPlay: [],
    activeEventId: null,
    botId: "me",
    round: 2,
    phase: "VOTING",
    phaseStartedAt: 0,
    phaseEndsAt: 30_000,
    selfRole: "VILLAGER",
    players: PLAYERS.map((id) => ({ id, name: id.toUpperCase(), alive: true })),
    knownRoles: { me: "VILLAGER" },
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
    legalVoteChoices: [
      { type: "PLAYER", targetId: "a" },
      { type: "PLAYER", targetId: "b" },
      { type: "PLAYER", targetId: "c" },
      { type: "NO_ELIMINATION" },
    ] as PublicVoteChoice[],
    lastNightDeaths: [],
    ...over,
  };
}

function context(over: Partial<BotKnowledgeView> = {}): BotDecisionContext {
  return { knowledge: knowledge(over), visibleChat: [] };
}

function evidence(over: Partial<BotEvidence> = {}): BotEvidence {
  return {
    id: "e1",
    kind: "ACCUSE",
    sourceId: "src1",
    actorId: "a",
    targetId: "b",
    weight: 20,
    confidence: 0.5,
    round: 1,
    summary: "test",
    ...over,
  };
}

function runtimeWithTrace(over: { seed?: string; suspicion?: Record<string, number> } = {}) {
  const trace = createTraceCollector();
  const runtime = new BotRuntime({
    playerId: "me",
    rng: createSeededRng(over.seed ?? "trace"),
    playerIds: PLAYERS,
    trace,
  });
  for (const [id, score] of Object.entries(over.suspicion ?? {})) {
    runtime.state.seenEventIds.push("src1");
    runtime.state.suspicion[id] = {
      score,
      reasons: [evidence({ actorId: id })],
      lastUpdatedRound: 2,
    };
  }
  return { runtime, trace };
}

describe("trace tắt theo mặc định", () => {
  it("không sink thì quyết định không đổi một chút nào", () => {
    const decide = (trace?: ReturnType<typeof createTraceCollector>): PublicVoteChoice => {
      const runtime = new BotRuntime({
        playerId: "me",
        rng: createSeededRng("same"),
        playerIds: PLAYERS,
        trace,
      });
      runtime.state.seenEventIds.push("src1");
      runtime.state.suspicion.a = {
        score: 90,
        reasons: [evidence({ actorId: "a" })],
        lastUpdatedRound: 2,
      };
      const ctx = context();
      runtime.observe(ctx);
      return runtime.decideVote(ctx).choice;
    };

    // Bọc RNG để ghi lại từng lần rút không được phép làm lệch chuỗi số.
    expect(decide()).toEqual(decide(createTraceCollector()));
  });

  it("không sink thì không trace nào được sinh ra", () => {
    const runtime = new BotRuntime({
      playerId: "me",
      rng: createSeededRng("off"),
      playerIds: PLAYERS,
    });
    const ctx = context();
    runtime.observe(ctx);
    // Không có gì để khẳng định ngoài việc nó chạy trót lọt và không cấp phát:
    // giá trị của "tắt" nằm ở chỗ không có API nào để lấy trace ra.
    expect(runtime.decideVote(ctx)).toBeDefined();
    expect("traces" in runtime).toBe(false);
  });
});

describe("nội dung trace", () => {
  it("ghi lại mọi ứng viên đã chấm điểm", () => {
    const { runtime, trace } = runtimeWithTrace({ suspicion: { a: 90 } });
    const ctx = context();
    runtime.observe(ctx);
    runtime.decideVote(ctx);

    const vote = trace.traces.find((item) => item.decision === "VOTE")!;
    expect(vote.candidates.map((c) => c.targetId).sort()).toEqual(["a", "b", "c"]);
  });

  /**
   * `score` được TÍNH TỪ `terms` qua `sumTerms` ở mọi đường chấm điểm, nên
   * "tổng các số hạng bằng điểm" đúng theo cấu tạo chứ không nhờ kiểm tra.
   *
   * Đó là chủ ý: một bất biến được bảo đảm bởi kiến trúc mạnh hơn một bất biến
   * được canh bởi test. Nhưng nó cũng có nghĩa là khẳng định `sum === score`
   * KHÔNG có răng - bỏ hẳn một số hạng thì cả hai vế cùng đổi và test vẫn xanh.
   * (Đã kiểm bằng cách bỏ số hạng jitter của Bảo Vệ: khẳng định đó vẫn xanh,
   * và thứ bắt được là van tay v1 trong `bot-weights.test.ts`.)
   *
   * Nên hai test dưới đây kiểm thứ khác: TÊN của các số hạng, và GIÁ TRỊ của
   * từng số hạng trên một state dựng tay. Đó mới là chỗ một lời giải thích có
   * thể sai mà hành vi vẫn đúng.
   */
  it("nêu đủ và đúng tên các số hạng của một lá phiếu", () => {
    const { runtime, trace } = runtimeWithTrace({ suspicion: { a: 90 } });
    const ctx = context();
    runtime.observe(ctx);
    runtime.decideVote(ctx);

    const candidate = trace.traces[0].candidates.find((item) => item.targetId === "a")!;
    expect(candidate.terms.map((term) => term.name)).toEqual([
      "belief",
      "evidenceConfidence",
      "hostility",
      "pairPressure",
      "trustDamping",
      "roleBias",
      "isolation",
      "jitter",
    ]);
    expect(sumTerms(candidate.terms)).toBe(candidate.score);
  });

  it("giá trị từng số hạng khớp với state dựng tay", () => {
    // Không có bằng chứng nào cho `b` và `c`, nên mọi số hạng xã hội bằng 0 và
    // điểm của `a` giải thích được bằng tay: belief 90, evidenceConfidence
    // 0.5 * 8 = 4, trustDamping -(40 * 0.2) = -8, còn lại 0 trừ jitter.
    const { runtime, trace } = runtimeWithTrace({ suspicion: { a: 90 } });
    runtime.state.trust.a = { score: 40, reasons: [], lastUpdatedRound: 2 };

    const ctx = context();
    runtime.observe(ctx);
    runtime.decideVote(ctx);

    const candidate = trace.traces[0].candidates.find((item) => item.targetId === "a")!;
    const byName = Object.fromEntries(candidate.terms.map((t) => [t.name, t.value]));
    expect(byName.belief).toBe(90);
    expect(byName.evidenceConfidence).toBeCloseTo(4, 10);
    expect(byName.trustDamping).toBeCloseTo(-8, 10);
    expect(byName.hostility).toBe(0);
    expect(byName.pairPressure).toBe(0);
    expect(byName.roleBias).toBe(0);
    expect(byName.isolation).toBe(0);
    expect(Math.abs(byName.jitter)).toBeLessThanOrEqual(3);
  });

  it("Sói bảo vệ đồng bọn bằng một số hạng CÓ TÊN, không phải một phép trừ ẩn", () => {
    const trace = createTraceCollector();
    const runtime = new BotRuntime({
      playerId: "me",
      rng: createSeededRng("wolf-terms"),
      playerIds: PLAYERS,
      trace,
    });
    const ctx = context({
      selfRole: "WEREWOLF",
      knownRoles: { me: "WEREWOLF", a: "WEREWOLF" },
    });
    runtime.observe(ctx);
    runtime.decideVote(ctx);

    const ally = trace.traces[0].candidates.find((item) => item.targetId === "a")!;
    const other = trace.traces[0].candidates.find((item) => item.targetId === "b")!;
    const names = ally.terms.map((term) => term.name);
    expect(names).toContain("teammateProtection");
    expect(ally.terms.find((t) => t.name === "teammateProtection")!.value).toBeLessThan(0);
    expect(ally.terms.find((t) => t.name === "roleBias")!.value).toBe(-100);
    // Người ngoài phe không có số hạng đó chứ không phải có nó với giá trị 0.
    expect(other.terms.map((term) => term.name)).not.toContain("teammateProtection");
  });

  it("các số hạng cộng lại BẰNG điểm cho MỌI vai có chấm điểm ban đêm", () => {
    // Kiểm riêng vì đường ban đêm không đi qua `selectVote`: mỗi vai tự cộng
    // điểm của nó, nên mỗi vai là một cơ hội để quên một số hạng.
    const cases: Array<[Role, Parameters<typeof emptyNight>[0]]> = [
      ["WEREWOLF", { legalActions: ["KILL"], legalTargets: { ...emptyNight().legalTargets, KILL: ["a", "b", "c"] } }],
      ["SEER", { legalActions: ["SEE"], legalTargets: { ...emptyNight().legalTargets, SEE: ["a", "b", "c"] } }],
      ["GUARD", { legalActions: ["GUARD"], legalTargets: { ...emptyNight().legalTargets, GUARD: ["a", "b", "c"] } }],
      [
        "TRACKER",
        {
          legalActions: ["TRACK"],
          legalTargets: { ...emptyNight().legalTargets, TRACK: ["a", "b", "c"] },
        },
      ],
      [
        "DETECTIVE",
        {
          legalActions: ["DETECTIVE_CHECK"],
          legalTargets: { ...emptyNight().legalTargets, DETECTIVE_CHECK: ["a", "b", "c"] },
        },
      ],
    ];

    for (const [role, night] of cases) {
      const { runtime, trace } = runtimeWithTrace({ seed: role, suspicion: { a: 70, b: 20 } });
      runtime.decideNight(
        context({ selfRole: role, phase: "NIGHT", night: emptyNight(night) }),
      );

      const recorded = trace.traces.find((item) => item.decision === "NIGHT")!;
      expect({ role, count: recorded.candidates.length }).toEqual({ role, count: 3 });
      for (const candidate of recorded.candidates) {
        expect({ role, target: candidate.targetId, sum: sumTerms(candidate.terms) }).toEqual({
          role,
          target: candidate.targetId,
          sum: candidate.score,
        });
      }
    }
  });

  it("ghi đúng số lần rút RNG, và cùng seed cho cùng chuỗi", () => {
    const draws = (seed: string): number[] => {
      const { runtime, trace } = runtimeWithTrace({ seed, suspicion: { a: 90 } });
      const ctx = context();
      runtime.observe(ctx);
      runtime.decideVote(ctx);
      return trace.traces.find((item) => item.decision === "VOTE")!.rngDraws;
    };

    // Ba ứng viên, mỗi ứng viên đúng một lần rút jitter.
    expect(draws("x")).toHaveLength(3);
    expect(draws("x")).toEqual(draws("x"));
    expect(draws("x")).not.toEqual(draws("y"));
  });

  it("nêu lý do khi bỏ cuộc", () => {
    const { runtime, trace } = runtimeWithTrace();
    // Không ai được phép chấm điểm: người chết không có ý kiến.
    const ctx = context({
      players: PLAYERS.map((id) => ({ id, name: id, alive: id !== "me" })),
      legalVoteChoices: [],
    });
    runtime.observe(ctx);
    runtime.decideVote(ctx);

    const vote = trace.traces.find((item) => item.decision === "VOTE")!;
    expect(vote.fallbackReason).toContain("không có ứng viên hợp lệ");
  });

  it("ghi belief trước và sau lần quan sát, không phải trước/sau lúc chấm điểm", () => {
    // `selectVote` chỉ ĐỌC belief, nên "trước/sau" của nó luôn giống nhau và
    // không nói lên điều gì. Thứ đổi belief là quan sát.
    const { runtime, trace } = runtimeWithTrace();
    const ctx = context({
      seerResult: { targetId: "a", targetName: "A", isWolf: true, team: "wolves" },
    });
    runtime.observe(ctx);
    runtime.decideVote(ctx);

    const vote = trace.traces.find((item) => item.decision === "VOTE")!;
    expect(vote.beliefBefore.a.suspicion).toBe(0);
    expect(vote.beliefAfter.a.suspicion).toBe(100);
  });

  it("có trace cho cả năm loại quyết định", () => {
    const { runtime, trace } = runtimeWithTrace({ suspicion: { a: 95 } });

    const day = context();
    runtime.observe(day);
    const vote = runtime.decideVote(day);
    runtime.decideSpeech(day, vote);
    runtime.decideNight(
      context({
        selfRole: "SEER",
        phase: "NIGHT",
        night: emptyNight({
          legalActions: ["SEE"],
          legalTargets: { ...emptyNight().legalTargets, SEE: ["a", "b"] },
        }),
      }),
    );
    runtime.decideFinalVote(context({ phase: "FINAL_VOTE", trialAccusedId: "a" }));
    runtime.decideHunterShot(
      context({ hunterShot: { canAct: true, legalTargets: ["a", "b"] } }),
    );

    expect(trace.traces.map((item) => item.decision)).toEqual([
      "VOTE",
      "SPEECH",
      "NIGHT",
      "FINAL_VOTE",
      "HUNTER_SHOT",
    ]);
  });

  it("mỗi trace nêu rõ nước đã chọn", () => {
    const { runtime, trace } = runtimeWithTrace({ suspicion: { a: 95 } });
    const ctx = context();
    runtime.observe(ctx);
    runtime.decideVote(ctx);

    const vote = trace.traces[0];
    expect(vote.chosen.targetId).toBe("a");
    expect(vote.chosen.label).toBe("bầu");
    expect(vote.botId).toBe("me");
    expect(vote.round).toBe(2);
    expect(vote.phase).toBe("VOTING");
  });
});

// ---------------------------------------------------------------------------
// Ranh giới: trace không được chứa NHIỀU HƠN knowledge view của chính bot đó.
// ---------------------------------------------------------------------------

function rolesMentionedIn(trace: BotDecisionTrace): string[] {
  const ROLES: Role[] = [
    "WEREWOLF",
    "WOLF_CUB",
    "SEER",
    "APPRENTICE_SEER",
    "GUARD",
    "TRACKER",
    "WITCH",
    "HUNTER",
    "CURSED",
    "DETECTIVE",
    "SORCERER",
    "ALPHA_WOLF",
    "MAYOR",
    "VILLAGER",
  ];
  const text = JSON.stringify(trace);
  return ROLES.filter((role) => text.includes(role));
}

describe("ranh giới knowledge của trace", () => {
  it("BOT phe làng: trace không nhắc vai của bất kỳ ai khác", () => {
    const { runtime, trace } = runtimeWithTrace({ suspicion: { a: 95 } });
    const ctx = context();
    runtime.observe(ctx);
    runtime.decideVote(ctx);

    const vote = trace.traces[0];
    expect(vote.knowledgeSnapshot.knownRoles).toEqual({ me: "VILLAGER" });
    // Chỉ đúng vai của CHÍNH nó được phép xuất hiện ở bất cứ đâu trong trace.
    expect(rolesMentionedIn(vote)).toEqual(["VILLAGER"]);
  });

  it("BOT Sói: trace chứa ĐÚNG đồng bọn mà engine đã cho thấy, không hơn", () => {
    // Ràng buộc không phải "trace không chứa role": Sói có quyền biết đồng bọn,
    // và trace của nó phải giải thích được vì sao nó không bầu đồng bọn.
    const trace = createTraceCollector();
    const runtime = new BotRuntime({
      playerId: "me",
      rng: createSeededRng("wolf"),
      playerIds: PLAYERS,
      trace,
    });
    const view = knowledge({
      selfRole: "WEREWOLF",
      knownRoles: { me: "WEREWOLF", a: "WEREWOLF" },
    });
    const ctx: BotDecisionContext = { knowledge: view, visibleChat: [] };
    runtime.observe(ctx);
    runtime.decideVote(ctx);

    const recorded = trace.traces[0];
    expect(recorded.knowledgeSnapshot.knownRoles).toEqual(view.knownRoles);
    // Không nhiều hơn: mọi khoá trong trace phải có mặt trong knowledge view.
    for (const id of Object.keys(recorded.knowledgeSnapshot.knownRoles)) {
      expect(view.knownRoles[id]).toBeDefined();
    }
    expect(rolesMentionedIn(recorded)).toEqual(["WEREWOLF"]);
  });

  it("snapshot là bản SAO, sửa nó không ghi ngược vào knowledge của engine", () => {
    const { runtime, trace } = runtimeWithTrace();
    const ctx = context();
    runtime.observe(ctx);
    runtime.decideVote(ctx);

    trace.traces[0].knowledgeSnapshot.knownRoles.a = "WEREWOLF";
    expect(ctx.knowledge.knownRoles.a).toBeUndefined();
  });

  it("trace không bao giờ chứa vai của người đã chết", () => {
    const { runtime, trace } = runtimeWithTrace();
    const ctx = context({
      players: [
        { id: "me", name: "ME", alive: true },
        { id: "a", name: "A", alive: false },
        { id: "b", name: "B", alive: true },
        { id: "c", name: "C", alive: true },
      ],
      legalVoteChoices: [
        { type: "PLAYER", targetId: "b" },
        { type: "PLAYER", targetId: "c" },
      ],
    });
    runtime.observe(ctx);
    runtime.decideVote(ctx);

    const recorded = trace.traces[0];
    expect(recorded.knowledgeSnapshot.aliveIds).toEqual(["me", "b", "c"]);
    expect(recorded.knowledgeSnapshot.knownRoles.a).toBeUndefined();
  });

  it("kết quả soi trong trace chỉ là kết quả của chính bot đó", () => {
    const { runtime, trace } = runtimeWithTrace();
    const ctx = context({
      selfRole: "SEER",
      seerResult: { targetId: "a", targetName: "A", isWolf: true, team: "wolves" },
    });
    runtime.observe(ctx);
    runtime.decideVote(ctx);

    expect(trace.traces[0].knowledgeSnapshot.seerResult).toEqual({
      targetId: "a",
      isWolf: true,
    });
  });
});
