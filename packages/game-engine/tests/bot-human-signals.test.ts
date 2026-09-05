import { describe, expect, it } from "vitest";
import type { DayVoteRecap, PublicVoteChoice } from "@masoi/shared";
import { BotRuntime } from "../src/bot/BotRuntime";
import { BOT_WEIGHTS_V10, BOT_WEIGHTS_V11, BOT_WEIGHTS_V12 } from "../src/bot/config/weights";
import type {
  BotChatObservation,
  BotDecisionContext,
  BotKnowledgeView,
  BotPersonality,
} from "../src/bot/types";

/**
 * Hai tín hiệu P0.2 đi qua `BotRuntime.observe` - đúng đường `applyEvidence`
 * mà mọi bằng chứng công khai khác đi, không có đường riêng.
 */

const SHARP: BotPersonality = {
  aggressiveness: 0.5,
  talkativeness: 0.5,
  riskTolerance: 0.5,
  deceptionSkill: 0.5,
  analyticalSkill: 1,
  loyalty: 0.5,
  stubbornness: 0.5,
};

const PLAYERS = ["me", "a", "b", "c", "d"];

function player(targetId: string): PublicVoteChoice {
  return { type: "PLAYER", targetId };
}

function recap(
  round: number,
  ballots: Record<string, string | null>,
  accusedId: string | null = null,
): DayVoteRecap {
  const list = Object.entries(ballots).map(([voterId, to], index) => ({
    id: `${round}:nomination:${index + 1}`,
    round,
    voterId,
    previousChoice: null,
    choice: (to === null ? { type: "NO_ELIMINATION" } : player(to)) as PublicVoteChoice,
    castAt: 1_000 * (index + 1),
    phaseStartedAt: 0,
    phaseEndsAt: 30_000,
    sequence: index + 1,
  }));
  return {
    round,
    mutations: list,
    finalBallots: list.map((m) => ({ voterId: m.voterId, choice: m.choice })),
    nomination: accusedId ? { kind: "TRIAL", accusedId } : { kind: "NONE", reason: "tie" },
    finalJudgment: null,
  };
}

function context(over: Partial<BotKnowledgeView> = {}, chat: BotChatObservation[] = []): BotDecisionContext {
  return {
    knowledge: {
      botId: "me",
      round: 3,
      phase: "VOTING",
      phaseStartedAt: 0,
      phaseEndsAt: 30_000,
      selfRole: "VILLAGER",
      players: PLAYERS.map((id) => ({ id, name: id.toUpperCase(), alive: true })),
      knownRoles: { me: "VILLAGER" },
      seerResult: null,
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
      ...over,
    },
    visibleChat: chat,
  };
}

function runtime(weights = BOT_WEIGHTS_V11): BotRuntime {
  return new BotRuntime({
    playerId: "me",
    rng: () => 0,
    playerIds: PLAYERS,
    personality: SHARP,
    weights,
  });
}

/** d bỏ phiếu trắng ba vòng liền và không ai đụng tới d. */
function avoidantHistory(): DayVoteRecap[] {
  return [
    recap(1, { me: "c", a: "c", b: "a", c: "a", d: null }, "c"),
    recap(2, { me: "c", a: "c", b: "a", c: "a", d: null }),
    recap(3, { me: "c", a: "c", b: "a", c: "b", d: null }, "c"),
  ];
}

describe("AVOIDANCE qua BotRuntime", () => {
  it("nghi người né tránh sau ba vòng, và chỉ cộng một lần dù observe nhiều lần", () => {
    const bot = runtime();
    const ctx = context({ publicVoteHistory: avoidantHistory() });

    bot.observe(ctx);
    const once = bot.state.suspicion.d!.score;
    expect(once).toBeGreaterThan(0);
    expect(bot.state.suspicion.d!.reasons.map((r) => r.kind)).toContain("AVOIDANCE");

    bot.observe(ctx);
    bot.observe(ctx);
    expect(bot.state.suspicion.d!.score).toBe(once);
  });

  it("ghi một memory AVOIDANCE có nguồn là recap thật", () => {
    const bot = runtime();
    bot.observe(context({ publicVoteHistory: avoidantHistory() }));

    const memories = bot.state.memories.filter((m) => m.type === "AVOIDANCE");
    expect(memories.length).toBeGreaterThan(0);
    for (const memory of memories) {
      expect(memory.actorId).toBe("d");
      expect(bot.state.seenEventIds).toContain(memory.sourceId);
    }
  });

  it("không nghi ai khi mới có hai vòng", () => {
    const bot = runtime();
    bot.observe(context({ round: 2, publicVoteHistory: avoidantHistory().slice(0, 2) }));
    expect(bot.state.suspicion.d!.score).toBe(0);
  });

  it("v10 không có tín hiệu này", () => {
    const bot = runtime(BOT_WEIGHTS_V10);
    bot.observe(context({ publicVoteHistory: avoidantHistory() }));
    expect(bot.state.suspicion.d!.reasons.map((r) => r.kind)).not.toContain("AVOIDANCE");
  });
});

