import { describe, expect, it } from "vitest";
import type { PublicVoteChoice } from "@masoi/shared";
import { BotRuntime } from "../src/bot/BotRuntime";
import {
  BOT_WEIGHTS_V13,
  BOT_WEIGHTS_V14,
  DEFAULT_BOT_WEIGHTS,
  type BotWeights,
} from "../src/bot/config/weights";
import { BOT_WEIGHTS_PRESETS } from "../src/bot/config/presets";
import { countHumansAlive, isHumanTable } from "../src/bot/knowledge";
import { createSeededRng } from "../src/bot/rng";
import { createBotPersonality } from "../src/bot/personality/personality";
import type {
  BotDecisionContext,
  BotKnowledgeView,
  BotPersonality,
  BotSpeechIntention,
} from "../src/bot/types";

/**
 * Hành vi "biết bàn có người" (P2).
 *
 * Bot được tune bằng self-play bot-vs-bot, và ở đó Tiên Tri hô kết quả ngay
 * ngày 1 là đúng: bầy Sói bot không đọc chat để cắn. Trước người thật thì
 * cùng nước đi đó là tự xin chết đêm 2. Mọi scenario ở đây dựng một bàn có
 * bốn người thật và một bàn toàn bot, cùng seed, và chỉ khác đúng cờ `isBot`.
 */

const PLAYERS = ["me", "a", "b", "c", "d", "e"];

function personality(over: Partial<BotPersonality> = {}): BotPersonality {
  return { ...createBotPersonality(createSeededRng("p")), ...over };
}

function players(humans: readonly string[]): BotKnowledgeView["players"] {
  return PLAYERS.map((id) => ({
    id,
    name: id.toUpperCase(),
    alive: true,
    isBot: !humans.includes(id),
  }));
}

function context(over: Partial<BotKnowledgeView> = {}): BotDecisionContext {
  return {
    knowledge: {
      dayOfTruthClaims: {},
      neutralRolesInPlay: [],
      activeEventId: null,
      botId: "me",
      round: 1,
      phase: "DAY_DISCUSSION",
      phaseStartedAt: 0,
      phaseEndsAt: 30_000,
      selfRole: "SEER",
      players: players([]),
      knownRoles: { me: "SEER" },
      seerResult: { targetId: "a", targetName: "A", isWolf: true, team: "wolves" },
      night: null,
      trialAccusedId: null,
      canFinalVote: false,
      hunterShot: null,
      publicVoteHistory: [],
      currentVoteCounts: { players: {}, noElimination: 0 },
      hasVoted: false,
      myVote: null,
      legalVoteChoices: PLAYERS.filter((id) => id !== "me").map(
        (targetId): PublicVoteChoice => ({ type: "PLAYER", targetId }),
      ),
      lastNightDeaths: [],
      ...over,
    },
    visibleChat: [],
  };
}

const FOUR_HUMANS = ["a", "b", "c", "d"];

function seerSpeaks(
  weights: BotWeights,
  humans: readonly string[],
  round: number,
  seed = "seer-table",
): { speech: BotSpeechIntention | null; voteTarget: string | null } {
  const runtime = new BotRuntime({
    playerId: "me",
    rng: createSeededRng(seed),
    playerIds: PLAYERS,
    personality: personality({ talkativeness: 1 }),
    weights,
  });
  const ctx = context({ round, players: players(humans) });
  runtime.observe(ctx);
  const vote = runtime.decideVote(ctx);
  const speech = runtime.decideSpeech(ctx, vote);
  return {
    speech,
    voteTarget: vote.choice.type === "PLAYER" ? vote.choice.targetId : null,
  };
}

function seerKinds(speech: BotSpeechIntention | null): string[] {
  return (speech?.evidence ?? [])
    .map((item) => item.kind)
    .filter((kind) => kind === "SEER_RESULT_WOLF" || kind === "SEER_RESULT_CLEAR");
}

describe("đếm người thật trên bàn", () => {
  it("chỉ đếm người còn sống và không phải bot; thiếu cờ isBot thì coi là bot", () => {
    const view = context({
      players: [
        { id: "me", name: "ME", alive: true, isBot: true },
        { id: "a", name: "A", alive: true, isBot: false },
        { id: "b", name: "B", alive: false, isBot: false },
        // Record self-play cũ không có cờ: không được đoán là người.
        { id: "c", name: "C", alive: true },
      ],
    }).knowledge;
    expect(countHumansAlive(view)).toBe(1);
  });

  it("bàn có người khi số người sống đạt ngưỡng humanTableThreshold", () => {
    expect(DEFAULT_BOT_WEIGHTS.deceptionRisk.humanTableThreshold).toBe(4);
    expect(isHumanTable(context({ players: players(["a", "b", "c"]) }).knowledge, DEFAULT_BOT_WEIGHTS)).toBe(false);
    expect(isHumanTable(context({ players: players(FOUR_HUMANS) }).knowledge, DEFAULT_BOT_WEIGHTS)).toBe(true);
  });
});

