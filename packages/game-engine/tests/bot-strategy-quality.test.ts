import { describe, expect, it } from "vitest";
import type { PublicVoteChoice, Role } from "@masoi/shared";
import { BotRuntime } from "../src/bot/BotRuntime";
import { BOT_WEIGHTS_V1, resolveWeights, type BotWeights } from "../src/bot/config/weights";
import { createSeededRng } from "../src/bot/rng";
import { createBotBrainState } from "../src/bot/memory/memory-store";
import { createBotPersonality } from "../src/bot/personality/personality";
import { selectVote } from "../src/bot/decision/vote-decision";
import { decideHunterShot } from "../src/bot/decision/trial-decision";
import { strategyFor } from "../src/bot/roles/registry";
import type {
  BotBrainState,
  BotDecisionContext,
  BotEvidence,
  BotKnowledgeView,
  BotPersonality,
  NightKnowledge,
} from "../src/bot/types";

/**
 * Chất lượng chiến thuật, đo được.
 *
 * Mỗi scenario dựng `BotBrainState` và `BotKnowledgeView` trực tiếp thay vì chạy
 * trọn ván: một test hành vi phải hỏng vì ĐÚNG lý do nó kiểm. Chạy 300 ván rồi
 * nhìn win-rate không nói được vì sao Sói bảo vệ đồng đội quá lộ liễu.
 *
 * Bốn hành vi mới của Phase 3 được BẬT bằng trọng số, không phải bằng cờ ẩn:
 * `BOT_WEIGHTS_V1` giữ chúng trung tính để v1 tái lập Phase 2 từng bit, nên các
 * scenario dưới đây chỉ định rõ cấu hình mà chúng đang kiểm.
 */

const PLAYERS = ["me", "ally", "a", "b", "c"];

/**
 * Bật cả bốn hành vi mới, trên NỀN v1.
 *
 * Neo vào `BOT_WEIGHTS_V1` chứ không vào `DEFAULT_BOT_WEIGHTS`: các scenario ở
 * đây kiểm từng HÀNH VI một cách cô lập, nên chúng không được đổi ý nghĩa mỗi
 * lần production đổi cấu hình. Cân bằng tổng thể là việc của batch self-play.
 */
function tuned(over: Parameters<typeof resolveWeights>[0] = {}): BotWeights {
  return resolveWeights(
    {
      deceptionRisk: {
        bussingVoteShare: 0.3,
        bussingDeceptionScale: 2,
        bussingJoinBonus: 120,
        seerRevealRound: 2,
        allyLostThresholdBonus: 25,
        abstainPressureCeiling: 0.3,
      },
      selfPreservation: {
        guardSelfHostilityThreshold: 0.5,
        guardSelfBonusBase: 60,
        guardSelfBonusSpan: 60,
        guardSuspicionPenalty: 0.5,
        guardRepeatPenalty: 40,
      },
      ...over,
    },
    BOT_WEIGHTS_V1,
  );
}

function personality(over: Partial<BotPersonality> = {}): BotPersonality {
  return { ...createBotPersonality(createSeededRng("p")), ...over };
}

function stateFor(playerId = "me", over: Partial<BotPersonality> = {}): BotBrainState {
  return createBotBrainState(playerId, personality(over), PLAYERS);
}

function evidence(over: Partial<BotEvidence> = {}): BotEvidence {
  return {
    id: `e:${over.actorId ?? "x"}:${over.kind ?? "ACCUSE"}`,
    kind: "ACCUSE",
    sourceId: "src",
    actorId: "a",
    weight: 10,
    confidence: 0.5,
    round: 2,
    summary: "",
    ...over,
  };
}

/** Ghim niềm tin về một người mà không phải chạy cả đường quan sát. */
function believe(
  state: BotBrainState,
  playerId: string,
  suspicion: number,
  reasons: BotEvidence[] = [evidence({ actorId: playerId })],
  trust = 0,
): void {
  state.seenEventIds.push("src");
  state.suspicion[playerId] = { score: suspicion, reasons, lastUpdatedRound: 2 };
  state.trust[playerId] = { score: trust, reasons: [], lastUpdatedRound: 2 };
}

