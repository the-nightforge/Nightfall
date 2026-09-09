import { describe, expect, it } from "vitest";
import { BotRuntime } from "../src/bot/BotRuntime";
import {
  buildConversationState,
  speechUrge,
  type ConversationState,
} from "../src/bot/conversation/conversation-state";
import { markReplied, recordSpeechIntention } from "../src/bot/conversation/speech-memory";
import { planSpeech } from "../src/bot/conversation/speech-planner";
import { deriveSpeechStyle } from "../src/bot/personality/speech-style";
import { BOT_WEIGHTS_V21, BOT_WEIGHTS_V23, DEFAULT_BOT_WEIGHTS } from "../src/bot/config/weights";
import { createSeededRng } from "../src/bot/rng";
import type {
  BotChatObservation,
  BotDecisionContext,
  BotPlayerKnowledge,
  BotVoteIntention,
} from "../src/bot/types";

const PLAYERS: BotPlayerKnowledge[] = [
  { id: "me", name: "An", alive: true },
  { id: "p2", name: "Bình", alive: true },
  { id: "p3", name: "Chi", alive: true },
  { id: "p4", name: "Dũng", alive: true },
  { id: "p5", name: "Em", alive: true },
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

function runtime(seed = "conv"): BotRuntime {
  return new BotRuntime({
    playerId: "me",
    rng: createSeededRng(seed),
    playerIds: PLAYERS.map((player) => player.id),
  });
}

function say(id: string, actorId: string, text: string): BotChatObservation {
  return { id, actorId, text, at: 0 };
}

/** Quan sát chat của MỌI vòng đã đi qua rồi dựng bảng ở vòng cuối. */
function stateAfter(
  bot: BotRuntime,
  rounds: Array<BotChatObservation[]>,
  weights = DEFAULT_BOT_WEIGHTS,
): ConversationState {
  let ctx = context([], 1);
  rounds.forEach((chat, index) => {
    ctx = context(chat, index + 1);
    bot.observe(ctx);
  });
  return buildConversationState(ctx, bot.state, weights);
}

describe("buildConversationState — áp lực xã hội (§7)", () => {
  it("càng nhiều người tố mình thì áp lực càng cao", () => {
    const one = stateAfter(runtime(), [[say("m1", "p2", "Tôi nghi An")]]);
    const three = stateAfter(runtime(), [
      [
        say("m1", "p2", "Tôi nghi An"),
        say("m2", "p3", "Tôi nghi An"),
        say("m3", "p4", "Tôi nghi An"),
      ],
    ]);

    expect(one.pressureOnMe).toBeGreaterThan(0);
    expect(three.pressureOnMe).toBeGreaterThan(one.pressureOnMe);
    expect(three.pressureOnMe).toBeLessThanOrEqual(1);
  });

  it("có người bênh thì áp lực giảm", () => {
    const alone = stateAfter(runtime(), [
      [say("m1", "p2", "Tôi nghi An"), say("m2", "p3", "Tôi nghi An")],
    ]);
    const defended = stateAfter(runtime(), [
      [
        say("m1", "p2", "Tôi nghi An"),
        say("m2", "p3", "Tôi nghi An"),
        say("m3", "p4", "Đừng treo An"),
      ],
    ]);

    expect(defended.pressureOnMe).toBeLessThan(alone.pressureOnMe);
  });

  it("áp lực dâng lên qua các vòng được đọc thành trend", () => {
    const rising = stateAfter(runtime(), [
      [say("a1", "p2", "Tôi nghi An")],
      [
        say("b1", "p2", "Tôi nghi An"),
        say("b2", "p3", "Tôi nghi An"),
        say("b3", "p4", "Tôi nghi An"),
      ],
    ]);
    expect(rising.pressureTrend).toBe("rising");

    const falling = stateAfter(runtime(), [
      [
        say("a1", "p2", "Tôi nghi An"),
        say("a2", "p3", "Tôi nghi An"),
        say("a3", "p4", "Tôi nghi An"),
      ],
      [say("b1", "p2", "Tôi nghi An")],
    ]);
    expect(falling.pressureTrend).toBe("falling");
  });

  it("áp lực lên NGƯỜI KHÁC cũng được ghi, và bàn im thì bảng rỗng", () => {
    const busy = stateAfter(runtime(), [
      [say("m1", "p2", "Tôi nghi Chi"), say("m2", "p4", "Tôi nghi Chi")],
    ]);
    expect(busy.pressureByPlayer["p3"]).toBeGreaterThan(0);
    expect(busy.pressureOnMe).toBe(0);

    const quiet = stateAfter(runtime(), [[]]);
    expect(quiet.pressureByPlayer).toEqual({});
    expect(quiet.pressureTrend).toBe("stable");
  });
});

describe("buildConversationState — câu hỏi còn nợ (§6)", () => {
  it("bị hỏi thẳng mà chưa đáp thì nằm trong danh sách nợ", () => {
    const state = stateAfter(runtime(), [[say("m1", "p2", "An ơi sao lúc nãy đổi phiếu?")]]);

    expect(state.unansweredQuestions).toHaveLength(1);
    expect(state.unansweredQuestions[0]!.messageId).toBe("m1");
    expect(state.unansweredQuestions[0]!.askerId).toBe("p2");
    expect(state.unansweredQuestions[0]!.ageInRounds).toBe(0);
  });

  it("đáp rồi thì hết nợ", () => {
    const bot = runtime();
    const ctx = context([say("m1", "p2", "An ơi sao lúc nãy đổi phiếu?")], 1);
    bot.observe(ctx);
    markReplied(bot.state, "m1");

    expect(buildConversationState(ctx, bot.state).unansweredQuestions).toHaveLength(0);
  });

  it("nợ sống lâu hơn cửa sổ trigger, nhưng không sống mãi", () => {
    // `triggerFreshnessRounds = 1` ở v21: sang vòng 2 thì trigger đã tắt.
    const ask = say("m1", "p2", "An ơi sao lúc nãy đổi phiếu?");
    const bot = runtime();
    bot.observe(context([ask], 1));

    const round2 = buildConversationState(context([ask], 2), bot.state);
    expect(round2.unansweredQuestions).toHaveLength(1);
    expect(round2.unansweredQuestions[0]!.ageInRounds).toBe(1);

    // `unansweredQuestionRounds = 3`: vòng 4 là vòng đầu tiên câu hỏi hết hạn.
    expect(
      buildConversationState(context([ask], 4), bot.state).unansweredQuestions,
    ).toHaveLength(0);
  });

  it("cửa sổ bằng 0 tắt hẳn danh sách", () => {
    const state = stateAfter(
      runtime(),
      [[say("m1", "p2", "An ơi sao lúc nãy đổi phiếu?")]],
      BOT_WEIGHTS_V21.conversation.unansweredQuestionRounds === 0
        ? BOT_WEIGHTS_V21
        : { ...BOT_WEIGHTS_V21, conversation: { ...BOT_WEIGHTS_V21.conversation, unansweredQuestionRounds: 0 } },
    );
    expect(state.unansweredQuestions).toHaveLength(0);
  });
});

describe("buildConversationState — chỗ đứng trong bàn (§12)", () => {
  it("không ai nhắc tới và mình chưa nói: IGNORED", () => {
    expect(stateAfter(runtime(), [[say("m1", "p2", "Tôi nghi Chi")]]).floor).toBe("IGNORED");
  });

  it("bị cả bàn dồn: UNDER_PRESSURE", () => {
    const state = stateAfter(runtime(), [
      [
        say("m1", "p2", "Tôi nghi An"),
        say("m2", "p3", "Tôi nghi An"),
        say("m3", "p4", "Tôi nghi An"),
      ],
    ]);
    expect(state.pressureOnMe).toBeGreaterThanOrEqual(0.34);
    expect(state.floor).toBe("UNDER_PRESSURE");
  });

  it("bị nhắc tên nhiều lần mà chưa thành áp lực: CENTRAL", () => {
    const state = stateAfter(runtime(), [
      [say("m1", "p2", "An ơi nghe nè"), say("m2", "p3", "An thấy sao")],
    ]);
    expect(state.floor).toBe("CENTRAL");
  });

  it("nói nhiều hơn cả phần còn lại: DOMINANT", () => {
    const bot = runtime();
    const ctx = context([say("m1", "p2", "Tôi nghi Chi")], 1);
    bot.observe(ctx);
    for (let index = 0; index < 3; index += 1) {
      recordSpeechIntention(
        bot.state,
        { kind: "ACCUSE", targetId: "p3", confidence: 0.5, evidence: [], tone: "FIRM" },
        1,
      );
    }

    const state = buildConversationState(ctx, bot.state);
    expect(state.myShareOfVoice).toBeGreaterThanOrEqual(0.5);
    expect(state.floor).toBe("DOMINANT");
  });
});

describe("speechUrge (§11)", () => {
  const base: ConversationState = {
    round: 1,
    pressureOnMe: 0,
    pressureTrend: "stable",
    pressureByPlayer: {},
    floor: "SAFE",
    unansweredQuestions: [],
    myMessagesThisRound: 0,
    myShareOfVoice: 0,
  };

  it("có bằng chứng chưa nói thì đáng nói hơn là không có", () => {
    expect(speechUrge(base, 2)).toBeGreaterThan(speechUrge(base, 0));
  });

  it("bị dồn thì đáng nói hơn", () => {
    expect(speechUrge({ ...base, pressureOnMe: 0.8, floor: "UNDER_PRESSURE" }, 0)).toBeGreaterThan(
      speechUrge(base, 0),
    );
  });

  it("nợ câu trả lời thì đáng nói hơn", () => {
    const owing = {
      ...base,
      unansweredQuestions: [{ messageId: "m1", askerId: "p2", round: 1, ageInRounds: 0 }],
    };
    expect(speechUrge(owing, 0)).toBeGreaterThan(speechUrge(base, 0));
  });

  it("nói đủ phần rồi thì bớt đáng nói", () => {
    const talked = { ...base, myMessagesThisRound: 3 };
    expect(speechUrge(talked, 2)).toBeLessThan(speechUrge(base, 2));
  });

  it("luôn nằm trong [0,1]", () => {
    const extreme: ConversationState = {
      ...base,
      pressureOnMe: 1,
      floor: "DOMINANT",
      myMessagesThisRound: 99,
      unansweredQuestions: [
        { messageId: "m1", askerId: "p2", round: 1, ageInRounds: 0 },
        { messageId: "m2", askerId: "p3", round: 1, ageInRounds: 0 },
        { messageId: "m3", askerId: "p4", round: 1, ageInRounds: 0 },
      ],
    };
    expect(speechUrge(extreme, 99)).toBeGreaterThanOrEqual(0);
    expect(speechUrge(extreme, 99)).toBeLessThanOrEqual(1);
    expect(speechUrge(base, 0)).toBeGreaterThanOrEqual(0);
  });
});

describe("planSpeech — cổng SPEAK/WAIT", () => {
  const vote: BotVoteIntention = {
    kind: "VOTE",
    choice: { type: "PLAYER", targetId: "p3" },
    confidence: 0.5,
    evidence: [],
  };

  /** Cùng một tình huống, chạy qua nhiều seed; đếm số lần bot chịu mở lời. */
  function speakCount(chat: BotChatObservation[], weights = DEFAULT_BOT_WEIGHTS): number {
    let spoke = 0;
    for (let seed = 0; seed < 60; seed += 1) {
      const bot = runtime(`gate-${seed}`);
      const ctx = context(chat, 1);
      bot.observe(ctx);
      // Trigger đã bị đánh dấu đã-đáp: bài kiểm này chỉ nói về đường TỰ MỞ LỜI.
      for (const message of chat) markReplied(bot.state, message.id);
      bot.state.personality.talkativeness = 0.2;

      const speech = planSpeech({
        context: ctx,
        state: bot.state,
        vote,
        style: deriveSpeechStyle(bot.state.personality),
        rng: createSeededRng(`say-${seed}`),
        weights,
      });
      if (speech !== null) spoke += 1;
    }
    return spoke;
  }

  const CALM = [say("m1", "p2", "Tôi nghi Chi")];
  const PILE_ON = [
    say("m1", "p2", "Tôi nghi An"),
    say("m2", "p3", "Tôi nghi An"),
    say("m3", "p4", "Tôi nghi An"),
  ];

  it("v21 im lặng như nhau dù bị dồn hay không — đó là cái v23 chữa", () => {
    expect(BOT_WEIGHTS_V21.conversation.urgencyBoost).toBe(0);
    expect(speakCount(PILE_ON, BOT_WEIGHTS_V21)).toBe(speakCount(CALM, BOT_WEIGHTS_V21));
  });

  it("v23 mở lời nhiều hơn khi đang bị dồn", () => {
    expect(speakCount(PILE_ON, BOT_WEIGHTS_V23)).toBeGreaterThan(
      speakCount(CALM, BOT_WEIGHTS_V23),
    );
  });

  it("v23 không đổi hành vi ở tình huống bình lặng nếu urge bằng 0", () => {
    // Không bằng chứng, không áp lực, không nợ, nhưng floor = IGNORED nên urge
    // vẫn > 0 — v23 phải nói NHIỀU HƠN hoặc bằng v21, không bao giờ ít hơn.
    expect(speakCount(CALM, BOT_WEIGHTS_V23)).toBeGreaterThanOrEqual(
      speakCount(CALM, BOT_WEIGHTS_V21),
    );
  });
});
