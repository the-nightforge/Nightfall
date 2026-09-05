import { describe, expect, it } from "vitest";
import { BotRuntime } from "../src/bot/BotRuntime";
import { createSeededRng } from "../src/bot/rng";
import { createBotPersonality } from "../src/bot/personality/personality";
import { createBotBrainState, remember } from "../src/bot/memory/memory-store";
import { applyEvidence, decayBeliefs } from "../src/bot/belief/belief-state";
import { applyPrivateInformation } from "../src/bot/belief/private-info";
import type { Role } from "@masoi/shared";
import type {
  BotBrainState,
  BotDecisionContext,
  BotEvidence,
  BotKnowledgeView,
} from "../src/bot/types";

const PLAYERS = ["me", "a", "b", "c"];

function stateFor(seed = "decay"): BotBrainState {
  return createBotBrainState("me", createBotPersonality(createSeededRng(seed)), PLAYERS);
}

function knowledge(over: Partial<BotKnowledgeView> = {}): BotKnowledgeView {
  return {
    dayOfTruthClaims: {},
    activeEventId: null,
    neutralRolesInPlay: [],
    botId: "me",
    round: 1,
    phase: "DAY_DISCUSSION",
    phaseStartedAt: 0,
    phaseEndsAt: 60_000,
    selfRole: "VILLAGER",
    players: PLAYERS.map((id) => ({ id, name: id.toUpperCase(), alive: true })),
    knownRoles: { me: "VILLAGER" },
    seerResult: null,
    mediumResult: null,
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
    ...over,
  };
}

function context(over: Partial<BotKnowledgeView> = {}): BotDecisionContext {
  return { knowledge: knowledge(over), visibleChat: [] };
}

function evidence(over: Partial<BotEvidence> = {}): BotEvidence {
  return {
    id: "ev-1",
    kind: "ACCUSE",
    sourceId: "src-1",
    actorId: "a",
    targetId: "b",
    weight: 40,
    confidence: 1,
    round: 1,
    summary: "buộc tội",
    ...over,
  };
}

describe("decayBeliefs", () => {
  it("làm nguội nghi ngờ cũ theo số vòng đã trôi qua", () => {
    // Một nghi ngờ từ vòng 1 không nên nặng ngang một nghi ngờ vừa mới có ở
    // vòng 4. Không có decay thì bot bị khoá vào ấn tượng đầu tiên vĩnh viễn.
    const state = stateFor();
    state.seenEventIds.push("src-1");
    applyEvidence(state, evidence({ round: 1 }));
    const before = state.suspicion.a.score;

    decayBeliefs(state, 4);

    expect(before).toBeGreaterThan(0);
    expect(state.suspicion.a.score).toBeLessThan(before);
  });

  it("không nguội thêm khi gọi lại ở cùng một vòng", () => {
    const state = stateFor();
    state.seenEventIds.push("src-1");
    applyEvidence(state, evidence({ round: 1 }));

    decayBeliefs(state, 4);
    const once = state.suspicion.a.score;
    decayBeliefs(state, 4);

    expect(state.suspicion.a.score).toBe(once);
  });

  it("không đụng tới nghi ngờ vừa cập nhật ở chính vòng này", () => {
    const state = stateFor();
    state.seenEventIds.push("src-1");
    applyEvidence(state, evidence({ round: 3 }));
    const fresh = state.suspicion.a.score;

    decayBeliefs(state, 3);

    expect(state.suspicion.a.score).toBe(fresh);
  });

  it("KHÔNG làm nguội kết quả soi của Tiên Tri", () => {
    // Kết quả soi là sự thật đã xác lập, không phải ấn tượng. Để nó nguội đi là
    // biến Tiên Tri thành vô dụng sau vài vòng.
    const state = stateFor();
    state.seenEventIds.push("seer:b");
    applyEvidence(
      state,
      evidence({
        id: "seer-wolf-b",
        kind: "SEER_RESULT_WOLF",
        sourceId: "seer:b",
        actorId: "b",
        weight: 100,
        confidence: 1,
        round: 1,
      }),
    );
    const locked = state.suspicion.b.score;

    decayBeliefs(state, 9);

    // Điểm cụ thể phụ thuộc inertia của personality; điều đang đo là nó KHÔNG
    // đổi sau 8 vòng, chứ không phải nó bằng một con số nào.
    expect(locked).toBeGreaterThan(0);
    expect(state.suspicion.b.score).toBe(locked);
  });

  it("làm nguội cả trust và quan hệ xã hội", () => {
    const state = stateFor();
    state.seenEventIds.push("src-1");
    state.trust.a = {
      score: 60,
      reasons: [evidence({ round: 1 })],
      lastUpdatedRound: 1,
    };
    state.relationships["a->b"] = {
      support: 0.8,
      hostility: 0.4,
      voteAlignment: 0.6,
      samples: 3,
      reasons: [],
      lastUpdatedRound: 1,
    };

    decayBeliefs(state, 5);

    expect(state.trust.a.score).toBeLessThan(60);
    expect(state.relationships["a->b"].support).toBeLessThan(0.8);
  });

  it("không đẩy điểm xuống dưới 0", () => {
    const state = stateFor();
    state.suspicion.a = { score: 0.0001, reasons: [], lastUpdatedRound: 0 };

    decayBeliefs(state, 50);

    expect(state.suspicion.a.score).toBeGreaterThanOrEqual(0);
  });
});