function night(over: Partial<NightKnowledge> = {}): NightKnowledge {
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

// ---------------------------------------------------------------------------

describe("1. Dân ưu tiên người có chuỗi vote đáng ngờ", () => {
  it("hai người cùng điểm nghi, người có LATE_SWITCH + SAVE_VOTE được chọn", () => {
    // Điểm belief bằng nhau, nên thứ phân định phải là CHẤT của bằng chứng:
    // hành vi bỏ phiếu đáng ngờ nặng hơn một cáo buộc miệng.
    const state = stateFor();
    believe(state, "a", 60, [
      evidence({ actorId: "a", kind: "LATE_SWITCH", confidence: 0.6 }),
      evidence({ actorId: "a", kind: "SAVE_VOTE", confidence: 0.65 }),
    ]);
    believe(state, "b", 60, [evidence({ actorId: "b", kind: "ACCUSE", confidence: 0.2 })]);

    const vote = selectVote(context(), state, createSeededRng("s1"), tuned());
    expect(chosen(vote)).toBe("a");
  });
});

describe("2. Sói tránh bảo vệ đồng đội quá lộ liễu", () => {
  it("không bao giờ tự đề cử đồng bọn khi bằng chứng còn mỏng", () => {
    const state = stateFor();
    believe(state, "ally", 40);
    believe(state, "a", 10);

    const vote = selectVote(
      context({ selfRole: "WEREWOLF", knownRoles: { me: "WEREWOLF", ally: "WEREWOLF" } }),
      state,
      createSeededRng("s2"),
      tuned(),
    );
    expect(chosen(vote)).not.toBe("ally");
  });

  it("bảo vệ bằng cách KHÔNG bầu, không phải bằng cách bênh ra mặt", () => {
    // Phân biệt hai thứ khác nhau: `voteBias` chỉ dịch phiếu của CHÍNH Sói.
    // Nó không sinh ra bằng chứng gỡ tội nào cho đồng bọn, nên cả làng không
    // thấy Sói đứng ra che ai.
    const bias = strategyFor("WEREWOLF", tuned()).voteBias(
      context({ selfRole: "WEREWOLF", knownRoles: { me: "WEREWOLF", ally: "WEREWOLF" } }),
      stateFor(),
    );
    expect(Object.keys(bias)).toEqual(["ally"]);
    expect(bias.ally).toBeLessThan(0);
  });
});

describe("3. Sói hy sinh đồng đội khi bằng chứng quá mạnh", () => {
  /**
   * Cổng bussing đo ÁP LỰC CÔNG KHAI, không phải nghi ngờ của chính con Sói.
   *
   * Bản đầu tiên gate trên `state.suspicion[ally]`, và `applyPrivateInformation`
   * ghim đúng giá trị đó về 0 cho mọi đồng đội - nên hành vi tồn tại trên giấy
   * và không lần nào chạy. Chỉ một batch 200 ván với `bus=0.0%` mới lộ ra điều
   * đó; không test đơn lẻ nào bắt được, vì mỗi test tự dựng state của nó.
   */
  const wolfSees = (votesOnAlly: number) =>
    context({
      selfRole: "WEREWOLF",
      knownRoles: { me: "WEREWOLF", ally: "WEREWOLF" },
      currentVoteCounts: { players: { ally: votesOnAlly }, noElimination: 0 },
    });

  /**
   * Trong ván thật, `applyPrivateInformation` ghim suspicion của đồng đội về 0
   * NHƯNG vẫn để lại một `reasons` (bằng chứng `KNOWN_ALLY`). Fixture tái hiện
   * đúng hình dạng đó: điểm 0, lý do khác rỗng.
   */
  const wolfState = (deceptionSkill: number): BotBrainState => {
    const state = stateFor("me", { deceptionSkill });
    believe(state, "a", 20);
    believe(state, "ally", 0, [evidence({ actorId: "ally", kind: "KNOWN_ALLY" })]);
    return state;
  };

  it("bỏ phiếu cho đồng bọn khi cả làng đã dồn phiếu vào người đó", () => {
    // Che một người mà đa số đã chỉ vào thì không cứu được ai - một lá phiếu
    // không lật được đa số - và nó ghép tên mình vào tên người sắp bị treo.
    const vote = selectVote(wolfSees(3), wolfState(0.9), createSeededRng("s3"), tuned());
    expect(chosen(vote)).toBe("ally");
  });

  it("Sói vụng thì KHÔNG dám bán, dù áp lực y hệt", () => {
    // `deceptionSkill` là hệ số vì đây là nước đi cần diễn.
    const vote = selectVote(wolfSees(3), wolfState(0.3), createSeededRng("s3"), tuned());
    expect(chosen(vote)).not.toBe("ally");
  });

  it("áp lực dưới ngưỡng thì vẫn bảo vệ, dù rất khéo", () => {
    // 1/5 chưa phải là đa số đang dồn vào.
    const vote = selectVote(wolfSees(1), wolfState(0.9), createSeededRng("s3"), tuned());
    expect(chosen(vote)).not.toBe("ally");
  });
});

describe("4. Tiên Tri dùng kết quả soi mà không tự lộ quá sớm", () => {
  const seerContext = () =>
    context({
      round: 1,
      selfRole: "SEER",
      knownRoles: { me: "SEER" },
      seerResult: { targetId: "a", targetName: "A", isWolf: true },
    });

  it("vòng 1: vẫn bầu đúng con Sói đã soi trúng", () => {
    const runtime = new BotRuntime({
      playerId: "me",
      rng: createSeededRng("s4"),
      playerIds: PLAYERS,
      weights: tuned(),
    });
    const ctx = seerContext();
    runtime.observe(ctx);
    expect(chosen(runtime.decideVote(ctx))).toBe("a");
  });

  it("vòng 1: KHÔNG nói ra lý do là kết quả soi", () => {
    // Lá phiếu vẫn nhắm đúng người; thứ bị giữ lại là LÝ DO. Hô lên ở vòng 1 là
    // cách nhanh nhất để chết ở đêm 2, và một Tiên Tri chết mang theo mọi thông
    // tin nó sẽ có.
    const runtime = new BotRuntime({
      playerId: "me",
      rng: createSeededRng("talky"),
      playerIds: PLAYERS,
      personality: personality({ talkativeness: 1 }),
      weights: tuned(),
    });
    const ctx = seerContext();
    runtime.observe(ctx);
    const speech = runtime.decideSpeech(ctx, runtime.decideVote(ctx));

    const kinds = (speech?.evidence ?? []).map((item) => item.kind);
    expect(kinds).not.toContain("SEER_RESULT_WOLF");
  });

  it("từ vòng ngưỡng trở đi thì nói thẳng", () => {
    const runtime = new BotRuntime({
      playerId: "me",
      rng: createSeededRng("talky"),
      playerIds: PLAYERS,
      personality: personality({ talkativeness: 1 }),
      weights: tuned(),
    });
    const ctx = context({
      round: 3,
      selfRole: "SEER",
      knownRoles: { me: "SEER" },
      seerResult: { targetId: "a", targetName: "A", isWolf: true },
    });
    runtime.observe(ctx);
    const speech = runtime.decideSpeech(ctx, runtime.decideVote(ctx));

    expect((speech?.evidence ?? []).map((item) => item.kind)).toContain("SEER_RESULT_WOLF");
  });
});

describe("5. Bảo vệ cân bằng giữa mục tiêu mạnh và tránh pattern lặp", () => {
  const guardNight = (previous: string | null, round = 2) =>
    context({
      round,
      selfRole: "GUARD",
      phase: "NIGHT",
      knownRoles: { me: "GUARD" },
      night: night({
        legalActions: ["GUARD"],
        legalTargets: { ...night().legalTargets, GUARD: ["me", "a", "b", "c"] },
        guardPrevious: previous,
      }),
    });

  it("không bao giờ đỡ lại người của đêm ngay trước", () => {
    const decision = strategyFor("GUARD", tuned()).decideNight(
      guardNight("a"),
      stateFor(),
      createSeededRng("g"),
    );
    expect(decision!.targetId).not.toBe("a");
  });

  it("qua bốn đêm chọn ít nhất ba mục tiêu khác nhau", () => {
    // Luôn chọn "người đáng tin nhất" sẽ đỡ đúng một người mọi đêm, và bầy Sói
    // đọc được mẫu đó sau hai vòng - lúc đó Bảo Vệ tự chỉ vào mình.
    const runtime = new BotRuntime({
      playerId: "me",
      rng: createSeededRng("g4"),
      playerIds: PLAYERS,
      weights: tuned(),
    });
    // `a` là người đáng tin nhất; không có phạt lặp thì đêm nào cũng là `a`.
    runtime.state.trust.a = { score: 90, reasons: [], lastUpdatedRound: 1 };
    runtime.state.trust.b = { score: 70, reasons: [], lastUpdatedRound: 1 };
    runtime.state.trust.c = { score: 60, reasons: [], lastUpdatedRound: 1 };

    const picks: string[] = [];
    for (let round = 1; round <= 4; round += 1) {
      picks.push(runtime.decideNight(guardNight(null, round))!.targetId!);
    }
    // Không có phạt lặp thì cả bốn đêm đều là `a`.
    expect(new Set(picks).size).toBeGreaterThanOrEqual(3);
    expect(picks[0]).toBe("a");
  });
});

describe("6. Thợ săn chọn mục tiêu dựa trên belief cuối cùng", () => {
  const shot = () => context({ hunterShot: { canAct: true, legalTargets: ["a", "b", "c"] } });

  it("bắn người bị nghi nhất khi vượt ngưỡng", () => {
    const state = stateFor();
    believe(state, "a", 95);
    believe(state, "b", 50);
    expect(
      decideHunterShot(shot(), state, createSeededRng("h"), tuned()).targetId,
    ).toBe("a");
  });

  it("KHÔNG bắn khi không ai vượt ngưỡng", () => {
    // Bắn bừa lúc chết là cách nhanh nhất để phe làng tự sát: Thợ Săn chết
    // thường là lúc họ thiếu thông tin nhất, không phải nhiều nhất.
    const state = stateFor();
    believe(state, "a", 40);
    expect(
      decideHunterShot(shot(), state, createSeededRng("h"), tuned()).targetId,
    ).toBeNull();
  });

  it("dùng belief MỚI NHẤT, không phải nghi ngờ ban đầu", () => {
    const state = stateFor();
    believe(state, "a", 95);
    believe(state, "b", 20);
    // Bằng chứng mới lật ngược tình thế.
    believe(state, "a", 10);
    believe(state, "b", 98);
    expect(
      decideHunterShot(shot(), state, createSeededRng("h"), tuned()).targetId,
    ).toBe("b");
  });
});

describe("7. BOT đổi chiến thuật khi đồng đội chết", () => {
  it("Sói mất đồng bọn thì bớt đẩy phiếu lộ liễu", () => {
    // Một con Sói vừa mất bạn mà vẫn hăng hái chỉ mặt người khác là con Sói dễ
    // bị để ý nhất trên bàn.
    const build = (lostAlly: boolean) => {
      const state = stateFor();
      believe(state, "a", 62);
      if (lostAlly) {
        state.memories.push({
          id: "ALLY_LOST:x",
          sourceId: "x",
          round: 2,
          phase: "DAY_DISCUSSION",
          type: "ALLY_LOST",
          actorId: "me",
          targetId: "ally",
          importance: 10,
          pinned: true,
          data: {},
        });
      }
      return selectVote(
        context({ selfRole: "WEREWOLF", knownRoles: { me: "WEREWOLF", ally: "WEREWOLF" } }),
        state,
        createSeededRng("s7"),
        tuned(),
      );
    };

    expect(chosen(build(false))).toBe("a");
    // Cùng bằng chứng, cùng seed - chỉ khác việc vừa mất đồng đội.
    expect(chosen(build(true))).toBeNull();
  });

  it("phe làng KHÔNG bị ảnh hưởng bởi luật đó", () => {
    const state = stateFor();
    believe(state, "a", 62);
    state.memories.push({
      id: "ALLY_LOST:x",
      sourceId: "x",
      round: 2,
      phase: "DAY_DISCUSSION",
      type: "ALLY_LOST",
      actorId: "me",
      importance: 10,
      pinned: true,
      data: {},
    });
    expect(chosen(selectVote(context(), state, createSeededRng("s7"), tuned()))).toBe("a");
  });
});

describe("8. BOT không lặp lại cùng một luận điểm vô hạn", () => {
  it("cùng bằng chứng hai lần thì lần sau chuyển sang hỏi", () => {
    const runtime = new BotRuntime({
      playerId: "me",
      rng: createSeededRng("s8"),
      playerIds: PLAYERS,
      personality: personality({ talkativeness: 1 }),
      weights: tuned(),
    });
    believe(runtime.state, "a", 95);

    const ctx = context();
    const first = runtime.decideSpeech(ctx, runtime.decideVote(ctx))!;
    expect(first.kind).toBe("ACCUSE");
    runtime.recordSpeech(first, 2);

    const second = runtime.decideSpeech(ctx, runtime.decideVote(ctx))!;
    expect(second.kind).toBe("QUESTION");
    expect(second.targetId).toBe("a");
    expect(second.evidence).toEqual([]);
  });
});

describe("9. BOT đổi phiếu khi có bằng chứng mới mạnh hơn", () => {
  it("kết quả soi lật phiếu ngay lập tức", () => {
    const runtime = new BotRuntime({
      playerId: "me",
      rng: createSeededRng("s9"),
      playerIds: PLAYERS,
      weights: tuned(),
    });
    believe(runtime.state, "a", 70);

    const before = context({ myVote: { type: "PLAYER", targetId: "a" } });
    expect(chosen(runtime.decideVote(before))).toBe("a");

    // Soi ra `b` là Sói: một sự thật, không phải một ấn tượng.
    const after = context({
      round: 3,
      myVote: { type: "PLAYER", targetId: "a" },
      selfRole: "SEER",
      knownRoles: { me: "SEER" },
      seerResult: { targetId: "b", targetName: "B", isWolf: true },
    });
    runtime.observe(after);
    expect(chosen(runtime.decideVote(after))).toBe("b");
  });
});

describe("10. BOT không đổi phiếu chỉ vì nhiễu nhỏ", () => {
  it("chênh lệch nhỏ hơn hysteresis thì giữ nguyên mục tiêu cũ", () => {
    // Không có quán tính này, jitter ±3 điểm sẽ khiến BOT đổi phiếu mỗi lần
    // được hỏi, và cả bàn trông như một đám nhiễu trắng.
    const state = stateFor("me", { stubbornness: 0.9 });
    believe(state, "a", 70);
    believe(state, "b", 72);

    const vote = selectVote(
      context({ myVote: { type: "PLAYER", targetId: "a" } }),
      state,
      createSeededRng("s10"),
      tuned(),
    );
    expect(chosen(vote)).toBe("a");
  });

  it("chênh lệch lớn hơn hysteresis thì đổi", () => {
    const state = stateFor("me", { stubbornness: 0.9 });
    believe(state, "a", 70);
    believe(state, "b", 95);

    const vote = selectVote(
      context({ myVote: { type: "PLAYER", targetId: "a" } }),
      state,
      createSeededRng("s10"),
      tuned(),
    );
    expect(chosen(vote)).toBe("b");
  });
});
