import { describe, expect, it, vi } from "vitest";
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
    personalityStyle: "điềm tĩnh",
    intention: {
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
  decideNight: async () => failed(),
  renderDaySpeech: async () => failed(),
  decideHunterShot: async () => failed(),
  decideDefense: async () => failed(),
  decideFinalVote: async () => failed(),
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
    const line = await renderBotSpeech(requestForTarget("Chi"), failingBrain);

    expect(line).toContain("Chi");
    expect(line).not.toContain("Bình");
    expect(line).toContain("đổi phiếu sát giờ chót");
  });

  it("uses the provider line when the provider answers", async () => {
    const line = await renderBotSpeech(
      requestForTarget("Chi"),
      speakingBrain("Tôi thấy Chi rất đáng ngờ."),
    );

    expect(line).toBe("Tôi thấy Chi rất đáng ngờ.");
  });

  it("falls back to the template when the provider declines to speak", async () => {
    const line = await renderBotSpeech(requestForTarget("Chi"), silentBrain);

    expect(line).toContain("Chi");
  });

  it("trims a provider line to the chat maximum", async () => {
    const line = await renderBotSpeech(
      requestForTarget("Chi"),
      speakingBrain("x".repeat(500)),
    );

    expect(line!.length).toBe(300);
  });

  it("never lets a provider line replace the intention target", async () => {
    const request = requestForTarget("Chi");
    const brain = speakingBrain("Tôi nghi Bình");

    await renderBotSpeech(request, brain);

    expect(request.intention.targetId).toBe("c");
    expect(request.targetName).toBe("Chi");
  });

  it("withholds with a fixed line and never names anyone", () => {
    const line = speechTemplate(
      requestForTarget("Chi", {
        intention: { kind: "WITHHOLD", confidence: 0.2, evidence: [] },
        evidence: [],
        targetName: null,
      }),
    );

    expect(line).toBe("Hiện tại tôi chưa thấy đủ bằng chứng để treo ai.");
  });

  it("asks a question when there is a target but no fresh evidence", () => {
    const line = speechTemplate(
      requestForTarget("Chi", {
        intention: { kind: "QUESTION", targetId: "c", confidence: 0.5, evidence: [] },
        evidence: [],
      }),
    );

    expect(line).toContain("Chi");
    expect(line).toContain("?");
  });

  it("stays silent rather than inventing a line with no target and no evidence", () => {
    expect(
      speechTemplate(
        requestForTarget(null, {
          intention: { kind: "ACCUSE", confidence: 0.5, evidence: [] },
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

    await expect(renderBotSpeech(requestForTarget("Chi"), throwing)).resolves.toContain("Chi");
  });
});
