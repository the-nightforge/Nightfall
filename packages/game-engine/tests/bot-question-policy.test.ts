import { describe, expect, it } from "vitest";
import { BotRuntime } from "../src/bot/BotRuntime";
import { analyzeChat, classifyQuestion, asciiForm, plainForm } from "../src/bot/analysis/chat-analysis";
import {
  chooseResponseStrategy,
  intentionFor,
  questionImportance,
  RESPONSE_STRATEGIES,
  type QuestionContext,
} from "../src/bot/conversation/question-policy";
import { planSpeech } from "../src/bot/conversation/speech-planner";
import { findConversationTriggers } from "../src/bot/conversation/triggers";
import { deriveSpeechStyle, type BotSpeechStyle } from "../src/bot/personality/speech-style";
import { BOT_WEIGHTS_V23, BOT_WEIGHTS_V24 } from "../src/bot/config/weights";
import { createSeededRng } from "../src/bot/rng";
import type {
  BotChatObservation,
  BotDecisionContext,
  BotEvidence,
  BotPlayerKnowledge,
  BotVoteIntention,
} from "../src/bot/types";

const PLAYERS: BotPlayerKnowledge[] = [
  { id: "me", name: "An", alive: true },
  { id: "p2", name: "Bình", alive: true },
  { id: "p3", name: "Chi", alive: true },
  { id: "p4", name: "Dũng", alive: true },
];

function context(chat: BotChatObservation[], round = 1): BotDecisionContext {
  return {
    knowledge: {
      dayOfTruthClaims: {},
      activeEventId: null,
      neutralRolesInPlay: [],
      botId: "me",
      round,
      phase: "DAY_DISCUSSION",
      phaseStartedAt: 0,
      phaseEndsAt: null,
      selfRole: "VILLAGER",
      players: PLAYERS,
      knownRoles: {},
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
      legalVoteChoices: [],
      lastNightDeaths: [],
    },
    visibleChat: chat,
  };
}

function say(id: string, actorId: string, text: string): BotChatObservation {
  return { id, actorId, text, at: 0 };
}

function clause(text: string) {
  return { plain: plainForm(text), ascii: asciiForm(text) };
}

// ---------------------------------------------------------------------------

describe("classifyQuestion (§13)", () => {
  const cases: Array<[string, string]> = [
    ["mày là sói phải ko", "ACCUSATION"],
    ["An là sw à", "ACCUSATION"],
    ["An vai gì thế", "ROLE"],
    ["An là tiên tri hả", "ROLE"],
    ["dựa vào đâu vậy An", "EVIDENCE"],
    ["An có bằng chứng gì không", "EVIDENCE"],
    ["An sao lúc nãy đổi phiếu", "CONSISTENCY"],
    ["An hôm qua nói khác mà", "CONSISTENCY"],
    ["An vote ai thế", "VOTE"],
    ["An nghi ai nhất", "TARGET"],
    ["An thấy sao", "GENERAL"],
  ];

  for (const [text, expected] of cases) {
    it(`"${text}" -> ${expected}`, () => {
      expect(classifyQuestion(clause(text))).toBe(expected);
    });
  }

  it("nhãn đi kèm memory DIRECT_QUESTION, không phải suy lại ở tầng trên", () => {
    const memories = analyzeChat([say("m1", "p2", "An dựa vào đâu vậy")], PLAYERS);
    const question = memories.find((memory) => memory.type === "DIRECT_QUESTION");
    expect(question?.data.questionType).toBe("EVIDENCE");
  });

  it("câu KHÔNG phải câu hỏi thì không có nhãn nào cả", () => {
    const memories = analyzeChat([say("m1", "p2", "Tôi nghi An")], PLAYERS);
    expect(memories.every((memory) => memory.data.questionType === undefined)).toBe(true);
  });

  it("trigger mang nhãn xuống tới planner", () => {
    const bot = new BotRuntime({
      playerId: "me",
      rng: createSeededRng("q"),
      playerIds: PLAYERS.map((player) => player.id),
    });
    const ctx = context([say("m1", "p2", "An sao lúc nãy đổi phiếu")], 1);
    bot.observe(ctx);
    const asked = findConversationTriggers(ctx, bot.state, BOT_WEIGHTS_V24).find(
      (trigger) => trigger.kind === "QUESTIONED_ME",
    );
    expect(asked?.questionType).toBe("CONSISTENCY");
  });
});

