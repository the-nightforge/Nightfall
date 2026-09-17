import { describe, expect, it } from "vitest";
import type { Role } from "@masoi/shared";
import { BotRuntime, isDefaultLearnedDecisions, learnedHas } from "../src/bot/BotRuntime";
import {
  decideFinalVote,
  finalVoteHardRule,
  FINAL_VOTE_GUILTY_LABEL,
  FINAL_VOTE_SPARE_LABEL,
} from "../src/bot/decision/trial-decision";
import { runSelfPlay } from "../src/bot/evaluation/selfplay";
import {
  candidateBases,
  candidateScores,
  optimalActionMask,
  validateTrajectoryLine,
} from "../src/bot/learning/dataset";
import type { LearnedPolicy } from "../src/bot/learning/mlp";
import {
  ACTION_KINDS,
  actionIndexOf,
  actionSize,
  DEFAULT_MAX_SEATS,
  encodeObservation,
  FINAL_ACTION_KIND,
  legalMoves,
  observationFeatureNames,
  observationSize,
  TARGETING_DECISIONS,
} from "../src/bot/learning/observation";
import { createBotBrainState } from "../src/bot/memory/memory-store";
import { createBotPersonality } from "../src/bot/personality/personality";
import type { FinalVotePolicyModel } from "../src/bot/policy/policy-model";
import { createSeededRng } from "../src/bot/rng";
import type {
  BotBrainState,
  BotDecisionContext,
  BotKnowledgeView,
} from "../src/bot/types";
import type { BotTrajectory } from "../src/bot/evaluation/trajectory";

/**
 * Spec 2026-09-14-final-vote-action-space-design: FINAL_VOTE có không gian
 * hành động (kind FINAL append cuối), nhãn treo/tha, runtime hook
 * fail-closed, LearnedDecisions thành tập cờ, dataset-0004.
 */

const PLAYERS = ["me", "a", "b", "c"];

function stateFor(seed = "final-space"): BotBrainState {
  return createBotBrainState("me", createBotPersonality(createSeededRng(seed)), PLAYERS);
}

