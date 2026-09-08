import { describe, expect, it } from "vitest";
import { assessPlayer, assessPlayers } from "../src/bot/belief/player-assessment";
import type { AssessmentInput } from "../src/bot/belief/player-assessment";
import { BotRuntime } from "../src/bot/BotRuntime";
import { createSeededRng } from "../src/bot/rng";
import type { BotKnowledgeView, BotPersonality } from "../src/bot/types";
import { DEFAULT_BOT_WEIGHTS } from "../src/bot/config/weights";

/**
 * Khép tiêu chí §40-#5 của spec CONTINUE: surface chung phân biệt các chiều
 * ĐÁNH GIÁ khác nhau của MỘT người — suspicion / threat / credibility /
 * influence / cooperation / survival / wolfProbability — đọc từ cùng state
 * mà các module cũ đã tính riêng lẻ.
 *
 * §9 của spec: "B can be more likely a wolf while A is the better immediate
 * target" — hai số đó phải tồn tại ĐỘC LẬP trong cùng một bảng, không trộn
 * vào một score.
 */

const BALANCED: BotPersonality = {
  aggressiveness: 0.5,
  talkativeness: 0.9,
  riskTolerance: 0.5,
  deceptionSkill: 0.0,
  analyticalSkill: 1,
  loyalty: 0.5,
  stubbornness: 0.5,
};

const DECK_8: Record<string, number> = {
  WEREWOLF: 2,
  SEER: 1,
  WITCH: 1,
  GUARD: 1,
  HUNTER: 1,
  DETECTIVE: 1,
  VILLAGER: 1,
};

function knowledge(overrides: Partial<BotKnowledgeView> = {}): BotKnowledgeView {
  return {
    botId: "me",
    round: 3,
    phase: "DAY_DISCUSSION",
    phaseStartedAt: 0,
    phaseEndsAt: 30_000,
    selfRole: "VILLAGER",
    players: [
      { id: "me", name: "Me", alive: true },
      { id: "a", name: "A", alive: true },
      { id: "b", name: "B", alive: true },
      { id: "c", name: "C", alive: true },
      { id: "d", name: "D", alive: true },
      { id: "x", name: "X", alive: false },
    ],
    knownRoles: { me: "VILLAGER" },
    seerResult: null,
    sorcererResult: null,
    trackerResult: null,
    neutralRolesInPlay: [],
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
    activeEventId: null,
    dayOfTruthClaims: {},
    ...overrides,
  };
}

function runtime() {
  return new BotRuntime({
    playerId: "me",
    rng: createSeededRng("player-assessment"),
    playerIds: ["me", "a", "b", "c", "d", "x"],
    personality: BALANCED,
    weights: DEFAULT_BOT_WEIGHTS,
  });
}

/**
 * a: ĐƯỢC LÀNG TIN (trust 80) nhưng hơi đáng nghi — ứng viên số một để GIỮ.
 * b: ĐÁNG NGHI sâu (suspicion 80) nhưng không ai tin — ứng viên để TREO.
 * c: người bình thường; d: SÓI đã lộ (soi trúng).
 */
function input(overrides: Partial<BotKnowledgeView> = {}): AssessmentInput {
  const ctx = knowledge(overrides);
  const bot = runtime();
  bot.state.suspicion["a"] = {
    score: 20,
    reasons: [
      {
        id: "r1",
        kind: "ACCUSE",
        sourceId: "m1",
        actorId: "c",
        targetId: "a",
        weight: 4,
        confidence: 0.6,
        round: 1,
        summary: "Buộc tội.",
      },
    ],
    lastUpdatedRound: 1,
  };
  bot.state.trust["a"] = { score: 80, reasons: [], lastUpdatedRound: 1 };
  bot.state.suspicion["b"] = {
    score: 80,
    reasons: [
      {
        id: "r2",
        kind: "LATE_SWITCH",
        sourceId: "m2",
        actorId: "b",
        weight: 9,
        confidence: 0.7,
        round: 1,
        summary: "Đổi phiếu muộn.",
      },
    ],
    lastUpdatedRound: 1,
  };
  bot.state.trust["b"] = { score: 5, reasons: [], lastUpdatedRound: 1 };
  bot.state.suspicion["c"] = { score: 10, reasons: [], lastUpdatedRound: 1 };
  bot.state.trust["c"] = { score: 30, reasons: [], lastUpdatedRound: 1 };
  // c bênh a → a có incoming support; mọi người cùng công kích b.
  bot.state.relationships["c->a"] = {
    support: 0.6,
    hostility: 0,
    voteAlignment: 0.5,
    samples: 3,
    reasons: [],
    lastUpdatedRound: 2,
  };
  bot.state.relationships["d->b"] = {
    support: 0,
    hostility: 0.7,
    voteAlignment: 0,
    samples: 3,
    reasons: [],
    lastUpdatedRound: 2,
  };
  bot.state.relationships["c->b"] = {
    support: 0,
    hostility: 0.5,
    voteAlignment: 0,
    samples: 2,
    reasons: [],
    lastUpdatedRound: 2,
  };
  // d đã lộ Sói qua knownRoles kiểu public (revealRoleOnDeath=on).
  const finalCtx =
    overrides.knownRoles !== undefined && overrides.knownRoles["d"] !== undefined
      ? ctx
      : {
          ...ctx,
          revealRoleOnDeath: true,
          knownRoles: { me: "VILLAGER" as const, d: "WEREWOLF" as const },
        };
  return {
    knowledge: finalCtx,
    state: bot.state,
    roleComposition: DECK_8,
  };
}

