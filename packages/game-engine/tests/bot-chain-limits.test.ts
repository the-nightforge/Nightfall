import { describe, expect, it } from "vitest";
import { BotRuntime } from "../src/bot/BotRuntime";
import { DEFAULT_BOT_WEIGHTS } from "../src/bot/config/weights";
import {
  judgeChainPosition,
  type ChainLedger,
} from "../src/bot/conversation/chain-limits";
import { hasReplied } from "../src/bot/conversation/speech-memory";
import { createSeededRng } from "../src/bot/rng";
import type { BotSpeechIntention } from "../src/bot/types";

const LIMITS = DEFAULT_BOT_WEIGHTS.conversation;

function ledger(
  depths: Record<string, number> = {},
  replies: Record<string, number> = {},
): ChainLedger {
  return {
    depthOf: new Map(Object.entries(depths)),
    repliesTo: new Map(Object.entries(replies)),
  };
}

function intention(over: Partial<BotSpeechIntention> = {}): BotSpeechIntention {
  return {
    kind: "REPLY",
    targetId: "p1",
    confidence: 0.5,
    evidence: [],
    tone: "NEUTRAL",
    topic: "PROCESS",
    ...over,
  };
}

/**
 * Hai trần này là luật của CĂN PHÒNG, và cả self-play lẫn server đều phải hiểu
 * chúng theo đúng một nghĩa. Nếu mỗi bên tự đếm lấy thì "chuỗi sâu nhất là 3"
 * trong báo cáo self-play không nói được điều gì về phòng thật.
 */
describe("hai trần của một chuỗi đối đáp", () => {
  it("câu tự mở lời có độ sâu 0 và không bao giờ bị chặn", () => {
    const verdict = judgeChainPosition(undefined, ledger(), LIMITS);
    expect(verdict.depth).toBe(0);
    expect(verdict.blockedBy).toBeNull();
  });

  it("message của người thật ngầm hiểu là gốc, nên câu đáp nó sâu 1", () => {
    // Scheduler chỉ ghi độ sâu cho câu do chính nó phát. Mọi message khác -
    // người thật, hoặc câu từ trước khi phiên mở - là gốc.
    const verdict = judgeChainPosition("human-1", ledger(), LIMITS);
    expect(verdict.depth).toBe(1);
    expect(verdict.blockedBy).toBeNull();
  });

  it("độ sâu của câu đáp là độ sâu cha cộng một", () => {
    expect(judgeChainPosition("m2", ledger({ m2: 2 }), LIMITS).depth).toBe(3);
  });

  it("chạm đúng maxChainDepth thì vẫn phát", () => {
    const parentAtCeilingMinusOne = LIMITS.maxChainDepth - 1;
    const verdict = judgeChainPosition(
      "m",
      ledger({ m: parentAtCeilingMinusOne }),
      LIMITS,
    );
    expect(verdict.depth).toBe(LIMITS.maxChainDepth);
    expect(verdict.blockedBy).toBeNull();
  });

  it("vượt maxChainDepth thì bị chặn", () => {
    const verdict = judgeChainPosition("m", ledger({ m: LIMITS.maxChainDepth }), LIMITS);
    expect(verdict.depth).toBe(LIMITS.maxChainDepth + 1);
    expect(verdict.blockedBy).toBe("CHAIN_DEPTH");
  });

  it("một câu đã nhận đủ maxRepliesPerMessage thì không nhận thêm", () => {
    const full = ledger({ m: 0 }, { m: LIMITS.maxRepliesPerMessage });
    expect(judgeChainPosition("m", full, LIMITS).blockedBy).toBe("REPLIES_PER_MESSAGE");

    const oneShort = ledger({ m: 0 }, { m: LIMITS.maxRepliesPerMessage - 1 });
    expect(judgeChainPosition("m", oneShort, LIMITS).blockedBy).toBeNull();
  });

  it("số phản hồi của một message KHÔNG chặn được câu tự mở lời", () => {
    const busy = ledger({}, { "some-message": 99 });
    expect(judgeChainPosition(undefined, busy, LIMITS).blockedBy).toBeNull();
  });

  it("chạm cả hai trần thì báo độ sâu, vì đó là trần chặt hơn", () => {
    const both = ledger(
      { m: LIMITS.maxChainDepth },
      { m: LIMITS.maxRepliesPerMessage },
    );
    expect(judgeChainPosition("m", both, LIMITS).blockedBy).toBe("CHAIN_DEPTH");
  });

  it("báo lại số phản hồi cha đang có, để chỗ gọi cộng dồn mà không đếm lại", () => {
    const verdict = judgeChainPosition("m", ledger({ m: 0 }, { m: 1 }), LIMITS);
    expect(verdict.parentReplies).toBe(1);
  });
});

/**
 * Một ý định bị phòng từ chối vẫn phải để lại DẤU VẾT trong trí nhớ của BOT.
 *
 * Nếu không, con BOT sẽ thấy đúng cái trigger đó ở checkpoint sau và cố đáp lại
 * lần nữa - mãi mãi. Trần của phòng khi đó không còn là một giới hạn, nó là một
 * vòng lặp bận.
 */
describe("ý định bị từ chối phát", () => {
  const runtime = (): BotRuntime =>
    new BotRuntime({
      playerId: "me",
      rng: createSeededRng("decline"),
      playerIds: ["me", "p1", "p2"],
    });

  it("đánh dấu đã xử lý câu đó, nên BOT không thử đáp lại nữa", () => {
    const bot = runtime();
    expect(hasReplied(bot.state, "m1")).toBe(false);

    bot.declineSpeech(intention({ replyToMessageId: "m1", replyToActorId: "p1" }));

    expect(hasReplied(bot.state, "m1")).toBe(true);
  });

  it("KHÔNG ghi một bản ghi phát ngôn giả", () => {
    // Một bản ghi giả làm hỏng hai thứ cùng lúc: `speechCountInRound` tưởng BOT
    // đã nói, và cửa sổ chống lặp bị chiếm chỗ bởi một câu chưa từng phát ra.
    const bot = runtime();
    const before = bot.state.speechSequence;

    bot.declineSpeech(intention({ replyToMessageId: "m1", replyToActorId: "p1" }));

    expect(bot.state.speechMemory).toHaveLength(0);
    expect(bot.state.speechSequence).toBe(before);
  });

  it("ý định không đáp ai thì không có gì để đánh dấu", () => {
    const bot = runtime();
    bot.declineSpeech(intention({ kind: "ACCUSE", replyToMessageId: undefined }));
    expect(bot.state.speechMemory).toHaveLength(0);
    expect(bot.state.repliedMessageIds).toHaveLength(0);
  });
});