function context(over: Partial<BotKnowledgeView> = {}): BotDecisionContext {
  return {
    knowledge: {
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

/** Một line FINAL_VOTE hợp lệ: bị cáo p1, verdict theo `label`. */
function finalLine(
  label: string,
  overrides: Omit<Partial<BotTrajectory>, "observation" | "selectedAction"> & {
    observation?: Partial<BotTrajectory["observation"]>;
    selectedAction?: Partial<BotTrajectory["selectedAction"]>;
  } = {},
): BotTrajectory {
  const base: BotTrajectory = {
    gameId: "g1",
    seed: "g1",
    playerId: "p2",
    finalRole: "VILLAGER" as Role,
    turn: 3,
    phase: "FINAL_VOTE",
    decision: "FINAL_VOTE",
    observation: {
      aliveIds: ["p1", "p2", "p3"],
      legalActions: ["p1", "p3", "NO_ELIMINATION"],
      nightLegalTargets: null,
      knownRoles: { p2: "VILLAGER" as Role },
      seerResult: null,
      belief: [
        { playerId: "p1", suspicion: 60, trust: 0, wolfProbability: 0.7, threat: 0.2, credibility: 0.4, influence: 0.1, informationValue: 40, claimedPowerRole: true, guardedBefore: false },
        { playerId: "p2", suspicion: 0, trust: 20, wolfProbability: 0, threat: 0, credibility: 0.5, influence: 0, informationValue: 20, claimedPowerRole: false, guardedBefore: false },
        { playerId: "p3", suspicion: 10, trust: 0, wolfProbability: 0.2, threat: 0.6, credibility: 0.5, influence: 0.3, informationValue: 30, claimedPowerRole: false, guardedBefore: true },
      ],
      personality: {
        aggressiveness: 0.5,
        talkativeness: 0.4,
        riskTolerance: 0.3,
        deceptionSkill: 0.2,
        analyticalSkill: 0.6,
        loyalty: 0.7,
        stubbornness: 0.8,
      },
      nightWolfTarget: null,
      healUsed: false,
      poisonUsed: false,
      guardPrevious: null,
      lastNightDeaths: [],
      voteCounts: { players: { p1: 1 }, noElimination: 0 },
      trialAccusedId: "p1",
    },
    legalActions: ["p1", "p3", "NO_ELIMINATION"],
    candidates: [
      { targetId: "p1", score: 60, terms: [{ name: "suspicion", value: 60 }], evidenceIds: [] },
    ],
    selectedAction: { decision: "FINAL_VOTE", targetId: "p1", label, kind: "FINAL" },
    reward: 1,
    shaping: 1,
    finalWinner: "village",
  };
  return {
    ...base,
    ...overrides,
    observation: { ...base.observation, ...(overrides.observation ?? {}) },
    selectedAction: { ...base.selectedAction, ...(overrides.selectedAction ?? {}) },
  };
}

describe("D1 — kind FINAL trong cùng action space", () => {
  it("FINAL append cuối: 12 kinds × 17 slots = 204, chỉ số cũ 0–186 giữ nguyên", () => {
    expect(ACTION_KINDS).toHaveLength(12);
    expect(ACTION_KINDS[0]).toBe("CHOOSE");
    expect(ACTION_KINDS[ACTION_KINDS.length - 1]).toBe(FINAL_ACTION_KIND);
    expect(actionSize()).toBe(204);
    // Kind cũ không dịch: CHOOSE ghế 0 vẫn là 0, POISON ghế 1 vẫn như cũ.
    expect(actionIndexOf("CHOOSE", 0)).toBe(0);
    expect(actionIndexOf("CHOOSE", DEFAULT_MAX_SEATS)).toBe(DEFAULT_MAX_SEATS);
    expect(actionIndexOf("POISON", 1)).toBe(5 * (DEFAULT_MAX_SEATS + 1) + 1);
    // Observation thêm đúng một chiều legalKind:FINAL. (Số đo thực ở HEAD là
    // 412 → 413; spec ghi 413 → 414 theo model đã commit — model đó vốn đã
    // lệch encoder HEAD một chiều và loader từ chối nó từ trước spec này.)
    expect(observationSize()).toBe(413);
    expect(observationFeatureNames()).toContain("legalKind:FINAL");
  });

  it("TARGETING_DECISIONS mở cổng FINAL_VOTE", () => {
    expect(TARGETING_DECISIONS.has("FINAL_VOTE")).toBe(true);
    expect(TARGETING_DECISIONS.has("SPEECH")).toBe(false);
  });

  it("legalMoves FINAL_VOTE: đúng một entry FINAL (ghế bị cáo + tha), return ngay", () => {
    const moves = legalMoves({
      playerId: "p2",
      turn: 3,
      phase: "FINAL_VOTE",
      decision: "FINAL_VOTE",
      observation: finalLine("treo").observation,
      legalActions: ["p1", "p3", "NO_ELIMINATION"],
    });
    expect([...moves.keys()]).toEqual([FINAL_ACTION_KIND]);
    expect(moves.get(FINAL_ACTION_KIND)).toEqual({ targets: new Set(["p1"]), none: true });
  });

  it("vắng bị cáo → mask rỗng → actionIndex null (quy ước không nhãn)", () => {
    const noAccused = finalLine("tha", {
      observation: { trialAccusedId: null },
      selectedAction: { targetId: null },
    });
    const moves = legalMoves({
      playerId: noAccused.playerId,
      turn: noAccused.turn,
      phase: noAccused.phase,
      decision: noAccused.decision,
      observation: noAccused.observation,
      legalActions: noAccused.legalActions,
    });
    expect(moves.size).toBe(0);
    expect(encodeObservation(noAccused).actionIndex).toBeNull();
  });
});

describe("mask/nhãn FINAL_VOTE (Kiểm chứng TS)", () => {
  it("mask mở đúng hai ô (bị cáo + tha), KHÔNG mở ô CHOOSE nào (hồi quy bẫy D1)", () => {
    // seats = [p2, p3, p1]: bị cáo p1 ở ghế 2; FINAL base = 11 × 17 = 187.
    const encoded = encodeObservation(finalLine("treo"));
    const base = 11 * (DEFAULT_MAX_SEATS + 1);
    expect(encoded.mask[base + 2]).toBe(true);
    expect(encoded.mask[base + DEFAULT_MAX_SEATS]).toBe(true);
    expect(encoded.mask.filter(Boolean)).toHaveLength(2);
    for (let i = 0; i <= DEFAULT_MAX_SEATS; i += 1) {
      expect(encoded.mask[actionIndexOf("CHOOSE", i)]).toBe(false);
    }
  });

  it("treo → ô ghế bị cáo, tha → ô không-mục-tiêu", () => {
    const base = 11 * (DEFAULT_MAX_SEATS + 1);
    expect(encodeObservation(finalLine(FINAL_VOTE_GUILTY_LABEL)).actionIndex).toBe(base + 2);
    expect(encodeObservation(finalLine(FINAL_VOTE_SPARE_LABEL)).actionIndex).toBe(
      base + DEFAULT_MAX_SEATS,
    );
    // Label lạ → null (validator siết thành violation, không im lặng).
    expect(encodeObservation(finalLine("bầu")).actionIndex).toBeNull();
  });
});

describe("validator §42 + nhãn phụ (D7/D8)", () => {
  it("hàng FINAL_VOTE hợp lệ (treo và tha) → violations = 0", () => {
    expect(validateTrajectoryLine(finalLine("treo"))).toEqual({ valid: true, violations: [] });
    expect(validateTrajectoryLine(finalLine("tha"))).toEqual({ valid: true, violations: [] });
  });

  it("có bị cáo mà label lạ → violation (không phải actionIndex null im lặng)", () => {
    const report = validateTrajectoryLine(finalLine("bầu"));
    expect(report.valid).toBe(false);
    expect(report.violations.some((v) => v.field === "selectedAction.label")).toBe(true);
  });

  it("optimalActionMask hàng FINAL chỉ một ô — cả khi tha", () => {
    const base = 11 * (DEFAULT_MAX_SEATS + 1);
    for (const label of [FINAL_VOTE_GUILTY_LABEL, FINAL_VOTE_SPARE_LABEL]) {
      const line = finalLine(label);
      const enc = encodeObservation(line);
      const opt = optimalActionMask(line, enc);
      expect(opt.filter(Boolean)).toHaveLength(1);
      expect(opt[enc.actionIndex!]).toBe(true);
      // Hàng tha mà bật ô treo là thước đo chính bị chấm sai (bẫy D7).
      if (label === FINAL_VOTE_SPARE_LABEL) expect(opt[base + 2]).toBe(false);
    }
  });

  it("candidateScores/candidateBases NaN toàn phần ở hàng FINAL", () => {
    for (const label of [FINAL_VOTE_GUILTY_LABEL, FINAL_VOTE_SPARE_LABEL]) {
      const line = finalLine(label);
      const enc = encodeObservation(line);
      expect(candidateScores(line, enc).every((v) => Number.isNaN(v))).toBe(true);
      expect(candidateBases(line, enc).every((v) => Number.isNaN(v))).toBe(true);
    }
  });
});

describe("finalVoteHardRule — năm nhánh đứng trước, policy không ghi đè", () => {
  const stub = (guilty: boolean): FinalVotePolicyModel => ({
    name: "stub",
    selectVerdict: () => ({ guilty }),
  });
  const thrower: FinalVotePolicyModel = {
    name: "thrower",
    selectVerdict: () => {
      throw new Error("policy nổ");
    },
  };
  const nuller: FinalVotePolicyModel = { name: "nuller", selectVerdict: () => null };

  it("belief-driven: policy thắng teacher; null/nổ → teacher (fail-closed)", () => {
    const trusting = stateFor();
    trusting.trust.a = { score: 100, reasons: [], lastUpdatedRound: 2 };
    // Teacher tha (trust cao) nhưng policy treo.
    expect(decideFinalVote(context(), trusting, rng()).guilty).toBe(false);
    expect(decideFinalVote(context(), trusting, rng(), undefined, undefined, stub(true)).guilty).toBe(
      true,
    );
    expect(decideFinalVote(context(), trusting, rng(), undefined, undefined, nuller).guilty).toBe(
      false,
    );
    expect(decideFinalVote(context(), trusting, rng(), undefined, undefined, thrower).guilty).toBe(
      false,
    );
  });

  it("năm nhánh hard-rule không bị policy ghi đè", () => {
    const against = stub(true);
    const forSpare = stub(false);
    // Không bị cáo → tha.
    expect(decideFinalVote(context({ trialAccusedId: null }), stateFor(), rng(), undefined, undefined, against).guilty).toBe(false);
    // Sói không treo đồng bọn.
    const allyCtx = context({ selfRole: "WEREWOLF" as const });
    const allyState = stateFor();
    allyState.suspicion.a = { score: 95, reasons: [], lastUpdatedRound: 2 };
    const allyKnown = { ...allyCtx.knowledge, knownRoles: { me: "WEREWOLF", a: "WEREWOLF" } as Record<string, Role> };
    expect(
      decideFinalVote({ ...allyCtx, knowledge: allyKnown }, allyState, rng(), undefined, undefined, against).guilty,
    ).toBe(false);
    // Hề luôn tha.
    expect(decideFinalVote(context({ selfRole: "JESTER" }), stateFor(), rng(), undefined, undefined, against).guilty).toBe(false);
    // Sát Nhân luôn treo.
    expect(decideFinalVote(context({ selfRole: "SERIAL_KILLER" }), stateFor(), rng(), undefined, undefined, forSpare).guilty).toBe(true);
    // Báo Thù theo mục tiêu.
    expect(
      decideFinalVote(
        context({ selfRole: "EXECUTIONER", executionerTargetId: "a" }),
        stateFor(),
        rng(),
        undefined,
        undefined,
        forSpare,
      ).guilty,
    ).toBe(true);
  });

  it("finalVoteHardRule: null ở nhánh belief-driven", () => {
    expect(finalVoteHardRule(context())).toBeNull();
    expect(finalVoteHardRule(context({ selfRole: "JESTER" }))).toEqual({
      guilty: false,
      reason: expect.any(String),
    });
    expect(finalVoteHardRule(context({ trialAccusedId: null }))).toEqual({
      guilty: false,
      reason: expect.any(String),
    });
  });
});

describe("BotRuntime.decideFinalVote — hook + trace (D3/D8)", () => {
  function runtimeWith(over: Partial<ConstructorParameters<typeof BotRuntime>[0]>): BotRuntime {
    return new BotRuntime({ playerId: "me", rng: createSeededRng("rt"), playerIds: PLAYERS, ...over });
  }

  it("không policy → teacher, byte một: label + actionKind FINAL trên trace", () => {
    const { runtime, traces } = (() => {
      const collected: import("../src/bot/trace/trace").BotDecisionTrace[] = [];
      const rt = runtimeWith({ trace: { record: (t) => collected.push(t) } });
      return { runtime: rt, traces: collected };
    })();
    runtime.observe(context());
    const verdict = runtime.decideFinalVote(context());
    // Không bằng chứng (suspicion/trust 0) → tha (ranh giới đã khoá ở trial-decision).
    expect(verdict.guilty).toBe(false);
    const t = traces.find((item) => item.decision === "FINAL_VOTE")!;
    expect(t.chosen.targetId).toBe("a");
    expect(t.chosen.label).toBe(FINAL_VOTE_SPARE_LABEL);
    expect(t.chosen.actionKind).toBe("FINAL");
  });

  it("cờ hunter: model thay mục tiêu bắn, mask chặn tự bắn; không cờ = heuristic", () => {
    const hunterContext = context({
      phase: "HUNTER_SHOT",
      selfRole: "HUNTER",
      knownRoles: { me: "HUNTER" },
      trialAccusedId: null,
      canFinalVote: false,
      hunterShot: { canAct: true, legalTargets: ["me", "a", "b", "c"] },
    });
    const angry = (): BotBrainState => {
      const s = stateFor("hunter");
      s.suspicion.a = { score: 95, reasons: [], lastUpdatedRound: 2 };
      return s;
    };
    const stub = (slots: number[]): LearnedPolicy => ({
      id: "hunter-stub",
      logits: () => {
        const l = new Array<number>(actionSize()).fill(0);
        for (const slot of slots) l[actionIndexOf("CHOOSE", slot)] = 10;
        return l;
      },
      value: () => null,
    });
    const noneSlot = DEFAULT_MAX_SEATS;

    const heuristic = runtimeWith({ state: angry() });
    heuristic.observe(hunterContext);
    expect(heuristic.decideHunterShot(hunterContext).targetId).toBe("a");

    // Model thích "không bắn" → lật heuristic.
    const holdFire = runtimeWith({ learnedPolicy: stub([noneSlot]), learnedDecisions: ["hunter"], state: angry() });
    holdFire.observe(hunterContext);
    expect(holdFire.decideHunterShot(hunterContext).targetId).toBeNull();

    // Model thích mọi ghế → chọn một ghế hợp lệ, không bao giờ chính mình.
    const anySeat = runtimeWith({
      learnedPolicy: stub(Array.from({ length: DEFAULT_MAX_SEATS }, (_, i) => i)),
      learnedDecisions: ["hunter"],
      state: angry(),
    });
    anySeat.observe(hunterContext);
    const target = anySeat.decideHunterShot(hunterContext).targetId;
    expect(["a", "b", "c"]).toContain(target);

    // Cờ khác (vote/night/final) không chạm phát bắn.
    const otherFlags = runtimeWith({
      learnedPolicy: stub([noneSlot]),
      learnedDecisions: ["vote", "night", "final"],
      state: angry(),
    });
    otherFlags.observe(hunterContext);
    expect(otherFlags.decideHunterShot(hunterContext).targetId).toBe("a");
  });

  it("finalVotePolicy tường minh thắng teacher; learned cờ final cũng thắng", () => {
    const trusting = stateFor();
    trusting.trust.a = { score: 100, reasons: [], lastUpdatedRound: 2 };
    const hang: FinalVotePolicyModel = { name: "hang", selectVerdict: () => ({ guilty: true }) };
    const rt = runtimeWith({ finalVotePolicy: hang, state: trusting });
    rt.observe(context());
    expect(rt.decideFinalVote(context()).guilty).toBe(true);

    // Learned stub thích ô tha FINAL → lật teacher treo thành tha.
    const spareLearned: LearnedPolicy = {
      id: "spare",
      logits: () => {
        const l = new Array<number>(actionSize()).fill(0);
        l[actionIndexOf("FINAL", DEFAULT_MAX_SEATS)] = 10;
        return l;
      },
      value: () => null,
    };
    const angry = stateFor("angry");
    angry.suspicion.a = { score: 95, reasons: [], lastUpdatedRound: 2 };
    const rt2 = runtimeWith({ learnedPolicy: spareLearned, learnedDecisions: ["final"], state: angry });
    rt2.observe(context());
    expect(rt2.decideFinalVote(context()).guilty).toBe(false);
  });

  it("learnedDecisions bật riêng final không bật vote/night (và ngược lại)", () => {
    const policy: LearnedPolicy = {
      id: "split-final",
      logits: () => {
        const l = new Array<number>(actionSize()).fill(0);
        l[actionIndexOf("KILL", 2)] = 10;
        l[actionIndexOf("CHOOSE", 1)] = 10;
        return l;
      },
      value: () => null,
    };
    const plain = runSelfPlay({ seed: "ld-final", playerCount: 8, maxRounds: 5, trace: true });
    const finalOnly = runSelfPlay({
      seed: "ld-final",
      playerCount: 8,
      maxRounds: 5,
      trace: true,
      learnedPolicy: policy,
      learnedDecisions: ["final"],
    });
    const voteNight = runSelfPlay({
      seed: "ld-final",
      playerCount: 8,
      maxRounds: 5,
      trace: true,
      learnedPolicy: policy,
      learnedDecisions: ["vote", "night"],
    });
    const votesOf = (g: typeof plain): string =>
      JSON.stringify(
        g.traces
          .filter((t) => t.decision === "VOTE" || t.decision === "NIGHT")
          .map((t) => [t.botId, t.round, t.decision, t.chosen.actionKind ?? null, t.chosen.targetId]),
      );
    // Cờ final riêng: bầu/đêm byte một với heuristic.
    expect(votesOf(finalOnly)).toBe(votesOf(plain));
    expect(finalOnly.record.learnedDecisions).toEqual(["final"]);
    // Cờ vote+night không chạm phiên toà: kiểm ở mức runtime cho tất định
    // (so trace giữa hai ván self-play khác dynamics là vô nghĩa — đề cử đã
    // đổi thì phiên toà đã khác). Policy thích tha nhưng teacher treo vẫn treo.
    const spareLearned: LearnedPolicy = {
      id: "spare-final",
      logits: () => {
        const l = new Array<number>(actionSize()).fill(0);
        l[actionIndexOf("FINAL", DEFAULT_MAX_SEATS)] = 10;
        return l;
      },
      value: () => null,
    };
    const angry = stateFor("angry-vn");
    angry.suspicion.a = { score: 95, reasons: [], lastUpdatedRound: 2 };
    const rt = new BotRuntime({
      playerId: "me",
      rng: createSeededRng("rt-vn"),
      playerIds: PLAYERS,
      learnedPolicy: spareLearned,
      learnedDecisions: ["vote", "night"],
      state: angry,
    });
    rt.observe(context());
    expect(rt.decideFinalVote(context()).guilty).toBe(true);
  });
});

describe("D6 — LearnedDecisions là tập cờ", () => {
  it("learnedHas: both = vote+night (không gồm final); mảng đọc theo phép thuộc", () => {
    expect(learnedHas(undefined, "vote")).toBe(true);
    expect(learnedHas(undefined, "night")).toBe(true);
    expect(learnedHas(undefined, "final")).toBe(false);
    expect(learnedHas("both", "final")).toBe(false);
    expect(learnedHas("vote", "vote")).toBe(true);
    expect(learnedHas("vote", "night")).toBe(false);
    expect(learnedHas("vote", "final")).toBe(false);
    expect(learnedHas("final", "vote")).toBe(false);
    expect(learnedHas("final", "final")).toBe(true);
    expect(learnedHas(["vote", "final"], "night")).toBe(false);
    expect(learnedHas(["vote", "final"], "final")).toBe(true);
    expect(learnedHas("both", "hunter")).toBe(false);
    expect(learnedHas(["hunter"], "hunter")).toBe(true);
    expect(learnedHas(["hunter"], "vote")).toBe(false);
  });

  it("isDefaultLearnedDecisions: chỉ undefined/both là mặc định", () => {
    expect(isDefaultLearnedDecisions(undefined)).toBe(true);
    expect(isDefaultLearnedDecisions("both")).toBe(true);
    expect(isDefaultLearnedDecisions("vote")).toBe(false);
    expect(isDefaultLearnedDecisions(["vote", "night"])).toBe(false);
  });
});
