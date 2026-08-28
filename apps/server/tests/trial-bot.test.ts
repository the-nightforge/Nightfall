import { describe, expect, it, vi } from "vitest";
import type { RoomSnapshot } from "@masoi/shared";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { buildDefensePrompt, buildFinalVotePrompt } from "../src/bots/prompt";
import { interpretDefense, interpretFinalVote } from "../src/bots/decide";
import { derivedFinalVote } from "../src/bots/targets";
import { randomBrain } from "../src/bots/random-brain";

const DEFENSE_TEXT = "Tôi soi ra Wolf là sói, treo tôi là làng thua đấy.";

function trialView(over: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "ABCDE",
    hostId: "v",
    phase: "FINAL_VOTE",
    config: { ...DEFAULT_ROOM_CONFIG },
    round: 2,
    phaseEndsAt: null,
    you: { id: "v", name: "Vân", ready: true, connected: true, role: "VILLAGER", alive: true },
    players: [
      { id: "v", name: "Vân", alive: true, isBot: true, voteCount: 0 },
      { id: "w", name: "Wolf", alive: true, isBot: false, voteCount: 0 },
      { id: "s", name: "Sang", alive: true, isBot: false, voteCount: 3 },
    ],
    night: null,
    hunterShot: null,
    trial: {
      accusedId: "s",
      accusedName: "Sang",
      guiltyVotes: 1,
      innocentVotes: 0,
      guiltyRequired: 2,
      canVote: true,
      hasVoted: false,
      myVote: null,
      canSpeak: false,
    },
    lastTrial: null,
    hasVoted: true,
    myVote: "s",
    noEliminationVoteCount: 0,
    serverNow: 0,
    discussionSkip: null,
    votesRevealed: true,
    nightHistory: [],
    hunterShots: [],
    lastNightDeaths: [],
    lastEliminated: null,
    winner: null,
    chatLog: [
      { id: "1", channel: "day", playerId: "v", playerName: "Vân", text: "Tôi nghi Sang", at: 1 },
      { id: "2", channel: "day", playerId: "s", playerName: "Sang", text: DEFENSE_TEXT, at: 2 },
    ],
    log: [],
  };
}

/** Snapshot của chính bị cáo trong pha biện hộ. */
function accusedView(): RoomSnapshot {
  const base = trialView();
  return {
    ...base,
    phase: "DEFENSE",
    you: { id: "s", name: "Sang", ready: true, connected: true, role: "VILLAGER", alive: true },
    trial: { ...base.trial!, canVote: false, canSpeak: true },
  };
}

const noop = () => undefined;

describe("prompt phiên toà", () => {
  it("prompt phiếu xác nhận kèm nguyên văn lời biện hộ vừa nghe", () => {
    const spec = buildFinalVotePrompt(trialView());
    expect(spec).not.toBeNull();
    // Không có dòng này thì cả pha biện hộ là một khoảng chờ vô nghĩa với bot.
    expect(spec!.user).toContain(DEFENSE_TEXT);
    expect(spec!.user).toContain("vừa tự bào chữa");
    expect(spec!.user).toContain("Cần 2 phiếu Treo");
    expect(spec!.schema.required).toEqual(expect.arrayContaining(["guilty"]));
  });

  it("không dựng prompt phiếu xác nhận cho chính bị cáo", () => {
    expect(buildFinalVotePrompt(accusedView())).toBeNull();
  });

  it("dựng prompt biện hộ cho bị cáo và chỉ cho bị cáo", () => {
    const spec = buildDefensePrompt(accusedView());
    expect(spec).not.toBeNull();
    expect(spec!.user).toContain("3 phiếu");
    expect(spec!.schema.required).toEqual(expect.arrayContaining(["defense"]));
    expect(buildDefensePrompt(trialView())).toBeNull();
  });
});

describe("interpretFinalVote", () => {
  it("nhận cả hai giá trị guilty", () => {
    const view = trialView();
    expect(interpretFinalVote(view, { think: "x", guilty: true }, noop)).toEqual({
      ok: true,
      value: { guilty: true },
    });
    expect(interpretFinalVote(view, { think: "x", guilty: false }, noop)).toEqual({
      ok: true,
      value: { guilty: false },
    });
  });

  it("thiếu guilty là lượt hỏng, không phải phiếu Tha", () => {
    const view = trialView();
    // Ép về false sẽ biến một lời gọi lỗi thành lá phiếu thật và chuỗi dự phòng
    // không bao giờ chạy.
    expect(interpretFinalVote(view, { think: "x" }, noop)).toEqual({ ok: false });
    expect(interpretFinalVote(view, { think: "x", guilty: "yes" }, noop)).toEqual({ ok: false });
  });
});

