import { describe, expect, it } from "vitest";
import { analyzeChat } from "../src/bot/analysis/chat-analysis";
import { BOT_WEIGHTS_PRESETS } from "../src/bot/config/presets";
import { BOT_WEIGHTS_V31, type BotWeights } from "../src/bot/config/weights";
import { planSpeech } from "../src/bot/conversation/speech-planner";
import { createBotBrainState, remember } from "../src/bot/memory/memory-store";
import { deriveSpeechStyle } from "../src/bot/personality/speech-style";
import type { BotDecisionContext, BotEvidence, BotPersonality, BotVoteIntention } from "../src/bot/types";

type PublicVoteChoice = BotVoteIntention["choice"];

/**
 * Bị hỏi "nghi ai" thì nói ra mình nghi ai (`conversation.answerWithSuspect`).
 *
 * Trước knob này, câu đáp theo trigger KHÔNG mang mục tiêu hay bằng chứng nào,
 * nên "Bình nghi ai nhất?" nhận về "Về câu của An thì tôi thấy thường thôi".
 */

const PLAYERS = [
  { id: "p1", name: "An", alive: true },
  { id: "p2", name: "Bình", alive: true },
  { id: "p3", name: "Chi", alive: true },
];

const PERSONALITY: BotPersonality = {
  aggressiveness: 0.5,
  talkativeness: 0.9,
  riskTolerance: 0.5,
  deceptionSkill: 0.5,
  analyticalSkill: 0.5,
  loyalty: 0.5,
  stubbornness: 0.5,
};

const ON: BotWeights = {
  ...BOT_WEIGHTS_V31,
  conversation: { ...BOT_WEIGHTS_V31.conversation, answerWithSuspect: 1 },
};

const EVIDENCE: BotEvidence = {
  id: "e1",
  kind: "LATE_SWITCH",
  sourceId: "vote-1",
  actorId: "p3",
  targetId: "p3",
  weight: 1,
  confidence: 0.6,
  round: 1,
  summary: "Đổi phiếu phút chót.",
};

function plan(question: string, choice: PublicVoteChoice, weights: BotWeights, evidence: BotEvidence[] = [EVIDENCE]) {
  const context: BotDecisionContext = {
    knowledge: {
      activeEventId: null,
      neutralRolesInPlay: [],
      botId: "p2",
      round: 2,
      phase: "DAY_DISCUSSION",
      phaseStartedAt: 0,
      phaseEndsAt: 60_000,
      selfRole: "VILLAGER",
      players: PLAYERS,
      knownRoles: { p2: "VILLAGER" },
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
    visibleChat: [{ id: "q1", actorId: "p1", text: question, at: 1 }],
  };
  const state = createBotBrainState("p2", PERSONALITY, ["p1", "p2", "p3"]);
  for (const memory of analyzeChat(context.visibleChat, PLAYERS, { round: 2, phase: "DAY_DISCUSSION", weights })) {
    remember(state, memory, weights);
  }
  const vote: BotVoteIntention = { kind: "VOTE", choice, confidence: 0.7, evidence };
  return planSpeech({ context, state, vote, style: deriveSpeechStyle(PERSONALITY), rng: () => 0, weights });
}

const SUSPECT: PublicVoteChoice = { type: "PLAYER", targetId: "p3" };

/** Câu đáp cũ: vẫn là một câu ĐÁP (có `replyTo`), nhưng không phải lời tố. */
function expectOldReply(speech: ReturnType<typeof plan>) {
  expect(speech?.kind).not.toBe("ACCUSE");
  expect(speech?.replyToMessageId).toBe("q1");
}

describe("answerWithSuspect", () => {
  it("bị hỏi nghi ai thì nêu đúng mục tiêu phiếu kèm căn cứ, như một câu đáp", () => {
    const speech = plan("Bình ơi, nghi ai nhất?", SUSPECT, ON);
    expect(speech).toMatchObject({ kind: "ACCUSE", targetId: "p3", replyToMessageId: "q1", replyToActorId: "p1" });
    expect(speech?.evidence.map((item) => item.id)).toEqual(["e1"]);
  });

  it("\"bầu ai\" - có dấu lẫn không dấu - là câu hỏi nghi ai", () => {
    expect(plan("Bình ơi, bầu ai?", SUSPECT, ON)).toMatchObject({ kind: "ACCUSE", targetId: "p3" });
    expect(plan("Binh oi bau ai", SUSPECT, ON)).toMatchObject({ kind: "ACCUSE", targetId: "p3" });
  });

  it("câu hỏi về lá phiếu cũng được đáp bằng lá phiếu", () => {
    expect(plan("Bình vote ai?", SUSPECT, ON)).toMatchObject({ kind: "ACCUSE", targetId: "p3", replyToMessageId: "q1" });
  });

  it("không còn căn cứ nào chưa nói thì không tố trần, rơi về câu đáp cũ", () => {
    expectOldReply(plan("Bình nghi ai nhất?", SUSPECT, ON, []));
  });

  it("phiếu không nhắm ai thì đáp là chưa chốt", () => {
    expect(plan("Bình nghi ai nhất?", { type: "NO_ELIMINATION" }, ON)).toMatchObject({
      kind: "WITHHOLD",
      replyToMessageId: "q1",
    });
  });

  it("câu hỏi chung chung không bị đáp bằng một lời tố", () => {
    expectOldReply(plan("Bình nghĩ sao?", SUSPECT, ON));
  });

  it("câu hỏi về vai không bị đáp bằng một lời tố", () => {
    expect(plan("Bình vai gì?", SUSPECT, ON)?.kind).not.toBe("ACCUSE");
  });

  it("knob tắt (v31) giữ nguyên câu đáp cũ", () => {
    expectOldReply(plan("Bình ơi, nghi ai nhất?", SUSPECT, BOT_WEIGHTS_V31));
  });

  it("v33 là v31 cộng đúng knob này", () => {
    expect(BOT_WEIGHTS_PRESETS["33.0.0"]).toEqual({ ...ON, version: "33.0.0" });
  });
});
