import { describe, expect, it } from "vitest";
import { runSelfPlay, type SelfPlayEvent, type SelfPlayGame } from "../src/bot/evaluation/selfplay";
import { collectMetrics } from "../src/bot/evaluation/metrics";

type Speech = Extract<SelfPlayEvent, { kind: "SPEECH" }>;

const BASE = runSelfPlay({ seed: "prod-metrics" });
const FIRST_SPEECH = BASE.events.find((e): e is Speech => e.kind === "SPEECH")!;

function withEvents(extra: SelfPlayEvent[]): SelfPlayGame {
  return { ...BASE, events: [...BASE.events, ...extra] };
}

function humanQuestion(outcome: "ANSWERED" | "NO_TURN"): SelfPlayEvent {
  return {
    kind: "QUESTION_OUTCOME",
    round: 1,
    messageId: `h-${outcome}`,
    askerId: "human",
    targetId: FIRST_SPEECH.actorId,
    outcome,
    humanAsker: true,
  };
}

function providerLine(text: string, messageId: string): SelfPlayEvent {
  return { ...FIRST_SPEECH, messageId, text, fromTemplate: false };
}

describe("collectMetrics — câu hỏi của người thật", () => {
  it("đi bảng riêng, không lẫn vào bảng bot hỏi bot", () => {
    const base = collectMetrics([BASE]).overall;
    const mixed = collectMetrics([withEvents([humanQuestion("ANSWERED"), humanQuestion("NO_TURN")])]).overall;
    expect(mixed.directQuestionOutcomes).toEqual(base.directQuestionOutcomes);
    expect(mixed.humanQuestionOutcomes.ANSWERED).toEqual({ value: 0.5, numerator: 1, denominator: 2 });
    expect(mixed.humanQuestionOutcomes.NO_TURN).toEqual({ value: 0.5, numerator: 1, denominator: 2 });
  });

  it("self-play không có người hỏi: mẫu số 0, giá trị null", () => {
    const m = collectMetrics([BASE]).overall;
    expect(m.humanQuestionOutcomes.ANSWERED).toEqual({ value: null, numerator: 0, denominator: 0 });
  });
});

describe("collectMetrics — giọng của riêng nhà cung cấp", () => {
  it("chỉ đếm câu fromTemplate === false", () => {
    const m = collectMetrics([
      withEvents([
        providerLine("ừ t nghi An", "p1"),
        providerLine("Tôi cho rằng chúng ta nên cân nhắc kỹ lưỡng mọi bằng chứng đã được trình bày.", "p2"),
      ]),
    ]).overall;
    expect(m.casualToneRateProvider).toEqual({ value: 0.5, numerator: 1, denominator: 2 });
  });

  it("self-play toàn bảng mẫu: null", () => {
    expect(collectMetrics([BASE]).overall.casualToneRateProvider).toEqual({
      value: null,
      numerator: 0,
      denominator: 0,
    });
  });
});
