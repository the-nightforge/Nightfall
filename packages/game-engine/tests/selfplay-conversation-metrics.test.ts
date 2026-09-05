import { describe, expect, it } from "vitest";
import type { Role } from "@masoi/shared";
import { collectMetrics } from "../src/bot/evaluation/metrics";
import { runSelfPlay, type SelfPlayEvent, type SelfPlayGame } from "../src/bot/evaluation/selfplay";
import { speechTextFingerprint } from "../src/bot/conversation/fingerprint";
import { BOT_WEIGHTS_V1 } from "../src/bot/config/weights";

function game(over: Partial<SelfPlayGame> = {}): SelfPlayGame {
  return {
    record: {
      seed: "metrics",
      playerCount: 8,
      config: {} as SelfPlayGame["record"]["config"],
      weightsVersion: BOT_WEIGHTS_V1.version,
      maxRounds: 20,
      events: false,
      speech: true,
    },
    winner: "village",
    rounds: 3,
    actions: 0,
    rejected: 0,
    skipped: 0,
    events: [],
    violations: [],
    traces: [],
    roles: { v1: "VILLAGER", v2: "VILLAGER", w1: "WEREWOLF" } as Record<string, Role>,
    ...over,
  };
}

let seq = 0;

function speech(
  round: number,
  actorId: string,
  text: string,
  over: Partial<Extract<SelfPlayEvent, { kind: "SPEECH" }>> = {},
): SelfPlayEvent {
  seq += 1;
  return {
    kind: "SPEECH",
    round,
    actorId,
    messageId: `m${seq}`,
    speech: "ACCUSE",
    targetId: "w1",
    replyToMessageId: null,
    chainDepth: 0,
    tone: "FIRM",
    text,
    textFingerprint: speechTextFingerprint(text),
    semanticFingerprint: `sem-${text}`,
    evidenceSourceIds: [],
    claimedRole: null,
    fromTemplate: true,
    ...over,
  };
}

describe("đo lặp câu chữ THẬT", () => {
  it("lặp nguyên văn được đếm riêng", () => {
    const { overall } = collectMetrics([
      game({
        events: [
          speech(1, "v1", "Tôi nghi w1."),
          speech(2, "v1", "Tôi nghi w1."),
          speech(3, "v1", "Chuyện khác hẳn."),
        ],
      }),
    ]);
    expect(overall.exactRepetitionRate).toEqual({
      value: 1 / 3,
      numerator: 1,
      denominator: 3,
    });
  });

  it("khác dấu câu và chữ hoa thì KHÔNG tính là lặp nguyên văn, nhưng tính sau chuẩn hoá", () => {
    const { overall } = collectMetrics([
      game({ events: [speech(1, "v1", "Tôi nghi w1!"), speech(2, "v1", "tôi   nghi w1")] }),
    ]);
    expect(overall.exactRepetitionRate.numerator).toBe(0);
    expect(overall.normalizedRepetitionRate.numerator).toBe(1);
  });

  it("lặp Ý mà khác chữ thì chỉ hiện ở chỉ số ngữ nghĩa", () => {
    const { overall } = collectMetrics([
      game({
        events: [
          speech(1, "v1", "Tôi nghi w1.", { semanticFingerprint: "same" }),
          speech(2, "v1", "w1 lạ lắm nhé.", { semanticFingerprint: "same" }),
        ],
      }),
    ]);
    expect(overall.exactRepetitionRate.numerator).toBe(0);
    expect(overall.normalizedRepetitionRate.numerator).toBe(0);
    expect(overall.semanticRepetitionRate.numerator).toBe(1);
  });

  it("lặp cách mở đầu bị bắt kể cả khi phần sau khác", () => {
    const { overall } = collectMetrics([
      game({
        events: [
          speech(1, "v1", "Tôi nghi w1 vì lá phiếu."),
          speech(2, "v1", "Tôi nghi w1 thật đấy."),
        ],
      }),
    ]);
    expect(overall.repeatedOpeningRate).toEqual({ value: 0.5, numerator: 1, denominator: 2 });
  });

  it("distinctOpeningRate: số cách mở đầu khác nhau trên số câu, theo từng bot trong từng ván", () => {
    const { overall } = collectMetrics([
      game({
        events: [
          speech(1, "v1", "Tôi nghi w1 vì lá phiếu."),
          speech(1, "v1", "Tôi nghi w1 thật đấy."),
          speech(2, "v1", "w1 im từ nãy giờ."),
          speech(2, "v2", "Tôi nghi w1 luôn."),
        ],
      }),
    ]);
    // v1: 3 câu, 2 cách mở đầu; v2: 1 câu, 1 cách. (2 + 1) / 4.
    expect(overall.distinctOpeningRate).toEqual({ value: 0.75, numerator: 3, denominator: 4 });
  });

  it("fromTemplateRate đếm đúng cờ trên từng câu, không phải một hằng số", () => {
    const { overall } = collectMetrics([
      game({
        events: [
          speech(1, "v1", "Tôi nghi w1 vì lá phiếu."),
          speech(1, "v2", "w1 im từ nãy giờ.", { fromTemplate: false }),
        ],
      }),
    ]);
    expect(overall.fromTemplateRate).toEqual({ value: 0.5, numerator: 1, denominator: 2 });
  });

  it("nhắm mãi một người bị đếm riêng", () => {
    const { overall } = collectMetrics([
      game({
        events: [
          speech(1, "v1", "a", { targetId: "w1" }),
          speech(2, "v1", "b", { targetId: "w1" }),
          speech(3, "v1", "c", { targetId: "v2" }),
        ],
      }),
    ]);
    expect(overall.consecutiveSameTargetRate.numerator).toBe(1);
  });

  it("lặp của người này không tính sang người kia", () => {
    const { overall } = collectMetrics([
      game({ events: [speech(1, "v1", "Cùng một câu."), speech(1, "v2", "Cùng một câu.")] }),
    ]);
    expect(overall.exactRepetitionRate.numerator).toBe(0);
  });
});

