import { describe, expect, it } from "vitest";
import { buildDaySpeechPrompt, personaFor } from "../src/bots/prompt";
import type { SpeechRequest } from "../src/bots/types";

/**
 * Yêu cầu diễn đạt ban ngày của chính bot Kẻ Nguyền Rủa.
 *
 * Ban ngày không còn đi qua snapshot: lõi deterministic chốt mục tiêu, còn nhà
 * cung cấp chỉ nhận đúng ý định và bằng chứng. Vai không nằm trong hình dạng
 * này, nên bí mật của Kẻ Nguyền Rủa được giữ bởi kiểu dữ liệu chứ không phải
 * bởi một câu dặn dò mà model có thể phớt lờ.
 */
function cursedSpeechRequest(over: Partial<SpeechRequest> = {}): SpeechRequest {
  return {
    roomCode: "CURSE",
    speaker: { id: "cursed", name: "Nguyền" },
    personalityStyle: personaFor("cursed"),
    intention: {
      kind: "ACCUSE",
      targetId: "villager",
      confidence: 0.7,
      evidence: [
        {
          id: "ev-1",
          kind: "BANDWAGON",
          sourceId: "2:nomination:3",
          actorId: "villager",
          targetId: "seer",
          weight: 4,
          confidence: 0.5,
          round: 2,
          summary: "nhảy vào phiếu đang dẫn ngay khi nó dẫn",
        },
      ],
    },
    evidence: [{ sourceId: "2:nomination:3", summary: "nhảy vào phiếu đang dẫn ngay khi nó dẫn" }],
    targetName: "Dân",
    recentSpeechSourceIds: [],
    ...over,
  };
}

describe("Bot Kẻ Nguyền Rủa trước khi chuyển phe", () => {
  it("không thể tiết lộ cơ chế nguyền rủa vì prompt ngày không mang vai", () => {
    const prompt = buildDaySpeechPrompt(cursedSpeechRequest());
    const text = `${prompt.system}\n${prompt.user}`;

    expect(text).not.toContain("CURSED");
    expect(text).not.toContain("Kẻ Nguyền Rủa");
    // "Nguyền" trần là TÊN của chính bot và vẫn phải xuất hiện; thứ không được
    // lộ là cơ chế, nên assert bám vào cụm mô tả cơ chế.
    expect(text).not.toMatch(/nguyền rủa|bị nguyền|hoá thành Ma Sói/i);
    expect(text).not.toContain("Vai của bạn");
  });
});

describe("Bot Kẻ Nguyền Rủa sau khi chuyển phe", () => {
  it("prompt ngày vẫn không mang theo việc mình từng bị nguyền", () => {
    const prompt = buildDaySpeechPrompt(cursedSpeechRequest());

    expect(`${prompt.system}\n${prompt.user}`).not.toMatch(
      /nguyền rủa|bị nguyền|từng là|phe Ma Sói/i,
    );
  });
});
