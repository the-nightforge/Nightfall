import { describe, expect, it } from "vitest";
import {
  BOT_SPEECH_KINDS,
  BOT_SPEECH_TONES,
  BOT_SPEECH_TOPICS,
  assertSpeechScope,
} from "../src/bot/types";
import type {
  BotChatObservation,
  BotEvidence,
  BotSpeechIntention,
  BotSpeechKind,
} from "../src/bot/types";
import { renderIntentionText } from "../src/bot/evaluation/selfplay";

const PLAYERS = [
  { id: "p1", name: "An", alive: true },
  { id: "p2", name: "Bình", alive: true },
  { id: "p3", name: "Chi", alive: false },
];

const CHAT: BotChatObservation[] = [
  { id: "m1", actorId: "p2", text: "tôi nghi An", at: 10 },
];

function evidence(sourceId: string): BotEvidence {
  return {
    id: `${sourceId}:ACCUSE:x`,
    kind: "ACCUSE",
    sourceId,
    actorId: "p2",
    targetId: "p1",
    weight: 4,
    confidence: 0.45,
    round: 1,
    summary: "Công khai buộc tội người này.",
  };
}

function intention(over: Partial<BotSpeechIntention> = {}): BotSpeechIntention {
  return {
    kind: "ACCUSE",
    targetId: "p1",
    confidence: 0.5,
    evidence: [],
    tone: "NEUTRAL",
    ...over,
  };
}

describe("bảng speech act", () => {
  it("có đúng mười hai loại mà thiết kế Phase 4 liệt kê", () => {
    expect([...BOT_SPEECH_KINDS].sort()).toEqual(
      [
        "ACCUSE",
        "AGREE",
        "ASK_EVIDENCE",
        "CHALLENGE",
        "CHANGE_MIND",
        "DEFEND",
        "DISAGREE",
        "HUMOR",
        "QUESTION",
        "REACTION",
        "REPLY",
        "WITHHOLD",
      ].sort(),
    );
  });

  it("tone và topic là tập đóng, không phải chuỗi tự do", () => {
    expect(BOT_SPEECH_TONES.length).toBeGreaterThanOrEqual(5);
    expect(BOT_SPEECH_TOPICS.length).toBeGreaterThanOrEqual(5);
    expect(new Set(BOT_SPEECH_TONES).size).toBe(BOT_SPEECH_TONES.length);
    expect(new Set(BOT_SPEECH_TOPICS).size).toBe(BOT_SPEECH_TOPICS.length);
  });

  it("mọi loại đều diễn đạt được thành câu, không loại nào rơi ra undefined", () => {
    // Bảo vệ chống đúng lỗi A3 trong audit: `renderIntentionText` là một switch
    // không có default. Nới union mà quên một nhánh sẽ cho ra `undefined` chạy
    // thẳng vào chat log.
    for (const kind of BOT_SPEECH_KINDS) {
      const text = renderIntentionText(intention({ kind }), (id) => `Tên ${id}`);
      expect(typeof text, kind).toBe("string");
      expect(text.trim().length, kind).toBeGreaterThan(0);
    }
  });
});

describe("assertSpeechScope", () => {
  const scope = { players: PLAYERS, chat: CHAT, seenSourceIds: ["m1", "recap:1"] };

  it("chấp nhận một ý định Phase 3 hợp lệ", () => {
    expect(
      assertSpeechScope(intention({ evidence: [evidence("recap:1")] }), scope),
    ).toEqual([]);
  });

  it("từ chối target không có trong danh sách người chơi", () => {
    expect(assertSpeechScope(intention({ targetId: "ghost" }), scope)).toContain(
      "targetId không có trong knowledge: ghost",
    );
  });

  it("từ chối reply tới một message chưa từng thấy", () => {
    expect(
      assertSpeechScope(intention({ kind: "REPLY", replyToMessageId: "m404" }), scope),
    ).toContain("replyToMessageId không có trong chat đã lọc: m404");
  });

  it("từ chối evidence có nguồn chưa từng quan sát", () => {
    expect(
      assertSpeechScope(intention({ evidence: [evidence("bịa-ra")] }), scope),
    ).toContain("evidence.sourceId chưa từng được quan sát: bịa-ra");
  });

  it("từ chối bằng chứng gắn vào loại không mang luận điểm", () => {
    // HUMOR / REACTION / WITHHOLD không nói điều gì kiểm chứng được. Cho chúng
    // mang evidence là mở một kênh rò rỉ không ai nhìn vào.
    for (const kind of ["HUMOR", "REACTION", "WITHHOLD"] as BotSpeechKind[]) {
      const problems = assertSpeechScope(
        intention({ kind, evidence: [evidence("m1")] }),
        scope,
      );
      expect(problems.join(" "), kind).toContain("không được mang bằng chứng");
    }
  });

  it("từ chối replyToActorId là người không tồn tại", () => {
    expect(
      assertSpeechScope(intention({ kind: "REPLY", replyToActorId: "ghost" }), scope),
    ).toContain("replyToActorId không có trong knowledge: ghost");
  });
});