describe("DEFENSE_QUALITY qua BotRuntime", () => {
  const trialRound: DayVoteRecap[] = [recap(2, { me: "c", a: "c", b: "c", c: "a", d: "c" }, "c")];
  const defenseWindow = { startedAt: 40_000, endedAt: 70_000 };

  function duringDefense(chat: BotChatObservation[] = []): BotDecisionContext {
    return context(
      {
        round: 2,
        phase: "DEFENSE",
        trialAccusedId: "c",
        trialDefense: { startedAt: defenseWindow.startedAt, endedAt: null },
        publicVoteHistory: trialRound,
      },
      chat,
    );
  }

  function atFinalVote(chat: BotChatObservation[] = []): BotDecisionContext {
    return context(
      {
        round: 2,
        phase: "FINAL_VOTE",
        trialAccusedId: "c",
        trialDefense: defenseWindow,
        publicVoteHistory: trialRound,
        canFinalVote: true,
      },
      chat,
    );
  }

  it("bị cáo im lặng suốt lượt bào chữa thì bị nghi thêm, đúng một lần", () => {
    const bot = runtime();
    bot.observe(duringDefense());
    const beforeVerdict = bot.state.suspicion.c!.score;
    // Lượt bào chữa chưa khép: chưa được phán xét gì.
    expect(bot.state.suspicion.c!.reasons.map((r) => r.kind)).not.toContain("DEFENSE_QUALITY");

    bot.observe(atFinalVote());
    const after = bot.state.suspicion.c!.score;
    expect(after).toBeGreaterThan(beforeVerdict);
    const reason = bot.state.suspicion.c!.reasons.find((r) => r.kind === "DEFENSE_QUALITY");
    expect(reason?.id).toBe("2:nomination:result:DEFENSE_QUALITY:silent");

    bot.observe(atFinalVote());
    expect(bot.state.suspicion.c!.score).toBe(after);
  });

  it("chỉ tính lời nói trong CỬA SỔ bào chữa, không tính câu nói trước đó", () => {
    const early: BotChatObservation = { id: "m0", actorId: "c", text: "Tôi nghi A", at: 10_000 };
    const bot = runtime();
    bot.observe(atFinalVote([early]));
    const reason = bot.state.suspicion.c!.reasons.find((r) => r.kind === "DEFENSE_QUALITY");
    expect(reason?.id).toBe("2:nomination:result:DEFENSE_QUALITY:silent");
  });

  it("bị cáo chỉ lái sang người khác thì bị nghi, và nhắm đúng người bị lái sang", () => {
    const deflect: BotChatObservation = { id: "m1", actorId: "c", text: "Tôi nghi A", at: 50_000 };
    const bot = runtime();
    bot.observe(atFinalVote([deflect]));
    const reason = bot.state.suspicion.c!.reasons.find((r) => r.kind === "DEFENSE_QUALITY");
    expect(reason?.id).toBe("2:nomination:result:DEFENSE_QUALITY:deflect:a");
    expect(reason?.targetId).toBe("a");
  });

  it("bị cáo nhận vơ vai chức năng lần đầu lúc bị xử", () => {
    const grab: BotChatObservation = { id: "m1", actorId: "c", text: "Tôi là tiên tri", at: 50_000 };
    const bot = runtime();
    bot.observe(atFinalVote([grab]));
    const reason = bot.state.suspicion.c!.reasons.find((r) => r.kind === "DEFENSE_QUALITY");
    expect(reason?.id).toBe("2:nomination:result:DEFENSE_QUALITY:grab");
  });

  it("đã khai vai từ trước phiên toà thì nhắc lại không phải nhận vơ", () => {
    const earlier: BotChatObservation = { id: "m0", actorId: "c", text: "Tôi là tiên tri", at: 5_000 };
    const again: BotChatObservation = { id: "m1", actorId: "c", text: "Tôi là tiên tri mà", at: 50_000 };
    const bot = runtime();
    bot.observe(context({ round: 1, phase: "DAY_DISCUSSION" }, [earlier]));
    bot.observe(atFinalVote([earlier, again]));
    expect(bot.state.suspicion.c!.reasons.map((r) => r.kind)).not.toContain("DEFENSE_QUALITY");
  });

  it("bị cáo nói nhưng parser không hiểu thì không phán xét gì", () => {
    const vague: BotChatObservation = { id: "m1", actorId: "c", text: "mọi người tin tôi đi mà", at: 50_000 };
    const bot = runtime();
    bot.observe(atFinalVote([vague]));
    expect(bot.state.suspicion.c!.reasons.map((r) => r.kind)).not.toContain("DEFENSE_QUALITY");
  });

  it("không có cửa sổ bào chữa (harness tự chơi) thì không phán xét", () => {
    const bot = runtime();
    bot.observe(
      context({
        round: 2,
        phase: "FINAL_VOTE",
        trialAccusedId: "c",
        publicVoteHistory: trialRound,
        canFinalVote: true,
      }),
    );
    expect(bot.state.suspicion.c!.reasons.map((r) => r.kind)).not.toContain("DEFENSE_QUALITY");
  });

  it("bot là bị cáo thì không tự nghi mình", () => {
    const bot = new BotRuntime({
      playerId: "c",
      rng: () => 0,
      playerIds: PLAYERS,
      personality: SHARP,
      weights: BOT_WEIGHTS_V11,
    });
    const ctx = atFinalVote();
    ctx.knowledge.botId = "c";
    bot.observe(ctx);
    expect(bot.state.suspicion.c).toBeUndefined();
  });
});