// ---------------------------------------------------------------------------

const CALM_STYLE: BotSpeechStyle = deriveSpeechStyle({
  aggressiveness: 0.2,
  talkativeness: 0.5,
  riskTolerance: 0.5,
  deceptionSkill: 0.5,
  analyticalSkill: 0.8,
  loyalty: 0.5,
  stubbornness: 0.2,
});

const HARSH_STYLE: BotSpeechStyle = deriveSpeechStyle({
  aggressiveness: 0.95,
  talkativeness: 0.8,
  riskTolerance: 0.8,
  deceptionSkill: 0.5,
  analyticalSkill: 0.3,
  loyalty: 0.3,
  stubbornness: 0.9,
});

function ask(over: Partial<QuestionContext> = {}): QuestionContext {
  return {
    type: "GENERAL",
    pressureOnMe: 0,
    askerCredibility: 0.5,
    unspokenEvidence: 0,
    hasClaimedRole: false,
    ignoreFloor: 0.45,
    style: CALM_STYLE,
    ...over,
  };
}

describe("chooseResponseStrategy (§14)", () => {
  it("bị hỏi vai mà CHƯA khai thì không bao giờ trả lời thẳng", () => {
    for (const style of [CALM_STYLE, HARSH_STYLE]) {
      const strategy = chooseResponseStrategy(ask({ type: "ROLE", style }));
      expect(["DEFLECT", "COUNTER_QUESTION", "CHALLENGE_PREMISE"]).toContain(strategy);
    }
  });

  it("khai vai rồi thì hỏi vai lại trả lời được bình thường", () => {
    const strategy = chooseResponseStrategy(ask({ type: "ROLE", hasClaimedRole: true }));
    expect(["DIRECT_ANSWER", "ANSWER_WITH_EVIDENCE"]).toContain(strategy);
  });

  it("kể cả khi đang bị dồn dữ, hỏi vai vẫn không moi được lời khai", () => {
    const strategy = chooseResponseStrategy(
      ask({ type: "ROLE", pressureOnMe: 1, askerCredibility: 1 }),
    );
    expect(strategy).not.toBe("DIRECT_ANSWER");
    expect(strategy).not.toBe("ANSWER_WITH_EVIDENCE");
  });

  it("cáo buộc mặc áo câu hỏi thì bác tiền đề hoặc hỏi ngược", () => {
    expect(chooseResponseStrategy(ask({ type: "ACCUSATION", style: HARSH_STYLE }))).toBe(
      "CHALLENGE_PREMISE",
    );
    expect(chooseResponseStrategy(ask({ type: "ACCUSATION", style: CALM_STYLE }))).toBe(
      "COUNTER_QUESTION",
    );
  });

  it("có căn cứ chưa nói thì đáp KÈM căn cứ", () => {
    expect(chooseResponseStrategy(ask({ type: "VOTE", unspokenEvidence: 2 }))).toBe(
      "ANSWER_WITH_EVIDENCE",
    );
  });

  it("bị đòi căn cứ mà không có thì không được im, không được lảng", () => {
    for (const style of [CALM_STYLE, HARSH_STYLE]) {
      const strategy = chooseResponseStrategy(ask({ type: "EVIDENCE", style }));
      expect(strategy).not.toBe("IGNORE");
      expect(strategy).not.toBe("DEFLECT");
    }
  });

  it("câu hỏi về tính nhất quán không bao giờ bị lảng", () => {
    const strategy = chooseResponseStrategy(
      ask({ type: "CONSISTENCY", pressureOnMe: 0.9, style: HARSH_STYLE }),
    );
    expect(strategy).toBe("DIRECT_ANSWER");
  });

  it("câu vặt từ người không đáng kể, giữa lúc yên: bỏ qua", () => {
    expect(chooseResponseStrategy(ask({ type: "GENERAL", askerCredibility: 0 }))).toBe("IGNORE");
  });

  it("ngưỡng 0 thì không bao giờ bỏ qua", () => {
    expect(
      chooseResponseStrategy(ask({ type: "GENERAL", askerCredibility: 0, ignoreFloor: 0 })),
    ).not.toBe("IGNORE");
  });

  it("bị dồn thì không câu hỏi nào bị bỏ qua", () => {
    expect(
      chooseResponseStrategy(ask({ type: "GENERAL", askerCredibility: 0, pressureOnMe: 0.5 })),
    ).not.toBe("IGNORE");
  });

  it("người hỏi càng đáng tin, câu hỏi càng quan trọng", () => {
    expect(questionImportance(ask({ askerCredibility: 1 }))).toBeGreaterThan(
      questionImportance(ask({ askerCredibility: 0 })),
    );
  });

  it("cáo buộc quan trọng hơn câu hỏi vu vơ", () => {
    expect(questionImportance(ask({ type: "ACCUSATION" }))).toBeGreaterThan(
      questionImportance(ask({ type: "GENERAL" })),
    );
  });
});

