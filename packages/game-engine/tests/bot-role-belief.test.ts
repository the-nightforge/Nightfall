import { describe, expect, it } from "vitest";
import { projectRoleBeliefs } from "../src/bot/belief/role-belief";
import type { RoleBeliefInput } from "../src/bot/belief/role-belief";
import { BotRuntime } from "../src/bot/BotRuntime";
import { createSeededRng } from "../src/bot/rng";
import type { BotKnowledgeView, BotPersonality } from "../src/bot/types";
import { BOT_WEIGHTS_V18 } from "../src/bot/config/weights";

/**
 * PR 1 của BOT_AI_CONTINUE_UPGRADE (§5/§6/§7/§33): projection xác suất theo VAI
 * từ đúng những gì bot được biết — scalar suspicion/trust giữ nguyên, decision
 * KHÔNG đổi (§33 "Do not immediately change action selection").
 *
 * Ràng buộc bắt buộc:
 * - Tổng P(role) = 1 cho mọi player (chuẩn hoá).
 * - Certain beats evidence: knownRoles / pin soi đè mọi suy diễn.
 * - Composition của deck do caller cấp từ engine; module không hard-code.
 * - Evidence không đếm đôi: claim chỉ phân bổ lại khối lượng không-Sói.
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

/** Bộ bài 8 người của preset xếp hạng: 2 Sói + 5 vai chức năng + 1 Dân. */
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

function input(
  overrides: Partial<BotKnowledgeView> = {},
  mutate?: (bot: BotRuntime) => void,
  composition: Record<string, number> = DECK_8,
): RoleBeliefInput {
  const ctx = { knowledge: knowledge(overrides), visibleChat: [] };
  const bot = new BotRuntime({
    playerId: "me",
    rng: createSeededRng("role-belief"),
    playerIds: ctx.knowledge.players.map((player) => player.id),
    personality: BALANCED,
    weights: BOT_WEIGHTS_V18,
  });
  const reason = (id: string, weight: number) => ({
    id: `ev-${id}`,
    kind: "TIE_BREAK" as const,
    sourceId: `1:nomination:${id}`,
    actorId: id,
    targetId: "z",
    weight,
    confidence: 0.7,
    round: 1,
    summary: `Phiếu phá hoà của ${id}.`,
  });
  bot.state.seenEventIds.push("1:nomination:b", "1:nomination:c");
  bot.state.suspicion["b"] = { score: 74, reasons: [reason("b", 10)], lastUpdatedRound: 1 };
  bot.state.suspicion["c"] = { score: 30, reasons: [reason("c", 6)], lastUpdatedRound: 1 };
  bot.state.suspicion["d"] = { score: 0, reasons: [], lastUpdatedRound: 1 };
  if (mutate) mutate(bot);
  return { knowledge: ctx.knowledge, state: bot.state, roleComposition: composition };
}

function wolfProb(belief: { probabilities: Record<string, number> }): number {
  return belief.probabilities["WEREWOLF"] ?? 0;
}