describe("đo mức độ hội thoại", () => {
  it("tỉ lệ trả lời tính trên tổng số câu", () => {
    const { overall } = collectMetrics([
      game({
        events: [
          speech(1, "v1", "a"),
          speech(1, "v2", "b", { replyToMessageId: "m-x", chainDepth: 1 }),
        ],
      }),
    ]);
    expect(overall.replyRate).toEqual({ value: 0.5, numerator: 1, denominator: 2 });
  });

  it("tỉ lệ đáp câu hỏi trực tiếp dùng mẫu số là số câu hỏi trực tiếp", () => {
    const asked = speech(1, "v1", "v2 nghĩ sao?", { speech: "QUESTION", targetId: "v2" });
    const { overall } = collectMetrics([
      game({
        events: [
          asked,
          speech(1, "v2", "tôi đây", {
            speech: "REPLY",
            replyToMessageId: (asked as Extract<SelfPlayEvent, { kind: "SPEECH" }>).messageId,
            chainDepth: 1,
          }),
          speech(1, "v1", "v2 im à?", { speech: "QUESTION", targetId: "v2" }),
        ],
      }),
    ]);
    expect(overall.directQuestionResponseRate).toEqual({
      value: 0.5,
      numerator: 1,
      denominator: 2,
    });
  });

  it("chuỗi hội thoại dài nhất được đo đúng", () => {
    const { overall } = collectMetrics([
      game({
        events: [
          speech(1, "v1", "a", { chainDepth: 0 }),
          speech(1, "v2", "b", { chainDepth: 1, replyToMessageId: "m1" }),
          speech(1, "v1", "c", { chainDepth: 2, replyToMessageId: "m2" }),
          speech(1, "v2", "d", { chainDepth: 3, replyToMessageId: "m3" }),
        ],
      }),
    ]);
    expect(overall.maxDialogueChainLength).toBe(3);
  });

  it("số tin trung bình mỗi BOT mỗi ngày", () => {
    const { overall } = collectMetrics([
      game({
        rounds: 2,
        events: [
          speech(1, "v1", "a"),
          speech(1, "v1", "b"),
          speech(2, "v2", "c"),
        ],
      }),
    ]);
    // Ba câu, ba cặp (vòng, người) có phát ngôn: v1@1 nói 2, v2@2 nói 1.
    expect(overall.messagesPerBotPerDay).toBeCloseTo(1.5, 5);
  });

  it("mẫu số 0 vẫn cho ra null, không phải 0", () => {
    const { overall } = collectMetrics([game({ events: [] })]);
    expect(overall.exactRepetitionRate.value).toBeNull();
    expect(overall.replyRate.value).toBeNull();
    expect(overall.directQuestionResponseRate.value).toBeNull();
    expect(overall.messagesPerBotPerDay).toBeNull();
    expect(overall.maxDialogueChainLength).toBe(0);
  });

  it("giữ chỉ số cũ của Phase 3 để còn so dọc được", () => {
    const { overall } = collectMetrics([
      game({ events: [speech(1, "v1", "a"), speech(2, "v1", "b")] }),
    ]);
    expect(overall.speechRepetitionRate.denominator).toBe(2);
  });
});

describe("đo trên ván thật", () => {
  const games = Array.from({ length: 12 }, (_, i) => runSelfPlay({ seed: `metric-real-${i}` }));
  const { overall } = collectMetrics(games);

  it("có đủ mẫu để kết luận", () => {
    expect(overall.exactRepetitionRate.denominator).toBeGreaterThan(80);
  });

  it("không còn lặp nguyên văn đáng kể", () => {
    expect(overall.exactRepetitionRate.value).toBeLessThanOrEqual(0.05);
  });

  it("thật sự có đối thoại", () => {
    expect(overall.replyRate.value ?? 0).toBeGreaterThan(0);
  });

  it("không ai nói quá hạn mức trung bình", () => {
    expect(overall.messagesPerBotPerDay ?? 0).toBeLessThanOrEqual(3);
  });

  it("không có chuỗi hội thoại dài bất thường", () => {
    expect(overall.maxDialogueChainLength).toBeLessThanOrEqual(4);
  });

  it("self-play chạy hoàn toàn bằng mẫu câu, không gọi mạng", () => {
    expect(overall.fromTemplateRate.value).toBe(1);
    expect(overall.fromTemplateRate.denominator).toBeGreaterThan(0);
  });

  it("phần lớn câu của một bot trong một ván mở đầu khác nhau", () => {
    // Task A/B tồn tại để đẩy số này lên. 0.6 thấp hơn hẳn mức đo được, đủ để
    // bắt một hồi quy về bảng mẫu bốn câu chứ không đỏ vì đổi một mẫu.
    expect(overall.distinctOpeningRate.value).toBeGreaterThan(0.6);
  });
});
