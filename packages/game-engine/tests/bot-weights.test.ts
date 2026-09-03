import { describe, expect, it } from "vitest";
import type { PublicVoteChoice } from "@masoi/shared";
import {
  BOT_WEIGHTS_V1,
  BOT_WEIGHTS_V2,
  BOT_WEIGHTS_V3,
  BOT_WEIGHTS_V4,
  BOT_WEIGHTS_V5,
  BOT_WEIGHTS_V6,
  BOT_WEIGHTS_V7,
  BOT_WEIGHTS_V8,
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
import { runSelfPlay } from "../src/bot/evaluation/selfplay";
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
      GUARDIAN_PROTECT: [],
      HOLY_WATER: [],
      SERIAL_KILL: [],
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
  // Các test dưới đây nêu NỀN tường minh (`BOT_WEIGHTS_V1`) thay vì mượn
  // `DEFAULT_BOT_WEIGHTS`: chúng nói về CƠ CHẾ merge, không về cấu hình đang
  // dùng cho production, nên chúng không được đổi ý nghĩa mỗi lần default đổi.
  it("giữ nguyên mọi trường không được nêu", () => {
    const resolved = resolveWeights({ trust: { damping: 0.9 } }, BOT_WEIGHTS_V1);
    expect(resolved.trust.damping).toBe(0.9);
    expect(resolved.suspicion).toEqual(BOT_WEIGHTS_V1.suspicion);
    expect(resolved.evidence.TIE_BREAK).toEqual(BOT_WEIGHTS_V1.evidence.TIE_BREAK);
  });

  it("không mutate bản gốc", () => {
    // DEFAULT_BOT_WEIGHTS là hằng số dùng chung của cả process. Một lần mutate ở
    // đây rò cấu hình của ván này sang mọi ván sau, và bug đó không tái lập được.
    const before = DEFAULT_BOT_WEIGHTS.trust.damping;
    resolveWeights({ trust: { damping: 0.9 } });
    expect(DEFAULT_BOT_WEIGHTS.trust.damping).toBe(before);
  });

  it("merge nông trong một nhóm: trường cùng nhóm không bị xoá", () => {
    const resolved = resolveWeights({ confidence: { hunterMargin: 99 } }, BOT_WEIGHTS_V1);
    expect(resolved.confidence.hunterMargin).toBe(99);
    expect(resolved.confidence.jitterSpan).toBe(BOT_WEIGHTS_V1.confidence.jitterSpan);
  });

  it("vá một phần bảng evidence giữ nguyên tám kind còn lại", () => {
    // Đây là cách dùng thật của Task 8. Trải cả bảng ra trước khi vá sẽ khiến
    // test xanh dù `resolveWeights` THAY THẾ cả nhóm thay vì merge.
    const resolved = resolveWeights(
      { evidence: { ACCUSE: { weight: 9, confidence: 0.9 } } },
      BOT_WEIGHTS_V1,
    );
    expect(resolved.evidence.ACCUSE).toEqual({ weight: 9, confidence: 0.9 });
    expect(resolved.evidence.TIE_BREAK).toEqual(BOT_WEIGHTS_V1.evidence.TIE_BREAK);
    expect(Object.keys(resolved.evidence).sort()).toEqual(
      Object.keys(BOT_WEIGHTS_V1.evidence).sort(),
    );
  });

  it("đánh dấu version khi giá trị bị chỉnh, để report không gán nhầm cho preset", () => {
    // Một con số win-rate không truy được về cấu hình sinh ra nó là vô dụng.
    expect(resolveWeights({ trust: { damping: 0.9 } }, BOT_WEIGHTS_V1).version).toBe(
      "1.0.0+custom",
    );
    // Đặt version tường minh thì tôn trọng caller.
    expect(
      resolveWeights({ version: "9.9.9", trust: { damping: 0.9 } }, BOT_WEIGHTS_V1).version,
    ).toBe("9.9.9");
    // Không đổi giá trị nào thì không gắn nhãn.
    expect(resolveWeights({}, BOT_WEIGHTS_V1).version).toBe("1.0.0");
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
    const base = voteThreshold(personality, BOT_WEIGHTS_V1);
    const low = voteThreshold(
      personality,
      resolveWeights({ aggression: { thresholdBase: 10 } }, BOT_WEIGHTS_V1),
    );
    expect(low).toBeLessThan(base);
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
        knowledge({ seerResult: { targetId: "a", targetName: "A", isWolf: true, team: "wolves" } }),
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
    // Đủ để vượt ngưỡng phiếu thường, nên chỉ còn `hunterMargin` quyết định.
    state.suspicion.a = { score: 62, reasons: [evidence()], lastUpdatedRound: 1 };

    const shoot = (weights?: BotWeights): string | null =>
      decideHunterShot(
        context({ hunterShot: { canAct: true, legalTargets: ["a", "b"] } }),
        state,
        createSeededRng("h"),
        weights,
      ).targetId;

    // Hai giá trị TƯỜNG MINH, không so với mặc định: bài này kiểm núm vặn có
    // được nối vào quyết định hay không, và nó phải còn đúng khi
    // `DEFAULT_BOT_WEIGHTS` đổi. Trước v5 nó đọc mặc định làm vế "không bắn",
    // nên việc hạ `hunterMargin` ở v5 làm hỏng một bài không liên quan.
    expect(shoot(resolveWeights({ confidence: { hunterMargin: 80 } }))).toBeNull();
    expect(shoot(resolveWeights({ confidence: { hunterMargin: 0 } }))).toBe("a");
  });

  it("confidence.spareTrustMargin đổi ngưỡng Tha ở phiên toà", () => {
    const state = stateFor();
    state.seenEventIds.push("src1");
    state.suspicion.a = { score: 40, reasons: [evidence()], lastUpdatedRound: 1 };
    state.trust.a = { score: 50, reasons: [], lastUpdatedRound: 1 };

    const verdict = (weights: BotWeights): boolean =>
      decideFinalVote(
        context({ phase: "FINAL_VOTE", trialAccusedId: "a", canFinalVote: true }),
        state,
        createSeededRng("f"),
        weights,
      ).guilty;

    // trust 50 vượt suspicion 40 + margin 15? Không -> TREO.
    expect(verdict(BOT_WEIGHTS_V1)).toBe(true);
    // Hạ margin xuống 0 thì trust 50 > suspicion 40 -> THA.
    expect(
      verdict(resolveWeights({ confidence: { spareTrustMargin: 0 } }, BOT_WEIGHTS_V1)),
    ).toBe(false);
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

    // Tường minh cả hai vế, cùng lý do như bài `hunterMargin` ở trên.
    expect(
      act(resolveWeights({ roleThresholds: { witchPoisonSuspicion: 95 } }))!.action,
    ).toBe("SKIP");
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

    // Tường minh cả hai vế, cùng lý do như hai bài trên.
    expect(act(resolveWeights({ roleThresholds: { priestSuspicion: 95 } }))).toBeNull();
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
   * Task 8 đã đổi `DEFAULT_BOT_WEIGHTS` sang v4 (không phải v2 như dòng này
   * từng dự đoán). Khẳng định dưới đây neo vào `BOT_WEIGHTS_V1` một cách tường
   * minh, nên nó vẫn phải xanh sau lần đổi đó. Nếu nó đỏ, nghĩa là một thay đổi
   * đã âm thầm chạm vào cái mốc.
   */
  const V1_FINGERPRINT = [
    "golden-0 village 3 44",
    "golden-1 wolves 4 47",
    "golden-2 wolves 5 81",
    "golden-3 wolves 4 58",
    "golden-4 wolves 4 60",
    "golden-5 wolves 3 45",
    "golden-6 wolves 3 53",
    "golden-7 wolves 4 61",
    "golden-8 wolves 3 45",
    "golden-9 wolves 4 55",
    "golden-10 wolves 3 39",
    "golden-11 wolves 5 75",
    "golden-12 wolves 3 45",
    "golden-13 village 3 44",
    "golden-14 wolves 2 36",
    "golden-15 wolves 4 56",
    "golden-16 wolves 4 53",
    "golden-17 wolves 5 68",
    "golden-18 wolves 4 53",
    "golden-19 wolves 3 43",
    "golden-20 wolves 3 44",
    "golden-21 wolves 7 86",
    "golden-22 wolves 4 51",
    "golden-23 wolves 4 44",
  ];

  it("tái lập chính xác cấu hình v1 trên 24 ván", () => {
    const actual = V1_FINGERPRINT.map((_, i) => {
      const seed = `golden-${i}`;
      const result = runSelfPlay({ seed, playerCount: 8, weights: BOT_WEIGHTS_V1, speech: false });
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
    expect(wolfWins).toBe(22);
  });
});

describe("v2 là cấu hình production", () => {
  /**
   * 200 ván, không phải 60.
   *
   * Sai số chuẩn của một tỉ lệ quanh 0.4 với n=60 là ~6.3%, tức khoảng tin cậy
   * 95% rộng ±12% - đủ để một lát seed kém may mắn làm đỏ một ngưỡng đặt đúng.
   * Đã đo: cùng cấu hình cho 28.3% ở n=60 và 40.5% ở n=200. Ngưỡng dưới đây vì
   * thế chừa biên cho sai số lấy mẫu (SE ≈ 3.5% ở n=200) chứ không bám sát giá
   * trị đo được.
   */
  const SEEDS = Array.from({ length: 200 }, (_, i) => `v2-accept-${i}`);

  /**
   * Hai batch 200 ván là hai test CHẬM NHẤT của cả engine (~2.2s mỗi cái ở máy
   * dev; mọi test khác dưới 0.3s). Chúng là phép đo thống kê, không phải unit
   * test, nên chúng cần một hạn giờ tường minh thay vì mặc định 5s.
   *
   * Vì sao cần: Phase 4 làm mỗi ván tốn hơn khoảng 3,3 lần (8.5ms so với 2.6ms)
   * do BOT nói nhiều gấp 3,4 lần và mỗi câu đều đi qua `chat-analysis`. Ở máy
   * dev chúng vẫn dưới 5s, nhưng runner CI chậm hơn 2–3 lần đã đẩy cả hai vượt
   * hạn và làm đỏ build - xem `docs/bot-ai-phase-4-verification.md` §9 C8.
   */
  const BATCH_TIMEOUT_MS = 60_000;

  /**
   * Đo bằng `runSelfPlay` mặc định (có lời nói): đo bằng một cấu hình không ai
   * chơi là cách chắc chắn nhất để hiệu chỉnh nhầm.
   *
   * Kết quả được ghi nhớ theo phiên bản trọng số. `runSelfPlay` là hàm thuần
   * của `(seed, weights)`, nên chạy lại đúng cùng batch chỉ tốn thời gian mà
   * không thêm thông tin - và hai test dưới đây cùng cần batch của
   * `DEFAULT_BOT_WEIGHTS` (v4.0.0 kể từ Task 8; trước đó là v3.0.0).
   */
  const cache = new Map<string, { village: number; wolves: number }>();

  function winRates(weights: BotWeights): { village: number; wolves: number } {
    const memo = cache.get(weights.version);
    if (memo) return memo;

    const results = SEEDS.map((seed) => runSelfPlay({ seed, weights }));
    const finished = results.filter((item) => item.winner !== null).length;
    const rates = {
      village: results.filter((item) => item.winner === "village").length / finished,
      wolves: results.filter((item) => item.winner === "wolves").length / finished,
    };
    cache.set(weights.version, rates);
    return rates;
  }

  it("mặc định trỏ tới v8", () => {
    // Cùng cơ chế rollout mà docstring của `DEFAULT_BOT_WEIGHTS` mô tả: nâng
    // chính hằng số này lên bản mới để `session-registry.ts` (chỗ ván thật
    // dựng `BotRuntime`, không tự truyền `weights`) chạy bản mới mà không phải
    // sửa. v5 đưa ngưỡng của Phù Thuỷ và Thợ Săn về thang belief thật, v6 làm
    // nốt Linh Mục, v7 bật hành vi của Thằng Hề, v8 bật hành vi của Sát Nhân;
    // v2-v4 vẫn tồn tại nguyên vẹn làm mốc so sánh.
    expect(DEFAULT_BOT_WEIGHTS.version).toBe("8.0.0");
    expect(weightsPreset("8.0.0")).toBe(DEFAULT_BOT_WEIGHTS);
    expect(weightsPreset("7.0.0")).toBe(BOT_WEIGHTS_V7);
    expect(weightsPreset("6.0.0")).toBe(BOT_WEIGHTS_V6);
    expect(weightsPreset("5.0.0")).toBe(BOT_WEIGHTS_V5);
    expect(weightsPreset("4.0.0")).toBe(BOT_WEIGHTS_V4);
    expect(weightsPreset("3.0.0")).toBe(BOT_WEIGHTS_V3);
    expect(weightsPreset("2.0.0")).toBe(BOT_WEIGHTS_V2);
  });

  it(
    "không phe nào thắng quá áp đảo",
    () => {
      // Ngưỡng thật, không phải "mỗi phe thắng ít nhất một ván" như Phase 2 -
      // một tiêu chí mà 96% Sói thắng vẫn lọt qua.
      //
      // Đo được 41.3% ở v3 (Phase 4). Task 8 nâng `DEFAULT_BOT_WEIGHTS` lên
      // v4.0.0 (bật nhóm `claim`, Task 3-7) - đo lại đúng batch này ra 49.5%
      // làng / 50.5% Sói, vẫn nằm gọn trong ngưỡng cũ nên không cần đổi số.
      // Ngưỡng đặt ở 0.28/0.68 để chừa biên sai số lấy mẫu cho cả hai mốc.
      const rates = winRates(DEFAULT_BOT_WEIGHTS);
      expect(rates.village).toBeGreaterThan(0.28);
      expect(rates.village).toBeLessThan(0.68);
      expect(rates.wolves).toBeGreaterThan(0.28);
      expect(rates.wolves).toBeLessThan(0.68);
    },
    BATCH_TIMEOUT_MS,
  );

  it(
    "cải thiện thật so với v1 trên cùng bộ seed",
    () => {
      // Cùng seed, cùng engine, chỉ khác cấu hình: chênh lệch không thể là nhiễu
      // seed. Trước Task 8 (v3 mặc định): 11.5% (v1) so với 41.3% (v3). Sau
      // Task 8 (v4 mặc định, nhóm `claim` bật): 16.5% (v1) so với 49.5% (v4) -
      // biên +0.15 vẫn còn thừa rất nhiều so với chênh lệch đo được (~33 điểm).
      expect(winRates(DEFAULT_BOT_WEIGHTS).village).toBeGreaterThan(
        winRates(BOT_WEIGHTS_V1).village + 0.15,
      );
    },
    BATCH_TIMEOUT_MS,
  );

  it("v1 vẫn đóng băng và vẫn tái lập được", () => {
    // Mốc so sánh chỉ có giá trị nếu nó không trôi. Đây là điều khiến câu
    // "v2 tốt hơn v1 hai lần rưỡi" còn kiểm chứng được ở tương lai.
    expect(BOT_WEIGHTS_V1.version).toBe("1.0.0");
    expect(BOT_WEIGHTS_V1.deceptionRisk.abstainPressureCeiling).toBe(0.3);
    expect(BOT_WEIGHTS_V1.aggression.thresholdBase).toBe(58);
    expect(BOT_WEIGHTS_V1.deceptionRisk.bussingVoteShare).toBeGreaterThan(1);
  });

  it("v2 không thắng bằng cách nới ranh giới hiểu biết", () => {
    // Điều kiện quan trọng nhất của cả đợt hiệu chỉnh: cải thiện phải đến từ
    // chơi hay hơn, không phải từ việc cho BOT thấy nhiều hơn.
    //
    // GHIM `BOT_WEIGHTS_V2` tường minh. Trước đây dòng dưới đọc
    // `DEFAULT_BOT_WEIGHTS`, nên từ lúc mặc định lên v4 (Task 8) test này đo v4
    // trong khi tên nó, docstring nó và cả `describe` bọc ngoài đều nói v2 -
    // một test nói dối về thứ nó chạy. Độ phủ v4 không mất: bộ bất biến đầy đủ
    // ở `selfplay-invariants.test.ts` chạy trên mặc định, tức v4.
    for (const seed of SEEDS.slice(0, 20)) {
      const result = runSelfPlay({ seed, weights: BOT_WEIGHTS_V2 });
      expect({ seed, violations: result.violations.map((item) => item.id) }).toEqual({
        seed,
        violations: [],
      });
    }
  });
});

describe("nhóm conversation", () => {
  it("v3 là v2 cộng thêm hội thoại, không sửa gì khác", () => {
    // Mọi nhóm KHÁC `conversation` phải trỏ tới đúng object của v2. So sánh
    // bằng tham chiếu chứ không bằng giá trị: một bản sao "giống hệt" hôm nay
    // là một bản sao trôi lệch được vào ngày mai.
    for (const group of Object.keys(BOT_WEIGHTS_V2) as Array<keyof BotWeights>) {
      if (group === "version" || group === "conversation") continue;
      expect(BOT_WEIGHTS_V3[group]).toBe(BOT_WEIGHTS_V2[group]);
    }
  });

  it("v1 và v2 giữ nhóm ở giá trị TRUNG TÍNH, tức đúng hành vi Phase 3", () => {
    // Nhóm mới phải có mặt trong mọi preset (BotWeights đòi nó), nhưng ở hai
    // mốc lịch sử nó phải TẮT: một mốc so sánh thay đổi hành vi vì một phase
    // sau đó không còn là mốc so sánh.
    for (const legacy of [BOT_WEIGHTS_V1, BOT_WEIGHTS_V2]) {
      expect(legacy.conversation.messagesPerBotPerRound).toBe(1);
      expect(legacy.conversation.directReplyFloor).toBe(0);
      expect(legacy.conversation.replyCeiling).toBe(0);
      expect(legacy.conversation.selfPlayTurnsPerRound).toBe(1);
      expect(legacy.conversation.humorChance).toBe(0);
      expect(legacy.conversation.reactionChance).toBe(0);
    }
    expect(BOT_WEIGHTS_V1.version).toBe("1.0.0");
    expect(BOT_WEIGHTS_V2.version).toBe("2.0.0");
  });

  it("v3 thật sự bật hội thoại", () => {
    const { conversation } = BOT_WEIGHTS_V3;
    expect(conversation.messagesPerBotPerRound).toBeGreaterThanOrEqual(2);
    expect(conversation.messagesPerBotPerRound).toBeLessThanOrEqual(3);
    expect(conversation.selfPlayTurnsPerRound).toBeGreaterThanOrEqual(2);
    expect(conversation.directReplyFloor).toBeGreaterThan(0);
    // Trần PHẢI nhỏ hơn 1: "ưu tiên trả lời khi bị gọi tên, nhưng không phải
    // lúc nào cũng phản hồi". Một trần bằng 1 biến BOT thành máy trả lời.
    expect(conversation.replyCeiling).toBeLessThan(1);
    expect(conversation.replyCeiling).toBeGreaterThanOrEqual(conversation.directReplyFloor);
    expect(conversation.maxChainDepth).toBeGreaterThanOrEqual(2);
    expect(conversation.maxRepliesPerMessage).toBeGreaterThanOrEqual(1);
  });

  it("bắt tỉ lệ hội thoại nằm ngoài [0, 1]", () => {
    for (const field of [
      "directReplyFloor",
      "replyCeiling",
      "humorChance",
      "reactionChance",
    ] as const) {
      const broken = resolveWeights({ conversation: { [field]: 1.5 } });
      expect(validateWeights(broken).join(" ")).toContain(`conversation.${field}`);
    }
  });

  it("báo thiếu nhóm conversation thay vì ném", () => {
    const missing = { ...DEFAULT_BOT_WEIGHTS } as Record<string, unknown>;
    delete missing.conversation;
    expect(validateWeights(missing as unknown as BotWeights)).toContain(
      'thiếu nhóm bắt buộc "conversation"',
    );
  });

  it("nhóm conversation bất biến", () => {
    expect(() => {
      (DEFAULT_BOT_WEIGHTS.conversation as { maxChainDepth: number }).maxChainDepth = 99;
    }).toThrow();
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
    const decide = (weights: BotWeights): PublicVoteChoice => {
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

    // v1: chưa ai chết nên áp lực bằng 0, dưới trần 0.3 -> Sói bỏ trắng.
    // Hạ trần về 0 thì cùng seed, cùng state, nhưng buộc phải nêu tên.
    expect(decide(BOT_WEIGHTS_V1).type).toBe("NO_ELIMINATION");
    expect(
      decide(resolveWeights({ deceptionRisk: { abstainPressureCeiling: 0 } }, BOT_WEIGHTS_V1))
        .type,
    ).toBe("PLAYER");
  });
});

describe("nhóm trọng số claim", () => {
  it("tắt ở mọi preset cũ, nên v1/v2/v3 không đổi hành vi", () => {
    for (const preset of [BOT_WEIGHTS_V1, BOT_WEIGHTS_V2, BOT_WEIGHTS_V3]) {
      expect(preset.claim.accusationWeight).toBe(0);
      expect(preset.claim.wolfBluffChance).toBe(0);
    }
  });

  it("v4 bật cơ chế lên và mang đúng version", () => {
    expect(BOT_WEIGHTS_V4.version).toBe("4.0.0");
    expect(BOT_WEIGHTS_V4.claim.accusationWeight).toBeGreaterThan(0);
  });

  it("v4 khác v3 ĐÚNG ở nhóm claim và version", () => {
    for (const key of Object.keys(BOT_WEIGHTS_V3) as Array<keyof typeof BOT_WEIGHTS_V3>) {
      if (key === "version" || key === "claim") continue;
      expect(BOT_WEIGHTS_V4[key]).toBe(BOT_WEIGHTS_V3[key]);
    }
  });

  it("v5 khác v4 ĐÚNG ở hai nhóm ngưỡng và version", () => {
    for (const key of Object.keys(BOT_WEIGHTS_V4) as Array<keyof typeof BOT_WEIGHTS_V4>) {
      if (key === "version" || key === "confidence" || key === "roleThresholds") continue;
      expect(BOT_WEIGHTS_V5[key]).toBe(BOT_WEIGHTS_V4[key]);
    }
  });

  it("v6 khác v5 ĐÚNG ở nhóm roleThresholds và version", () => {
    for (const key of Object.keys(BOT_WEIGHTS_V5) as Array<keyof typeof BOT_WEIGHTS_V5>) {
      if (key === "version" || key === "roleThresholds") continue;
      expect(BOT_WEIGHTS_V6[key]).toBe(BOT_WEIGHTS_V5[key]);
    }
  });

  it("v7 khác v6 ĐÚNG ở nhóm jester và version", () => {
    for (const key of Object.keys(BOT_WEIGHTS_V6) as Array<keyof typeof BOT_WEIGHTS_V6>) {
      if (key === "version" || key === "jester") continue;
      expect(BOT_WEIGHTS_V7[key]).toBe(BOT_WEIGHTS_V6[key]);
    }
  });

  it("v8 khác v7 ĐÚNG ở nhóm serialKiller và version", () => {
    for (const key of Object.keys(BOT_WEIGHTS_V7) as Array<keyof typeof BOT_WEIGHTS_V7>) {
      if (key === "version" || key === "serialKiller") continue;
      expect(BOT_WEIGHTS_V8[key]).toBe(BOT_WEIGHTS_V7[key]);
    }
  });

  it("v1-v7 giữ hành vi Sát Nhân TẮT hoàn toàn", () => {
    // Cùng điều kiện và cùng lý do với nhóm `jester` ngay dưới: dưới các cấu
    // hình đó, một con BOT Sát Nhân chốt bằng một luật tất định và không rút
    // một số ngẫu nhiên nào, nên mọi ván tái lập khoá theo chúng vẫn đúng từng
    // bit. Quét cả nhóm chứ không chỉ cổng `nightThreatWeight`.
    for (const preset of [
      BOT_WEIGHTS_V1,
      BOT_WEIGHTS_V2,
      BOT_WEIGHTS_V3,
      BOT_WEIGHTS_V4,
      BOT_WEIGHTS_V5,
      BOT_WEIGHTS_V6,
      BOT_WEIGHTS_V7,
    ]) {
      for (const value of Object.values(preset.serialKiller)) {
        expect(value).toBe(0);
      }
    }
  });

  it("v8 đảo NGƯỢC dấu số hạng đám đông so với Thằng Hề", () => {
    /*
     * Quan hệ này là toàn bộ chỗ khác nhau giữa hai vai trung lập, và nó dễ bị
     * phá vỡ âm thầm: Hề TRỪ điểm người đang dẫn phiếu (đứng lạc lõng để bị
     * treo), Sát Nhân CỘNG (hùa theo để không bị treo). Hai con số cùng dấu ở
     * đây nghĩa là một trong hai vai đang chơi ván của vai kia.
     */
    expect(BOT_WEIGHTS_V8.jester.bandwagonPenalty).toBeGreaterThan(0);
    expect(BOT_WEIGHTS_V8.serialKiller.bandwagonBonus).toBeGreaterThan(0);
    // Và Sát Nhân hùa theo NHẸ hơn mức Hề chống lại: một kẻ luôn bấm theo số
    // đông bất kể lý lẽ cũng là một kẻ dễ đọc.
    expect(BOT_WEIGHTS_V8.serialKiller.bandwagonBonus).toBeLessThan(
      BOT_WEIGHTS_V8.jester.bandwagonPenalty,
    );
  });

  it("v1-v6 giữ hành vi Thằng Hề TẮT hoàn toàn", () => {
    // Đây là điều kiện để mọi test tái lập khoá theo v1/v2/v3 còn đúng: dưới
    // các cấu hình đó, một con BOT Hề không nghiêng bảng điểm và không rút một
    // số ngẫu nhiên nào. Quét cả nhóm chứ không chỉ `bluffChance`, vì bất kỳ
    // số hạng khác 0 nào cũng đủ để đổi thứ tự một lá phiếu.
    for (const preset of [BOT_WEIGHTS_V1, BOT_WEIGHTS_V2, BOT_WEIGHTS_V3, BOT_WEIGHTS_V4, BOT_WEIGHTS_V5, BOT_WEIGHTS_V6]) {
      for (const value of Object.values(preset.jester)) {
        expect(value).toBe(0);
      }
    }
  });

  it("v7 để Thằng Hề dám khai láo hơn Sói, và sớm hơn Sói", () => {
    // Quan hệ này là điều `weights.ts` tuyên bố thành lời: Sói khai láo là
    // đánh cược mạng, còn Hề bị bắt bài chính là thắng. Hai con số rời nhau ở
    // đây thì lần hiệu chỉnh sau sẽ lặng lẽ làm Hề rụt rè hơn Sói.
    expect(BOT_WEIGHTS_V7.jester.bluffChance).toBeGreaterThan(
      BOT_WEIGHTS_V7.claim.wolfBluffChance,
    );
    expect(BOT_WEIGHTS_V7.jester.bluffFromRound).toBeLessThan(
      BOT_WEIGHTS_V7.claim.wolfBluffFromRound,
    );
  });

  it("v6 giữ Nước thánh khó hơn bình độc, đúng vì nó có phản đòn", () => {
    // Không phải một con số đẹp: ném trượt thì chính Linh Mục chết còn mục tiêu
    // vẫn sống, nên ngưỡng của nó PHẢI cao hơn bình độc - thứ chỉ mất một
    // người. Quan hệ này là điều `roles/priest.ts` tuyên bố, và nó dễ bị phá vỡ
    // âm thầm ở lần hiệu chỉnh sau nếu không có ai kiểm.
    expect(BOT_WEIGHTS_V6.roleThresholds.priestSuspicion).toBeGreaterThan(
      BOT_WEIGHTS_V6.roleThresholds.witchPoisonSuspicion,
    );
    // Nhưng vẫn phải nằm trong tầm với của thang thật, nếu không thì nó chỉ đổi
    // từ "không bao giờ ném" sang "không bao giờ ném".
    expect(BOT_WEIGHTS_V6.roleThresholds.priestSuspicion).toBeLessThan(8.6);
    // v5 vẫn giữ nguyên: nó là mốc so sánh, không phải một bản bị sửa lại.
    expect(BOT_WEIGHTS_V5.roleThresholds.priestSuspicion).toBe(95);
  });

  it("v5 đưa ba ngưỡng của Phù Thuỷ và Thợ Săn vào tầm với của thang belief", () => {
    // Mốc so sánh không phải một con số đẹp mà là thang belief THẬT: p99 của
    // suspicion đo trên self-play là 8.6. Một ngưỡng nằm trên mốc đó là một
    // ngưỡng không bao giờ chạy - đúng thứ đã làm hai vai này bất động ở v4.
    const REACHABLE = 8.6;
    expect(BOT_WEIGHTS_V5.roleThresholds.witchPoisonSuspicion).toBeLessThan(REACHABLE);
    expect(BOT_WEIGHTS_V5.roleThresholds.witchHealTrust).toBeLessThan(REACHABLE);
    expect(BOT_WEIGHTS_V5.roleThresholds.witchPoisonTrustVeto).toBeLessThan(REACHABLE);
    // Ngưỡng bắn = voteThreshold + hunterMargin, nên chỉ cần margin không tự nó
    // đẩy tổng ra ngoài tầm với.
    expect(BOT_WEIGHTS_V5.confidence.hunterMargin).toBeLessThan(REACHABLE);
    // v4 vẫn giữ nguyên: nó là mốc so sánh, không phải một bản bị sửa lại.
    expect(BOT_WEIGHTS_V4.roleThresholds.witchPoisonSuspicion).toBe(95);
    expect(BOT_WEIGHTS_V4.confidence.hunterMargin).toBe(80);
  });

  it("validateWeights bắt được hệ số ngoài [0,1]", () => {
    expect(
      validateWeights({ ...BOT_WEIGHTS_V4, claim: { ...BOT_WEIGHTS_V4.claim, underFireFactor: 1.5 } }).join(" "),
    ).toContain("claim.underFireFactor");
  });
});
