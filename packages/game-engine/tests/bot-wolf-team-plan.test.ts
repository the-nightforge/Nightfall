import { describe, expect, it } from "vitest";
import type { Role } from "@masoi/shared";
import { planWolfTeam } from "../src/bot/roles/wolf-team-plan";
import type { WolfTeamPlanInput } from "../src/bot/roles/wolf-team-plan";
import { BotRuntime } from "../src/bot/BotRuntime";
import { createSeededRng } from "../src/bot/rng";
import type { BotKnowledgeView, BotPersonality, NightKnowledge } from "../src/bot/types";
import { BOT_WEIGHTS_V21 } from "../src/bot/config/weights";

const EMPTY_NIGHT: NightKnowledge = {
  canAct: true,
  legalActions: ["KILL"],
  legalTargets: {
    KILL: [], GUARD: [], SEE: [], HEAL: [], POISON: [],
    DETECTIVE_CHECK: [], SORCERER_CHECK: [], SERIAL_KILL: [], TRACK: [],
    SKIP: [],
  },
  wolfTarget: null,
  guardPrevious: null,
  healUsed: false,
  poisonUsed: false,
  wolvesLocked: false,
  bonusSecondTargetFor: null,
};

/**
 * PR 5 của BOT_AI_CONTINUE_UPGRADE (§14-§17): Wolf Team Planner.
 *
 * Ràng buộc kiến trúc: các BotRuntime không có kênh truyền tin giữa bầy Sói.
 * Plan phải thuần và tất định từ dữ liệu mà MỌI con Sói cùng thấy (roster pack
 * qua knownRoles, wolfTarget engine cấp, phiếu công khai) — cùng mô hình mà
 * `fakeFightTarget`/`wolfBluffSeat` đã dùng để bầy tự đồng bộ không cần chat.
 *
 * §14: chỉ Sói được nhìn thấy plan — non-wolf gọi hàm nhận plan rỗng.
 * §15: không ép mọi con Sói hành động giống nhau — plan là KHUNG, phần cá thể
 * (jitter, personality) nằm ở strategy.
 */

const BALANCED: BotPersonality = {
  aggressiveness: 0.5,
  talkativeness: 0.9,
  riskTolerance: 0.5,
  deceptionSkill: 0.8,
  analyticalSkill: 1,
  loyalty: 0.5,
  stubbornness: 0.5,
};