describe("projectRoleBeliefs (PR1 — belief xác suất theo vai)", () => {
  it("mọi player được chuẩn hoá: tổng P(role) = 1", () => {
    const beliefs = projectRoleBeliefs(input());
    for (const [playerId, belief] of Object.entries(beliefs)) {
      const total = Object.values(belief.probabilities).reduce((sum, value) => sum + value, 0);
      expect(total).toBeCloseTo(1, 6);
      expect(belief.playerId).toBe(playerId);
    }
  });

  it("pool vai chỉ gồm vai trong composition do caller cấp", () => {
    const beliefs = projectRoleBeliefs(input());
    for (const belief of Object.values(beliefs)) {
      for (const role of Object.keys(belief.probabilities)) {
        expect(Object.keys(DECK_8)).toContain(role);
      }
    }
  });

  it("self biết chắc vai mình: P(VILLAGER)=1, confidence=1", () => {
    const beliefs = projectRoleBeliefs(input());
    const self = beliefs["me"]!;
    expect(self.probabilities["VILLAGER"]).toBe(1);
    expect(self.confidence).toBe(1);
  });

  it("knownRoles đè mọi suy diễn (đồng bọn Sói thấy nhau)", () => {
    const beliefs = projectRoleBeliefs(input({ knownRoles: { me: "VILLAGER", b: "WEREWOLF" } }));
    expect(beliefs["b"]!.probabilities["WEREWOLF"]).toBe(1);
    expect(beliefs["b"]!.confidence).toBe(1);
  });

  it("người không có bằng chứng đứng ở prior của deck (2/8 Sói), không phải 0", () => {
    const beliefs = projectRoleBeliefs(input());
    expect(wolfProb(beliefs["d"]!)).toBeCloseTo(0.25, 6);
  });

  it("bằng chứng kéo P(Sói) lên theo scalar suspicion nhưng không qua 1", () => {
    const beliefs = projectRoleBeliefs(input());
    // b: suspicion 74, prior 0.25 → P = 0.25 + 0.74 × 0.75
    expect(wolfProb(beliefs["b"]!)).toBeCloseTo(0.25 + 0.74 * 0.75, 6);
    expect(wolfProb(beliefs["b"]!)).toBeGreaterThan(wolfProb(beliefs["c"]!));
    expect(wolfProb(beliefs["c"]!)).toBeGreaterThan(wolfProb(beliefs["d"]!));
  });

  it("người chết chưa lộ vai KHÔNG được coi là biết chắc (luật mặc định giấu vai)", () => {
    const beliefs = projectRoleBeliefs(input());
    const dead = beliefs["x"]!;
    expect(wolfProb(dead)).toBeGreaterThan(0);
    expect(wolfProb(dead)).toBeLessThan(1);
  });

  it("kết quả soi trúng Sói ghim cả khối lượng phe Sói, confidence=1", () => {
    const beliefs = projectRoleBeliefs({
      ...input(),
      knowledge: knowledge({
        seerResult: { targetId: "d", targetName: "D", isWolf: true, team: "wolves" },
      }),
    });
    const pinned = beliefs["d"]!;
    expect(wolfProb(pinned)).toBe(1);
    expect(pinned.confidence).toBe(1);
  });

  it("kết quả soi trúng sạch → P(Sói)=0, phần còn lại chuẩn hoá", () => {
    const beliefs = projectRoleBeliefs({
      ...input(),
      knowledge: knowledge({
        seerResult: { targetId: "d", targetName: "D", isWolf: false, team: "village" },
      }),
    });
    const pinned = beliefs["d"]!;
    expect(wolfProb(pinned)).toBe(0);
    const total = Object.values(pinned.probabilities).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it("claim chỉ phân bổ lại khối lượng không-Sói (không đếm đôi bằng chứng)", () => {
    // d chưa có bằng chứng; cho d claim SEER → khối lượng SEER của d phải tăng
    // so với bản không claim, còn P(Sói) đứng ở prior.
    const plain = projectRoleBeliefs(input());
    const claimed = projectRoleBeliefs(input({}, (bot) => {
      bot.state.claims.push({
        id: "m1",
        sourceId: "chat:1",
        round: 1,
        phase: "DAY_DISCUSSION",
        type: "ROLE_CLAIM",
        actorId: "d",
        importance: 10,
        pinned: true,
        data: { role: "SEER" },
      });
    }));
    expect(wolfProb(claimed["d"]!)).toBeCloseTo(wolfProb(plain["d"]!), 6);
    expect(claimed["d"]!.probabilities["SEER"]).toBeGreaterThan(
      plain["d"]!.probabilities["SEER"]!,
    );
    // Chuẩn hoá vẫn giữ.
    const total = Object.values(claimed["d"]!.probabilities).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it("thiếu composition (knowledge cũ) vẫn chạy: fallback pool có Sói + Dân + vai public", () => {
    const beliefs = projectRoleBeliefs({ ...input(), roleComposition: undefined });
    const total = Object.values(beliefs["b"]!.probabilities).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1, 6);
    expect(wolfProb(beliefs["b"]!)).toBeGreaterThan(0);
  });
});
