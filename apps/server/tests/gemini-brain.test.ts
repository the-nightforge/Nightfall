import { describe, expect, it } from "vitest";
import type { RoomSnapshot } from "@masoi/shared";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { GeminiBrain } from "../src/bots/gemini-brain";
import { BotGovernor } from "../src/bots/governor";

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
    myVote: null,
    votesRevealed: false,
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

function brain(fetchImpl: (u: string, i: RequestInit) => Promise<Response>, governor = new BotGovernor(60)) {
  return new GeminiBrain({ apiKey: "k", model: "m", governor, timeoutMs: 1_000, fetchImpl });
}

describe("GeminiBrain.decideNight", () => {
  it("chuyển kết quả hợp lệ thành NightDecision", async () => {
    const b = brain(async () => reply({ think: "x", targetId: "v" }));
    expect(await b.decideNight(wolfNightView())).toEqual({ action: "KILL", targetId: "v" });
  });

  it("trả null khi JSON hỏng", async () => {
    const b = brain(async () => new Response("khong phai json", { status: 200 }));
    expect(await b.decideNight(wolfNightView())).toBeNull();
  });

  it("trả null khi thiếu trường bắt buộc", async () => {
    const b = brain(async () => reply({ think: "x" }));
    expect(await b.decideNight(wolfNightView())).toBeNull();
  });

  it("từ chối mục tiêu ngoài danh sách hợp lệ", async () => {
    const b = brain(async () => reply({ think: "x", targetId: "w" }));
    expect(await b.decideNight(wolfNightView())).toBeNull();
  });

  it("ngắt mạch khi gặp 429 và không gọi lại", async () => {
    const governor = new BotGovernor(60);
    let calls = 0;
    const b = brain(async () => {
      calls += 1;
      return new Response("{}", { status: 429 });
    }, governor);

    expect(await b.decideNight(wolfNightView())).toBeNull();
    expect(await b.decideNight(wolfNightView())).toBeNull();
    expect(calls).toBe(1);
    expect(governor.canCall("ABCDE")).toBe(false);
  });

  it("không gọi API khi đã chạm trần", async () => {
    const governor = new BotGovernor(0);
    let calls = 0;
    const b = brain(async () => {
      calls += 1;
      return reply({ think: "x", targetId: "v" });
    }, governor);

    expect(await b.decideNight(wolfNightView())).toBeNull();
    expect(calls).toBe(0);
  });

  it("không gọi API khi bot không có hành động", async () => {
    let calls = 0;
    const b = brain(async () => {
      calls += 1;
      return reply({ think: "x", targetId: "v" });
    });
    const v = { ...wolfNightView(), night: null };
    expect(await b.decideNight(v)).toBeNull();
    expect(calls).toBe(0);
  });
});

describe("GeminiBrain.decideDay", () => {
  it("cắt lời thoại về 300 ký tự", async () => {
    const long = "a".repeat(500);
    const b = brain(async () => reply({ think: "x", chat: long, voteTargetId: "v" }));
    const v = { ...wolfNightView(), phase: "DAY_DISCUSSION" as const, night: null };
    const d = await b.decideDay(v);
    expect(d?.chat?.length).toBe(300);
    expect(d?.voteTargetId).toBe("v");
  });

  it("chấp nhận voteTargetId null", async () => {
    const b = brain(async () => reply({ think: "x", chat: "ừ", voteTargetId: null }));
    const v = { ...wolfNightView(), phase: "DAY_DISCUSSION" as const, night: null };
    expect(await b.decideDay(v)).toEqual({ chat: "ừ", voteTargetId: null });
  });

  it("bỏ phiếu ngoài danh sách hợp lệ nhưng vẫn giữ lời thoại", async () => {
    const b = brain(async () => reply({ think: "x", chat: "ừ", voteTargetId: "khong-ton-tai" }));
    const v = { ...wolfNightView(), phase: "DAY_DISCUSSION" as const, night: null };
    expect(await b.decideDay(v)).toEqual({ chat: "ừ", voteTargetId: null });
  });
});
