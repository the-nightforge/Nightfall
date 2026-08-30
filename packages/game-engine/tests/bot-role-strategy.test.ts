import { describe, expect, it } from "vitest";
import type { Role } from "@masoi/shared";
import { strategyFor } from "../src/bot/roles/registry";
import { createSeededRng } from "../src/bot/rng";
import { createBotPersonality } from "../src/bot/personality/personality";
import { createBotBrainState } from "../src/bot/memory/memory-store";
import type {
  BotBrainState,
  BotDecisionContext,
  BotKnowledgeView,
  NightKnowledge,
} from "../src/bot/types";

const ALL_ROLES: Role[] = [
  "WEREWOLF",
  "SEER",
  "GUARD",
  "WITCH",
  "HUNTER",
  "CURSED",
  "VILLAGER",
];

const PLAYERS = ["wolf", "ally", "seer", "guard", "witch", "villager"];

function stateFor(playerId: string, seed = "strategy"): BotBrainState {
  return createBotBrainState(
    playerId,
    createBotPersonality(createSeededRng(seed)),
    PLAYERS,
  );
}

function night(over: Partial<NightKnowledge> = {}): NightKnowledge {
  return {
    bonusSecondTargetFor: null,
    canAct: true,
    legalActions: ["KILL"],
    legalTargets: {
      KILL: ["seer", "guard", "witch", "villager"],
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

function context(over: Partial<BotKnowledgeView> = {}): BotDecisionContext {
  return {
    knowledge: {
      dayOfTruthClaims: {},
      activeEventId: null,
      botId: "wolf",
      round: 2,
      phase: "NIGHT",
      phaseStartedAt: 0,
      phaseEndsAt: 30_000,
      selfRole: "WEREWOLF",
      players: PLAYERS.map((id) => ({ id, name: id.toUpperCase(), alive: true })),
      knownRoles: { wolf: "WEREWOLF", ally: "WEREWOLF" },
      seerResult: null,
      night: night(),
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

describe("strategyFor", () => {
  it("trả về strategy cho MỌI vai, không bao giờ undefined", () => {
    // Không có nhánh undefined nghĩa là chỗ gọi không phải xử lý một trạng thái
    // không tồn tại, và thêm một vai mới sẽ mặc định an toàn thay vì nổ.
    for (const role of ALL_ROLES) {
      const strategy = strategyFor(role);
      expect(strategy).toBeDefined();
      expect(strategy.role).toBe(role);
    }
  });

  it("vai không có hành động đêm thì luôn bỏ lượt", () => {
    for (const role of ["VILLAGER", "HUNTER", "CURSED"] as Role[]) {
      const decision = strategyFor(role).decideNight(
        context({ selfRole: role, night: null }),
        stateFor("villager"),
        createSeededRng("x"),
      );
      expect(decision).toBeNull();
    }
  });

  it("mọi vai trả null khi không có thông tin đêm", () => {
    for (const role of ALL_ROLES) {
      expect(
        strategyFor(role).decideNight(
          context({ selfRole: role, night: null }),
          stateFor("wolf"),
          createSeededRng("x"),
        ),
      ).toBeNull();
    }
  });
});

describe("chiến lược Sói", () => {
  const wolf = () => strategyFor("WEREWOLF");

  it("không bao giờ chọn đồng bọn làm mục tiêu cắn", () => {
    // Engine sẽ ném nếu Sói cắn Sói, nên đây vừa là chiến thuật vừa là điều kiện
    // để lượt đêm không bị mất trắng.
    const decision = wolf().decideNight(
      context({
        night: night({
          legalTargets: {
            ...night().legalTargets,
            // Cố tình nhét đồng bọn vào danh sách để chắc chắn strategy tự lọc,
            // chứ không chỉ dựa vào engine đã lọc sẵn.
            KILL: ["ally", "seer", "villager"],
          },
        }),
      }),
      stateFor("wolf"),
      createSeededRng("kill"),
    );

    expect(decision).not.toBeNull();
    expect(decision!.targetId).not.toBe("ally");
  });

  it("ưu tiên người đã tự nhận vai quyền lực", () => {
    const state = stateFor("wolf");
    state.seenEventIds.push("m1");
    state.claims.push({
      id: "ROLE_CLAIM:m1:",
      sourceId: "m1",
      round: 1,
      phase: "DAY_DISCUSSION",
      type: "ROLE_CLAIM",
      actorId: "seer",
      importance: 8,
      pinned: true,
      data: { role: "SEER" },
    });

    const decision = wolf().decideNight(
      context(),
      state,
      createSeededRng("claim"),
    );

    expect(decision!.targetId).toBe("seer");
  });

  it("chọn hành động KILL và mục tiêu nằm trong legalTargets", () => {
    const decision = wolf().decideNight(context(), stateFor("wolf"), createSeededRng("k"));

    expect(decision!.action).toBe("KILL");
    expect(night().legalTargets.KILL).toContain(decision!.targetId!);
  });

  it("không có mục tiêu hợp lệ thì bỏ lượt thay vì ném", () => {
    const decision = wolf().decideNight(
      context({ night: night({ legalTargets: { ...night().legalTargets, KILL: [] } }) }),
      stateFor("wolf"),
      createSeededRng("empty"),
    );

    expect(decision).toBeNull();
  });

  it("cùng seed cho cùng mục tiêu", () => {
    const run = () =>
      wolf().decideNight(context(), stateFor("wolf"), createSeededRng("same"))!.targetId;

    expect(run()).toBe(run());
  });

  it("bằng chứng đi kèm quyết định đều có source thật", () => {
    const decision = wolf().decideNight(context(), stateFor("wolf"), createSeededRng("ev"));

    for (const item of decision!.evidence) {
      expect(item.sourceId.length).toBeGreaterThan(0);
    }
  });
});

describe("voteBias", () => {
  it("Sói đẩy phiếu ra khỏi đồng bọn", () => {
    const bias = strategyFor("WEREWOLF").voteBias(context(), stateFor("wolf"));

    expect(bias.ally ?? 0).toBeLessThan(0);
  });

  it("vai phe làng không thiên vị ai", () => {
    expect(
      strategyFor("VILLAGER").voteBias(
        context({ selfRole: "VILLAGER", knownRoles: { villager: "VILLAGER" } }),
        stateFor("villager"),
      ),
    ).toEqual({});
  });
});
