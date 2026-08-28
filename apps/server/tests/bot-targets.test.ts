import { describe, expect, it } from "vitest";
import type { RoomSnapshot } from "@masoi/shared";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { legalNightTargets, soloNightAction, witchActions } from "../src/bots/targets";

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
    serverNow: 0,
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

describe("soloNightAction", () => {
  it("ánh xạ vai sang hành động cố định", () => {
    expect(soloNightAction("WEREWOLF")).toBe("KILL");
    expect(soloNightAction("SEER")).toBe("SEE");
    expect(soloNightAction("GUARD")).toBe("GUARD");
  });

  it("trả null cho Phù Thuỷ vì vai này có lựa chọn", () => {
    expect(soloNightAction("WITCH")).toBeNull();
  });

  it("trả null cho Dân Làng và khi chưa biết vai", () => {
    expect(soloNightAction("VILLAGER")).toBeNull();
    expect(soloNightAction(undefined)).toBeNull();
  });
});

describe("legalNightTargets", () => {
  it("Sói không cắn được đồng bọn, chính mình, hay người chết", () => {
    expect(legalNightTargets(view(), "KILL")).toEqual(["c"]);
  });

  it("Tiên Tri không soi được chính mình", () => {
    const v = view({
      you: { id: "a", name: "A", ready: true, connected: true, role: "SEER", alive: true },
      players: [
        { id: "a", name: "A", alive: true, isBot: true },
        { id: "b", name: "B", alive: true, isBot: false },
        { id: "d", name: "D", alive: false, isBot: false },
      ],
    });
    expect(legalNightTargets(v, "SEE")).toEqual(["b"]);
  });

  it("Bảo Vệ loại mục tiêu đêm trước nhưng vẫn đỡ được chính mình", () => {
    const v = view({
      you: { id: "a", name: "A", ready: true, connected: true, role: "GUARD", alive: true },
      players: [
        { id: "a", name: "A", alive: true, isBot: true },
        { id: "b", name: "B", alive: true, isBot: false },
        { id: "c", name: "C", alive: true, isBot: false },
      ],
      night: { canAct: true, acted: false, guardPrevious: "b" },
    });
    expect(legalNightTargets(v, "GUARD")).toEqual(["a", "c"]);
  });

  it("Phù Thuỷ đầu độc được người còn sống, trừ người chết", () => {
    const v = view({
      you: { id: "a", name: "A", ready: true, connected: true, role: "WITCH", alive: true },
    });
    expect(legalNightTargets(v, "POISON")).toEqual(["a", "b", "c"]);
  });

  it("HEAL không nhận mục tiêu nên danh sách rỗng", () => {
    expect(legalNightTargets(view(), "HEAL")).toEqual([]);
  });
});

describe("witchActions", () => {
  it("còn cả hai bình thì có đủ ba lựa chọn", () => {
    const v = view({
      night: { canAct: true, acted: false, wolfTarget: "c", healUsed: false, poisonUsed: false },
    });
    expect(witchActions(v)).toEqual(["HEAL", "POISON", "SKIP"]);
  });

  it("đêm không ai bị cắn thì không chào HEAL dù bình còn", () => {
    const v = view({
      night: { canAct: true, acted: false, wolfTarget: null, healUsed: false, poisonUsed: false },
    });
    expect(witchActions(v)).toEqual(["POISON", "SKIP"]);
  });

  it("dùng hết bình cứu thì HEAL biến mất", () => {
    const v = view({ night: { canAct: true, acted: false, healUsed: true, poisonUsed: false } });
    expect(witchActions(v)).toEqual(["POISON", "SKIP"]);
  });

  it("hết cả hai bình thì chỉ còn SKIP", () => {
    const v = view({ night: { canAct: true, acted: false, healUsed: true, poisonUsed: true } });
    expect(witchActions(v)).toEqual(["SKIP"]);
  });
});

// Mục tiêu bỏ phiếu ban ngày không còn được tính lại ở tầng server: engine phát
// `legalVoteChoices` trong `botKnowledgeFor`, và luật hợp lệ chỉ nên có một bản.
// Coverage cho nó nằm ở packages/game-engine/tests/bot-knowledge.test.ts.
