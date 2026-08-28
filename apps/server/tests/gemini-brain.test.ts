import { describe, expect, it } from "vitest";
import type { RoomSnapshot } from "@masoi/shared";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { GeminiBrain } from "../src/bots/gemini-brain";
import { BotGovernor, Cooldown } from "../src/bots/governor";

function wolfNightView(): RoomSnapshot {
  return {
    code: "ABCDE",
    hostId: "w",
    phase: "NIGHT",
    config: { ...DEFAULT_ROOM_CONFIG },
    round: 1,
    phaseEndsAt: null,
    you: { id: "w", name: "Wolf", ready: true, connected: true, role: "WEREWOLF", alive: true },
    players: [
      { id: "w", name: "Wolf", alive: true, isBot: true, role: "WEREWOLF" },
      { id: "v", name: "Vân", alive: true, isBot: false },
      { id: "s", name: "Sang", alive: true, isBot: false },
    ],
    night: { canAct: true, acted: false, wolfTarget: null, seerResult: null },
    hasVoted: false,
    myVote: null,
    noEliminationVoteCount: 0,
    serverNow: 0,
    discussionSkip: null,
    votesRevealed: false,
    nightHistory: [],
    lastNightDeaths: [],
    lastEliminated: null,
    winner: null,
    chatLog: [],
    log: [],
  };
}

function witchNightView(): RoomSnapshot {
  return {
    code: "ABCDE",
    hostId: "w",
    phase: "NIGHT",
    config: { ...DEFAULT_ROOM_CONFIG },
    round: 1,
    phaseEndsAt: null,
    you: { id: "w", name: "Witch", ready: true, connected: true, role: "WITCH", alive: true },
    players: [
      { id: "w", name: "Witch", alive: true, isBot: true, role: "WITCH" },
      { id: "v", name: "Vân", alive: true, isBot: false },
      { id: "s", name: "Sang", alive: true, isBot: false },
    ],
    night: {
      canAct: true,
      acted: false,
      wolvesLocked: true,
      wolfTarget: "v",
      seerResult: null,
      healUsed: false,
      poisonUsed: false,
    },
    hasVoted: false,
    myVote: null,
    noEliminationVoteCount: 0,
    serverNow: 0,
    discussionSkip: null,
    votesRevealed: false,
    nightHistory: [],
    lastNightDeaths: [],
    lastEliminated: null,
    winner: null,
    chatLog: [],
    log: [],
  };
}

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

describe("GeminiBrain.decideNight", () => {
  it("chuyển kết quả hợp lệ thành NightDecision", async () => {
    const b = brain(async () => reply({ think: "x", targetId: "v" }));
    expect(await b.decideNight(wolfNightView())).toEqual({
      ok: true,
      value: { action: "KILL", targetId: "v" },
    });
  });

  it("JSON hỏng là lượt hỏng, không phải lượt bỏ qua", async () => {
    const b = brain(async () => new Response("khong phai json", { status: 200 }));
    expect(await b.decideNight(wolfNightView())).toEqual({ ok: false });
  });

  it("thiếu trường bắt buộc là lượt hỏng", async () => {
    const b = brain(async () => reply({ think: "x" }));
    expect(await b.decideNight(wolfNightView())).toEqual({ ok: false });
  });

  it("từ chối mục tiêu ngoài danh sách hợp lệ", async () => {
    const b = brain(async () => reply({ think: "x", targetId: "w" }));
    expect(await b.decideNight(wolfNightView())).toEqual({ ok: false });
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

    expect(await b.decideNight(wolfNightView())).toEqual({ ok: false });
    expect(calls).toBe(1);

    t = 6_999;
    expect(await b.decideNight(wolfNightView())).toEqual({ ok: false });
    expect(calls).toBe(1);

    t = 7_000;
    await b.decideNight(wolfNightView());
    expect(calls).toBe(2);
  });

  it("ưu tiên header Retry-After hơn retryDelay trong thân lỗi", async () => {
    let t = 0;
    const governor = new BotGovernor(60);
    const cooldown = new Cooldown(() => t);
    const b = brain(async () => rateLimited("60s", { "retry-after": "3" }), governor, cooldown);

    await b.decideNight(wolfNightView());
    expect(cooldown.remainingMs()).toBe(3_000);
  });

  it("429 không kèm thông tin chờ thì dùng mặc định", async () => {
    let t = 0;
    const governor = new BotGovernor(60);
    const cooldown = new Cooldown(() => t);
    const b = brain(async () => rateLimited(), governor, cooldown);

    await b.decideNight(wolfNightView());
    expect(cooldown.remainingMs()).toBe(30_000);
  });

  it("không gọi API khi đã chạm trần", async () => {
    const governor = new BotGovernor(0);
    let calls = 0;
    const b = brain(async () => {
      calls += 1;
      return reply({ think: "x", targetId: "v" });
    }, governor);

    // Bị governor chặn cũng là hỏng: đây chính là lúc cần nhà cung cấp khác.
    expect(await b.decideNight(wolfNightView())).toEqual({ ok: false });
    expect(calls).toBe(0);
  });

  it("không gọi API khi bot không có hành động", async () => {
    let calls = 0;
    const b = brain(async () => {
      calls += 1;
      return reply({ think: "x", targetId: "v" });
    });
    const v = { ...wolfNightView(), night: null };
    // Không có hành động đêm KHÁC với gọi hỏng: chuỗi fallback phải dừng ở đây,
    // nếu không Dân Làng lại bị mang đi hỏi nhà cung cấp thứ hai.
    expect(await b.decideNight(v)).toEqual({ ok: true, value: null });
    expect(calls).toBe(0);
  });
});

