import { describe, expect, it } from "vitest";
import type { PublicVoteChoice } from "@masoi/shared";
import { BOT_WEIGHTS_V16, BOT_WEIGHTS_V17, type BotWeights } from "../src/bot/config/weights";
import { BOT_WEIGHTS_PRESETS } from "../src/bot/config/presets";
import { linesSpokenThisRound, selectVote, voteHysteresis } from "../src/bot/decision/vote-decision";
import { createBotBrainState } from "../src/bot/memory/memory-store";
import { createBotPersonality } from "../src/bot/personality/personality";
import { createSeededRng } from "../src/bot/rng";
import type {
  BotBrainState,
  BotDecisionContext,
  BotEvidence,
  BotKnowledgeView,
  BotMemory,
  BotPersonality,
} from "../src/bot/types";

/**
 * P2.4 - phiếu dính hơn khi mục tiêu đang bầu là người nói nhiều.
 *
 * Đổi phiếu vì nhiễu nhỏ trước một người vừa nói ba câu bào chữa bị đọc là
 * "bot ngu": người đó vừa dồn sức thuyết phục, và con bot lật kèo mà không có
 * lý do nào mới. Trước một người im lặng thì cùng cú lật ấy không ai để ý.
 */

const PLAYERS = ["me", "a", "b", "c", "d"];

function personality(over: Partial<BotPersonality> = {}): BotPersonality {
  return { ...createBotPersonality(createSeededRng("p")), ...over };
}

function evidence(actorId: string): BotEvidence {
  return {
    id: `e:${actorId}`,
    kind: "ACCUSE",
    sourceId: "src",
    actorId,
    weight: 10,
    confidence: 0.5,
    round: 2,
    summary: "",
  };
}

function stateFor(): BotBrainState {
  const state = createBotBrainState("me", personality({ stubbornness: 0.5 }), PLAYERS);
  state.seenEventIds.push("src");
  state.suspicion.a = { score: 70, reasons: [evidence("a")], lastUpdatedRound: 2 };
  state.suspicion.b = { score: 73, reasons: [evidence("b")], lastUpdatedRound: 2 };
  return state;
}

/** Một câu của `actorId` trong vòng `round` mà parser hiểu được. */
function spoke(actorId: string, round: number, seq: number): BotMemory {
  return {
    id: `DEFEND:m:${actorId}:${seq}`,
    sourceId: `m:${actorId}:${round}:${seq}`,
    round,
    phase: "DAY_DISCUSSION",
    type: "DEFEND",
    actorId,
    targetId: "c",
    importance: 5,
    pinned: false,
    data: {},
  };
}

function context(over: Partial<BotKnowledgeView> = {}): BotDecisionContext {
  return {
    knowledge: {
      dayOfTruthClaims: {},
      neutralRolesInPlay: [],
      activeEventId: null,
      botId: "me",
      round: 2,
      phase: "VOTING",
      phaseStartedAt: 0,
      phaseEndsAt: 30_000,
      selfRole: "VILLAGER",
      players: PLAYERS.map((id) => ({ id, name: id.toUpperCase(), alive: true })),
      knownRoles: { me: "VILLAGER" },
      seerResult: null,
      sorcererResult: null,
      night: null,
      trialAccusedId: null,
      canFinalVote: false,
      hunterShot: null,
      publicVoteHistory: [],
      currentVoteCounts: { players: {}, noElimination: 0 },
      hasVoted: false,
      myVote: { type: "PLAYER", targetId: "a" },
      legalVoteChoices: PLAYERS.filter((id) => id !== "me").map(
        (targetId): PublicVoteChoice => ({ type: "PLAYER", targetId }),
      ),
      lastNightDeaths: [],
      ...over,
    },
    visibleChat: [],
  };
}

function chosen(vote: { choice: PublicVoteChoice }): string | null {
  return vote.choice.type === "PLAYER" ? vote.choice.targetId : null;
}

describe("preset v17", () => {
  it("v17 khác v16 ĐÚNG ở confidence và version; thresholdBase không đổi", () => {
    for (const key of Object.keys(BOT_WEIGHTS_V16) as Array<keyof BotWeights>) {
      if (key === "version" || key === "confidence") continue;
      expect(BOT_WEIGHTS_V17[key]).toBe(BOT_WEIGHTS_V16[key]);
    }
    expect(BOT_WEIGHTS_V17.confidence).toEqual({
      ...BOT_WEIGHTS_V16.confidence,
      talkerHysteresisBonus: 2,
    });
    expect(BOT_WEIGHTS_V17.confidence.talkerHysteresisLines).toBe(3);
    expect(BOT_WEIGHTS_V17.aggression.thresholdBase).toBe(BOT_WEIGHTS_V16.aggression.thresholdBase);
  });

  it("v1..v16 giữ bonus 0", () => {
    for (const preset of Object.values(BOT_WEIGHTS_PRESETS)) {
      if (Number(preset.version.split(".")[0]) >= 17) continue;
      expect(preset.confidence.talkerHysteresisBonus).toBe(0);
    }
  });
});

