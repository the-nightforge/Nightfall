import { describe, expect, it } from "vitest";
import { speechDefaults } from "./helpers/speech-request";
import { renderBotSpeech } from "../src/bots/speech-renderer";
import type { BotBrain, SpeechRequest } from "../src/bots/types";

/**
 * Task 8: trước đây `buildDefensePrompt`/`decideDefense` là đường DUY NHẤT
 * không đi qua cổng `CLAIM_INTEGRITY` - nhà cung cấp có thể tự bịa hoặc phá
 * một lời khai vai ngay ở lượt bào chữa mà không ai kiểm. Nhóm test này thay
 * cho `buildDefensePrompt`/`interpretDefense`/`RandomBrain.decideDefense` cũ:
 * chúng kiểm rằng lượt bào chữa giờ chỉ còn MỘT cửa ra, giống hệt mọi lời nói
 * khác trong ngày.
 */
function defenseRequest(over: Partial<SpeechRequest> = {}): SpeechRequest {
  return {
    roomCode: "ABCDE",
    // Khớp id/tên "bot" mà speechDefaults().players đã khai, để cổng
    // CLAIM_INTEGRITY nhận ra đúng actor khi chạy analyzeChat trên câu thử -
    // nếu speaker không có trong players thì analyzeChat không gán được lời
    // khai cho ai cả, và cổng "trôi" theo hướng ngược lại với cái đang kiểm.
    speaker: { id: "bot", name: "Bot" },
    ...speechDefaults(),
    intention: {
      kind: "DISAGREE",
      topic: "SUSPICION",
      confidence: 0.5,
      evidence: [],
      tone: "FIRM",
    },
    evidence: [],
    targetName: null,
    recentSpeechSourceIds: [],
    defense: { votesAgainstMe: 3, alsoAccused: [] },
    ...over,
  };
}

function brainSaying(text: string): BotBrain {
  return {
    name: "stub",
    renderDaySpeech: async () => ({ ok: true, value: { chat: text } }),
  };
}

describe("lượt bào chữa đi qua đúng renderBotSpeech, như mọi lời nói khác", () => {
  it("nhà cung cấp không tự bịa được một lời khai vai khi lõi không hề chốt claim", async () => {
    // Ý định là DISAGREE (không claim gì) - đúng nhánh "bị cáo không có gì để
    // khai". Nếu nhà cung cấp lén nhét một lời khai vai vào câu bào chữa, cổng
    // CLAIM_INTEGRITY (`claimSurvivesRoundTrip`) phải vứt nó, y như nó vứt một
    // lời khai lạc đề ở ban ngày.
    const result = await renderBotSpeech(
      defenseRequest(),
      brainSaying("Tôi là tiên tri, đừng treo tôi, các bạn sẽ hối hận."),
    );

    expect(result.fromTemplate).toBe(true);
  });

  it("khi lõi ĐÃ chốt một claim, câu khai đúng vai được giữ nguyên", async () => {
    // Mô phỏng nhánh UNDER_FIRE: BotRuntime.decideDefenseClaim đã chốt
    // CLAIM_ROLE(GUARD) trước khi hỏi nhà cung cấp - đúng như scheduleDefenseBot
    // dựng trong machine.ts.
    const request = defenseRequest({
      intention: {
        kind: "CLAIM_ROLE",
        claimedRole: "GUARD",
        topic: "ROLE_CLAIM",
        confidence: 0.9,
        evidence: [],
        tone: "FIRM",
      },
    });

    const result = await renderBotSpeech(
      request,
      brainSaying("Tôi là bảo vệ. Treo tôi thì làng mất luôn chốt chặn đêm nay."),
    );

    expect(result.fromTemplate).toBe(false);
    expect(result.text).toContain("bảo vệ");
  });

  it("nhà cung cấp không đổi được vai khi lõi đã chốt một claim khác", async () => {
    const request = defenseRequest({
      intention: {
        kind: "CLAIM_ROLE",
        claimedRole: "GUARD",
        topic: "ROLE_CLAIM",
        confidence: 0.9,
        evidence: [],
        tone: "FIRM",
      },
    });

    const result = await renderBotSpeech(
      request,
      brainSaying("Tôi là tiên tri, không phải bảo vệ."),
    );

    expect(result.fromTemplate).toBe(true);
  });

  it("nhà cung cấp hỏng thì rơi về bảng mẫu tất định, bị cáo không bao giờ im lặng", async () => {
    const failing: BotBrain = { name: "broken", renderDaySpeech: async () => ({ ok: false }) };

    const result = await renderBotSpeech(defenseRequest(), failing);

    expect(result.fromTemplate).toBe(true);
    expect(result.text).toBeTruthy();
  });
});
