import { describe, expect, it } from "vitest";
import type { RoomSnapshot } from "@masoi/shared";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { randomBrain } from "../src/bots/random-brain";

function view(over: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "ABCDE",
    hostId: "a",
    phase: "NIGHT",
    config: { ...DEFAULT_ROOM_CONFIG },
    round: 2,
    phaseEndsAt: null,
    you: { id: "a", name: "A", ready: true, connected: true, role: "WEREWOLF", alive: true },
    players: [
      { id: "a", name: "A", alive: true, isBot: true, role: "WEREWOLF" },
      { id: "b", name: "B", alive: true, isBot: false, role: "WEREWOLF" },
      { id: "c", name: "C", alive: true, isBot: false },
      { id: "d", name: "D", alive: false, isBot: false },
    ],
    night: { canAct: true, acted: false, wolfTarget: null, seerResult: null },
    hasVoted: false,
    myVote: null,
    noEliminationVoteCount: 0,
    discussionSkip: null,
    votesRevealed: false,
    nightHistory: [],
    lastNightDeaths: [],
    lastEliminated: null,
    winner: null,
    chatLog: [],
    log: [],
    ...over,
  };
}

describe("RandomBrain.decideNight", () => {
  it("Sói luôn chọn mục tiêu hợp lệ", async () => {
    const d = await randomBrain.decideNight(view());
    expect(d).toEqual({ ok: true, value: { action: "KILL", targetId: "c" } });
  });

  it("trả null khi không được hành động", async () => {
    const v = view({ night: { canAct: false, acted: false } });
    expect(await randomBrain.decideNight(v)).toEqual({ ok: true, value: null });
  });

  it("trả null cho Dân Làng", async () => {
    const v = view({
      you: { id: "a", name: "A", ready: true, connected: true, role: "VILLAGER", alive: true },
    });
    expect(await randomBrain.decideNight(v)).toEqual({ ok: true, value: null });
  });

  it("Phù Thuỷ dùng bình cứu khi còn và không nhận mục tiêu", async () => {
    const v = view({
      you: { id: "a", name: "A", ready: true, connected: true, role: "WITCH", alive: true },
      night: { canAct: true, acted: false, wolvesLocked: true, wolfTarget: "c", healUsed: false, poisonUsed: false },
    });
    expect(await randomBrain.decideNight(v)).toEqual({ ok: true, value: { action: "HEAL", targetId: null } });
  });

  it("Phù Thuỷ hết cả hai bình thì bỏ lượt", async () => {
    const v = view({
      you: { id: "a", name: "A", ready: true, connected: true, role: "WITCH", alive: true },
      night: { canAct: true, acted: false, healUsed: true, poisonUsed: true },
    });
    expect(await randomBrain.decideNight(v)).toEqual({ ok: true, value: null });
  });
});

describe("RandomBrain.decideDay", () => {
  it("không bao giờ chat", async () => {
    const d = await randomBrain.decideDay(view({ phase: "DAY_DISCUSSION" }));
    expect(d.value?.chat).toBeNull();
  });

  it("chọn phiếu trong danh sách hợp lệ", async () => {
    const d = await randomBrain.decideDay(view({ phase: "VOTING" }));
    expect(d.value?.vote).toEqual({ type: "PLAYER", targetId: expect.stringMatching(/^[bc]$/) });
  });

  it("trả null khi đã chết", async () => {
    const v = view({
      phase: "VOTING",
      you: { id: "a", name: "A", ready: true, connected: true, role: "WEREWOLF", alive: false },
    });
    expect(await randomBrain.decideDay(v)).toEqual({ ok: true, value: null });
  });
});