describe("đếm câu đã nói trong vòng", () => {
  it("đếm theo message, không theo memory: một câu sinh hai memory vẫn là một câu", () => {
    const state = stateFor();
    state.memories.push(spoke("a", 2, 1), spoke("a", 2, 2));
    // Cùng message thứ 2 nhưng parser tách thêm một DIRECT_ADDRESS.
    state.memories.push({ ...spoke("a", 2, 2), id: "DIRECT_ADDRESS:m:a:2", type: "DIRECT_ADDRESS" });
    // Vòng trước không tính; người khác không tính.
    state.memories.push(spoke("a", 1, 9), spoke("b", 2, 1));
    expect(linesSpokenThisRound(state, "a", 2)).toBe(2);
    expect(linesSpokenThisRound(state, "b", 2)).toBe(1);
    expect(linesSpokenThisRound(state, "c", 2)).toBe(0);
  });
});

describe("P2.4 hysteresis riêng cho mục tiêu nói nhiều", () => {
  it("voteHysteresis cộng bonus khi đủ số câu, và chỉ khi đó", () => {
    const p = personality({ stubbornness: 0.5 });
    const base = voteHysteresis(p, BOT_WEIGHTS_V17);
    expect(voteHysteresis(p, BOT_WEIGHTS_V17, 2)).toBe(base);
    expect(voteHysteresis(p, BOT_WEIGHTS_V17, 3)).toBe(base + 2);
    // v16: không đổi dù nói bao nhiêu.
    expect(voteHysteresis(p, BOT_WEIGHTS_V16, 3)).toBe(voteHysteresis(p, BOT_WEIGHTS_V16));
  });

  it("cùng bảng điểm: mục tiêu im thì đổi, mục tiêu nói 3 câu thì giữ", () => {
    // Jitter 0 để so đúng: chênh lệch a/b đặt GIỮA hysteresis thường và
    // hysteresis đã cộng bonus, nên chỉ số câu đã nói quyết định lá phiếu.
    const flat = () => 0.5; // jitter = (0.5 - 0.5) x span = 0
    const p = personality({ stubbornness: 0.5 });
    const plain = voteHysteresis(p, BOT_WEIGHTS_V17);
    const sticky = voteHysteresis(p, BOT_WEIGHTS_V17, 3);
    const gap = (plain + sticky) / 2;

    const silent = stateFor();
    silent.suspicion.b.score = 70 + gap;
    expect(chosen(selectVote(context(), silent, flat, BOT_WEIGHTS_V17))).toBe("b");

    const talker = stateFor();
    talker.suspicion.b.score = 70 + gap;
    talker.memories.push(spoke("a", 2, 1), spoke("a", 2, 2), spoke("a", 2, 3));
    expect(chosen(selectVote(context(), talker, flat, BOT_WEIGHTS_V17))).toBe("a");

    // Hai câu chưa đủ.
    const twoLines = stateFor();
    twoLines.suspicion.b.score = 70 + gap;
    twoLines.memories.push(spoke("a", 2, 1), spoke("a", 2, 2));
    expect(chosen(selectVote(context(), twoLines, flat, BOT_WEIGHTS_V17))).toBe("b");
  });

  it("v16: mục tiêu nói 3 câu vẫn đổi như cũ", () => {
    const flat = () => 0.5;
    const p = personality({ stubbornness: 0.5 });
    const plain = voteHysteresis(p, BOT_WEIGHTS_V16);
    const talker = stateFor();
    talker.suspicion.b.score = 70 + plain + 1;
    talker.memories.push(spoke("a", 2, 1), spoke("a", 2, 2), spoke("a", 2, 3));
    expect(chosen(selectVote(context(), talker, flat, BOT_WEIGHTS_V16))).toBe("b");
  });

  it("bằng chứng mới đủ mạnh vẫn lật được, dù mục tiêu nói nhiều", () => {
    const flat = () => 0.5;
    const talker = stateFor();
    talker.suspicion.b.score = 95;
    talker.memories.push(spoke("a", 2, 1), spoke("a", 2, 2), spoke("a", 2, 3));
    expect(chosen(selectVote(context(), talker, flat, BOT_WEIGHTS_V17))).toBe("b");
  });
});