describe("GeminiBrain.decideNight (Phù Thuỷ)", () => {
  it("chấp nhận HEAL khi bình cứu còn dùng được", async () => {
    const b = brain(async () => reply({ think: "x", action: "HEAL" }));
    expect(await b.decideNight(witchNightView())).toEqual({
      ok: true,
      value: { action: "HEAL", targetId: null },
    });
  });

  it("chấp nhận POISON với mục tiêu hợp lệ", async () => {
    const b = brain(async () => reply({ think: "x", action: "POISON", targetId: "v" }));
    expect(await b.decideNight(witchNightView())).toEqual({
      ok: true,
      value: { action: "POISON", targetId: "v" },
    });
  });

  it("từ chối hành động mô hình chọn nhưng không còn dùng được", async () => {
    const b = brain(async () => reply({ think: "x", action: "HEAL" }));
    const v = {
      ...witchNightView(),
      night: { canAct: true, acted: false, wolfTarget: null, seerResult: null, healUsed: true, poisonUsed: false },
    };
    expect(await b.decideNight(v)).toEqual({ ok: false });
  });

  it("từ chối POISON với mục tiêu ngoài danh sách hợp lệ", async () => {
    const b = brain(async () => reply({ think: "x", action: "POISON", targetId: "khong-ton-tai" }));
    expect(await b.decideNight(witchNightView())).toEqual({ ok: false });
  });
});

describe("GeminiBrain.decideDay", () => {
  it("cắt lời thoại về 300 ký tự", async () => {
    const long = "a".repeat(500);
    const b = brain(async () => reply({ think: "x", chat: long, voteTargetId: "v" }));
    const v = { ...wolfNightView(), phase: "DAY_DISCUSSION" as const, night: null };
    expect(await b.decideDay(v)).toEqual({
      ok: true,
      value: { chat: "a".repeat(300), vote: { type: "PLAYER", targetId: "v" } },
    });
  });

  it("chấp nhận voteTargetId null", async () => {
    const b = brain(async () => reply({ think: "x", chat: "ừ", voteTargetId: null }));
    const v = { ...wolfNightView(), phase: "DAY_DISCUSSION" as const, night: null };
    expect(await b.decideDay(v)).toEqual({ ok: true, value: { chat: "ừ", vote: null } });
  });

  it("hiểu NO_ELIMINATION là cố ý không treo ai, khác với chưa quyết", async () => {
    const b = brain(async () => reply({ think: "x", chat: "ừ", voteTargetId: "NO_ELIMINATION" }));
    const v = { ...wolfNightView(), phase: "DAY_DISCUSSION" as const, night: null };
    expect(await b.decideDay(v)).toEqual({
      ok: true,
      value: { chat: "ừ", vote: { type: "NO_ELIMINATION" } },
    });
  });

  it("bỏ phiếu ngoài danh sách hợp lệ nhưng vẫn giữ lời thoại", async () => {
    const b = brain(async () => reply({ think: "x", chat: "ừ", voteTargetId: "khong-ton-tai" }));
    const v = { ...wolfNightView(), phase: "DAY_DISCUSSION" as const, night: null };
    expect(await b.decideDay(v)).toEqual({ ok: true, value: { chat: "ừ", vote: null } });
  });
});
