import { describe, expect, it } from "vitest";
import { speechDefaults } from "./helpers/speech-request";
import { renderBotSpeech } from "../src/bots/speech-renderer";
import { FallbackBrain } from "../src/bots/fallback-brain";
import { interpretDaySpeech } from "../src/bots/decide";
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
    defense: { votesAgainstMe: 3, alsoAccused: [], stance: "SURVIVE" },
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

/**
 * Fix round 1, mục 2: `interpretDaySpeech` coi chuỗi rỗng là im lặng có chủ
 * đích (`decided({chat:null})`), và với `FallbackBrain` đó là một nhánh
 * THÀNH CÔNG - chuỗi dừng lại, não kế tiếp không bao giờ được hỏi. Đúng cho
 * ban ngày, nhưng SAI cho lượt bào chữa: một câu trả lời rỗng từ não A không
 * được phép chiếm mất lượt của não B. `gemini-brain.ts`/`openai-compat-brain.ts`
 * truyền `treatEmptyAsFailure: request.defense !== null` để chữa đúng chỗ
 * này; nhóm dưới đây kiểm hành vi GHÉP của interpretDaySpeech + FallbackBrain,
 * không chỉ từng hàm riêng lẻ.
 */
function brainCalling(name: string, chat: string, calls: string[]): BotBrain {
  return {
    name,
    async renderDaySpeech(request: SpeechRequest) {
      calls.push(name);
      // Mô phỏng ĐÚNG lời gọi thật của gemini-brain.ts/openai-compat-brain.ts,
      // không tự suy ra { ok: true/false } bằng tay - nếu không test này có
      // thể xanh dù chỗ nối thật đã đứt.
      return interpretDaySpeech({ think: "x", chat }, 300, () => undefined, {
        treatEmptyAsFailure: request.defense !== null,
      });
    },
  };
}

describe("chuỗi dự phòng: chuỗi rỗng ở lượt bào chữa phải thử não kế tiếp", () => {
  it("ban ngày: não A trả lời rỗng thì DỪNG ở đó, não B không được hỏi", async () => {
    const calls: string[] = [];
    const chain = new FallbackBrain([
      brainCalling("A", "   ", calls),
      brainCalling("B", "Tôi nghi Wolf.", calls),
    ]);

    const attempt = await chain.renderDaySpeech(
      // Không phải lượt bào chữa - defenseRequest() ghi đè lại `defense: null`
      // và một ý định không cần mục tiêu, để khác biệt DUY NHẤT với test dưới
      // là cờ `defense`, không phải hình dạng ý định.
      defenseRequest({
        defense: null,
        intention: { kind: "WITHHOLD", tone: "NEUTRAL", confidence: 0.2, evidence: [] },
        targetName: null,
      }),
    );

    expect(calls).toEqual(["A"]);
    expect(attempt).toEqual({ ok: true, value: { chat: null } });
  });

  it("lượt bào chữa: não A trả lời rỗng thì não B ĐƯỢC hỏi tiếp", async () => {
    const calls: string[] = [];
    const chain = new FallbackBrain([
      brainCalling("A", "   ", calls),
      brainCalling("B", "Tôi không phải sói, đừng treo tôi.", calls),
    ]);

    const attempt = await chain.renderDaySpeech(defenseRequest());

    expect(calls).toEqual(["A", "B"]);
    expect(attempt).toEqual({ ok: true, value: { chat: "Tôi không phải sói, đừng treo tôi." } });
  });
});
