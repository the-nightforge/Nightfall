import { describe, expect, it } from "vitest";
import type { PublicVoteChoice } from "@masoi/shared";
import {
  BOT_WEIGHTS_V1,
  DEFAULT_BOT_WEIGHTS,
  resolveWeights,
  validateWeights,
  type BotWeights,
} from "../src/bot/config/weights";
import { BOT_WEIGHTS_PRESETS, weightsPreset } from "../src/bot/config/presets";
import { BotRuntime } from "../src/bot/BotRuntime";
import { createSeededRng } from "../src/bot/rng";
import { createBotPersonality } from "../src/bot/personality/personality";
import { createBotBrainState } from "../src/bot/memory/memory-store";
import { applyEvidence, beliefInertia, decayBeliefs } from "../src/bot/belief/belief-state";
import { applySocialEvidence, possibleWolfPairScore } from "../src/bot/analysis/social-analysis";
import { selectVote, voteHysteresis, voteThreshold } from "../src/bot/decision/vote-decision";
import { decideFinalVote, decideHunterShot } from "../src/bot/decision/trial-decision";
import { strategyFor } from "../src/bot/roles/registry";
import { applyPrivateInformation } from "../src/bot/belief/private-info";
import { simulateGame } from "../src/bot/evaluation/simulate";
import type {
  BotBrainState,
  BotDecisionContext,
  BotEvidence,
  BotKnowledgeView,
  NightKnowledge,
} from "../src/bot/types";

const PLAYERS = ["me", "a", "b", "c"];

function stateFor(playerId = "me", seed = "weights"): BotBrainState {
  return createBotBrainState(playerId, createBotPersonality(createSeededRng(seed)), PLAYERS);
}

