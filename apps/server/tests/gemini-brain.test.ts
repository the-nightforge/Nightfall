import { describe, expect, it } from "vitest";
import { speechDefaults } from "./helpers/speech-request";
import { buildDaySpeechPrompt } from "../src/bots/prompt";
import type { SpeechRequest } from "../src/bots/types";
import { GeminiBrain } from "../src/bots/gemini-brain";
import { BotGovernor, Cooldown } from "../src/bots/governor";

function reply(payload: unknown, status = 200): Response {
  const body = {
    candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
  };
  return new Response(JSON.stringify(body), { status });
}

function brain(
  fetchImpl: (u: string, i: RequestInit) => Promise<Response>,
  governor = new BotGovernor(60),
  cooldown = new Cooldown(),
) {
  return new GeminiBrain({ apiKey: "k", model: "m", governor, cooldown, timeoutMs: 1_000, fetchImpl });
}

// Tầng transport dùng chung cho mọi lời gọi, nên kiểm nó qua đúng lối vào còn
// lại là renderDaySpeech; những gì đo ở đây (429, nghỉ, trần ngân sách) không
// liên quan tới nội dung prompt.
describe("GeminiBrain: tầng gọi mạng", () => {
  it("JSON hỏng là lượt hỏng, không phải lượt bỏ qua", async () => {
    const b = brain(async () => new Response("khong phai json", { status: 200 }));
    expect(await b.renderDaySpeech(speechRequest())).toEqual({ ok: false });
  });

  function rateLimited(retryDelay?: string, headers?: Record<string, string>) {
    const body = retryDelay
      ? {
          error: {
            code: 429,
            details: [
              { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay },
            ],
          },
        }
      : {};
    return new Response(JSON.stringify(body), { status: 429, headers });
  }

  // Bản cũ tắt Gemini tới hết ván ngay lần 429 đầu tiên, nên một lần chạm rate
  // limit thoáng qua làm mọi bot câm vĩnh viễn. Điều phải bảo vệ ở đây là bot
  // gọi lại được sau khi hết nghỉ, chứ không chỉ là nó có tạm dừng.
  it("gặp 429 thì nghỉ theo retryDelay rồi gọi lại được", async () => {
    let t = 0;
    const governor = new BotGovernor(60);
    const cooldown = new Cooldown(() => t);
    let calls = 0;
    const b = brain(async () => {
      calls += 1;
      return rateLimited("7s");
    }, governor, cooldown);

    expect(await b.renderDaySpeech(speechRequest())).toEqual({ ok: false });
    expect(calls).toBe(1);

    t = 6_999;
    expect(await b.renderDaySpeech(speechRequest())).toEqual({ ok: false });
    expect(calls).toBe(1);

    t = 7_000;
    await b.renderDaySpeech(speechRequest());
    expect(calls).toBe(2);
  });

  it("ưu tiên header Retry-After hơn retryDelay trong thân lỗi", async () => {
    let t = 0;
    const governor = new BotGovernor(60);
    const cooldown = new Cooldown(() => t);
    const b = brain(async () => rateLimited("60s", { "retry-after": "3" }), governor, cooldown);

    await b.renderDaySpeech(speechRequest());
    expect(cooldown.remainingMs()).toBe(3_000);
  });

  it("429 không kèm thông tin chờ thì dùng mặc định", async () => {
    let t = 0;
    const governor = new BotGovernor(60);
    const cooldown = new Cooldown(() => t);
    const b = brain(async () => rateLimited(), governor, cooldown);

    await b.renderDaySpeech(speechRequest());
    expect(cooldown.remainingMs()).toBe(30_000);
  });

  it("không gọi API khi đã chạm trần", async () => {
    const governor = new BotGovernor(0);
    let calls = 0;
    const b = brain(async () => {
      calls += 1;
      return reply({ think: "x", chat: "ừ" });
    }, governor);

    // Bị governor chặn cũng là hỏng: đây chính là lúc cần nhà cung cấp khác.
    expect(await b.renderDaySpeech(speechRequest())).toEqual({ ok: false });
    expect(calls).toBe(0);
  });
});

describe("GeminiBrain.renderDaySpeech", () => {
  it("cắt lời thoại về 300 ký tự", async () => {
    const b = brain(async () => reply({ think: "x", chat: "a".repeat(500) }));

    expect(await b.renderDaySpeech(speechRequest())).toEqual({
      ok: true,
      value: { chat: "a".repeat(300) },
    });
  });

  it("trả về đúng lời thoại và không có mục tiêu nào", async () => {
    const b = brain(async () => reply({ think: "x", chat: "ừ" }));

    expect(await b.renderDaySpeech(speechRequest())).toEqual({ ok: true, value: { chat: "ừ" } });
  });

  // Hàng rào cuối của luật "LLM không được đổi gameplay": kể cả khi model cố
  // trả về một mục tiêu, schema .strict() từ chối cả lượt thay vì bỏ qua trường.
  it("từ chối phản hồi có mục tiêu bỏ phiếu", async () => {
    const b = brain(async () => reply({ think: "x", chat: "ừ", voteTargetId: "v" }));

    expect(await b.renderDaySpeech(speechRequest())).toEqual({ ok: false });
  });

  it("chat rỗng là chủ động không nói gì, không phải lượt hỏng", async () => {
    const b = brain(async () => reply({ think: "x", chat: "   " }));

    expect(await b.renderDaySpeech(speechRequest())).toEqual({ ok: true, value: { chat: null } });
  });

  it("không gửi trường mục tiêu nào trong prompt ngày", async () => {
    const spec = buildDaySpeechPrompt(speechRequest());

    expect(Object.keys(spec.schema.properties)).toEqual(["think", "chat"]);
    expect(`${spec.system}\n${spec.user}`).not.toContain("voteTargetId");
  });
});

function speechRequest(overrides: Partial<SpeechRequest> = {}): SpeechRequest {
  return {
    roomCode: "ABCDE",
    speaker: { id: "v", name: "Vân" },
    ...speechDefaults(),
    intention: {
      tone: "NEUTRAL",
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
