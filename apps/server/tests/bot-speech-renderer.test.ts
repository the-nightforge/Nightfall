import { describe, expect, it, vi } from "vitest";
import { speechDefaults } from "./helpers/speech-request";
import type { BotBrain, SpeechRequest } from "../src/bots/types";
import { failed, decided, nothingToDo } from "../src/bots/types";
import { renderBotSpeech, speechTemplate } from "../src/bots/speech-renderer";

vi.mock("../src/db", () => ({ prisma: {} }));

function requestForTarget(
  targetName: string | null,
  overrides: Partial<SpeechRequest> = {},
): SpeechRequest {
  return {
    roomCode: "ROOM1",
    speaker: { id: "bot", name: "Bot" },
    ...speechDefaults(),
    intention: {
      tone: "NEUTRAL",
      kind: "ACCUSE",
      targetId: "c",
      confidence: 0.8,
      evidence: [
        {
          id: "ev-1",
          kind: "LATE_SWITCH",
          sourceId: "vote:late-switch:2",
          actorId: "c",
          targetId: "b",
          weight: 7,
          confidence: 0.6,
          round: 2,
          summary: "đổi phiếu sát giờ chót",
        },
      ],
    },
    evidence: [{ sourceId: "vote:late-switch:2", summary: "đổi phiếu sát giờ chót" }],
    targetName,
    recentSpeechSourceIds: [],
    ...overrides,
  };
}

const failingBrain: BotBrain = {
  name: "always-fails",
  renderDaySpeech: async () => failed(),
};

const silentBrain: BotBrain = {
  ...failingBrain,
  name: "silent",
  renderDaySpeech: async () => nothingToDo(),
};

function speakingBrain(chat: string): BotBrain {
  return { ...failingBrain, name: "speaking", renderDaySpeech: async () => decided({ chat }) };
}

describe("bot speech renderer", () => {
  it("keeps the deterministic target when every provider fails", async () => {
    const line = (await renderBotSpeech(requestForTarget("Chi"), failingBrain)).text;

    expect(line).toContain("Chi");
    expect(line).not.toContain("Bình");
    expect(line).toContain("đổi phiếu sát giờ chót");
  });

  it("uses the provider line when the provider answers", async () => {
    const line = (await renderBotSpeech(
      requestForTarget("Chi"),
      speakingBrain("Tôi thấy Chi rất đáng ngờ."),
    )).text;

    expect(line).toBe("Tôi thấy Chi rất đáng ngờ.");
  });

  it("falls back to the template when the provider declines to speak", async () => {
    const line = (await renderBotSpeech(requestForTarget("Chi"), silentBrain)).text;

    expect(line).toContain("Chi");
  });

  it("trims a provider line to the chat maximum", async () => {
    const line = (await renderBotSpeech(
      requestForTarget("Chi"),
      speakingBrain("x".repeat(500)),
    )).text;

    expect(line!.length).toBe(300);
  });

  it("never lets a provider line replace the intention target", async () => {
    const request = requestForTarget("Chi");
    const brain = speakingBrain("Tôi nghi Bình");

    await renderBotSpeech(request, brain);

    expect(request.intention.targetId).toBe("c");
    expect(request.targetName).toBe("Chi");
  });

  it("withholds without ever naming anyone", () => {
    // Phase 4 thay MỘT câu cố định bằng một bảng mẫu, nên khẳng định không còn
    // là "đúng chuỗi này" mà là điều thật sự quan trọng: không nêu tên ai.
    for (let seq = 0; seq < 20; seq += 1) {
      const line = speechTemplate(
        requestForTarget("Chi", {
          intention: { kind: "WITHHOLD", confidence: 0.2, evidence: [], tone: "NEUTRAL" },
          evidence: [],
          targetName: null,
          seq,
        }),
      );

      expect(line, `seq ${seq}`).not.toBeNull();
      expect(line, `seq ${seq}`).not.toContain("Chi");
      expect(line, `seq ${seq}`).not.toContain("Bình");
    }
  });

  it("asks a question when there is a target but no fresh evidence", () => {
    const line = speechTemplate(
      requestForTarget("Chi", {
        intention: { kind: "QUESTION", targetId: "c", confidence: 0.5, evidence: [], tone: "CURIOUS" },
        evidence: [],
      }),
    );

    expect(line).toContain("Chi");
  });

  it("stays silent rather than inventing a line with no target and no evidence", () => {
    expect(
      speechTemplate(
        requestForTarget(null, {
          intention: { kind: "ACCUSE", confidence: 0.5, evidence: [], tone: "FIRM" },
          evidence: [],
        }),
      ),
    ).toBeNull();
  });

  it("is deterministic: the template uses no randomness", () => {
    const request = requestForTarget("Chi");

    const lines = new Set(Array.from({ length: 20 }, () => speechTemplate(request)));

    expect(lines.size).toBe(1);
  });

  it("survives a provider that throws", async () => {
    const throwing: BotBrain = {
      ...failingBrain,
      renderDaySpeech: async () => {
        throw new Error("boom");
      },
    };

    expect((await renderBotSpeech(requestForTarget("Chi"), throwing)).text).toContain("Chi");
  });
});