function emptyNight(over: Partial<NightKnowledge> = {}): NightKnowledge {
  return {
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
      GUARDIAN_PROTECT: [],
      HOLY_WATER: [],
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
    botId: "me",
    round: 2,
    phase: "VOTING",
    phaseStartedAt: 0,
    phaseEndsAt: 30_000,
    selfRole: "VILLAGER",
    players: PLAYERS.map((id) => ({ id, name: id.toUpperCase(), alive: true })),
    knownRoles: { me: "VILLAGER" },
    seerResult: null,
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

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("validateWeights", () => {
  it("chấp nhận cấu hình mặc định", () => {
    expect(validateWeights(DEFAULT_BOT_WEIGHTS)).toEqual([]);
  });

  it("bắt NaN ở bất kỳ độ sâu nào", () => {
    const broken = resolveWeights({ suspicion: { pairBonus: Number.NaN } });
    expect(validateWeights(broken).join(" ")).toContain("suspicion.pairBonus");
  });

  it("bắt Infinity", () => {
    const broken = resolveWeights({ confidence: { jitterSpan: Number.POSITIVE_INFINITY } });
    expect(validateWeights(broken).join(" ")).toContain("confidence.jitterSpan");
  });

  it("bắt tỉ lệ nằm ngoài [0, 1]", () => {
    // 1.2 là một số hữu hạn hoàn toàn hợp lệ về kiểu; chỉ ngữ nghĩa mới sai.
    // Không có kiểm tra này thì decay > 1 sẽ khiến belief LỚN DẦN theo thời gian.
    const broken = resolveWeights({ recency: { beliefDecayPerRound: 1.2 } });
    expect(validateWeights(broken).join(" ")).toContain("recency.beliefDecayPerRound");
  });

  it("bắt confidence của evidence nằm ngoài [0, 1]", () => {
    const broken = resolveWeights({ evidence: { ACCUSE: { weight: 4, confidence: 3 } } });
    expect(validateWeights(broken).join(" ")).toContain("evidence.ACCUSE.confidence");
  });

  it("bắt nightConfidence ngoài [0, 1]", () => {
    // `nightConfidence` được gán THẲNG vào intention không qua clamp, nên 1.5 ở
    // đây sinh ra một xác suất > 1 và chỉ bị phát hiện ở tận tầng invariant.
    const broken = resolveWeights({ nightConfidence: { seer: 1.5 } });
    expect(validateWeights(broken).join(" ")).toContain("nightConfidence.seer");
  });

  it("báo thiếu nhóm thay vì ném khi cấu hình sai hình dạng", () => {
    // Đầu vào có khả năng thiếu nhóm nhất là một file JSON do CLI nạp - đúng
    // lúc người dùng cần một danh sách đọc được nhất, không phải một TypeError.
    const shapeless = { version: "x" } as unknown as BotWeights;
    const problems = validateWeights(shapeless);
    expect(problems.join(" ")).toContain("thiếu nhóm bắt buộc");
    expect(problems.some((item) => item.includes("roleThresholds"))).toBe(true);
  });

  it("bắt version rỗng", () => {
    expect(validateWeights(resolveWeights({ version: "  " })).join(" ")).toContain("version");
  });

  it("bắt personalityRange đảo ngược", () => {
    const broken = resolveWeights({ personalityRange: { min: 0.9, max: 0.1 } });
    expect(validateWeights(broken).join(" ")).toContain("personalityRange");
  });
});

describe("resolveWeights", () => {
  it("giữ nguyên mọi trường không được nêu", () => {
    const resolved = resolveWeights({ trust: { damping: 0.9 } });
    expect(resolved.trust.damping).toBe(0.9);
    expect(resolved.suspicion).toEqual(BOT_WEIGHTS_V1.suspicion);
    expect(resolved.evidence.TIE_BREAK).toEqual(BOT_WEIGHTS_V1.evidence.TIE_BREAK);
  });

  it("không mutate bản gốc", () => {
    // DEFAULT_BOT_WEIGHTS là hằng số dùng chung của cả process. Một lần mutate ở
    // đây rò cấu hình của ván này sang mọi ván sau, và bug đó không tái lập được.
    resolveWeights({ trust: { damping: 0.9 } });
    expect(DEFAULT_BOT_WEIGHTS.trust.damping).toBe(BOT_WEIGHTS_V1.trust.damping);
  });

  it("merge nông trong một nhóm: trường cùng nhóm không bị xoá", () => {
    const resolved = resolveWeights({ confidence: { hunterMargin: 99 } });
    expect(resolved.confidence.hunterMargin).toBe(99);
    expect(resolved.confidence.jitterSpan).toBe(BOT_WEIGHTS_V1.confidence.jitterSpan);
  });

  it("vá một phần bảng evidence giữ nguyên tám kind còn lại", () => {
    // Đây là cách dùng thật của Task 8. Trải cả bảng ra trước khi vá sẽ khiến
    // test xanh dù `resolveWeights` THAY THẾ cả nhóm thay vì merge.
    const resolved = resolveWeights({ evidence: { ACCUSE: { weight: 9, confidence: 0.9 } } });
    expect(resolved.evidence.ACCUSE).toEqual({ weight: 9, confidence: 0.9 });
    expect(resolved.evidence.TIE_BREAK).toEqual(BOT_WEIGHTS_V1.evidence.TIE_BREAK);
    expect(Object.keys(resolved.evidence).sort()).toEqual(
      Object.keys(BOT_WEIGHTS_V1.evidence).sort(),
    );
  });

  it("đánh dấu version khi giá trị bị chỉnh, để report không gán nhầm cho v1", () => {
    // Một con số win-rate không truy được về cấu hình sinh ra nó là vô dụng.
    expect(resolveWeights({ trust: { damping: 0.9 } }).version).toBe("1.0.0+custom");
    // Đặt version tường minh thì tôn trọng caller.
    expect(resolveWeights({ version: "2.0.0", trust: { damping: 0.9 } }).version).toBe("2.0.0");
    // Không đổi giá trị nào thì không gắn nhãn.
    expect(resolveWeights({}).version).toBe("1.0.0");
  });
});

describe("cấu hình thật sự bất biến", () => {
  it("không ghi được vào một ô của bảng evidence", () => {
    // `Object.freeze` là NÔNG. Mọi nhóm khác đều phẳng nên một lần freeze là đủ;
    // `evidence` là ngoại lệ, và không bịt thì một dòng ở bất kỳ đâu trong
    // process cũng làm hỏng vĩnh viễn cấu hình dùng chung.
    expect(Object.isFrozen(BOT_WEIGHTS_V1.evidence)).toBe(true);
    expect(Object.isFrozen(BOT_WEIGHTS_V1.evidence.ACCUSE)).toBe(true);

    const before = BOT_WEIGHTS_V1.evidence.ACCUSE.weight;
    expect(() => {
      (BOT_WEIGHTS_V1.evidence.ACCUSE as { weight: number }).weight = 999;
    }).toThrow();
    expect(BOT_WEIGHTS_V1.evidence.ACCUSE.weight).toBe(before);
  });

  it("không ghi được vào một nhóm phẳng", () => {
    expect(() => {
      (BOT_WEIGHTS_V1.trust as { damping: number }).damping = 999;
    }).toThrow();
    expect(BOT_WEIGHTS_V1.trust.damping).toBe(0.2);
  });

  it("nhóm không bị vá vẫn dùng CHUNG tham chiếu, nên phải bất biến", () => {
    // `resolveWeights` chia sẻ tham chiếu cho nhóm không đổi. Đó là lý do freeze
    // phải đúng: sửa qua cấu hình dẫn xuất sẽ sửa luôn bản gốc.
    const derived = resolveWeights({ trust: { damping: 0.9 } });
    expect(derived.evidence).toBe(BOT_WEIGHTS_V1.evidence);
    expect(Object.isFrozen(derived.evidence.DEFEND)).toBe(true);
  });
});

describe("presets", () => {
  it("v1 có mặt và bị đóng băng", () => {
    expect(weightsPreset("1.0.0")).toBe(BOT_WEIGHTS_V1);
    expect(Object.isFrozen(BOT_WEIGHTS_V1)).toBe(true);
  });

  it("báo lỗi rõ ràng cho phiên bản không tồn tại", () => {
    expect(() => weightsPreset("9.9.9")).toThrow(/9\.9\.9/);
  });

  it("mọi preset đều hợp lệ theo schema", () => {
    for (const [version, preset] of Object.entries(BOT_WEIGHTS_PRESETS)) {
      expect({ version, problems: validateWeights(preset) }).toEqual({ version, problems: [] });
    }
  });

  it("DEFAULT trỏ tới một preset có tên", () => {
    expect(BOT_WEIGHTS_PRESETS[DEFAULT_BOT_WEIGHTS.version]).toBe(DEFAULT_BOT_WEIGHTS);
  });
});

// ---------------------------------------------------------------------------
// Wiring: mỗi nhóm trọng số phải THẬT SỰ đổi được hành vi.
//
// Đây là bằng chứng mạnh hơn một test quét source tìm magic number: một hằng số
// vẫn nằm trong file cũ sẽ khiến đúng những khẳng định dưới đây thất bại.
// ---------------------------------------------------------------------------

describe("trọng số được nối vào quyết định", () => {
  it("aggression đổi ngưỡng đề cử", () => {
    const personality = createBotPersonality(createSeededRng("p"));
    const low = voteThreshold(personality, resolveWeights({ aggression: { thresholdBase: 10 } }));
    expect(low).toBeLessThan(voteThreshold(personality));
  });

  it("confidence.hysteresis đổi độ dính của phiếu hiện tại", () => {
    const personality = createBotPersonality(createSeededRng("p"));
    const sticky = voteHysteresis(
      personality,
      resolveWeights({ confidence: { hysteresisBase: 100 } }),
    );
    expect(sticky).toBeGreaterThan(voteHysteresis(personality));
  });

  it("suspicion.inertia đổi tốc độ cập nhật belief", () => {
    const personality = createBotPersonality(createSeededRng("p"));
    const slower = beliefInertia(personality, resolveWeights({ suspicion: { inertiaBase: 0.9 } }));
    expect(slower).toBeGreaterThan(beliefInertia(personality));
  });

  it("suspicion.inertia đổi delta thật sự cộng vào score", () => {
    const run = (weights?: BotWeights): number => {
      const state = stateFor();
      state.seenEventIds.push("src1");
      applyEvidence(state, evidence(), weights);
      return state.suspicion.a.score;
    };
    expect(run(resolveWeights({ suspicion: { inertiaScale: 0 } }))).not.toBeCloseTo(run());
  });

  it("recency.beliefDecayPerRound đổi tốc độ nguội", () => {
    const decayed = (weights?: BotWeights): number => {
      const state = stateFor();
      state.seenEventIds.push("src1");
      applyEvidence(state, evidence({ round: 1 }));
      decayBeliefs(state, 5, weights);
      return state.suspicion.a.score;
    };
    expect(decayed(resolveWeights({ recency: { beliefDecayPerRound: 0.1 } }))).toBeLessThan(
      decayed(),
    );
  });

  it("social.edgeStepDivisor đổi độ mạnh của cạnh xã hội", () => {
    const strength = (weights?: BotWeights): number => {
      const state = stateFor();
      state.seenEventIds.push("src1");
      applySocialEvidence(state, evidence(), weights);
      return state.relationships["a->b"].hostility;
    };
    expect(strength(resolveWeights({ social: { edgeStepDivisor: 200 } }))).toBeLessThan(
      strength(),
    );
  });

  it("social.priorStrength đổi mức chiết khấu khi ít mẫu", () => {
    const paired = (weights?: BotWeights): number => {
      const state = stateFor();
      state.seenEventIds.push("src1");
      applySocialEvidence(state, evidence({ kind: "VOTE_ALIGNMENT" }));
      return possibleWolfPairScore(state, "a", "b", weights);
    };
    expect(paired(resolveWeights({ social: { priorStrength: 100 } }))).toBeLessThan(paired());
  });

  it("privateInfo.seerWolf đổi sức nặng của kết quả soi", () => {
    const reason = (weights?: BotWeights): number => {
      const state = stateFor();
      applyPrivateInformation(
        state,
        knowledge({ seerResult: { targetId: "a", targetName: "A", isWolf: true } }),
        weights,
      );
      return state.suspicion.a.reasons.at(-1)!.weight;
    };
    expect(reason(resolveWeights({ privateInfo: { seerWolf: 7 } }))).toBe(7);
    expect(reason()).toBe(BOT_WEIGHTS_V1.privateInfo.seerWolf);
  });

  it("teammateProtection đổi mức Sói bảo vệ đồng bọn", () => {
    const bias = (weights?: BotWeights): number =>
      strategyFor("WEREWOLF", weights).voteBias(
        context({
          selfRole: "WEREWOLF",
          knownRoles: { me: "WEREWOLF", a: "WEREWOLF" },
        }),
        stateFor(),
      ).a;
    expect(bias(resolveWeights({ teammateProtection: { voteBiasPenalty: -5 } }))).toBe(-5);
  });

  it("confidence.hunterMargin đổi ngưỡng bắn của Thợ Săn", () => {
    const state = stateFor();
    state.seenEventIds.push("src1");
    // Đủ để vượt ngưỡng phiếu thường nhưng KHÔNG đủ để vượt ngưỡng bắn mặc định.
    state.suspicion.a = { score: 62, reasons: [evidence()], lastUpdatedRound: 1 };

    const shoot = (weights?: BotWeights): string | null =>
      decideHunterShot(
        context({ hunterShot: { canAct: true, legalTargets: ["a", "b"] } }),
        state,
        createSeededRng("h"),
        weights,
      ).targetId;

    expect(shoot()).toBeNull();
    expect(shoot(resolveWeights({ confidence: { hunterMargin: 0 } }))).toBe("a");
  });

  it("confidence.spareTrustMargin đổi ngưỡng Tha ở phiên toà", () => {
    const state = stateFor();
    state.seenEventIds.push("src1");
    state.suspicion.a = { score: 40, reasons: [evidence()], lastUpdatedRound: 1 };
    state.trust.a = { score: 50, reasons: [], lastUpdatedRound: 1 };

    const verdict = (weights?: BotWeights): boolean =>
      decideFinalVote(
        context({ phase: "FINAL_VOTE", trialAccusedId: "a", canFinalVote: true }),
        state,
        createSeededRng("f"),
        weights,
      ).guilty;

    // trust 50 vượt suspicion 40 + margin 15? Không -> TREO ở mặc định.
    expect(verdict()).toBe(true);
    // Hạ margin xuống 0 thì trust 50 > suspicion 40 -> THA.
    expect(verdict(resolveWeights({ confidence: { spareTrustMargin: 0 } }))).toBe(false);
  });

  it("roleThresholds.witchPoisonSuspicion đổi ngưỡng dùng bình độc", () => {
    const state = stateFor();
    state.seenEventIds.push("src1");
    state.suspicion.a = { score: 60, reasons: [evidence()], lastUpdatedRound: 1 };

    const act = (weights?: BotWeights) =>
      strategyFor("WITCH", weights).decideNight(
        context({
          selfRole: "WITCH",
          phase: "NIGHT",
          night: emptyNight({
            legalActions: ["POISON", "SKIP"],
            legalTargets: { ...emptyNight().legalTargets, POISON: ["a", "b"] },
          }),
        }),
        state,
        createSeededRng("w"),
      );

    expect(act()!.action).toBe("SKIP");
    expect(
      act(resolveWeights({ roleThresholds: { witchPoisonSuspicion: 10 } }))!.action,
    ).toBe("POISON");
  });

  it("roleThresholds.priestSuspicion đổi ngưỡng ném Nước thánh", () => {
    const state = stateFor();
    state.seenEventIds.push("src1");
    state.suspicion.a = { score: 60, reasons: [evidence()], lastUpdatedRound: 1 };

    const act = (weights?: BotWeights) =>
      strategyFor("PRIEST", weights).decideNight(
        context({
          selfRole: "PRIEST",
          phase: "NIGHT",
          night: emptyNight({
            legalActions: ["HOLY_WATER"],
            legalTargets: { ...emptyNight().legalTargets, HOLY_WATER: ["a", "b"] },
          }),
        }),
        state,
        createSeededRng("p"),
      );

    expect(act()).toBeNull();
    expect(act(resolveWeights({ roleThresholds: { priestSuspicion: 10 } }))!.action).toBe(
      "HOLY_WATER",
    );
  });

  it("nightConfidence là đầu ra thuần, không đổi mục tiêu", () => {
    const build = (weights?: BotWeights) =>
      strategyFor("SEER", weights).decideNight(
        context({
          selfRole: "SEER",
          phase: "NIGHT",
          night: emptyNight({
            legalActions: ["SEE"],
            legalTargets: { ...emptyNight().legalTargets, SEE: ["a", "b", "c"] },
          }),
        }),
        stateFor(),
        createSeededRng("s"),
      );

    const tuned = build(resolveWeights({ nightConfidence: { seer: 0.11 } }));
    expect(tuned!.confidence).toBe(0.11);
    expect(tuned!.targetId).toBe(build()!.targetId);
  });

  it("personalityRange đổi dải tính cách sinh ra", () => {
    const narrow = createBotPersonality(
      createSeededRng("p"),
      resolveWeights({ personalityRange: { min: 0.5, max: 0.5 } }),
    );
    expect(narrow.aggressiveness).toBe(0.5);
    expect(narrow.stubbornness).toBe(0.5);
  });

  it("limits.intentionEvidence giới hạn số bằng chứng mang theo phiếu", () => {
    const state = stateFor();
    for (let i = 0; i < 6; i += 1) state.seenEventIds.push(`s${i}`);
    state.suspicion.a = {
      score: 95,
      reasons: Array.from({ length: 6 }, (_, i) => evidence({ id: `e${i}`, sourceId: `s${i}` })),
      lastUpdatedRound: 2,
    };

    const count = (weights?: BotWeights): number =>
      selectVote(context(), state, createSeededRng("v"), weights).evidence.length;

    expect(count()).toBe(BOT_WEIGHTS_V1.limits.intentionEvidence);
    expect(count(resolveWeights({ limits: { intentionEvidence: 1 } }))).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Refactor thuần: v1 phải tái lập ĐÚNG hành vi Phase 2.
// ---------------------------------------------------------------------------

describe("v1 là mốc so sánh đóng băng", () => {
  /**
   * Vân tay hành vi của cấu hình v1 trên 24 ván.
   *
   * Tồn tại vì một test "cùng seed cho cùng kết quả" chạy hai lần trong cùng một
   * process KHÔNG bắt được một thay đổi đồng nhất - nó chỉ chứng minh hàm là
   * hàm. Chỉ một giá trị được ghim mới phân biệt được "vẫn đúng như cũ" với
   * "sai giống hệt nhau ở cả hai lần chạy". Đó là thứ đã chứng minh việc gom
   * trọng số ở Task 1 là refactor thuần (0 dòng khác biệt trước/sau).
   *
   * **Đã ghim lại hai lần, cả hai đều ở tầng HARNESS chứ không phải lõi quyết
   * định.** Không lần nào chạm vào `bot/decision`, `bot/roles` hay `bot/belief`,
   * và mỗi lần đều có ~500 test còn lại - gồm 100 seed của `bot-scenario` - xanh
   * xuyên qua để chứng minh lõi không đổi:
   *
   * 1. Task 3 cho `GameEngine.create` nhận `rng`, nên harness bỏ được mẹo "sort
   *    rồi xáo lại"; ánh xạ seed → phân vai vì thế thay đổi.
   * 2. Task 5 thêm LƯỢT CÂN NHẮC LẠI. Không có nó, mỗi BOT bỏ đúng một lá phiếu
   *    mỗi vòng và không bao giờ đổi ý - tức `myVote`, `voteHysteresis` và nhánh
   *    "giữ mục tiêu cũ" chưa từng chạy trong mô phỏng. Phase 1 dựng quyền đổi
   *    phiếu rồi không ván nào kiểm nó, và chỉ số "tỉ lệ đổi phiếu" luôn bằng 0
   *    vì lý do cấu trúc chứ không phải vì hành vi.
   *
   * Task 8 sẽ đổi `DEFAULT_BOT_WEIGHTS` sang v2. Khẳng định dưới đây neo vào
   * `BOT_WEIGHTS_V1` một cách tường minh, nên nó vẫn phải xanh sau lần đổi đó.
   * Nếu nó đỏ, nghĩa là một thay đổi đã âm thầm chạm vào cái mốc.
   */
  const V1_FINGERPRINT = [
    "golden-0 village 5 66",
    "golden-1 wolves 5 58",
    "golden-2 wolves 4 46",
    "golden-3 wolves 4 65",
    "golden-4 wolves 5 67",
    "golden-5 wolves 3 40",
    "golden-6 wolves 3 49",
    "golden-7 wolves 4 64",
    "golden-8 wolves 3 45",
    "golden-9 wolves 3 44",
    "golden-10 wolves 3 39",
    "golden-11 wolves 4 63",
    "golden-12 wolves 4 59",
    "golden-13 village 3 44",
    "golden-14 wolves 2 35",
    "golden-15 village 5 69",
    "golden-16 wolves 3 41",
    "golden-17 wolves 4 66",
    "golden-18 wolves 3 55",
    "golden-19 wolves 4 50",
    "golden-20 wolves 3 42",
    "golden-21 wolves 3 51",
    "golden-22 wolves 4 51",
    "golden-23 wolves 4 44",
  ];

  it("tái lập chính xác cấu hình v1 trên 24 ván", () => {
    const actual = V1_FINGERPRINT.map((_, i) => {
      const seed = `golden-${i}`;
      const result = simulateGame({ seed, playerCount: 8, weights: BOT_WEIGHTS_V1 });
      return `${seed} ${result.winner} ${result.rounds} ${result.actions}`;
    });
    expect(actual).toEqual(V1_FINGERPRINT);
  });

  it("personality của v1 không đổi tới mười hai chữ số thập phân", () => {
    // Dải personality quyết định ngưỡng vote và inertia của MỌI bot, nên một
    // thay đổi ở đây dịch chuyển toàn bộ cân bằng mà không đổi một dòng logic nào.
    const p = createBotPersonality(createSeededRng("p-0"), BOT_WEIGHTS_V1);
    expect(p.aggressiveness.toFixed(12)).toBe("0.653873024823");
    expect(p.stubbornness.toFixed(12)).toBe("0.625170627784");
    expect(p.loyalty.toFixed(12)).toBe("0.298741259938");
  });

  it("v1 để Sói thắng áp đảo — đây là mốc mà Task 8 phải cải thiện", () => {
    // Ghi lại như một SỰ THẬT ĐO ĐƯỢC, không phải một mục tiêu. Test cân bằng
    // của Phase 2 chỉ đòi mỗi phe thắng ít nhất một ván, nên 21/24 vẫn lọt qua.
    //
    // Lượt cân nhắc lại (Task 5) đã kéo từ 23/24 xuống 21/24: cho làng nhìn
    // bảng kiểm phiếu rồi quyết lại giúp được một chút, nhưng không giải quyết
    // được vấn đề. Đó là việc của Task 8.
    const wolfWins = V1_FINGERPRINT.filter((line) => line.includes("wolves")).length;
    expect(wolfWins).toBe(21);
  });
});

describe("BotRuntime nhận weights", () => {
  it("mặc định dùng DEFAULT_BOT_WEIGHTS", () => {
    const runtime = new BotRuntime({
      playerId: "me",
      rng: createSeededRng("r"),
      playerIds: PLAYERS,
    });
    expect(runtime.weights).toBe(DEFAULT_BOT_WEIGHTS);
  });

  it("từ chối cấu hình hỏng ngay tại constructor", () => {
    // Một NaN lọt qua sẽ không nổ - nó làm mọi so sánh trả về false, và BOT bỏ
    // lượt suốt ván mà không có lỗi nào. Chi phí phát hiện muộn là cả một batch.
    expect(
      () =>
        new BotRuntime({
          playerId: "me",
          rng: createSeededRng("r"),
          playerIds: PLAYERS,
          weights: resolveWeights({ trust: { damping: Number.NaN } }),
        }),
    ).toThrow(/trust\.damping/);
  });

  it("weights khác nhau cho ra quyết định khác nhau với cùng seed", () => {
    const decide = (weights?: BotWeights): PublicVoteChoice => {
      const runtime = new BotRuntime({
        playerId: "me",
        rng: createSeededRng("same-seed"),
        playerIds: PLAYERS,
        weights,
      });
      // Sói: chỉ phe Sói mới được phép chọn "không treo ai" khi bằng chứng mỏng,
      // vì nước đó tiêu một ngày của làng và không tốn gì của chúng.
      const ctx = context({ selfRole: "WEREWOLF", knownRoles: { me: "WEREWOLF" } });
      runtime.observe(ctx);
      return runtime.decideVote(ctx).choice;
    };

    // Chưa ai chết nên áp lực bằng 0, dưới trần 0.3 -> Sói bỏ trắng.
    // Hạ trần về 0 thì cùng seed, cùng state, nhưng buộc phải nêu tên.
    expect(decide().type).toBe("NO_ELIMINATION");
    expect(
      decide(resolveWeights({ deceptionRisk: { abstainPressureCeiling: 0 } })).type,
    ).toBe("PLAYER");
  });
});
