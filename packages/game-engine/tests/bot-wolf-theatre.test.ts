import { describe, expect, it } from "vitest";
import type { PublicVoteChoice } from "@masoi/shared";
import { BOT_WEIGHTS_V15, BOT_WEIGHTS_V16, type BotWeights } from "../src/bot/config/weights";
import { BOT_WEIGHTS_PRESETS } from "../src/bot/config/presets";
import { selectVote } from "../src/bot/decision/vote-decision";
import { runSelfPlay, type SelfPlayGame } from "../src/bot/evaluation/selfplay";
import { createBotBrainState } from "../src/bot/memory/memory-store";
import { createBotPersonality } from "../src/bot/personality/personality";
import { fakeFightTarget } from "../src/bot/roles/werewolf";
import { createSeededRng } from "../src/bot/rng";
import type {
  BotBrainState,
  BotDecisionContext,
  BotEvidence,
  BotKnowledgeView,
  BotPersonality,
} from "../src/bot/types";

/**
 * Sói DIỄN (P2.3): cãi nhau giả ở vòng 1-2, và bán đồng đội sớm hơn khi bàn
 * có người thật.
 *
 * Từ blind test: hai con Sói bot không bao giờ đụng nhau, và người chơi đọc
 * được điều đó sau hai ván - "hai đứa này chưa từng nghi nhau" là một tín hiệu
 * mà bot không hề định phát ra.
 */

const PLAYERS = ["me", "ally", "a", "b", "c", "d"];

function personality(over: Partial<BotPersonality> = {}): BotPersonality {
  return { ...createBotPersonality(createSeededRng("p")), ...over };
}

function stateFor(over: Partial<BotPersonality> = {}): BotBrainState {
  const state = createBotBrainState("me", personality(over), PLAYERS);
  // Hình dạng thật sau `applyPrivateInformation`: suspicion đồng đội bị ghim 0
  // (không lý do), trust ghim 100 với một lý do `KNOWN_ALLY`.
  const known: BotEvidence = {
    id: "e:ally:KNOWN_ALLY",
    kind: "KNOWN_ALLY",
    sourceId: "src",
    actorId: "ally",
    weight: 10,
    confidence: 0.9,
    round: 1,
    summary: "",
  };
  state.seenEventIds.push("src");
  state.suspicion.ally = { score: 0, reasons: [], lastUpdatedRound: 1 };
  state.trust.ally = { score: 100, reasons: [known], lastUpdatedRound: 1 };
  return state;
}

function players(humans: readonly string[] = []): BotKnowledgeView["players"] {
  return PLAYERS.map((id) => ({
    id,
    name: id.toUpperCase(),
    alive: true,
    isBot: !humans.includes(id),
  }));
}

function context(over: Partial<BotKnowledgeView> = {}): BotDecisionContext {
  return {
    knowledge: {
      dayOfTruthClaims: {},
      neutralRolesInPlay: [],
      activeEventId: null,
      botId: "me",
      round: 1,
      phase: "VOTING",
      phaseStartedAt: 0,
      phaseEndsAt: 30_000,
      selfRole: "WEREWOLF",
      players: players(),
      knownRoles: { me: "WEREWOLF", ally: "WEREWOLF" },
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
      legalVoteChoices: PLAYERS.filter((id) => id !== "me").map(
        (targetId): PublicVoteChoice => ({ type: "PLAYER", targetId }),
      ),
      lastNightDeaths: [],
      ...over,
    },
    visibleChat: [],
  };
}

function chosen(vote: { choice: PublicVoteChoice }): string | null {
  return vote.choice.type === "PLAYER" ? vote.choice.targetId : null;
}

/** Nhiều tính cách khác nhau: cuộc cãi giả là canh bạc, không phải luật. */
const SKILLS = [0.3, 0.42, 0.55, 0.61, 0.7, 0.78, 0.85, 0.9];

describe("preset v16", () => {
  it("v16 khác v15 ĐÚNG ở deceptionRisk và version", () => {
    for (const key of Object.keys(BOT_WEIGHTS_V15) as Array<keyof BotWeights>) {
      if (key === "version" || key === "deceptionRisk") continue;
      expect(BOT_WEIGHTS_V16[key]).toBe(BOT_WEIGHTS_V15[key]);
    }
    expect(BOT_WEIGHTS_V16.deceptionRisk).toEqual({
      ...BOT_WEIGHTS_V15.deceptionRisk,
      fakeFightChance: 0.3,
      bussingVoteShareHuman: 0.15,
    });
  });

  it("v1..v15 tắt cãi giả và bán mềm bằng bàn bot", () => {
    for (const preset of Object.values(BOT_WEIGHTS_PRESETS)) {
      if (Number(preset.version.split(".")[0]) >= 16) continue;
      expect(preset.deceptionRisk.fakeFightChance).toBe(0);
      expect(preset.deceptionRisk.bussingVoteShareHuman).toBe(preset.deceptionRisk.bussingVoteShare);
    }
  });
});

