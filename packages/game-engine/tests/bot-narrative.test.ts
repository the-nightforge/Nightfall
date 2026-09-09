import { describe, expect, it } from "vitest";
import { BotRuntime } from "../src/bot/BotRuntime";
import {
  buildNarrative,
  contradictsNarrative,
  liveStanceOn,
  stanceOfKind,
} from "../src/bot/conversation/narrative";
import { recordSpeechIntention } from "../src/bot/conversation/speech-memory";
import { planSpeech } from "../src/bot/conversation/speech-planner";
import { deriveSpeechStyle } from "../src/bot/personality/speech-style";
import { BOT_WEIGHTS_V24, BOT_WEIGHTS_V25 } from "../src/bot/config/weights";
import { createSeededRng } from "../src/bot/rng";
import type {
  BotBrainState,
  BotChatObservation,
  BotDecisionContext,
  BotPlayerKnowledge,
  BotSpeechIntention,
  BotVoteIntention,
} from "../src/bot/types";

const PLAYERS: BotPlayerKnowledge[] = [
  { id: "me", name: "An", alive: true },
  { id: "p2", name: "Bình", alive: true },
  { id: "p3", name: "Chi", alive: true },
  { id: "p4", name: "Dũng", alive: true },
];

function context(chat: BotChatObservation[], round = 1): BotDecisionContext {
  return {
    knowledge: {
      dayOfTruthClaims: {},
      activeEventId: null,
      neutralRolesInPlay: [],
      botId: "me",
      round,
      phase: "DAY_DISCUSSION",
      phaseStartedAt: 0,
      phaseEndsAt: null,
      selfRole: "VILLAGER",
      players: PLAYERS,
      knownRoles: {},
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

function say(id: string, actorId: string, text: string): BotChatObservation {
  return { id, actorId, text, at: 0 };
}

function runtime(seed = "narr", weights = BOT_WEIGHTS_V25): BotRuntime {
  return new BotRuntime({
    playerId: "me",
    rng: createSeededRng(seed),
    playerIds: PLAYERS.map((player) => player.id),
    weights,
  });
}

/** Ghi một lượt nói đã PHÁT, đúng cách `BotRuntime.recordSpeech` làm. */
function spoke(
  state: BotBrainState,
  kind: BotSpeechIntention["kind"],
  targetId: string,
  round: number,
  sourceIds: string[] = [],
): void {
  recordSpeechIntention(
    state,
    {
      kind,
      targetId,
      confidence: 0.6,
      evidence: sourceIds.map((sourceId) => ({
        id: sourceId,
        kind: "BANDWAGON" as const,
        sourceId,
        actorId: targetId,
        targetId,
        weight: 1,
        confidence: 0.8,
        round,
        summary: "x",
      })),
      tone: "NEUTRAL",
    },
    round,
    BOT_WEIGHTS_V25,
  );
}

describe("buildNarrative (§15)", () => {
  it("tố ai đó là một lập trường NGHI công khai", () => {
    const bot = runtime();
    spoke(bot.state, "ACCUSE", "p3", 1);

    const position = buildNarrative(bot.state, BOT_WEIGHTS_V25)["p3"];
    expect(position?.stance).toBe("suspect");
    expect(position?.createdAtRound).toBe(1);
    expect(position?.lastStatedRound).toBe(1);
  });

  it("bênh ai đó là một lập trường TIN công khai", () => {
    const bot = runtime();
    spoke(bot.state, "DEFEND", "p3", 1);
    expect(buildNarrative(bot.state, BOT_WEIGHTS_V25)["p3"]?.stance).toBe("trust");
  });

  it("lá phiếu công khai cũng là một lập trường NGHI", () => {
    const bot = runtime();
    bot.state.previousVotes.push({ round: 2, choice: { type: "PLAYER", targetId: "p4" } });
    expect(buildNarrative(bot.state, BOT_WEIGHTS_V25)["p4"]?.stance).toBe("suspect");
  });

  it("phiếu trắng không nói gì về ai cả", () => {
    const bot = runtime();
    bot.state.previousVotes.push({ round: 2, choice: { type: "NO_ELIMINATION" } });
    expect(buildNarrative(bot.state, BOT_WEIGHTS_V25)).toEqual({});
  });

  it("nói lại nhiều lần thì lập trường nặng thêm", () => {
    const bot = runtime();
    spoke(bot.state, "ACCUSE", "p3", 1);
    const one = buildNarrative(bot.state, BOT_WEIGHTS_V25)["p3"]!.strength;
    spoke(bot.state, "ACCUSE", "p3", 2);
    spoke(bot.state, "ACCUSE", "p3", 3);
    const three = buildNarrative(bot.state, BOT_WEIGHTS_V25)["p3"]!;

    expect(three.strength).toBeGreaterThan(one);
    expect(three.strength).toBeLessThanOrEqual(1);
    // Mạch không đứt thì `createdAtRound` vẫn là vòng đầu.
    expect(three.createdAtRound).toBe(1);
    expect(three.lastStatedRound).toBe(3);
  });

  it("đổi lập trường thì mạch cũ khép lại, không kéo dài createdAtRound", () => {
    const bot = runtime();
    spoke(bot.state, "DEFEND", "p3", 1);
    spoke(bot.state, "ACCUSE", "p3", 3);

    const position = buildNarrative(bot.state, BOT_WEIGHTS_V25)["p3"]!;
    expect(position.stance).toBe("suspect");
    expect(position.createdAtRound).toBe(3);
  });

  it("lập trường sau cùng thắng, và trong một vòng thì PHIẾU là tiếng nói cuối", () => {
    const bot = runtime();
    spoke(bot.state, "DEFEND", "p3", 2);
    bot.state.previousVotes.push({ round: 2, choice: { type: "PLAYER", targetId: "p3" } });
    expect(buildNarrative(bot.state, BOT_WEIGHTS_V25)["p3"]?.stance).toBe("suspect");
  });

  it("bằng chứng đã nêu kèm được giữ lại", () => {
    const bot = runtime();
    spoke(bot.state, "ACCUSE", "p3", 1, ["vote:1"]);
    expect(buildNarrative(bot.state, BOT_WEIGHTS_V25)["p3"]?.reasonIds).toContain("vote:1");
  });

  it("AGREE và CHALLENGE KHÔNG phải lập trường về phe", () => {
    expect(stanceOfKind("AGREE")).toBeNull();
    expect(stanceOfKind("CHALLENGE")).toBeNull();
    expect(stanceOfKind("ACCUSE")).toBe("suspect");
    expect(stanceOfKind("DEFEND")).toBe("trust");
  });
});

describe("liveStanceOn / contradictsNarrative", () => {
  it("lập trường hết hiệu lực sau cửa sổ vòng", () => {
    const bot = runtime();
    spoke(bot.state, "ACCUSE", "p3", 1);
    const narrative = buildNarrative(bot.state, BOT_WEIGHTS_V25);

    expect(liveStanceOn(narrative, "p3", 1, BOT_WEIGHTS_V25)).toBe("suspect");
    expect(liveStanceOn(narrative, "p3", 3, BOT_WEIGHTS_V25)).toBe("suspect");
    // `narrativeMemoryRounds = 3`: vòng 4 là vòng đầu tiên nó hết hạn.
    expect(liveStanceOn(narrative, "p3", 4, BOT_WEIGHTS_V25)).toBe("neutral");
  });

  it("cửa sổ 0 tắt hẳn cơ chế", () => {
    const bot = runtime("narr", BOT_WEIGHTS_V24);
    spoke(bot.state, "ACCUSE", "p3", 1);
    const narrative = buildNarrative(bot.state, BOT_WEIGHTS_V24);
    expect(liveStanceOn(narrative, "p3", 1, BOT_WEIGHTS_V24)).toBe("neutral");
  });

  it("chỉ ĐẢO NGƯỢC mới là mâu thuẫn", () => {
    const bot = runtime();
    spoke(bot.state, "ACCUSE", "p3", 1);
    const narrative = buildNarrative(bot.state, BOT_WEIGHTS_V25);

    expect(contradictsNarrative(narrative, "p3", "trust", 1, BOT_WEIGHTS_V25)).toBe(true);
    expect(contradictsNarrative(narrative, "p3", "suspect", 1, BOT_WEIGHTS_V25)).toBe(false);
    // Chưa từng nhắc tới thì không có gì để mâu thuẫn.
    expect(contradictsNarrative(narrative, "p4", "trust", 1, BOT_WEIGHTS_V25)).toBe(false);
  });
});

describe("planSpeech — quay xe phải NÓI RA", () => {
  const vote: BotVoteIntention = {
    kind: "VOTE",
    choice: { type: "PLAYER", targetId: "p3" },
    confidence: 0.7,
    evidence: [
      {
        id: "e1",
        kind: "BANDWAGON",
        sourceId: "vote:9",
        actorId: "p3",
        targetId: "p3",
        weight: 1,
        confidence: 0.8,
        round: 2,
        summary: "Chi theo phiếu muộn",
      },
    ],
  };

  /** BOT bướng bỉnh (concession thấp) đã công khai BÊNH Chi ở vòng 1. */
  function afterDefendingChi(weights = BOT_WEIGHTS_V25) {
    const bot = runtime("flip", weights);
    bot.observe(context([], 1));
    bot.state.personality.talkativeness = 1;
    bot.state.personality.stubbornness = 0.95;
    spoke(bot.state, "DEFEND", "p3", 1);

    const ctx = context([], 2);
    return {
      bot,
      speech: planSpeech({
        context: ctx,
        state: bot.state,
        vote,
        style: deriveSpeechStyle(bot.state.personality),
        rng: createSeededRng("flip-say"),
        weights,
      }),
    };
  }

  it("v25: tố người mình vừa bênh thì phải là CHANGE_MIND", () => {
    const { speech } = afterDefendingChi(BOT_WEIGHTS_V25);
    expect(speech?.kind).toBe("CHANGE_MIND");
    expect(speech?.targetId).toBe("p3");
    expect(speech?.reason).toContain("vòng 1");
  });

  it("v24: cùng tình huống, BOT bướng quay xe trong im lặng bằng một ACCUSE trần", () => {
    const { speech } = afterDefendingChi(BOT_WEIGHTS_V24);
    expect(speech?.kind).toBe("ACCUSE");
  });

  it("nói lại điều đã nói thì KHÔNG phải đổi ý", () => {
    const bot = runtime("same");
    bot.observe(context([], 1));
    bot.state.personality.talkativeness = 1;
    spoke(bot.state, "ACCUSE", "p3", 1);

    const speech = planSpeech({
      context: context([], 2),
      state: bot.state,
      vote,
      style: deriveSpeechStyle(bot.state.personality),
      rng: createSeededRng("same-say"),
      weights: BOT_WEIGHTS_V25,
    });
    expect(speech?.kind).not.toBe("CHANGE_MIND");
  });

  it("lập trường quá cũ thì thôi, không lôi ra đổi ý nữa", () => {
    const bot = runtime("stale");
    bot.observe(context([], 1));
    bot.state.personality.talkativeness = 1;
    bot.state.personality.stubbornness = 0.95;
    spoke(bot.state, "DEFEND", "p3", 1);

    const speech = planSpeech({
      context: context([], 6),
      state: bot.state,
      vote,
      style: deriveSpeechStyle(bot.state.personality),
      rng: createSeededRng("stale-say"),
      weights: BOT_WEIGHTS_V25,
    });
    expect(speech?.kind).not.toBe("CHANGE_MIND");
  });
});

describe("planSpeech — không bênh người mình vừa tố", () => {
  /**
   * BOT đã công khai tố Chi, rồi Bình tố Chi. Trigger `ACCUSED_MY_TRUSTED` đẩy
   * ra ứng viên `DEFEND`/`DISAGREE` cho Chi - và `DEFEND` ở đây là một cú lật
   * lập trường không lời giải thích.
   */
  function afterAccusingThenTrusting(weights = BOT_WEIGHTS_V25) {
    const bot = runtime("guard", weights);
    const ctx = context([say("m1", "p2", "Tôi nghi Chi")], 2);
    bot.observe(ctx);
    bot.state.personality.talkativeness = 0;
    // Ấm áp (trung thành cao, ít hung hăng) để `DEFEND` là ứng viên ĐẦU cho
    // `ACCUSED_MY_TRUSTED` - xem `candidatesFor`. Với người lạnh lùng thì
    // `DISAGREE` vốn đã đứng trước, và chốt chặn của v25 chẳng có gì để chặn.
    bot.state.personality.loyalty = 0.95;
    bot.state.personality.aggressiveness = 0.05;
    bot.state.trust["p3"] = { score: 40, reasons: [], lastUpdatedRound: 2 };
    spoke(bot.state, "ACCUSE", "p3", 1);

    return planSpeech({
      context: ctx,
      state: bot.state,
      vote: {
        kind: "VOTE",
        choice: { type: "PLAYER", targetId: "p4" },
        confidence: 0.5,
        evidence: [],
      },
      style: deriveSpeechStyle(bot.state.personality),
      rng: createSeededRng("guard-say"),
      weights,
    });
  }

  it("v25 không phát DEFEND cho người mình vừa tố", () => {
    expect(afterAccusingThenTrusting(BOT_WEIGHTS_V25)?.kind).not.toBe("DEFEND");
  });

  it("v24 vẫn phát — đây là chỗ hai bản khác nhau", () => {
    expect(afterAccusingThenTrusting(BOT_WEIGHTS_V24)?.kind).toBe("DEFEND");
  });
});