describe("applyPrivateInformation", () => {
  it("kết quả soi ra Sói đẩy nghi ngờ lên kịch trần", () => {
    const state = stateFor();

    applyPrivateInformation(
      state,
      knowledge({
        selfRole: "SEER",
        seerResult: { targetId: "b", targetName: "B", isWolf: true, team: "wolves" },
      }),
    );

    expect(state.suspicion.b.score).toBe(100);
  });

  it("soi ra không phải Sói thì tin tưởng và xoá nghi ngờ", () => {
    const state = stateFor();
    state.seenEventIds.push("src-1");
    applyEvidence(state, evidence({ actorId: "b", round: 1 }));
    expect(state.suspicion.b.score).toBeGreaterThan(0);

    applyPrivateInformation(
      state,
      knowledge({
        selfRole: "SEER",
        seerResult: { targetId: "b", targetName: "B", isWolf: false, team: "village" },
      }),
    );

    expect(state.suspicion.b.score).toBe(0);
    expect(state.trust.b.score).toBeGreaterThan(0);
  });

  /*
   * BÀ ĐỒNG: vai của cái xác chỉ có nghĩa khi đối chiếu ngược với người sống.
   *
   * Trước khi nối, `mediumResult` không tồn tại trong `BotKnowledgeView`: engine
   * ghi đúng vai thật, UI hiện đúng, mà lõi bot thì hỏi xong không nghe được
   * câu trả lời. Đo ra -2.2 điểm, tức một ghế đặc biệt bị lãng phí.
   */
  function claim(state: BotBrainState, actorId: string, role: Role, round = 1): void {
    remember(state, {
      id: `claim-${actorId}`,
      sourceId: `msg-${actorId}`,
      round,
      phase: "DAY_DISCUSSION",
      type: "ROLE_CLAIM",
      actorId,
      importance: 5,
      pinned: false,
      data: { role },
    });
  }

  const mediumSaw = (targetId: string, role: Role) => ({
    targetId,
    targetName: targetId.toUpperCase(),
    role,
  });

  it("người CÒN SỐNG nhận đúng vai của cái xác thì bị lật mặt", () => {
    const state = stateFor();
    claim(state, "a", "SEER");

    applyPrivateInformation(
      state,
      knowledge({ selfRole: "MEDIUM", mediumResult: mediumSaw("b", "SEER") }),
    );

    expect(state.suspicion.a.score).toBeGreaterThan(0);
  });

  it("khai một vai KHÁC thì không bị đụng tới", () => {
    const state = stateFor();
    claim(state, "a", "WITCH");

    applyPrivateInformation(
      state,
      knowledge({ selfRole: "MEDIUM", mediumResult: mediumSaw("b", "SEER") }),
    );

    expect(state.suspicion.a.score).toBe(0);
  });

  it("xác là Dân Làng thì không lật ai: hai người cùng khai Dân Làng không mâu thuẫn", () => {
    const state = stateFor();
    claim(state, "a", "VILLAGER");

    applyPrivateInformation(
      state,
      knowledge({ selfRole: "MEDIUM", mediumResult: mediumSaw("b", "VILLAGER") }),
    );

    expect(state.suspicion.a.score).toBe(0);
  });

  it("người khai đã CHẾT thì không lật: lời khai đó không còn chỉ vào ai", () => {
    const state = stateFor();
    claim(state, "a", "SEER");

    applyPrivateInformation(
      state,
      knowledge({
        selfRole: "MEDIUM",
        mediumResult: mediumSaw("b", "SEER"),
        players: PLAYERS.map((id) => ({ id, name: id.toUpperCase(), alive: id !== "a" })),
      }),
    );

    expect(state.suspicion.a.score).toBe(0);
  });

  it("Tiên Tri Tập Sự lật mặt người khai giả Tiên Tri", () => {
    // Cùng luật với Bà Đồng, nguồn khác: `knownRoles` do engine cấp thay cho
    // một lượt gọi hồn. Đây là việc lá bài làm được NGAY đêm 1.
    const state = stateFor();
    claim(state, "a", "SEER");

    applyPrivateInformation(
      state,
      knowledge({
        selfRole: "APPRENTICE_SEER",
        knownRoles: { me: "APPRENTICE_SEER", b: "SEER" },
      }),
    );

    expect(state.suspicion.a.score).toBeGreaterThan(0);
    // Không đụng tới chính Tiên Tri thật.
    expect(state.suspicion.b.score).toBe(0);
  });

  it("đồng bọn Sói đã biết được tin tưởng, không bị nghi", () => {
    const state = stateFor();

    applyPrivateInformation(
      state,
      knowledge({
        selfRole: "WEREWOLF",
        knownRoles: { me: "WEREWOLF", a: "WEREWOLF" },
      }),
    );

    expect(state.trust.a.score).toBeGreaterThan(0);
    expect(state.suspicion.a.score).toBe(0);
  });

  it("gọi lại nhiều lần không cộng dồn vô hạn", () => {
    // observe() chạy nhiều lần mỗi vòng; thông tin riêng là một sự thật cố định
    // nên áp lại phải cho cùng kết quả.
    const state = stateFor();
    const view = knowledge({
      selfRole: "SEER",
      seerResult: { targetId: "b", targetName: "B", isWolf: false, team: "village" },
    });

    applyPrivateInformation(state, view);
    const once = { ...state.trust.b };
    applyPrivateInformation(state, view);

    expect(state.trust.b.score).toBe(once.score);
  });

  it("không bao giờ ghi claim hay suy đoán vào knownRoles", () => {
    const state = stateFor();

    applyPrivateInformation(
      state,
      knowledge({
        selfRole: "SEER",
        seerResult: { targetId: "b", targetName: "B", isWolf: true, team: "wolves" },
      }),
    );

    // Soi ra Sói là bằng chứng rất mạnh, nhưng knownRoles là kho SỰ THẬT do
    // engine cấp. Ghi vào đó sẽ phá đúng ranh giới Phase 1 dựng lên.
    expect(state.knownInformation.knownRoles).not.toHaveProperty("b");
  });
});