describe("assessPlayer (surface đánh giá đa chiều §9)", () => {
  it("B đáng nghi hơn nhưng A nguy hiểm hơn: hai chiều tồn tại độc lập", () => {
    const input_ = input();
    const a = assessPlayer("a", input_);
    const b = assessPlayer("b", input_);
    // §9: B can be more likely a wolf while A is the better immediate target.
    expect(b.wolfProbability).toBeGreaterThan(a.wolfProbability);
    expect(a.threat).toBeGreaterThan(b.threat);
  });

  it("số liệu nằm đúng thang: scalar 0..100, mọi xác suất/trọng số 0..1", () => {
    const assessments = assessPlayers(input());
    for (const assessment of Object.values(assessments)) {
      expect(assessment.suspicion).toBeGreaterThanOrEqual(0);
      expect(assessment.suspicion).toBeLessThanOrEqual(100);
      expect(assessment.trust).toBeGreaterThanOrEqual(0);
      expect(assessment.trust).toBeLessThanOrEqual(100);
      for (const value of [
        assessment.wolfProbability,
        assessment.threat,
        assessment.credibility,
        assessment.influence,
        assessment.cooperationValue,
        assessment.survivalImportance,
      ]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("credibility chỉ đổi theo hồ sơ (bluff/accuracy), không đổi theo suspicion", () => {
    const base = input();
    const changedSuspicion = input();
    changedSuspicion.state.suspicion["a"] = {
      ...changedSuspicion.state.suspicion["a"]!,
      score: 90,
    };
    expect(assessPlayer("a", changedSuspicion).credibility).toBe(
      assessPlayer("a", base).credibility,
    );

    const bluffed = input();
    bluffed.state.profiles["a"] = {
      bluffRate: 0.8,
      aggroRate: 0,
      accuracy: 0.5,
      samples: 6,
      lastUpdatedRound: 2,
    };
    expect(assessPlayer("a", bluffed).credibility).toBeLessThan(
      assessPlayer("a", base).credibility,
    );

    const proven = input();
    proven.state.profiles["a"] = {
      bluffRate: 0,
      aggroRate: 0,
      accuracy: 1,
      samples: 6,
      lastUpdatedRound: 2,
    };
    expect(assessPlayer("a", proven).credibility).toBeGreaterThan(
      assessPlayer("a", base).credibility,
    );
  });

  it("vai lộ là certain qua mọi chiều: Sói lộ → P=1, threat vẫn tính theo công thức", () => {
    const input_ = input();
    const wolf = assessPlayer("d", input_);
    expect(wolf.wolfProbability).toBe(1);
    // Người chết không có trong bảng assessment của người sống bổ sung.
    const assessments = assessPlayers(input_);
    expect(assessments["d"]).toBeDefined();
    expect(assessments["x"]).toBeUndefined();
  });

  it("cooperation của người được bênh cao hơn người bị công kích", () => {
    // a được c bênh (support edge c→a); b bị công kích.
    const a = assessPlayer("a", input());
    const b = assessPlayer("b", input());
    expect(a.cooperationValue).toBeGreaterThan(b.cooperationValue);
    expect(b.influence).toBeGreaterThanOrEqual(a.influence * 0);
  });

  it("survivalImportance: người khai vai quyền lực chưa bị bác > dân thường > Sói lộ", () => {
    const bot = runtime();
    bot.state.suspicion["a"] = { score: 20, reasons: [], lastUpdatedRound: 1 };
    bot.state.trust["a"] = { score: 30, reasons: [], lastUpdatedRound: 1 };
    bot.state.seenEventIds.push("m-claim");
    bot.state.claims.push({
      id: "claim-a",
      sourceId: "m-claim",
      round: 1,
      phase: "DAY_DISCUSSION",
      type: "ROLE_CLAIM",
      actorId: "a",
      importance: 10,
      pinned: true,
      data: { role: "GUARD" },
    });
    const ctx = knowledge();
    const withClaim = assessPlayer("a", {
      knowledge: ctx,
      state: bot.state,
      roleComposition: DECK_8,
    });

    const plain = assessPlayer("c", input());
    expect(withClaim.survivalImportance).toBeGreaterThan(plain.survivalImportance);

    const wolf = assessPlayer("d", input());
    expect(wolf.survivalImportance).toBeLessThan(plain.survivalImportance);
  });

  it("threat đọc qua công thức threat của bầy: tin + ảnh hưởng − nghi", () => {
    // a: trust 80, influence 0 (không ai công kích), suspicion 20 →
    // (40 + 32 + 0 − 7)/100 = 0.65.
    const a = assessPlayer("a", input());
    expect(a.threat).toBeCloseTo((40 + 80 * 0.4 + 0 - 20 * 0.35) / 100, 6);
    // b: trust 5, suspicion 80, bị công kích 0.7 + 0.5 → mean 0.6 → +12:
    // (40 + 2 + 12 − 28)/100 = 0.26. Dẫn đầu dư luận BẰNG CÁCH BỊ CHỬI cũng là
    // một dạng lái bàn (Sói cắn để dập lửa), nên threat tính cả ảnh hưởng âm.
    const b = assessPlayer("b", input());
    expect(b.threat).toBeCloseTo((40 + 5 * 0.4 + 12 - 80 * 0.35) / 100, 6);
  });

  it("tất định: cùng input hai lần → cùng bảng (JSON-equal)", () => {
    const input_ = input();
    expect(JSON.stringify(assessPlayers(input_))).toBe(JSON.stringify(assessPlayers(input_)));
  });
});