describe("intentionFor", () => {
  it("mọi strategy đều có hình dạng, và chỉ IGNORE là im lặng", () => {
    for (const strategy of RESPONSE_STRATEGIES) {
      const shape = intentionFor(strategy, "GENERAL", CALM_STYLE);
      expect(shape === null).toBe(strategy === "IGNORE");
    }
  });

  it("chỉ ANSWER_WITH_EVIDENCE được mang bằng chứng", () => {
    for (const strategy of RESPONSE_STRATEGIES) {
      const shape = intentionFor(strategy, "EVIDENCE", CALM_STYLE);
      if (!shape) continue;
      expect(shape.withEvidence).toBe(strategy === "ANSWER_WITH_EVIDENCE");
    }
  });

  it("không sinh speech kind nào ngoài ba loại đã có", () => {
    for (const strategy of RESPONSE_STRATEGIES) {
      const shape = intentionFor(strategy, "VOTE", CALM_STYLE);
      if (!shape) continue;
      expect(["REPLY", "QUESTION", "CHALLENGE"]).toContain(shape.kind);
    }
  });

  it("lảng đi phân biệt được với đáp thẳng ở topic", () => {
    const deflect = intentionFor("DEFLECT", "VOTE", CALM_STYLE)!;
    const answer = intentionFor("DIRECT_ANSWER", "VOTE", CALM_STYLE)!;
    expect(deflect.kind).toBe(answer.kind);
    expect(deflect.topic).not.toBe(answer.topic);
  });
});

// ---------------------------------------------------------------------------