describe("preset v14", () => {
  it("v14 khác v13 ĐÚNG ở deceptionRisk và version", () => {
    for (const key of Object.keys(BOT_WEIGHTS_V13) as Array<keyof BotWeights>) {
      if (key === "version" || key === "deceptionRisk") continue;
      expect(BOT_WEIGHTS_V14[key]).toBe(BOT_WEIGHTS_V13[key]);
    }
    expect(BOT_WEIGHTS_V14.deceptionRisk).toEqual({
      ...BOT_WEIGHTS_V13.deceptionRisk,
      seerRevealRoundHuman: 2,
    });
  });

  it("v1..v13 giữ nhánh bàn-có-người TẮT (seerRevealRoundHuman = 0)", () => {
    // Điều kiện để mọi test tái lập khoá theo preset cũ còn đúng: dưới 0, cổng
    // thoát ngay ở phép so sánh đầu và không đọc tới `players` lần nào.
    for (const preset of Object.values(BOT_WEIGHTS_PRESETS)) {
      if (Number(preset.version.split(".")[0]) >= 14) continue;
      expect(preset.deceptionRisk.seerRevealRoundHuman).toBe(0);
    }
  });
});

describe("P2.1 Tiên Tri giấu kết quả khi bàn có người", () => {
  it("v14: bàn toàn bot vẫn khai ngay vòng 1 như v13", () => {
    const { speech } = seerSpeaks(BOT_WEIGHTS_V14, [], 1);
    expect(speech?.kind).toBe("CLAIM_ROLE");
    expect(seerKinds(speech)).toContain("SEER_RESULT_WOLF");
  });

  it("v14: bàn 4 người thì vòng 1 không khai, không đính kết quả soi, nhưng vẫn bầu đúng Sói", () => {
    const { speech, voteTarget } = seerSpeaks(BOT_WEIGHTS_V14, FOUR_HUMANS, 1);
    expect(voteTarget).toBe("a");
    expect(speech?.kind).not.toBe("CLAIM_ROLE");
    expect(seerKinds(speech)).toEqual([]);
  });

  it("v14: bàn 4 người thì từ vòng seerRevealRoundHuman trở đi khai như thường", () => {
    const round = BOT_WEIGHTS_V14.deceptionRisk.seerRevealRoundHuman;
    expect(round).toBeGreaterThan(1);
    const { speech } = seerSpeaks(BOT_WEIGHTS_V14, FOUR_HUMANS, round);
    expect(speech?.kind).toBe("CLAIM_ROLE");
    expect(seerKinds(speech)).toContain("SEER_RESULT_WOLF");
  });

  it("v14: bàn 3 người chưa đủ ngưỡng thì vẫn khai vòng 1", () => {
    const { speech } = seerSpeaks(BOT_WEIGHTS_V14, ["a", "b", "c"], 1);
    expect(speech?.kind).toBe("CLAIM_ROLE");
  });

  it("v13 giữ nguyên hành vi cũ: bàn 4 người vẫn khai vòng 1", () => {
    expect(BOT_WEIGHTS_V13.deceptionRisk.seerRevealRoundHuman).toBe(0);
    const { speech } = seerSpeaks(BOT_WEIGHTS_V13, FOUR_HUMANS, 1);
    expect(speech?.kind).toBe("CLAIM_ROLE");
    expect(seerKinds(speech)).toContain("SEER_RESULT_WOLF");
  });

  it("cùng seed thì hai lần chạy cho cùng một kết quả", () => {
    const first = seerSpeaks(BOT_WEIGHTS_V14, FOUR_HUMANS, 1, "replay");
    const second = seerSpeaks(BOT_WEIGHTS_V14, FOUR_HUMANS, 1, "replay");
    expect(second).toEqual(first);
  });

  it("bàn có người nhưng bị dồn phiếu thì vẫn lôi vai thật ra", () => {
    const runtime = new BotRuntime({
      playerId: "me",
      rng: createSeededRng("under-fire"),
      playerIds: PLAYERS,
      personality: personality({ talkativeness: 1 }),
      weights: BOT_WEIGHTS_V14,
    });
    const ctx = context({
      round: 1,
      players: players(FOUR_HUMANS),
      currentVoteCounts: { players: { me: 3 }, noElimination: 0 },
    });
    runtime.observe(ctx);
    const speech = runtime.decideSpeech(ctx, runtime.decideVote(ctx));
    expect(speech?.kind).toBe("CLAIM_ROLE");
  });
});
