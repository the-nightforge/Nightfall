import { describe, expect, it } from "vitest";
import { speechDefaults } from "./helpers/speech-request";
import { FallbackBrain } from "../src/bots/fallback-brain";
import type { Attempt, BotBrain, DaySpeechDecision, SpeechRequest } from "../src/bots/types";

/** Não giả ghi lại số lần bị hỏi, để đếm xem chuỗi có đi tiếp hay không. */
function stub(name: string, result: () => Attempt<DaySpeechDecision>) {
  const calls = { n: 0 };
  const brain: BotBrain = {
    name,
    async renderDaySpeech(): Promise<Attempt<DaySpeechDecision>> {
      calls.n += 1;
      return result();
    },
  };
  return { brain, calls };
}

const ok = (chat: string): Attempt<DaySpeechDecision> => ({ ok: true, value: { chat } });

describe("FallbackBrain", () => {
  it("dừng ở não đầu tiên thành công, không hỏi não sau", async () => {
    const a = stub("a", () => ok("xong"));
    const b = stub("b", () => ok("khong nen goi"));

    const r = await new FallbackBrain([a.brain, b.brain]).renderDaySpeech(speechRequest());
    expect(r).toEqual({ ok: true, value: { chat: "xong" } });
    expect(a.calls.n).toBe(1);
    expect(b.calls.n).toBe(0);
  });

  it("não hỏng thì chuyển sang não kế tiếp", async () => {
    const a = stub("a", () => ({ ok: false }));
    const b = stub("b", () => ok("cuu duoc"));

    const r = await new FallbackBrain([a.brain, b.brain]).renderDaySpeech(speechRequest());
    expect(r).toEqual({ ok: true, value: { chat: "cuu duoc" } });
    expect(b.calls.n).toBe(1);
  });

  // Đây là lý do Attempt tồn tại. Nếu "không cần nói gì" bị coi là hỏng thì bot
  // đã chết vẫn được mang sang nhà cung cấp thứ hai - tốn tiền và có thể phát ra
  // lời thoại của người đáng lẽ im lặng.
  it("KHÔNG fallback khi não chủ động không làm gì", async () => {
    const a = stub("a", () => ({ ok: true, value: null }));
    const b = stub("b", () => ok("khong duoc goi"));

    const r = await new FallbackBrain([a.brain, b.brain]).renderDaySpeech(speechRequest());
    expect(r).toEqual({ ok: true, value: null });
    expect(b.calls.n).toBe(0);
  });

  it("não ném lỗi không chặn đường não còn lại", async () => {
    const a: BotBrain = {
      name: "no",
      renderDaySpeech: async () => {
        throw new Error("mang hong");
      },
    };
    const b = stub("b", () => ok("van chay"));

    const r = await new FallbackBrain([a, b.brain]).renderDaySpeech(speechRequest());
    expect(r).toEqual({ ok: true, value: { chat: "van chay" } });
  });

  it("mọi não đều hỏng thì báo hỏng", async () => {
    const a = stub("a", () => ({ ok: false }));
    const b = stub("b", () => ({ ok: false }));

    expect(await new FallbackBrain([a.brain, b.brain]).renderDaySpeech(speechRequest())).toEqual({ ok: false });
    expect(a.calls.n).toBe(1);
    expect(b.calls.n).toBe(1);
  });

  it("từ chối chuỗi rỗng thay vì im lặng không làm gì", () => {
    expect(() => new FallbackBrain([])).toThrow();
  });
});

function speechRequest(overrides: Partial<SpeechRequest> = {}): SpeechRequest {
  return {
    roomCode: "ABCDE",
    speaker: { id: "v", name: "Vân" },
    ...speechDefaults(),
    intention: {
      kind: "ACCUSE",
      targetId: "s",
      confidence: 0.7,
      evidence: [
        {
          id: "2:nomination:5:LATE_SWITCH",
          kind: "LATE_SWITCH",
          sourceId: "vote:late-switch:2",
          actorId: "s",
          targetId: "v",
          weight: 7,
          confidence: 0.6,
          round: 2,
          summary: "đổi phiếu sát giờ chót",
        },
      ],
    },
    evidence: [{ sourceId: "vote:late-switch:2", summary: "đổi phiếu sát giờ chót" }],
    targetName: "Sang",
    recentSpeechSourceIds: [],
    ...overrides,
  };
}