describe("planSpeech — đường câu hỏi", () => {
  const evidence: BotEvidence[] = [
    {
      id: "e1",
      kind: "BANDWAGON",
      sourceId: "vote:1",
      actorId: "p3",
      targetId: "p3",
      weight: 1,
      confidence: 0.8,
      round: 1,
      summary: "Chi theo phiếu muộn",
    },
  ];

  /**
   * Ý định của lượt này. `talkativeness` để CAO có chủ đích: `responsiveness`
   * rút ra từ nó, và một BOT kiệm lời sẽ trượt lượt rút "có đáp không" trước
   * khi chính sách kịp nói gì - lúc đó bài kiểm đo RNG chứ không đo chính sách.
   *
   * Vì đường tự mở lời vẫn còn mở, mọi khẳng định dưới đây đọc
   * `replyToMessageId`: đó là thứ phân biệt một CÂU ĐÁP với một câu tự phát.
   */
  function reply(
    chat: BotChatObservation[],
    weights = BOT_WEIGHTS_V24,
    withEvidence = false,
    seed = "plan",
    /** Cho người hỏi một hồ sơ đã mất uy tín (khai láo, phán quyết sai). */
    discreditAsker = false,
  ) {
    const bot = new BotRuntime({
      playerId: "me",
      rng: createSeededRng(seed),
      playerIds: PLAYERS.map((player) => player.id),
      weights,
    });
    const ctx = context(chat, 1);
    bot.observe(ctx);
    bot.state.personality.talkativeness = 1;
    bot.state.personality.aggressiveness = 0.2;
    bot.state.personality.analyticalSkill = 0.8;
    if (discreditAsker) {
      bot.state.profiles["p2"] = {
        bluffRate: 0.9,
        aggroRate: 0,
        accuracy: 0.1,
        samples: 30,
        lastUpdatedRound: 1,
      };
    }

    const vote: BotVoteIntention = {
      kind: "VOTE",
      choice: { type: "PLAYER", targetId: "p3" },
      confidence: 0.6,
      evidence: withEvidence ? evidence : [],
    };
    return planSpeech({
      context: ctx,
      state: bot.state,
      vote,
      style: deriveSpeechStyle(bot.state.personality),
      rng: createSeededRng(`${seed}-say`),
      weights,
    });
  }

  /** Câu đáp cho `m1`, hoặc `null` nếu lượt này không đáp câu đó. */
  function answerTo(...args: Parameters<typeof reply>) {
    const speech = reply(...args);
    return speech?.replyToMessageId === "m1" ? speech : null;
  }

  it("v23 đáp một câu hỏi vai bằng REPLY như cũ", () => {
    const speech = answerTo([say("m1", "p2", "An vai gì thế")], BOT_WEIGHTS_V23);
    expect(speech?.kind).toBe("REPLY");
  });

  it("v24 KHÔNG đáp thẳng câu hỏi vai khi chưa khai", () => {
    const speech = answerTo([say("m1", "p2", "An vai gì thế")], BOT_WEIGHTS_V24);
    expect(speech).not.toBeNull();
    expect(speech!.kind).not.toBe("REPLY");
    expect(speech!.topic).toBe("ROLE_CLAIM");
    expect(speech!.claimedRole).toBeUndefined();
  });

  it("v24 đáp câu hỏi căn cứ KÈM bằng chứng khi đang có", () => {
    const speech = answerTo([say("m1", "p2", "An dựa vào đâu vậy")], BOT_WEIGHTS_V24, true);
    expect(speech?.kind).toBe("REPLY");
    expect(speech?.evidence.map((item) => item.sourceId)).toEqual(["vote:1"]);
  });

  it("câu đáp luôn nhắm vào NGƯỜI HỎI và trích đúng câu đã hỏi", () => {
    const speech = answerTo([say("m1", "p2", "An sao lúc nãy đổi phiếu")], BOT_WEIGHTS_V24);
    expect(speech?.targetId).toBe("p2");
    expect(speech?.replyToMessageId).toBe("m1");
    expect(speech?.replyToActorId).toBe("p2");
  });

  it("người hỏi TRUNG TÍNH thì câu vu vơ vẫn được đáp", () => {
    expect(answerTo([say("m1", "p2", "An thấy sao")], BOT_WEIGHTS_V24)).not.toBeNull();
  });

  it("câu vu vơ từ người đã mất uy tín thì bỏ qua", () => {
    const speech = answerTo(
      [say("m1", "p2", "An thấy sao")],
      BOT_WEIGHTS_V24,
      false,
      "plan",
      true,
    );
    expect(speech).toBeNull();
  });

  it("cùng người mất uy tín đó, v23 vẫn đáp — chỗ hai bản khác nhau", () => {
    expect(
      answerTo([say("m1", "p2", "An thấy sao")], BOT_WEIGHTS_V23, false, "plan", true),
    ).not.toBeNull();
  });
});