function knowledge(
  selfRole: Role,
  overrides: Partial<BotKnowledgeView> = {},
): BotKnowledgeView {
  return {
    botId: "w1",
    round: 3,
    phase: "NIGHT",
    phaseStartedAt: 0,
    phaseEndsAt: 30_000,
    selfRole,
    players: [
      { id: "w1", name: "W1", alive: true },
      { id: "w2", name: "W2", alive: true },
      { id: "v1", name: "V1", alive: true },
      { id: "v2", name: "V2", alive: true },
      { id: "v3", name: "V3", alive: true },
      { id: "d1", name: "D1", alive: false },
    ],
    knownRoles: { w1: "WEREWOLF", w2: "WEREWOLF" },
    seerResult: null,
    sorcererResult: null,
    trackerResult: null,
    neutralRolesInPlay: [],
    night: {
      ...EMPTY_NIGHT,
      legalTargets: {
        ...EMPTY_NIGHT.legalTargets,
        KILL: ["v1", "v2", "v3"],
      },
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
    activeEventId: null,
    dayOfTruthClaims: {},
    ...overrides,
  };
}

function input(
  overrides: Partial<BotKnowledgeView> = {},
  mutate?: (bot: BotRuntime, ctx: BotKnowledgeView) => void,
): WolfTeamPlanInput {
  const ctx = knowledge("WEREWOLF", overrides);
  const bot = new BotRuntime({
    playerId: "w1",
    rng: createSeededRng("wolf-plan"),
    playerIds: ctx.players.map((player) => player.id),
    personality: BALANCED,
    weights: BOT_WEIGHTS_V21,
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
    summary: `Phá hoà.`,
  });
  bot.state.seenEventIds.push("1:nomination:v1", "1:nomination:v2");
  // v1: có bằng chứng nghi (nhưng với Sói thì nghi không phải đe doạ);
  // v2: được làng tin (nguy hiểm hơn).
  bot.state.suspicion["v1"] = { score: 80, reasons: [reason("v1", 10)], lastUpdatedRound: 1 };
  bot.state.suspicion["v2"] = { score: 5, reasons: [], lastUpdatedRound: 1 };
  bot.state.trust["v2"] = { score: 70, reasons: [], lastUpdatedRound: 1 };
  if (mutate) mutate(bot, ctx);
  return { knowledge: ctx, state: bot.state, weights: BOT_WEIGHTS_V21 };
}

describe("planWolfTeam (PR5 — Wolf Team Planner)", () => {
  it("primary = threat cao nhất (được làng tin); bị nghi nặng thì threat THẤP với Sói", () => {
    const plan = planWolfTeam(input());
    // v2: trust 70, suspicion 5 → threat 66.25. v1: suspicion 80 bị chiết khấu
    // → threat 12 (làng tự treo hộ). v3: trung tính 40.
    expect(plan.primaryKillTarget).toBe("v2");
    // Backup: v3 (40) vượt v1 (12) — "đang bị cả làng nghi" là lý do để KHÔNG
    // tiêu một đêm cắn vào người đó.
    expect(plan.backupKillTarget).toBe("v3");
  });

  it("mọi slot team chỉ chứa ĐỒNG BỌN; kill target không bao giờ là đồng bọn", () => {
    const plan = planWolfTeam(input());
    const pack = ["w1", "w2"];
    for (const member of [plan.discussionLeader, plan.claimant, plan.sacrificeCandidate]) {
      if (member !== null) expect(pack).toContain(member);
    }
    for (const target of [plan.primaryKillTarget, plan.backupKillTarget]) {
      if (target !== null) expect(pack).not.toContain(target);
    }
    for (const member of plan.distancingPlayers) expect(pack).toContain(member);
  });

  it("§14: non-wolf không nhìn thấy plan nào (plan rỗng, không slot nào có giá trị)", () => {
    const villagerCtx = knowledge("VILLAGER", {
      knownRoles: { me: "VILLAGER" },
      botId: "me",
      night: null,
    });
    const bot = new BotRuntime({
      playerId: "me",
      rng: createSeededRng("wolf-plan"),
      playerIds: villagerCtx.players.map((player) => player.id),
      personality: BALANCED,
      weights: BOT_WEIGHTS_V21,
    });
    const plan = planWolfTeam({ knowledge: villagerCtx, state: bot.state, weights: BOT_WEIGHTS_V21 });
    expect(plan.primaryKillTarget).toBeNull();
    expect(plan.backupKillTarget).toBeNull();
    expect(plan.discussionLeader).toBeNull();
    expect(plan.claimant).toBeNull();
    expect(plan.sacrificeCandidate).toBeNull();
    expect(plan.distancingPlayers).toEqual([]);
  });

  it("claimant khớp wolfBluffSeat (hash tất định): bầy tự đồng bộ", () => {
    const plan = planWolfTeam(input());
    // Wolf Cub rage + Alpha cùng dùng plan này; hai lần gọi hai input riêng
    // (góc nhìn w1 và w2) phải ra cùng claimant.
    const second = knowledge("WEREWOLF", { botId: "w2" });
    const bot2 = new BotRuntime({
      playerId: "w2",
      rng: createSeededRng("wolf-plan-2"),
      playerIds: second.players.map((player) => player.id),
      personality: BALANCED,
      weights: BOT_WEIGHTS_V21,
    });
    const plan2 = planWolfTeam({ knowledge: second, state: bot2.state, weights: BOT_WEIGHTS_V21 });
    expect(plan.claimant).toBe(plan2.claimant);
  });

  it("sacrificeCandidate = đồng bọn đang bị dồn phiếu; cùng distancingPlayers", () => {
    const plan = planWolfTeam(
      input({}, (_bot, ctx) => {
        ctx.currentVoteCounts = { players: { w2: 3 }, noElimination: 0 };
      }),
    );
    expect(plan.sacrificeCandidate).toBe("w2");
    // w1 không cần giữ khoảng cách với chính mình; distancing = đồng bọn còn
    // sống khác candidate.
    expect(plan.distancingPlayers).toEqual(["w1"]);
  });

  it("không ai bị dồn phiếu → sacrifice null, distancing rỗng (không cần diễn)", () => {
    const plan = planWolfTeam(input());
    expect(plan.sacrificeCandidate).toBeNull();
    expect(plan.distancingPlayers).toEqual([]);
  });

  it("discussionLeader = đồng bọn không bị làng công kích (incomingHostility thấp nhất)", () => {
    const plan = planWolfTeam(
      input({}, (bot) => {
        // Làng đang công kích w2 (ACCUSE w2 qua social edge).
        bot.state.seenEventIds.push("src-h1");
        bot.state.relationships["v1->w2"] = {
          support: 0,
          hostility: 0.8,
          voteAlignment: 0,
          samples: 2,
          reasons: [],
          lastUpdatedRound: 2,
        };
      }),
    );
    expect(plan.discussionLeader).toBe("w1");
  });

  it("tất định: cùng input → cùng plan (JSON-equal)", () => {
    const input_ = input();
    expect(JSON.stringify(planWolfTeam(input_))).toBe(JSON.stringify(planWolfTeam(input_)));
  });
});
