import { describe, expect, it } from "vitest";
import { BotRuntime } from "../src/bot/BotRuntime";
import { planSpeech } from "../src/bot/conversation/speech-planner";
import { recordSpeechIntention } from "../src/bot/conversation/speech-memory";
import { deriveSpeechStyle } from "../src/bot/personality/speech-style";
import { BOT_WEIGHTS_V27, BOT_WEIGHTS_V28 } from "../src/bot/config/weights";
import { createSeededRng } from "../src/bot/rng";
import type {
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

function context(round = 2): BotDecisionContext {
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
    visibleChat: [],
  };
}

const vote: BotVoteIntention = {
  kind: "VOTE",
  choice: { type: "PLAYER", targetId: "p3" },
  confidence: 0.6,
  evidence: [],
};

/**
 * BOT đã nói cạn về Chi (mục tiêu phiếu): cả `ACCUSE` lẫn `QUESTION` về Chi đều
 * nằm trong cửa sổ chống lặp, nên đường tự mở lời hết ứng viên.
 */
function talkedOutAboutChi(weights = BOT_WEIGHTS_V28, suspects: Record<string, number> = {}) {
  const bot = new BotRuntime({
    playerId: "me",
    rng: createSeededRng("redirect"),
    playerIds: PLAYERS.map((player) => player.id),
    weights,
  });
  const ctx = context(2);
  bot.observe(ctx);
  bot.state.personality.talkativeness = 1;

  for (const [id, score] of Object.entries(suspects)) {
    bot.state.suspicion[id] = { score, reasons: [], lastUpdatedRound: 2 };
  }

  // Ghi ở vòng 1, lên kế hoạch ở vòng 2: cửa sổ chống lặp còn chặn (2 vòng),
  // nhưng hạn mức lượt nói của VÒNG 2 vẫn còn nguyên - đúng tình huống mà
  // nhánh chuyển hướng sinh ra để xử.
  for (const kind of ["ACCUSE", "QUESTION"] as const) {
    recordSpeechIntention(
      bot.state,
      { kind, targetId: "p3", topic: "SUSPICION", confidence: 0.6, evidence: [], tone: "FIRM" },
      1,
      weights,
    );
  }

  return planSpeech({
    context: ctx,
    state: bot.state,
    vote,
    style: deriveSpeechStyle(bot.state.personality),
    rng: createSeededRng("redirect-say"),
    weights,
  });
}