describe("P2.3 cãi nhau giả", () => {
  it("v16: có tính cách dám cãi, có tính cách không", () => {
    const outcomes = SKILLS.map((deceptionSkill) =>
      fakeFightTarget(context(), stateFor({ deceptionSkill }), BOT_WEIGHTS_V16),
    );
    expect(outcomes).toContain("ally");
    expect(outcomes).toContain(null);
  });

  it("không rút thêm một số ngẫu nhiên nào so với v15, dù có cãi hay không", () => {
    // `fakeFightTarget` không nhận rng; cổng chốt bằng hash. Đếm ở `selectVote`
    // để chắc số hạng mới cũng không kéo thêm lượt rút nào.
    for (const deceptionSkill of SKILLS) {
      const count = (weights: BotWeights): number => {
        let draws = 0;
        const inner = createSeededRng("count");
        selectVote(context(), stateFor({ deceptionSkill }), () => {
          draws += 1;
          return inner();
        }, weights);
        return draws;
      };
      expect(count(BOT_WEIGHTS_V16)).toBe(count(BOT_WEIGHTS_V15));
    }
  });

  it("v15 không bao giờ cãi giả", () => {
    for (const deceptionSkill of SKILLS) {
      expect(fakeFightTarget(context(), stateFor({ deceptionSkill }), BOT_WEIGHTS_V15)).toBeNull();
    }
  });

  it("chỉ ở vòng 1-2; vòng 3 trở đi thì thôi", () => {
    const fighter = SKILLS.find(
      (deceptionSkill) =>
        fakeFightTarget(context(), stateFor({ deceptionSkill }), BOT_WEIGHTS_V16) === "ally",
    )!;
    expect(fighter).toBeDefined();
    const state = stateFor({ deceptionSkill: fighter });
    expect(fakeFightTarget(context({ round: 3 }), state, BOT_WEIGHTS_V16)).toBeNull();
    expect(fakeFightTarget(context({ round: 0 }), state, BOT_WEIGHTS_V16)).toBeNull();
  });

  it("không cãi khi đã có người dồn vào một trong hai Sói", () => {
    const fighter = SKILLS.find(
      (deceptionSkill) =>
        fakeFightTarget(context(), stateFor({ deceptionSkill }), BOT_WEIGHTS_V16) === "ally",
    )!;
    const state = stateFor({ deceptionSkill: fighter });
    const pressured = context({ currentVoteCounts: { players: { ally: 1 }, noElimination: 0 } });
    expect(fakeFightTarget(pressured, state, BOT_WEIGHTS_V16)).toBeNull();
    const onMe = context({ currentVoteCounts: { players: { me: 1 }, noElimination: 0 } });
    expect(fakeFightTarget(onMe, state, BOT_WEIGHTS_V16)).toBeNull();
  });

  it("không cãi khi đồng đội đã chết hay bầy chỉ còn một", () => {
    const fighter = SKILLS.find(
      (deceptionSkill) =>
        fakeFightTarget(context(), stateFor({ deceptionSkill }), BOT_WEIGHTS_V16) === "ally",
    )!;
    const state = stateFor({ deceptionSkill: fighter });
    const allyDead = context({
      players: players().map((p) => (p.id === "ally" ? { ...p, alive: false } : p)),
    });
    expect(fakeFightTarget(allyDead, state, BOT_WEIGHTS_V16)).toBeNull();
  });

  it("trong một bầy hai con, mỗi vòng chỉ một con mở miệng", () => {
    // Cả hai cùng cáo buộc nhau là một vở kịch quá lộ. Ghế do hash chốt, nên
    // con còn lại thấy `null` từ chính dữ liệu cả bầy cùng thấy.
    const fighter = SKILLS.find(
      (deceptionSkill) =>
        fakeFightTarget(context(), stateFor({ deceptionSkill }), BOT_WEIGHTS_V16) === "ally",
    )!;
    const allyState = createBotBrainState("ally", personality({ deceptionSkill: fighter }), PLAYERS);
    const asAlly = context({ botId: "ally" });
    expect(fakeFightTarget(asAlly, allyState, BOT_WEIGHTS_V16)).toBeNull();
  });

  it("lá phiếu đi theo cuộc cãi: Sói bầu đồng đội với bằng chứng rỗng thay vì bỏ trắng", () => {
    const fighter = SKILLS.find(
      (deceptionSkill) =>
        fakeFightTarget(context(), stateFor({ deceptionSkill }), BOT_WEIGHTS_V16) === "ally",
    )!;
    const state = stateFor({ deceptionSkill: fighter });
    const vote = selectVote(context(), state, createSeededRng("fight"), BOT_WEIGHTS_V16);
    expect(chosen(vote)).toBe("ally");
    expect(vote.evidence).toEqual([]);

    // Cùng tính cách, v15: bảo vệ đồng đội như cũ.
    const old = selectVote(context(), stateFor({ deceptionSkill: fighter }), createSeededRng("fight"), BOT_WEIGHTS_V15);
    expect(chosen(old)).not.toBe("ally");
  });
});

