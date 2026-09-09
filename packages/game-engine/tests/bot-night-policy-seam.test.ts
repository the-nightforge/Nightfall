import { describe, expect, it } from "vitest";
import type { Role } from "@masoi/shared";
import { rankNightTargets } from "../src/bot/roles/night-scoring";
import { strategyFor } from "../src/bot/roles/registry";
import type { NightPolicyModel } from "../src/bot/policy/policy-model";
import { createSeededRng } from "../src/bot/rng";
import { createBotPersonality } from "../src/bot/personality/personality";
import { createBotBrainState } from "../src/bot/memory/memory-store";
import type {
  BotBrainState,
  BotDecisionContext,
  BotKnowledgeView,
  NightActionKind,
  NightKnowledge,
} from "../src/bot/types";

const PLAYERS = ["me", "a", "b", "c", "d"];

function stateFor(seed = "seam"): BotBrainState {
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
    SERIAL_KILL: [],
    SORCERER_CHECK: [],
    TRACK: [],
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
      sorcererResult: null,
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

/** Policy giả: luôn chọn ứng viên CUỐI bảng, ghi lại mọi lời gọi. */
function pickLast(): NightPolicyModel & {
  calls: Array<{ action: NightActionKind; ids: string[] }>;
} {
  const calls: Array<{ action: NightActionKind; ids: string[] }> = [];
  return {
    name: "pick-last",
    calls,
    selectTarget(action, candidates) {
      calls.push({ action, ids: candidates.map((c) => c.targetId) });
      return candidates[candidates.length - 1]!.targetId;
    },
  };
}

describe("rankNightTargets + NightPolicyModel", () => {
  const termsFor = (id: string) => [{ name: "t", value: { a: 3, b: 2, c: 1 }[id]! }];

  it("không policy: thứ tự điểm giảm dần như cũ", () => {
    const ranked = rankNightTargets(["c", "a", "b"], { termsFor });
    expect(ranked.map((r) => r.targetId)).toEqual(["a", "b", "c"]);
  });

  it("policy chọn một id không đứng đầu → id đó lên đầu, phần còn lại giữ thứ tự", () => {
    const policy = pickLast();
    const ranked = rankNightTargets(["c", "a", "b"], { termsFor, action: "SEE", policy });
    expect(ranked.map((r) => r.targetId)).toEqual(["c", "a", "b"]);
    expect(policy.calls).toEqual([{ action: "SEE", ids: ["a", "b", "c"] }]);
  });

  it("policy trả null hoặc id ngoài bảng → giữ nguyên; thiếu `action` → không hỏi policy", () => {
    const nul: NightPolicyModel = { name: "null", selectTarget: () => null };
    expect(
      rankNightTargets(["a", "b"], { termsFor, action: "SEE", policy: nul }).map((r) => r.targetId),
    ).toEqual(["a", "b"]);
    const stray: NightPolicyModel = { name: "stray", selectTarget: () => "zzz" };
    expect(
      rankNightTargets(["a", "b"], { termsFor, action: "SEE", policy: stray }).map(
        (r) => r.targetId,
      ),
    ).toEqual(["a", "b"]);
    const spy = pickLast();
    rankNightTargets(["a", "b"], { termsFor, policy: spy });
    expect(spy.calls).toEqual([]);
  });
});

describe("7 vai truyền policy vào bảng của đúng loại hành động", () => {
  const three = (kind: NightActionKind): Partial<NightKnowledge> => ({
    legalActions: [kind],
    legalTargets: { ...emptyTargets(), [kind]: ["a", "b", "c"] },
  });
  const cases: Array<{
    role: Role;
    action: NightActionKind;
    over?: Partial<BotKnowledgeView>;
  }> = [
    { role: "SEER", action: "SEE" },
    { role: "GUARD", action: "GUARD" },
    { role: "WEREWOLF", action: "KILL", over: { knownRoles: { me: "WEREWOLF" } } },
    { role: "SORCERER", action: "SORCERER_CHECK" },
    { role: "SERIAL_KILLER", action: "SERIAL_KILL" },
    { role: "TRACKER", action: "TRACK" },
    { role: "DETECTIVE", action: "DETECTIVE_CHECK" },
  ];

  for (const c of cases) {
    it(`${c.role}: policy chọn cuối bảng thì intention đi đúng người đó`, () => {
      const policy = pickLast();
      const ctx = context(three(c.action), { selfRole: c.role, ...c.over });
      const heuristic = strategyFor(c.role).decideNight(
        ctx,
        stateFor(),
        createSeededRng("h"),
        undefined,
      );
      const steered = strategyFor(c.role).decideNight(
        ctx,
        stateFor(),
        createSeededRng("h"),
        undefined,
        policy,
      );
      expect(policy.calls).toHaveLength(1);
      expect(policy.calls[0]!.action).toBe(c.action);
      expect(policy.calls[0]!.ids).toHaveLength(3);
      const first = policy.calls[0]!.ids[0]!;
      const last = policy.calls[0]!.ids[2]!;
      expect(steered?.action).toBe(c.action);
      expect(steered?.targetId).toBe(last);
      // Người thắng heuristic là ĐẦU bảng — cùng RNG nên cùng jitter, cùng bảng.
      expect(heuristic?.targetId).toBe(first);
      if (c.role === "DETECTIVE") expect(steered?.secondaryTargetId).toBe(first);
    });
  }

  it("Phù Thuỷ không có bảng → không hỏi policy", () => {
    const policy = pickLast();
    const ctx = context(
      {
        legalActions: ["POISON", "SKIP"],
        legalTargets: { ...emptyTargets(), POISON: ["a", "b"], SKIP: [] },
      },
      { selfRole: "WITCH" },
    );
    strategyFor("WITCH").decideNight(ctx, stateFor(), createSeededRng("w"), undefined, policy);
    expect(policy.calls).toEqual([]);
  });
});