describe("§24 — cạn chuyện thì đổi chiến thuật, không chỉ đổi cách nói", () => {
  it("v27 im lặng (hoặc buông một câu vu vơ) khi đã nói hết về mục tiêu", () => {
    const speech = talkedOutAboutChi(BOT_WEIGHTS_V27, { p2: 30 });
    expect(speech?.kind).not.toBe("QUESTION");
  });

  it("v28 quay sang hỏi người mình cũng đang nghi", () => {
    const speech = talkedOutAboutChi(BOT_WEIGHTS_V28, { p2: 30 });
    expect(speech?.kind).toBe("QUESTION");
    expect(speech?.targetId).toBe("p2");
    expect(speech?.reason).toContain("chuyển sang người khác");
  });

  it("chọn người NGHI NHẤT trước", () => {
    const speech = talkedOutAboutChi(BOT_WEIGHTS_V28, { p2: 10, p4: 50 });
    expect(speech?.targetId).toBe("p4");
  });

  it("KHÔNG hỏi người mình chẳng có ý kiến gì — đó là câu độn, không phải chiến thuật", () => {
    const speech = talkedOutAboutChi(BOT_WEIGHTS_V28, {});
    expect(speech?.kind).not.toBe("QUESTION");
  });

  it("không bao giờ quay lại chính mục tiêu phiếu, và không tự hỏi mình", () => {
    const speech = talkedOutAboutChi(BOT_WEIGHTS_V28, { p2: 30, p3: 90, me: 90 });
    expect(speech?.targetId).not.toBe("p3");
    expect(speech?.targetId).not.toBe("me");
  });

  it("người đã chết không được hỏi", () => {
    const bot = new BotRuntime({
      playerId: "me",
      rng: createSeededRng("dead"),
      playerIds: PLAYERS.map((player) => player.id),
      weights: BOT_WEIGHTS_V28,
    });
    const ctx: BotDecisionContext = {
      knowledge: {
        ...context(2).knowledge,
        players: PLAYERS.map((player) =>
          player.id === "p2" ? { ...player, alive: false } : player,
        ),
      },
      visibleChat: [],
    };
    bot.observe(ctx);
    bot.state.personality.talkativeness = 1;
    bot.state.suspicion["p2"] = { score: 90, reasons: [], lastUpdatedRound: 2 };
    for (const kind of ["ACCUSE", "QUESTION"] as const) {
      recordSpeechIntention(
        bot.state,
        { kind, targetId: "p3", topic: "SUSPICION", confidence: 0.6, evidence: [], tone: "FIRM" },
        1,
        BOT_WEIGHTS_V28,
      );
    }

    const speech = planSpeech({
      context: ctx,
      state: bot.state,
      vote,
      style: deriveSpeechStyle(bot.state.personality),
      rng: createSeededRng("dead-say"),
      weights: BOT_WEIGHTS_V28,
    });
    expect(speech?.targetId).not.toBe("p2");
  });

  it("hết gần hạn mức lượt nói thì KHÔNG chuyển hướng — để dành lượt mà đáp người khác", () => {
    const bot = new BotRuntime({
      playerId: "me",
      rng: createSeededRng("budget"),
      playerIds: PLAYERS.map((player) => player.id),
      weights: BOT_WEIGHTS_V28,
    });
    const ctx = context(2);
    bot.observe(ctx);
    bot.state.personality.talkativeness = 1;
    bot.state.suspicion["p2"] = { score: 30, reasons: [], lastUpdatedRound: 2 };

    // Hai câu đã nói TRONG VÒNG NÀY: hạn mức là 3, nên chỉ còn đúng một lượt -
    // và lượt đó phải để dành cho việc đáp, không tiêu vào câu chuyển hướng.
    for (const kind of ["ACCUSE", "QUESTION"] as const) {
      recordSpeechIntention(
        bot.state,
        { kind, targetId: "p3", topic: "SUSPICION", confidence: 0.6, evidence: [], tone: "FIRM" },
        2,
        BOT_WEIGHTS_V28,
      );
    }

    const speech = planSpeech({
      context: ctx,
      state: bot.state,
      vote,
      style: deriveSpeechStyle(bot.state.personality),
      rng: createSeededRng("budget-say"),
      weights: BOT_WEIGHTS_V28,
    });
    expect(speech?.targetId).not.toBe("p2");
  });

  it("hỏi rồi thì lần sau không hỏi lại đúng người đó", () => {
    const bot = new BotRuntime({
      playerId: "me",
      rng: createSeededRng("twice"),
      playerIds: PLAYERS.map((player) => player.id),
      weights: BOT_WEIGHTS_V28,
    });
    const ctx = context(2);
    bot.observe(ctx);
    bot.state.personality.talkativeness = 1;
    bot.state.suspicion["p2"] = { score: 30, reasons: [], lastUpdatedRound: 2 };
    bot.state.suspicion["p4"] = { score: 20, reasons: [], lastUpdatedRound: 2 };

    for (const [kind, target] of [
      ["ACCUSE", "p3"],
      ["QUESTION", "p3"],
      ["QUESTION", "p2"],
    ] as const) {
      recordSpeechIntention(
        bot.state,
        { kind, targetId: target, topic: "SUSPICION", confidence: 0.6, evidence: [], tone: "FIRM" },
        1,
        BOT_WEIGHTS_V28,
      );
    }

    const speech = planSpeech({
      context: ctx,
      state: bot.state,
      vote,
      style: deriveSpeechStyle(bot.state.personality),
      rng: createSeededRng("twice-say"),
      weights: BOT_WEIGHTS_V28,
    });
    // Bình đã hỏi rồi -> cơ chế chống lặp loại; rơi xuống Dũng.
    expect(speech?.targetId).toBe("p4");
  });
});
