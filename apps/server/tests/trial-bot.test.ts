import { describe, expect, it, vi } from "vitest";
import type { RoomSnapshot } from "@masoi/shared";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { buildDefensePrompt } from "../src/bots/prompt";
import { interpretDefense } from "../src/bots/decide";
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
  it("dựng prompt biện hộ cho bị cáo và chỉ cho bị cáo", () => {
    const spec = buildDefensePrompt(accusedView());
    expect(spec).not.toBeNull();
    expect(spec!.user).toContain("3 phiếu");
    expect(spec!.schema.required).toEqual(expect.arrayContaining(["defense"]));
    expect(buildDefensePrompt(trialView())).toBeNull();
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

describe("RandomBrain trong phiên toà", () => {
  it("bị cáo luôn có một lời bào chữa", async () => {
    const result = await randomBrain.decideDefense(accusedView());
    expect(result.value?.chat).toBeTruthy();
  });

  it("người không phải bị cáo thì im lặng có chủ đích", async () => {
    expect(await randomBrain.decideDefense(trialView())).toEqual({ ok: true, value: null });
  });
});

describe("chuỗi dự phòng phủ lời bào chữa", () => {
  it("FallbackBrain chuyển tiếp decideDefense", async () => {
    const { FallbackBrain } = await import("../src/bots/fallback-brain");
    const broken = {
      name: "broken",
      renderDaySpeech: vi.fn(),
      decideDefense: vi.fn(async () => ({ ok: false as const })),
    };
    const chain = new FallbackBrain([broken, randomBrain]);

    expect((await chain.decideDefense(accusedView())).ok).toBe(true);
    expect(broken.decideDefense).toHaveBeenCalledOnce();
  });
});