describe("interpretDefense", () => {
  it("cắt lời bào chữa theo giới hạn chat", () => {
    const long = "a".repeat(400);
    const result = interpretDefense(accusedView(), { think: "x", defense: long }, 300, noop);
    expect(result).toEqual({ ok: true, value: { chat: "a".repeat(300) } });
  });

  it("bào chữa rỗng là lượt hỏng chứ không phải im lặng có chủ đích", () => {
    expect(interpretDefense(accusedView(), { think: "x", defense: "   " }, 300, noop)).toEqual({
      ok: false,
    });
  });
});

describe("derivedFinalVote (đường lui)", () => {
  const wolfView = (accusedRole?: "WEREWOLF"): RoomSnapshot => {
    const base = trialView();
    return {
      ...base,
      you: { id: "v", name: "Vân", ready: true, connected: true, role: "WEREWOLF", alive: true },
      players: base.players.map((p) =>
        p.id === "s" && accusedRole ? { ...p, role: accusedRole } : p,
      ),
    };
  };

  it("Sói tha đồng bọn bị đưa ra toà", () => {
    expect(derivedFinalVote(wolfView("WEREWOLF"), undefined)).toBe(false);
  });

  it("Sói treo người không phải đồng bọn", () => {
    expect(derivedFinalVote(wolfView(), undefined)).toBe(true);
  });

  it("bot đã bỏ phiếu 'không treo ai' thì tha", () => {
    expect(derivedFinalVote(trialView(), { type: "NO_ELIMINATION" })).toBe(false);
  });

  it("dân làng mặc định treo dù đã đề cử người khác", () => {
    // Nếu đường lui chỉ treo người mình đã đề cử thì làng bot rải phiếu sẽ
    // không bao giờ đạt đa số tuyệt đối và Sói thắng bằng bào mòn.
    expect(derivedFinalVote(trialView(), { type: "PLAYER", targetId: "w" })).toBe(true);
  });

  it("không có phiên toà thì không treo ai", () => {
    expect(derivedFinalVote({ ...trialView(), trial: null }, undefined)).toBe(false);
  });
});

describe("RandomBrain trong phiên toà", () => {
  it("bị cáo luôn có một lời bào chữa", async () => {
    const result = await randomBrain.decideDefense(accusedView());
    expect(result.value?.chat).toBeTruthy();
  });

  it("người không phải bị cáo thì im lặng có chủ đích", async () => {
    expect(await randomBrain.decideDefense(trialView())).toEqual({ ok: true, value: null });
  });

  it("phiếu xác nhận đi theo luật suy ra", async () => {
    const guilty = await randomBrain.decideFinalVote(trialView(), { type: "PLAYER", targetId: "s" });
    expect(guilty.value).toEqual({ guilty: true });

    const spare = await randomBrain.decideFinalVote(trialView(), { type: "NO_ELIMINATION" });
    expect(spare.value).toEqual({ guilty: false });
  });

  it("không bỏ phiếu hộ người không được bỏ phiếu", async () => {
    expect(await randomBrain.decideFinalVote(accusedView())).toEqual({ ok: true, value: null });
  });
});

describe("chuỗi dự phòng phủ hết hai quyết định mới", () => {
  it("FallbackBrain chuyển tiếp decideDefense và decideFinalVote", async () => {
    const { FallbackBrain } = await import("../src/bots/fallback-brain");
    const broken = {
      name: "broken",
      decideNight: vi.fn(),
      decideDay: vi.fn(),
      decideHunterShot: vi.fn(),
      decideDefense: vi.fn(async () => ({ ok: false as const })),
      decideFinalVote: vi.fn(async () => ({ ok: false as const })),
    };
    const chain = new FallbackBrain([broken, randomBrain]);

    expect((await chain.decideFinalVote(trialView())).ok).toBe(true);
    expect(broken.decideFinalVote).toHaveBeenCalledOnce();
    expect((await chain.decideDefense(accusedView())).ok).toBe(true);
    expect(broken.decideDefense).toHaveBeenCalledOnce();
  });
});
