import { describe, expect, it } from "vitest";
import { BOT_WEIGHTS_V4 } from "../src/bot/config/weights";
import { decideChatClaim } from "../src/bot/decision/claim-decision";
import { createBotBrainState } from "../src/bot/memory/memory-store";
import { createBotPersonality } from "../src/bot/personality/personality";
import { createSeededRng } from "../src/bot/rng";
import type { BotBrainState, BotDecisionContext, BotMemory } from "../src/bot/types";

const IDS = ["p1", "p2", "p3", "p4"];

function stateFor(id: string): BotBrainState {
  return createBotBrainState(id, createBotPersonality(createSeededRng(id)), IDS);
}

function contextFor(
  selfId: string,
  selfRole: BotDecisionContext["knowledge"]["selfRole"],
  overrides: Partial<BotDecisionContext["knowledge"]> = {},
): BotDecisionContext {
  return {
    knowledge: {
      botId: selfId,
      round: 2,
      phase: "DAY_DISCUSSION",
      phaseStartedAt: 0,
      phaseEndsAt: null,
      selfRole,
      players: IDS.map((id) => ({ id, name: id.toUpperCase(), alive: true })),
      knownRoles: { [selfId]: selfRole },
      seerResult: null,
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
      activeEventId: null,
      dayOfTruthClaims: {},
      ...overrides,
    },
    visibleChat: [],
  };
}

function seerResultMemory(targetId: string): BotMemory {
  return {
    id: `SEER_RESULT:s1:p1`,
    sourceId: "s1",
    round: 1,
    phase: "NIGHT",
    type: "SEER_RESULT",
    actorId: "p1",
    targetId,
    importance: 10,
    pinned: true,
    data: { isWolf: true },
  };
}

describe("decideChatClaim", () => {
  it("Tiên Tri cầm kết quả trúng Sói thì khai và chỉ đích danh", () => {
    const state = stateFor("p1");
    state.knownInformation.seerResults.push(seerResultMemory("p3"));
    const claim = decideChatClaim(
      contextFor("p1", "SEER"),
      state,
      createSeededRng("a"),
      null,
      BOT_WEIGHTS_V4,
    );
    expect(claim?.kind).toBe("PROACTIVE");
    expect(claim?.role).toBe("SEER");
    expect(claim?.accusedId).toBe("p3");
  });

  it("Tiên Tri chỉ soi ra người sạch thì im — lời khai đó không chỉ được ai", () => {
    const state = stateFor("p1");
    state.knownInformation.seerResults.push({ ...seerResultMemory("p3"), data: { isWolf: false } });
    expect(
      decideChatClaim(
        contextFor("p1", "SEER"),
        state,
        createSeededRng("a"),
        null,
        BOT_WEIGHTS_V4,
      ),
    ).toBeNull();
  });

  it("khai xong thì không khai lại — một BOT một vai cả ván", () => {
    const state = stateFor("p1");
    state.knownInformation.seerResults.push(seerResultMemory("p3"));
    state.myClaim = { role: "SEER", round: 1 };
    expect(
      decideChatClaim(
        contextFor("p1", "SEER"),
        state,
        createSeededRng("a"),
        null,
        BOT_WEIGHTS_V4,
      ),
    ).toBeNull();
  });

  it("Bảo Vệ đang dẫn phiếu thì lôi vai ra làm lá bài cuối", () => {
    const claim = decideChatClaim(
      contextFor("p1", "GUARD", { currentVoteCounts: { players: { p1: 3 }, noElimination: 0 } }),
      stateFor("p1"),
      createSeededRng("a"),
      null,
      BOT_WEIGHTS_V4,
    );
    expect(claim?.kind).toBe("UNDER_FIRE");
    expect(claim?.role).toBe("GUARD");
  });

  it("Dân Làng bị dồn thì KHÔNG khai: câu đó không mang tin gì", () => {
    expect(
      decideChatClaim(
        contextFor("p1", "VILLAGER", { currentVoteCounts: { players: { p1: 3 }, noElimination: 0 } }),
        stateFor("p1"),
        createSeededRng("a"),
        null,
        BOT_WEIGHTS_V4,
      ),
    ).toBeNull();
  });

  it("nhóm claim tắt thì không ai khai gì, và không rút số ngẫu nhiên nào", () => {
    const state = stateFor("p1");
    state.knownInformation.seerResults.push(seerResultMemory("p3"));
    let draws = 0;
    const counting = () => {
      draws += 1;
      return 0.5;
    };
    const off = { ...BOT_WEIGHTS_V4, claim: { ...BOT_WEIGHTS_V4.claim, accusationWeight: 0 } };
    expect(decideChatClaim(contextFor("p1", "SEER"), state, counting, null, off)).toBeNull();
    expect(draws).toBe(0);
  });

  it("chỉ con Sói playerId nhỏ nhất được khai láo, và chỉ từ vòng 2", () => {
    const wolves = { p2: "WEREWOLF" as const, p3: "WEREWOLF" as const };
    const early = decideChatClaim(
      contextFor("p2", "WEREWOLF", { round: 1, knownRoles: { p2: "WEREWOLF", p3: "WEREWOLF" } }),
      stateFor("p2"),
      createSeededRng("a"),
      null,
      BOT_WEIGHTS_V4,
    );
    expect(early).toBeNull();

    const notChosen = decideChatClaim(
      contextFor("p3", "WEREWOLF", { knownRoles: wolves }),
      stateFor("p3"),
      createSeededRng("a"),
      null,
      BOT_WEIGHTS_V4,
    );
    expect(notChosen).toBeNull();
  });

  it("Sói khai láo thì chỉ đích danh đúng người nó định treo, do caller truyền vào chứ không tự đọc state", () => {
    // rng luôn trả 0: chắc chắn dưới ngưỡng `dare` (> 0 vì mọi hệ số đều dương),
    // nên nhánh khai láo chắc chắn kích hoạt bất kể personality sinh ra thế nào.
    const zero = () => 0;
    const claim = decideChatClaim(
      contextFor("p2", "WEREWOLF", { knownRoles: { p2: "WEREWOLF", p3: "WEREWOLF" } }),
      stateFor("p2"),
      zero,
      "p4",
      BOT_WEIGHTS_V4,
    );
    expect(claim?.kind).toBe("PROACTIVE");
    expect(claim?.role).toBe("SEER");
    expect(claim?.accusedId).toBe("p4");
  });
});
