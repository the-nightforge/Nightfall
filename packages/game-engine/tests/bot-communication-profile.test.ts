import { describe, expect, it } from "vitest";
import { BotRuntime } from "../src/bot/BotRuntime";
import {
  buildCommunicationProfile,
  PERSUASION_STYLES,
} from "../src/bot/belief/communication-profile";
import { planSpeech } from "../src/bot/conversation/speech-planner";
import { deriveSpeechStyle } from "../src/bot/personality/speech-style";
import { BOT_WEIGHTS_V25, BOT_WEIGHTS_V26 } from "../src/bot/config/weights";
import { createSeededRng } from "../src/bot/rng";
import { socialEdgeKey } from "../src/bot/analysis/social-analysis";
import type { DayVoteRecap } from "@masoi/shared";
import type {
  BotBrainState,
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
];

function recap(round: number, ballots: Array<[string, string]>): DayVoteRecap {
  return {
    round,
    mutations: [],
    finalBallots: ballots.map(([voterId, targetId]) => ({
      voterId,
      choice: { type: "PLAYER" as const, targetId },
    })),
    nomination: { nominatedId: null, nominations: [] },
    finalJudgment: null,
  } as unknown as DayVoteRecap;
}

function context(
  chat: BotChatObservation[],
  round = 3,
  publicVoteHistory: DayVoteRecap[] = [],
): BotDecisionContext {
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
      publicVoteHistory,
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

function runtime(seed = "profile", weights = BOT_WEIGHTS_V26): BotRuntime {
  return new BotRuntime({
    playerId: "me",
    rng: createSeededRng(seed),
    playerIds: PLAYERS.map((player) => player.id),
    weights,
  });
}

/** Bình hỏi bốn câu ĐÒI CĂN CỨ — dấu hiệu của người phân tích. */
const ANALYST_CHAT = [
  say("a1", "p2", "An dựa vào đâu vậy"),
  say("a2", "p2", "Chi dựa vào đâu vậy"),
  say("a3", "p2", "Dũng có bằng chứng gì không"),
  say("a4", "p2", "An có bằng chứng gì không"),
];

/** Bình tố người khác liên tục — dấu hiệu của người hung hăng. */
const AGGRESSIVE_CHAT = [
  say("g1", "p2", "Tôi nghi Chi"),
  say("g2", "p2", "Tôi nghi Dũng"),
  say("g3", "p2", "Chi đáng ngờ lắm"),
  say("g4", "p2", "An dựa vào đâu vậy"),
];

/**
 * Quan sát ở vòng 2 rồi bước sang vòng 3.
 *
 * Bắt buộc phải có bước sang vòng: `BotRuntime.recordAggression` chấm
 * `aggroRate` ở đầu mỗi vòng, đọc memory `ACCUSE` của vòng TRƯỚC. Quan sát tất
 * cả trong cùng một vòng thì hồ sơ hung hăng mãi mãi bằng 0 — đó là nhịp thật
 * của lớp hồ sơ, không phải một chỗ để lách trong test.
 */
function profileOf(chat: BotChatObservation[], votes: DayVoteRecap[] = [], weights = BOT_WEIGHTS_V26) {
  const bot = runtime("profile", weights);
  bot.observe(context(chat, 2, votes));
  const ctx = context(chat, 3, votes);
  bot.observe(ctx);
  return buildCommunicationProfile(ctx.knowledge, bot.state, "p2", weights);
}

describe("buildCommunicationProfile (§8)", () => {
  it("người hay đòi căn cứ đọc ra analyticalStyle cao và kiểu EVIDENCE", () => {
    const profile = profileOf(ANALYST_CHAT);
    expect(profile.analyticalStyle).toBeGreaterThan(0.5);
    expect(profile.style).toBe("EVIDENCE");
  });

  it("người hay tố đọc ra aggression cao và kiểu CHALLENGE", () => {
    const profile = profileOf(AGGRESSIVE_CHAT);
    expect(profile.aggression).toBeGreaterThan(0);
    expect(profile.style).toBe("CHALLENGE");
  });

  it("người luôn bỏ phiếu theo phe đông đọc ra followMajority = 1", () => {
    // Bốn vòng: `persuasionMinSamples = 4`, và một vòng phiếu là một quan sát.
    const votes = [
      recap(1, [["p2", "p4"], ["p3", "p4"], ["me", "p4"]]),
      recap(2, [["p2", "p3"], ["p4", "p3"], ["me", "p3"]]),
      recap(3, [["p2", "p4"], ["p3", "p4"], ["me", "p4"]]),
      recap(4, [["p2", "p3"], ["p4", "p3"], ["me", "p3"]]),
    ];
    const profile = profileOf([], votes);
    expect(profile.followMajority).toBe(1);
    expect(profile.style).toBe("CONSENSUS");
  });

  it("người luôn bỏ phiếu lệch phe đông đọc ra followMajority = 0", () => {
    const votes = [
      recap(1, [["p2", "me"], ["p3", "p4"], ["p4", "p4"], ["me", "p4"]]),
      recap(2, [["p2", "me"], ["p3", "p4"], ["p4", "p4"], ["me", "p4"]]),
    ];
    expect(profileOf([], votes).followMajority).toBe(0);
  });

  it("phiếu trắng không tính vào mẫu số", () => {
    const blank = {
      round: 1,
      mutations: [],
      finalBallots: [{ voterId: "p2", choice: { type: "NO_ELIMINATION" as const } }],
      nomination: { nominatedId: null, nominations: [] },
      finalJudgment: null,
    } as unknown as DayVoteRecap;
    const profile = profileOf([], [blank]);
    expect(profile.followMajority).toBe(0);
    expect(profile.samples).toBe(0);
  });

  it("người thù địch với chính bot đọc ra kiểu CONSISTENCY", () => {
    const bot = runtime();
    // Bốn mẫu để qua ngưỡng, nhưng là chat trung tính (không tố, không hỏi).
    const neutral = [
      say("n1", "p2", "An ơi"),
      say("n2", "p2", "An này"),
      say("n3", "p2", "An nhé"),
      say("n4", "p2", "An ê"),
    ];
    bot.observe(context(neutral, 2));
    const ctx = context(neutral, 3);
    bot.observe(ctx);
    bot.state.relationships[socialEdgeKey("p2", "me")] = {
      support: 0,
      hostility: 0.9,
      voteAlignment: 0,
      samples: 4,
      reasons: [],
      lastUpdatedRound: 3,
    };

    const profile = buildCommunicationProfile(ctx.knowledge, bot.state, "p2", BOT_WEIGHTS_V26);
    expect(profile.relationship).toBeLessThan(0);
    expect(profile.style).toBe("CONSISTENCY");
  });

  it("chưa đủ mẫu thì KHÔNG đọc kiểu nào cả", () => {
    const profile = profileOf([say("a1", "p2", "An dựa vào đâu vậy")]);
    expect(profile.samples).toBeLessThan(4);
    expect(profile.style).toBeNull();
  });

  it("v25 tắt hẳn cơ chế dù quan sát bao nhiêu đi nữa", () => {
    const profile = profileOf(ANALYST_CHAT, [], BOT_WEIGHTS_V25);
    expect(profile.analyticalStyle).toBeGreaterThan(0.5);
    expect(profile.style).toBeNull();
  });

  it("kiểu luôn nằm trong tập đóng, và hồ sơ không đụng thông tin vai", () => {
    const profile = profileOf(ANALYST_CHAT);
    expect(PERSUASION_STYLES).toContain(profile.style!);
    expect(Object.keys(profile)).not.toContain("wolfProbability");
  });

  it("mọi chiều đều nằm trong miền đã khai báo", () => {
    const profile = profileOf(AGGRESSIVE_CHAT);
    for (const key of ["credibility", "influence", "aggression", "followMajority", "analyticalStyle", "persuadability"] as const) {
      expect(profile[key]).toBeGreaterThanOrEqual(0);
      expect(profile[key]).toBeLessThanOrEqual(1);
    }
    expect(profile.relationship).toBeGreaterThanOrEqual(-1);
    expect(profile.relationship).toBeLessThanOrEqual(1);
  });
});

describe("planSpeech — nói theo kiểu người nghe (§9)", () => {
  const vote: BotVoteIntention = {
    kind: "VOTE",
    choice: { type: "PLAYER", targetId: "p4" },
    confidence: 0.6,
    evidence: [],
  };

  /**
   * Bình đã để lại một hồ sơ, rồi Bình tố BOT. Trigger `ACCUSED_ME` cho ba ứng
   * viên, và câu hỏi là ứng viên nào lên đầu.
   */
  function replyTo(history: BotChatObservation[], weights = BOT_WEIGHTS_V26) {
    const bot = runtime("listen", weights);
    bot.observe(context(history, 2));

    const accusation = say("hit", "p2", "Tôi nghi An");
    const ctx = context([...history, accusation], 3);
    bot.observe(ctx);
    // Ôn hoà + không quá tò mò: `candidatesFor` cho ["DISAGREE","REPLY","ASK_EVIDENCE"],
    // nên thứ tự mặc định KHÔNG bắt đầu bằng ASK_EVIDENCE hay CHALLENGE.
    bot.state.personality.aggressiveness = 0.2;
    bot.state.personality.analyticalSkill = 0.3;
    bot.state.personality.talkativeness = 1;

    return planSpeech({
      context: ctx,
      state: bot.state,
      vote,
      style: deriveSpeechStyle(bot.state.personality),
      rng: createSeededRng("listen-say"),
      weights,
    });
  }

  it("mặc định (v25) đáp một người tố bằng DISAGREE", () => {
    expect(replyTo(ANALYST_CHAT, BOT_WEIGHTS_V25)?.kind).toBe("DISAGREE");
  });

  it("v26: với người chỉ tin căn cứ, BOT đòi căn cứ", () => {
    expect(replyTo(ANALYST_CHAT, BOT_WEIGHTS_V26)?.kind).toBe("ASK_EVIDENCE");
  });

  it("v26: chưa đủ mẫu thì vẫn nói theo tính cách của chính mình", () => {
    expect(replyTo([say("a1", "p2", "An dựa vào đâu vậy")], BOT_WEIGHTS_V26)?.kind).toBe(
      "DISAGREE",
    );
  });

  it("người nghe chỉ ĐẢO THỨ TỰ, không mở ra nước đi mới", () => {
    // `SHARED_SUSPICION` chỉ có đúng một ứng viên là AGREE; không kiểu người
    // nghe nào được phép biến nó thành CHALLENGE.
    const bot = runtime("only");
    bot.observe(context(AGGRESSIVE_CHAT, 2));
    bot.state.suspicion["p3"] = { score: 60, reasons: [], lastUpdatedRound: 3 };
    bot.state.personality.talkativeness = 1;

    const ctx = context([...AGGRESSIVE_CHAT, say("s1", "p2", "Tôi nghi Chi")], 3);
    bot.observe(ctx);

    const speech = planSpeech({
      context: ctx,
      state: bot.state,
      vote,
      style: deriveSpeechStyle(bot.state.personality),
      rng: createSeededRng("only-say"),
      weights: BOT_WEIGHTS_V26,
    });
    // Dù Bình đọc ra CHALLENGE, câu đáp cho một trigger không có CHALLENGE
    // trong danh sách thì không bao giờ là CHALLENGE.
    if (speech?.replyToActorId === "p2" && speech.targetId === "p3") {
      expect(speech.kind).not.toBe("CHALLENGE");
    }
  });
});

describe("determinism", () => {
  it("hồ sơ thuần: gọi hai lần cho cùng một kết quả", () => {
    const bot = runtime();
    bot.observe(context(ANALYST_CHAT, 2));
    const ctx = context(ANALYST_CHAT, 3);
    bot.observe(ctx);
    const first = buildCommunicationProfile(ctx.knowledge, bot.state, "p2", BOT_WEIGHTS_V26);
    const second = buildCommunicationProfile(ctx.knowledge, bot.state, "p2", BOT_WEIGHTS_V26);
    expect(first).toEqual(second);
  });

  it("không đụng tới state", () => {
    const bot = runtime();
    bot.observe(context(ANALYST_CHAT, 2));
    const ctx = context(ANALYST_CHAT, 3);
    bot.observe(ctx);
    const before = JSON.stringify(bot.state);
    buildCommunicationProfile(ctx.knowledge, bot.state, "p2", BOT_WEIGHTS_V26);
    expect(JSON.stringify(bot.state)).toBe(before);
  });
});

/** Không dùng, nhưng giữ kiểu cho rõ ý đồ của fixture. */
export type _State = BotBrainState;
