import { describe, expect, it } from "vitest";
import { DEFAULT_BOT_WEIGHTS, resolveWeights } from "../src/bot/config/weights";
import { createBotBrainState } from "../src/bot/memory/memory-store";
import { createBotPersonality } from "../src/bot/personality/personality";
import { createSeededRng } from "../src/bot/rng";
import {
  RECENT_OPENING_WINDOW,
  hasRecentOpening,
  hasRecentSemantic,
  hasReplied,
  markReplied,
  recentOpenings,
  recentSpeechSourceIds,
  recordSpeechIntention,
} from "../src/bot/conversation/speech-memory";
import { speechSemanticFingerprint } from "../src/bot/conversation/fingerprint";
import type { BotBrainState, BotSpeechIntention } from "../src/bot/types";

function state(): BotBrainState {
  return createBotBrainState(
    "me",
    createBotPersonality(createSeededRng("style")),
    ["me", "p1", "p2"],
  );
}

function intention(over: Partial<BotSpeechIntention> = {}): BotSpeechIntention {
  return {
    kind: "ACCUSE",
    targetId: "p1",
    confidence: 0.5,
    evidence: [],
    tone: "FIRM",
    topic: "SUSPICION",
    ...over,
  };
}

describe("ghi nhớ lời đã nói", () => {
  it("QUESTION được ghi nhớ thật, không phải một danh sách rỗng", () => {
    // Đây là nguyên nhân #4 trong audit: QUESTION và WITHHOLD không có evidence
    // nên Phase 3 lưu chúng thành `sourceIds: []` - một bản ghi không phân biệt
    // được với bản ghi khác, nên BOT lặp lại câu hỏi đó mãi.
    const brain = state();
    const speech = intention({ kind: "QUESTION", evidence: [] });
    recordSpeechIntention(brain, speech, 1, DEFAULT_BOT_WEIGHTS);

    const record = brain.speechMemory.at(-1)!;
    expect(record.kind).toBe("QUESTION");
    expect(record.targetId).toBe("p1");
    expect(record.semanticFingerprint).toBe(speechSemanticFingerprint(speech));
    expect(record.semanticFingerprint.length).toBeGreaterThan(0);
  });

  it("WITHHOLD cũng có bản ghi riêng, phân biệt được với QUESTION", () => {
    const brain = state();
    recordSpeechIntention(brain, intention({ kind: "QUESTION" }), 1, DEFAULT_BOT_WEIGHTS);
    recordSpeechIntention(
      brain,
      intention({ kind: "WITHHOLD", targetId: undefined, topic: "PROCESS" }),
      1,
      DEFAULT_BOT_WEIGHTS,
    );

    const [first, second] = brain.speechMemory;
    expect(second!.kind).toBe("WITHHOLD");
    expect(second!.targetId).toBeNull();
    expect(second!.semanticFingerprint).not.toBe(first!.semanticFingerprint);
  });

  it("seq tăng đơn điệu và không đến từ đồng hồ", () => {
    const brain = state();
    for (let round = 1; round <= 4; round += 1) {
      recordSpeechIntention(brain, intention({ targetId: `p${round % 2 ? 1 : 2}` }), round, DEFAULT_BOT_WEIGHTS);
    }
    expect(brain.speechMemory.map((item) => item.seq)).toEqual([0, 1, 2, 3]);
    expect(brain.speechSequence).toBe(4);
  });

  it("giữ đúng cửa sổ, bỏ bản ghi cũ nhất", () => {
    const weights = resolveWeights({ conversation: { memoryWindow: 3 } });
    const brain = state();
    for (let i = 0; i < 6; i += 1) {
      recordSpeechIntention(brain, intention({ replyToMessageId: `m${i}` }), 1, weights);
    }
    expect(brain.speechMemory).toHaveLength(3);
    expect(brain.speechMemory.map((item) => item.seq)).toEqual([3, 4, 5]);
  });

  it("nhận vân tay văn bản do chỗ gọi cấp, và giữ null khi chưa render", () => {
    const brain = state();
    recordSpeechIntention(brain, intention(), 1, DEFAULT_BOT_WEIGHTS);
    expect(brain.speechMemory.at(-1)!.textFingerprint).toBeNull();
    expect(brain.speechMemory.at(-1)!.opening).toBeNull();

    recordSpeechIntention(brain, intention({ targetId: "p2" }), 1, DEFAULT_BOT_WEIGHTS, "Ừ, tôi nghi Bình");
    const record = brain.speechMemory.at(-1)!;
    expect(record.textFingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(record.opening).toBe("tôi nghi bình");
  });

  it("KHÔNG lưu raw chat vào state", () => {
    const brain = state();
    recordSpeechIntention(
      brain,
      intention(),
      1,
      DEFAULT_BOT_WEIGHTS,
      "một câu rất đặc trưng không được xuất hiện ở đâu cả",
    );
    expect(JSON.stringify(brain)).not.toContain("một câu rất đặc trưng");
  });
});

describe("hasRecentSemantic", () => {
  const weights = resolveWeights({
    conversation: { semanticCooldownRounds: 2, semanticCooldownCount: 6 },
  });

  it("bắt được ý vừa nói trong cùng vòng", () => {
    const brain = state();
    const speech = intention();
    recordSpeechIntention(brain, speech, 3, weights);
    expect(hasRecentSemantic(brain, speechSemanticFingerprint(speech), 3, weights)).toBe(true);
  });

  it("hết hạn khi qua đủ số vòng", () => {
    // `semanticCooldownRounds: 2` nghĩa là bị khoá trong ĐÚNG hai vòng: vòng
    // vừa nói và vòng kế tiếp. Sang vòng thứ ba thì ý cũ lại đáng nói.
    const brain = state();
    const speech = intention();
    recordSpeechIntention(brain, speech, 1, weights);
    expect(hasRecentSemantic(brain, speechSemanticFingerprint(speech), 1, weights)).toBe(true);
    expect(hasRecentSemantic(brain, speechSemanticFingerprint(speech), 2, weights)).toBe(true);
    expect(hasRecentSemantic(brain, speechSemanticFingerprint(speech), 3, weights)).toBe(false);
  });

  it("hết hạn khi đã có đủ số câu chen vào, dù cùng vòng", () => {
    // Cửa sổ KÉP. Chỉ theo vòng thì trong một vòng thảo luận dài BOT vẫn lặp.
    const narrow = resolveWeights({
      conversation: { semanticCooldownRounds: 9, semanticCooldownCount: 2 },
    });
    const brain = state();
    const speech = intention();
    recordSpeechIntention(brain, speech, 1, narrow);
    recordSpeechIntention(brain, intention({ targetId: "p2" }), 1, narrow);
    recordSpeechIntention(brain, intention({ kind: "QUESTION" }), 1, narrow);
    expect(hasRecentSemantic(brain, speechSemanticFingerprint(speech), 1, narrow)).toBe(false);
  });

  it("cửa sổ bằng 0 tắt hẳn cơ chế - đúng hành vi Phase 3", () => {
    const off = resolveWeights({
      conversation: { semanticCooldownRounds: 0, semanticCooldownCount: 0 },
    });
    const brain = state();
    const speech = intention();
    recordSpeechIntention(brain, speech, 1, off);
    expect(hasRecentSemantic(brain, speechSemanticFingerprint(speech), 1, off)).toBe(false);
  });
});

describe("đã trả lời message nào rồi", () => {
  it("đánh dấu rồi thì nhớ", () => {
    const brain = state();
    expect(hasReplied(brain, "m1")).toBe(false);
    markReplied(brain, "m1", DEFAULT_BOT_WEIGHTS);
    expect(hasReplied(brain, "m1")).toBe(true);
  });

  it("có trần, không phình theo độ dài ván", () => {
    const weights = resolveWeights({ conversation: { memoryWindow: 4 } });
    const brain = state();
    for (let i = 0; i < 40; i += 1) markReplied(brain, `m${i}`, weights);
    expect(brain.repliedMessageIds.length).toBeLessThanOrEqual(4 * 4);
    expect(hasReplied(brain, "m39")).toBe(true);
  });
});

describe("đọc lại lịch sử cho prompt", () => {
  it("recentSpeechSourceIds cắt theo cửa sổ chứ không trải phẳng cả ván", () => {
    // Audit A2: `flatMap` toàn bộ speechMemory khiến prompt phình theo độ dài
    // ván, và danh sách "đừng lặp lại" dài tới mức vô nghĩa.
    const brain = state();
    for (let i = 0; i < 10; i += 1) {
      recordSpeechIntention(
        brain,
        intention({
          evidence: [
            {
              id: `e${i}`,
              kind: "ACCUSE",
              sourceId: `src${i}`,
              actorId: "p2",
              targetId: "p1",
              weight: 4,
              confidence: 0.4,
              round: 1,
              summary: "x",
            },
          ],
        }),
        1,
        DEFAULT_BOT_WEIGHTS,
      );
    }
    const ids = recentSpeechSourceIds(brain, 3);
    expect(ids).toEqual(["src7", "src8", "src9"]);
  });

  it("recentOpenings chỉ trả về cách mở đầu đã biết", () => {
    const brain = state();
    recordSpeechIntention(brain, intention(), 1, DEFAULT_BOT_WEIGHTS);
    recordSpeechIntention(brain, intention({ targetId: "p2" }), 1, DEFAULT_BOT_WEIGHTS, "Tôi nghi Bình vì lá phiếu");
    expect(recentOpenings(brain, 5)).toEqual(["tôi nghi bình"]);
  });

  describe("hasRecentOpening", () => {
    it("nhận ra cách mở đầu đã dùng trong cửa sổ", () => {
      const brain = state();
      recordSpeechIntention(brain, intention(), 1, DEFAULT_BOT_WEIGHTS, "Tôi nghi Bình vì lá phiếu");
      expect(hasRecentOpening(brain, "tôi nghi bình")).toBe(true);
      expect(hasRecentOpening(brain, "bình đáng ngờ")).toBe(false);
    });

    it("bản ghi chưa có văn bản không tính", () => {
      const brain = state();
      recordSpeechIntention(brain, intention(), 1, DEFAULT_BOT_WEIGHTS);
      expect(hasRecentOpening(brain, "tôi nghi bình")).toBe(false);
    });

    it("chỉ nhìn đúng cửa sổ 5 lượt gần nhất", () => {
      const brain = state();
      recordSpeechIntention(brain, intention(), 1, DEFAULT_BOT_WEIGHTS, "Tôi nghi Bình vì lá phiếu");
      for (let i = 0; i < RECENT_OPENING_WINDOW; i += 1) {
        recordSpeechIntention(
          brain,
          intention({ targetId: `p${i}` }),
          1,
          DEFAULT_BOT_WEIGHTS,
          `Câu số ${i} khác hẳn`,
        );
      }
      expect(hasRecentOpening(brain, "tôi nghi bình")).toBe(false);
      expect(RECENT_OPENING_WINDOW).toBe(5);
    });
  });
});