describe("P2.3 bán đồng đội mềm hơn khi bàn có người", () => {
  const wolfSees = (votesOnAlly: number, humans: readonly string[]) =>
    context({
      players: players(humans),
      currentVoteCounts: { players: { ally: votesOnAlly }, noElimination: 0 },
    });
  const FOUR_HUMANS = ["a", "b", "c", "d"];

  /** Đồng đội đã bị một người tố công khai: có lý do để mang theo lá phiếu. */
  const accused: BotEvidence = {
    id: "e:ally:ACCUSE",
    kind: "ACCUSE",
    sourceId: "src",
    actorId: "ally",
    weight: 4,
    confidence: 0.45,
    round: 1,
    summary: "bị a tố",
  };

  it("1/6 phiếu: bàn bot chưa bán (0.2), bàn người thì bán (0.15)", () => {
    // 1/6 = 0.167 nằm giữa hai ngưỡng. Sói khéo (deceptionSkill 0.9 x 3 >= 1).
    // Đồng đội có nghi 8 với lý do công khai: bán thì có gì để nói; bàn bot thì
    // -100 roleBias và phạt bảo vệ vẫn nuốt chửng nó.
    const skilled = () => {
      const state = stateFor({ deceptionSkill: 0.9 });
      state.suspicion.ally = { score: 8, reasons: [accused], lastUpdatedRound: 1 };
      return state;
    };
    const bots = selectVote(wolfSees(1, []), skilled(), createSeededRng("bus"), BOT_WEIGHTS_V16);
    expect(chosen(bots)).not.toBe("ally");
    const humans = selectVote(wolfSees(1, FOUR_HUMANS), skilled(), createSeededRng("bus"), BOT_WEIGHTS_V16);
    expect(chosen(humans)).toBe("ally");
  });

  it("v15 không phân biệt bàn: 1/6 phiếu thì vẫn bảo vệ", () => {
    const state = stateFor({ deceptionSkill: 0.9 });
    state.suspicion.ally = { score: 8, reasons: [accused], lastUpdatedRound: 1 };
    const humans = selectVote(wolfSees(1, FOUR_HUMANS), state, createSeededRng("bus"), BOT_WEIGHTS_V15);
    expect(chosen(humans)).not.toBe("ally");
  });
});

describe("P2.3 self-play", () => {
  const SEEDS = Array.from({ length: 24 }, (_, i) => `theatre-${i}`);

  /**
   * Một lá phiếu Sói -> Sói mà TRƯỚC nó trong cùng vòng chưa ai bầu con Sói
   * đó. Bussing không bao giờ tạo ra hình dạng này (nó cần `voteShare >= 0.15`
   * tức đã có phiếu), nên đây là dấu vân tay riêng của cuộc cãi giả.
   */
  function fakeFights(game: SelfPlayGame): Array<{ round: number; voterId: string }> {
    const wolves = new Set(
      Object.entries(game.roles)
        .filter(([, role]) => role === "WEREWOLF" || role === "WOLF_CUB")
        .map(([id]) => id),
    );
    const found: Array<{ round: number; voterId: string }> = [];
    const votedThisRound = new Map<string, Set<string>>();
    for (const event of game.events) {
      if (event.kind === "PHASE") {
        votedThisRound.clear();
        continue;
      }
      if (event.kind !== "VOTE" || event.targetId === null) continue;
      const seen = votedThisRound.get(event.targetId) ?? new Set<string>();
      if (
        wolves.has(event.voterId) &&
        wolves.has(event.targetId) &&
        [...seen].every((id) => id === event.voterId)
      ) {
        found.push({ round: event.round, voterId: event.voterId });
      }
      seen.add(event.voterId);
      votedThisRound.set(event.targetId, seen);
    }
    return found;
  }

  it(
    "v16 có ván Sói cãi Sói ở vòng 1-2 và không kéo dài sang vòng 3; v15 không có ván nào",
    () => {
      const v16 = SEEDS.map((seed) => runSelfPlay({ seed, playerCount: 10, weights: BOT_WEIGHTS_V16 }));
      const v15 = SEEDS.map((seed) => runSelfPlay({ seed, playerCount: 10, weights: BOT_WEIGHTS_V15 }));

      const fights16 = v16.flatMap(fakeFights);
      const fights15 = v15.flatMap(fakeFights);

      expect(fights15).toEqual([]);
      expect(fights16.length).toBeGreaterThan(0);
      expect(fights16.every((f) => f.round >= 1 && f.round <= BOT_WEIGHTS_V16.deceptionRisk.fakeFightUntilRound)).toBe(true);

      for (const game of [...v16, ...v15]) expect(game.violations).toEqual([]);
    },
    120_000,
  );
});