describe("hồ sơ người chơi qua BotRuntime (P1.1)", () => {
  function claimContext(round: number, over: Partial<BotKnowledgeView> = {}): BotDecisionContext {
    return context(
      { round, phase: "DAY_DISCUSSION", ...over },
      [{ id: `claim-${round}`, actorId: "c", text: "Tôi là tiên tri", at: round * 1_000 }],
    );
  }

  it("lời khai bị lộ vai là sai -> bluffRate tăng, đúng một lần dù observe nhiều lần", () => {
    const bot = runtime(BOT_WEIGHTS_V12);
    bot.observe(claimContext(1));
    expect(bot.state.profiles.c!.samples).toBe(0);

    // c chết, luật lộ vai: c hoá ra là Sói. Cùng vòng 1 để không chốt sổ
    // aggro (mỗi vòng mới thêm một mẫu aggro cho mọi người).
    const revealed = claimContext(1, { knownRoles: { me: "VILLAGER", c: "WEREWOLF" }, revealRoleOnDeath: true });
    bot.observe(revealed);
    expect(bot.state.profiles.c).toMatchObject({ bluffRate: 1, samples: 1 });

    bot.observe(revealed);
    bot.observe(revealed);
    expect(bot.state.profiles.c!.samples).toBe(1);
  });

  it("lời khai khớp vai đã lộ -> một mẫu sạch", () => {
    const bot = runtime(BOT_WEIGHTS_V12);
    bot.observe(claimContext(1));
    bot.observe(claimContext(1, { knownRoles: { me: "VILLAGER", c: "SEER" }, revealRoleOnDeath: true }));
    expect(bot.state.profiles.c).toMatchObject({ bluffRate: 0, samples: 1 });
  });

  it("kết quả soi của chính bot cũng kiểm chứng được lời khai", () => {
    const bot = new BotRuntime({
      playerId: "me",
      rng: () => 0,
      playerIds: PLAYERS,
      personality: SHARP,
      weights: BOT_WEIGHTS_V12,
    });
    bot.observe(claimContext(1, { selfRole: "SEER", knownRoles: { me: "SEER" } }));
    bot.observe(
      claimContext(1, {
        selfRole: "SEER",
        knownRoles: { me: "SEER" },
        seerResult: { targetId: "c", targetName: "C", isWolf: true, team: "wolves" },
      }),
    );
    expect(bot.state.profiles.c).toMatchObject({ bluffRate: 1, samples: 1 });
  });

  it("phán quyết đã kiểm chứng -> accuracy", () => {
    const trial: DayVoteRecap = {
      ...recap(1, { me: "c", a: "c", b: "c", c: "a", d: "c" }, "c"),
      finalJudgment: {
        ballots: [
          { voterId: "a", guilty: true },
          { voterId: "b", guilty: false },
        ],
        guilty: 1,
        innocent: 1,
        abstain: 0,
        lynched: true,
      },
    };
    const bot = runtime(BOT_WEIGHTS_V12);
    bot.observe(
      context({
        round: 1,
        publicVoteHistory: [trial],
        revealRoleOnDeath: true,
        knownRoles: { me: "VILLAGER", c: "WEREWOLF" },
      }),
    );
    // a treo đúng Sói, b tha nhầm Sói.
    expect(bot.state.profiles.a).toMatchObject({ accuracy: 1, samples: 1 });
    expect(bot.state.profiles.b).toMatchObject({ accuracy: 0, samples: 1 });
    expect(bot.state.profiles.d!.samples).toBe(0);
  });

  it("cuối vòng: ai đã buộc tội ai đó -> aggroRate, người im lặng cũng có mẫu", () => {
    const bot = runtime(BOT_WEIGHTS_V12);
    bot.observe(
      context({ round: 1, phase: "DAY_DISCUSSION" }, [
        { id: "m1", actorId: "a", text: "Tôi nghi B", at: 1_000 },
      ]),
    );
    expect(bot.state.profiles.a!.samples).toBe(0);

    bot.observe(context({ round: 2, phase: "NIGHT" }));
    expect(bot.state.profiles.a).toMatchObject({ aggroRate: 1, samples: 1 });
    expect(bot.state.profiles.b).toMatchObject({ aggroRate: 0, samples: 1 });

    // Cùng vòng, observe thêm không chốt sổ lần nữa.
    bot.observe(context({ round: 2, phase: "DAY_DISCUSSION" }));
    expect(bot.state.profiles.a!.samples).toBe(1);
  });

  it("hồ sơ khai láo làm lời khai sau của cùng người đó được tin ít hơn (v12), v11 thì không", () => {
    const run = (weights: typeof BOT_WEIGHTS_V12) => {
      const bot = runtime(weights);
      // c khai Tiên Tri ở vòng 1; bot là Tiên Tri thật soi ra c là Sói.
      bot.observe(claimContext(1, { selfRole: "SEER", knownRoles: { me: "SEER" } }));
      bot.observe(
        claimContext(2, {
          selfRole: "SEER",
          knownRoles: { me: "SEER" },
          seerResult: { targetId: "c", targetName: "C", isWolf: true, team: "wolves" },
        }),
      );
      // c khai lại ở vòng 3 (một tin nhắn mới): mảnh S1 cho tin nhắn đó.
      bot.observe(
        context(
          { round: 3, phase: "DAY_DISCUSSION", selfRole: "SEER", knownRoles: { me: "SEER" } },
          [{ id: "claim-3", actorId: "c", text: "Tôi là tiên tri", at: 3_000 }],
        ),
      );
      return bot.state.trust.c!.reasons.find((r) => r.id === "claim-3:ROLE_CLAIM:claimant");
    };
    const v12 = run(BOT_WEIGHTS_V12);
    const v11 = run(BOT_WEIGHTS_V11);
    expect(v11).toBeDefined();
    expect(v12).toBeDefined();
    // Trust lưu mảnh với dấu đã đảo (dương = tin); v12 tin ít hơn.
    expect(Math.abs(v12!.weight)).toBeLessThan(Math.abs(v11!.weight));
    expect(v12!.summary).toContain("từng khai sai");
  });

  it("khôi phục snapshot cũ không có hồ sơ vẫn chạy", () => {
    const bot = runtime(BOT_WEIGHTS_V12);
    const snapshot = bot.serialize();
    const legacy = { ...snapshot.state } as Partial<typeof snapshot.state>;
    delete legacy.profiles;
    const restored = new BotRuntime({
      playerId: "me",
      rng: () => 0,
      playerIds: PLAYERS,
      state: legacy as typeof snapshot.state,
      lastDecayRound: snapshot.lastDecayRound,
      weights: BOT_WEIGHTS_V12,
    });
    expect(restored.state.profiles).toEqual({});
    restored.observe(claimContext(1));
    expect(() => restored.observe(claimContext(2, { knownRoles: { me: "VILLAGER", c: "WEREWOLF" } }))).not.toThrow();
    expect(restored.state.profiles.c!.bluffRate).toBe(1);
  });
});
