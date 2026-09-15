import { describe, expect, it } from "vitest";
import { BotRuntime } from "../src/bot/BotRuntime";
import type { BotChatObservation, BotDecisionContext } from "../src/bot/types";

/**
 * Chỉ lời nói ở kênh `day` là lời nói CÔNG KHAI.
 *
 * Ban đêm bot Sói nhận chat hang Sói, và bot đã chết nhận cả hang Sói lẫn kênh
 * người chết (`visibleChatLog`). Thấy thì được - người thật cũng thấy - nhưng
 * `ingestChat` ghi mọi câu nó parse thành "công khai buộc tội" hay một lời khai
 * trước cả làng. Một con Sói bàn trong hang "t sẽ nhận tiên tri" không phải là
 * đã khai trước làng.
 */
function nightContext(chat: BotChatObservation[]): BotDecisionContext {
  return {
    knowledge: {
      activeEventId: null,
      neutralRolesInPlay: [],
      botId: "me",
      round: 2,
      phase: "NIGHT",
      phaseStartedAt: 0,
      phaseEndsAt: 30_000,
      selfRole: "WEREWOLF",
      players: [
        { id: "me", name: "ME", alive: true },
        { id: "p1", name: "P1", alive: true },
        { id: "p9", name: "P9", alive: true },
      ],
      knownRoles: { me: "WEREWOLF", p1: "WEREWOLF" },
      seerResult: null,
      sorcererResult: null,
      night: null,
      trialAccusedId: null,
      canFinalVote: false,
      hunterShot: null,
      publicVoteHistory: [],
      currentVoteCounts: { players: {}, noElimination: 0 },
      hasVoted: false,
      myVote: null,
      legalVoteChoices: [],
      lastNightDeaths: [],
    },
    visibleChat: chat,
  };
}

function observed(chat: BotChatObservation[]): BotRuntime {
  const runtime = new BotRuntime({ playerId: "me", rng: () => 0.5, playerIds: ["me", "p1", "p9"] });
  runtime.observe(nightContext(chat));
  return runtime;
}

const fromChat = (runtime: BotRuntime, ids: string[]) =>
  runtime.state.memories.filter((memory) => ids.includes(memory.sourceId));

describe("ingestChat chỉ đọc kênh công khai", () => {
  it("lời bàn trong hang Sói không thành lời khai hay cáo buộc", () => {
    const runtime = observed([
      { id: "den-1", actorId: "p1", text: "tôi là tiên tri", at: 1, channel: "wolves" },
      { id: "den-2", actorId: "p1", text: "tôi nghi P9", at: 2, channel: "wolves" },
    ]);

    expect(runtime.state.claims).toEqual([]);
    expect(fromChat(runtime, ["den-1", "den-2"])).toEqual([]);
    // Vẫn đánh dấu đã đọc, để lần observe sau không parse lại.
    expect(runtime.state.seenEventIds).toEqual(expect.arrayContaining(["den-1", "den-2"]));
  });

  it("kênh người chết cũng không phải lời nói công khai", () => {
    const runtime = observed([{ id: "dead-1", actorId: "p9", text: "tôi là tiên tri", at: 1, channel: "dead" }]);

    expect(runtime.state.claims).toEqual([]);
    expect(fromChat(runtime, ["dead-1"])).toEqual([]);
  });

  it("đối chứng: cùng câu đó ở kênh day, hoặc không ghi kênh, vẫn được đọc", () => {
    for (const channel of ["day", undefined]) {
      const runtime = observed([{ id: "day-1", actorId: "p9", text: "tôi là tiên tri", at: 1, channel }]);
      expect(runtime.state.claims.map((memory) => memory.sourceId)).toEqual(["day-1"]);
    }
  });
});