describe("BotRuntime · tích hợp decay và thông tin riêng", () => {
  function runtime(seed = "integration"): BotRuntime {
    return new BotRuntime({
      playerId: "me",
      rng: createSeededRng(seed),
      playerIds: PLAYERS,
    });
  }

  it("observe áp kết quả soi vào belief, không chỉ ghi memory", () => {
    const bot = runtime();

    bot.observe(
      context({
        selfRole: "SEER",
        seerResult: { targetId: "b", targetName: "B", isWolf: true, team: "wolves" },
      }),
    );

    expect(bot.state.suspicion.b.score).toBe(100);
  });

  it("nghi ngờ nguội dần qua nhiều vòng khi không có bằng chứng mới", () => {
    const bot = runtime();
    bot.state.seenEventIds.push("src-1");
    applyEvidence(bot.state, evidence({ round: 1 }));
    const before = bot.state.suspicion.a.score;

    for (const round of [2, 3, 4, 5]) bot.observe(context({ round }));

    expect(bot.state.suspicion.a.score).toBeLessThan(before);
  });

  it("decay chỉ chạy một lần mỗi vòng dù observe nhiều lần", () => {
    const bot = runtime();
    bot.state.seenEventIds.push("src-1");
    applyEvidence(bot.state, evidence({ round: 1 }));

    bot.observe(context({ round: 5 }));
    const once = bot.state.suspicion.a.score;
    bot.observe(context({ round: 5 }));
    bot.observe(context({ round: 5 }));

    expect(bot.state.suspicion.a.score).toBe(once);
  });

  it("vẫn deterministic: cùng seed cho cùng belief cuối", () => {
    const run = (): BotBrainState => {
      const bot = runtime("same-seed");
      for (const round of [1, 2, 3]) {
        bot.observe(
          context({
            round,
            selfRole: "SEER",
            seerResult: { targetId: "b", targetName: "B", isWolf: true, team: "wolves" },
          }),
        );
      }
      return bot.state;
    };

    expect(run()).toEqual(run());
  });
});
