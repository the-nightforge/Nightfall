import { describe, expect, it } from "vitest";
import type { RoomSnapshot } from "@masoi/shared";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { OpenAiCompatBrain, tolerantJsonParse } from "../src/bots/openai-compat-brain";
import { BotGovernor, Cooldown } from "../src/bots/governor";

function dayView(): RoomSnapshot {
  return {
    code: "ABCDE",
    hostId: "v",
    phase: "DAY_DISCUSSION",
    config: { ...DEFAULT_ROOM_CONFIG },
    round: 2,
    phaseEndsAt: null,
    you: { id: "v", name: "Vân", ready: true, connected: true, role: "VILLAGER", alive: true },
    players: [
      { id: "v", name: "Vân", alive: true, isBot: true },
      { id: "w", name: "Wolf", alive: true, isBot: false },
      { id: "s", name: "Sang", alive: true, isBot: false },
    ],
    night: null,
    myVote: null,
    discussionSkip: null,
    votesRevealed: false,
    lastNightDeaths: [],
    lastEliminated: null,
    winner: null,
    chatLog: [],
    log: [],
  };
}

function reply(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
}

function brain(
  fetchImpl: (u: string, i: RequestInit) => Promise<Response>,
  jsonMode: "json_schema" | "prompt" = "prompt",
  governor = new BotGovernor(60),
  cooldown = new Cooldown(),
  extra: Partial<ConstructorParameters<typeof OpenAiCompatBrain>[0]> = {},
) {
  return new OpenAiCompatBrain({
    baseUrl: "https://x/v1",
    apiKey: "k",
    model: "m",
    governor,
    cooldown,
    timeoutMs: 1_000,
    jsonMode,
    fetchImpl,
    ...extra,
  });
}

describe("tolerantJsonParse", () => {
  // Nhà cung cấp không hỗ trợ response_format hay bọc JSON trong rào hoặc kèm
  // một câu dẫn; từ chối thẳng những phản hồi đó là vứt đi lượt nói dùng được.
  it("bóc JSON khỏi rào markdown", () => {
    expect(tolerantJsonParse('```json\n{"chat":"a"}\n```')).toEqual({ chat: "a" });
  });

  it("bóc JSON khỏi câu dẫn thừa", () => {
    expect(tolerantJsonParse('Đây nhé: {"chat":"a"} hy vọng giúp được')).toEqual({ chat: "a" });
  });

  it("trả null khi không có JSON nào", () => {
    expect(tolerantJsonParse("khong co gi")).toBeNull();
    expect(tolerantJsonParse("")).toBeNull();
    expect(tolerantJsonParse(null)).toBeNull();
  });
});

describe("OpenAiCompatBrain", () => {
  it("chuyển phản hồi hợp lệ thành DayDecision", async () => {
    const b = brain(async () => reply('{"think":"x","chat":"chào","voteTargetId":"w"}'));
    expect(await b.decideDay(dayView())).toEqual({
      ok: true,
      value: { chat: "chào", voteTargetId: "w" },
    });
  });

  it("phiếu ngoài danh sách hợp lệ bị bỏ nhưng vẫn giữ lời thoại", async () => {
    const b = brain(async () => reply('{"think":"x","chat":"ừ","voteTargetId":"khong-ton-tai"}'));
    expect(await b.decideDay(dayView())).toEqual({
      ok: true,
      value: { chat: "ừ", voteTargetId: null },
    });
  });

  it("văn xuôi không phải JSON là lượt hỏng", async () => {
    const b = brain(async () => reply("Tôi nghi Sang lắm nha"));
    expect(await b.decideDay(dayView())).toEqual({ ok: false });
  });

  it("HTTP lỗi là lượt hỏng", async () => {
    const b = brain(async () => new Response(JSON.stringify({ error: "hong" }), { status: 500 }));
    expect(await b.decideDay(dayView())).toEqual({ ok: false });
  });

  it("bot đã chết thì không gọi API và cũng không báo hỏng", async () => {
    let calls = 0;
    const b = brain(async () => {
      calls += 1;
      return reply("{}");
    });
    const dead = dayView();
    const v = { ...dead, you: { ...dead.you!, alive: false } };
    expect(await b.decideDay(v)).toEqual({ ok: true, value: null });
    expect(calls).toBe(0);
  });

  it("429 kích hoạt nghỉ riêng cho nhà cung cấp đó", async () => {
    const cooldown = new Cooldown(() => 0);
    const b = brain(
      async () => new Response("{}", { status: 429, headers: { "retry-after": "4" } }),
      "prompt",
      new BotGovernor(60),
      cooldown,
    );
    expect(await b.decideDay(dayView())).toEqual({ ok: false });
    expect(cooldown.remainingMs()).toBe(4_000);
  });
});

describe("OpenAiCompatBrain: hình dạng request", () => {
  async function capture(
    jsonMode: "json_schema" | "prompt",
    extra: Partial<ConstructorParameters<typeof OpenAiCompatBrain>[0]> = {},
  ) {
    let body: any = null;
    const b = brain(
      async (_u, init) => {
        body = JSON.parse(String(init.body));
        return reply('{"think":"x","chat":"a","voteTargetId":null}');
      },
      jsonMode,
      new BotGovernor(60),
      new Cooldown(),
      extra,
    );
    await b.decideDay(dayView());
    return body;
  }

  // Proxy mặc định trả SSE; quên stream:false là mọi phản hồi thành rác không parse được.
  it("luôn ép stream: false", async () => {
    expect((await capture("prompt")).stream).toBe(false);
  });

  it("chế độ prompt không gửi response_format mà mô tả JSON trong lời nhắc", async () => {
    const body = await capture("prompt");
    expect(body.response_format).toBeUndefined();
    expect(body.messages[1].content).toContain("CHỈ trả về một object JSON hợp lệ");
    expect(body.messages[1].content).toContain('"voteTargetId"');
  });

  it("chế độ json_schema gửi schema strict, mọi field nằm trong required", async () => {
    const body = await capture("json_schema");
    const schema = body.response_format.json_schema.schema;
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(Object.keys(schema.properties));
    // strict cấm field tuỳ chọn, nên thứ vốn có thể vắng phải thành nullable.
    expect(schema.properties.voteTargetId.type).toEqual(["string", "null"]);
    expect(schema.properties.voteTargetId.enum).toContain(null);
    expect(schema.properties.chat.type).toBe("string");
  });

  // "OpenAI-compatible" không có nghĩa là giống nhau. gpt-5.x trả 400 cho
  // max_tokens và cho mọi temperature khác 1, nên hai tham số này phải khai báo
  // theo từng nhà cung cấp - đặt cứng là chặng đó hỏng ở mọi lời gọi.
  it("mặc định dùng max_tokens", async () => {
    const body = await capture("prompt");
    expect(body.max_tokens).toBe(500);
    expect(body.max_completion_tokens).toBeUndefined();
  });

  it("đổi sang max_completion_tokens khi được yêu cầu", async () => {
    const body = await capture("json_schema", { maxTokensParam: "max_completion_tokens" });
    expect(body.max_completion_tokens).toBe(500);
    expect(body.max_tokens).toBeUndefined();
  });

  it("không gửi temperature khi không cấu hình", async () => {
    expect((await capture("prompt")).temperature).toBeUndefined();
  });

  it("gửi temperature khi có cấu hình", async () => {
    expect((await capture("prompt", { temperature: 1.2 })).temperature).toBe(1.2);
  });
});
