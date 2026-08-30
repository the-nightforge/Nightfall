import { describe, expect, it } from "vitest";
import { renderBotSpeech } from "../src/bots/speech-renderer";
import type { BotBrain, SpeechRequest } from "../src/bots/types";

function requestFor(overrides: Partial<SpeechRequest> = {}): SpeechRequest {
  return {
    roomCode: "ROOM",
    round: 2,
    seq: 0,
    speaker: { id: "p1", name: "An" },
    targetName: "Bình",
    replyTo: null,
    intention: {
      kind: "CLAIM_ROLE",
      claimedRole: "SEER",
      targetId: "p2",
      topic: "ROLE_CLAIM",
      confidence: 0.9,
      evidence: [],
      tone: "FIRM",
    },
    evidence: [],
    chatWindow: [],
    recentOwnLines: [],
    avoidOpenings: [],
    recentSpeechSourceIds: [],
    style: {
      verbosity: "NORMAL",
      warmth: "NEUTRAL",
      formality: "CASUAL",
      address: "TÔI_BẠN",
      harshness: 0.5,
      humor: 0.3,
      inquisitive: 0.5,
      concession: 0.5,
      responsiveness: 0.6,
      initiative: 0.5,
    },
    styleDescription: "bình thường",
    players: [
      { id: "p1", name: "An", alive: true },
      { id: "p2", name: "Bình", alive: true },
      { id: "p3", name: "Chi", alive: true },
    ],
    ...overrides,
  } as SpeechRequest;
}

/**
 * Ý định phản bác đã chốt: lõi khai vai SEER, nhắm phản bác đúng p2 (Bình).
 * Dùng riêng vì `COUNTER_CLAIM` mang hai thứ phải khớp - vai VÀ mục tiêu -
 * còn `requestFor` mặc định chỉ set `intention.targetId` cho việc khác.
 */
function counterClaimRequestFor(overrides: Partial<SpeechRequest> = {}): SpeechRequest {
  return requestFor({
    intention: {
      kind: "COUNTER_CLAIM",
      claimedRole: "SEER",
      targetId: "p2",
      topic: "ROLE_CLAIM",
      confidence: 0.9,
      evidence: [],
      tone: "FIRM",
    },
    ...overrides,
  } as Partial<SpeechRequest>);
}

function brainSaying(text: string): BotBrain {
  return {
    renderDaySpeech: async () => ({ ok: true, value: { chat: text } }),
  } as unknown as BotBrain;
}

describe("CLAIM_INTEGRITY", () => {
  it("giữ câu của nhà cung cấp khi nó khai đúng vai đã chốt", async () => {
    const result = await renderBotSpeech(requestFor(), brainSaying("Tôi là tiên tri. Bình là sói."));
    expect(result.fromTemplate).toBe(false);
    expect(result.text).toContain("tiên tri");
  });

  it("vứt câu không khai gì, dù nó nghe hay — lời khai không được bốc hơi", async () => {
    const result = await renderBotSpeech(requestFor(), brainSaying("Tin tôi đi, tôi biết Bình là ai."));
    expect(result.fromTemplate).toBe(true);
  });

  it("vứt câu khai NHẦM vai — nhà cung cấp không đổi được nước đi", async () => {
    const result = await renderBotSpeech(requestFor(), brainSaying("Tôi là bảo vệ. Bình là sói."));
    expect(result.fromTemplate).toBe(true);
  });

  it("vứt lời khai mà lõi chưa bao giờ quyết", async () => {
    const accuse = requestFor({
      intention: {
        kind: "ACCUSE",
        targetId: "p2",
        topic: "SUSPICION",
        confidence: 0.7,
        evidence: [],
        tone: "FIRM",
      },
    } as Partial<SpeechRequest>);
    const result = await renderBotSpeech(accuse, brainSaying("Tôi là tiên tri, Bình là sói."));
    expect(result.fromTemplate).toBe(true);
  });

  it("giữ câu phản bác khi nó đúng cả vai lẫn người bị phản bác", async () => {
    const result = await renderBotSpeech(
      counterClaimRequestFor(),
      brainSaying("Bình không thể là tiên tri, tôi mới là tiên tri."),
    );
    expect(result.fromTemplate).toBe(false);
    expect(result.text).toContain("Bình");
  });

  it("vứt câu phản bác NHẦM NGƯỜI — vai đúng nhưng lõi chốt mục tiêu khác (regression cho Critical)", async () => {
    const result = await renderBotSpeech(
      counterClaimRequestFor(),
      brainSaying("Chi không thể là tiên tri, tôi mới là tiên tri."),
    );
    expect(result.fromTemplate).toBe(true);
  });

  it("vứt câu phản bác khai NHẦM vai, dù đúng người bị phản bác", async () => {
    const result = await renderBotSpeech(
      counterClaimRequestFor(),
      brainSaying("Bình không thể là bảo vệ, tôi mới là bảo vệ."),
    );
    expect(result.fromTemplate).toBe(true);
  });

  it("vứt câu phản bác mà ý định không hề phản bác ai", async () => {
    const accuse = requestFor({
      intention: {
        kind: "ACCUSE",
        targetId: "p2",
        topic: "SUSPICION",
        confidence: 0.7,
        evidence: [],
        tone: "FIRM",
      },
    } as Partial<SpeechRequest>);
    const result = await renderBotSpeech(
      accuse,
      brainSaying("Bình không thể là tiên tri, tôi mới là tiên tri."),
    );
    expect(result.fromTemplate).toBe(true);
  });
});
