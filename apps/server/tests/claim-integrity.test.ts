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
    defense: null,
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

  it("vứt câu khai TRẦN khi chữ lại đọc ra một PHẢN BÁC — đúng vai không cứu được sai loại (regression cho Critical vòng 2)", async () => {
    // CLAIM_ROLE(role=SEER) nhưng câu khớp mẫu counter-claim và nhắm vào Chi -
    // parseCounterClaim chạy trước, không quan tâm ý định gọi nó là gì, nên nó
    // đọc ra COUNTER_CLAIM{targetId: Chi, data.role: SEER} - đúng vai, sai loại
    // và mang theo một mục tiêu lõi chưa từng chốt.
    const result = await renderBotSpeech(
      requestFor(),
      brainSaying("Chi không thể là sói, tôi mới là tiên tri."),
    );
    expect(result.fromTemplate).toBe(true);
  });

  it("vứt câu PHẢN BÁC khi chữ lại đọc ra một khai TRẦN — chặn bởi so MỤC TIÊU, không phải so loại", async () => {
    // KHÔNG phải bài test cho lớp so loại, dù trông giống. COUNTER_CLAIM
    // (role=SEER, targetId=Bình) nhưng câu chỉ là "Tôi là tiên tri." - đọc ra
    // ROLE_CLAIM trần, đúng vai. Một khai trần không bao giờ mang `targetId`
    // (`parseClause` không gắn nó cho `ROLE_CLAIM`), nên phép so mục tiêu của
    // round 1 đã tự rớt câu này ở `undefined !== "p2"` TRƯỚC KHI lớp so loại
    // của round 2 kịp chạy tới - tắt lớp so loại đi, test này vẫn xanh y hệt.
    // Ca thật sự cần lớp so loại để xanh là "CLAIM_ROLE mà chữ đọc ra
    // COUNTER_CLAIM" ở test phía trên: chỉ ca đó đỏ khi bỏ so loại đi.
    const result = await renderBotSpeech(
      counterClaimRequestFor(),
      brainSaying("Tôi là tiên tri."),
    );
    expect(result.fromTemplate).toBe(true);
  });
});
