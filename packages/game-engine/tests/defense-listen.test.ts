import { describe, expect, it } from "vitest";
import type { DayVoteRecap, PublicVoteChoice } from "@masoi/shared";
import { BotRuntime } from "../src/bot/BotRuntime";
import { BOT_WEIGHTS_V11 } from "../src/bot/config/weights";
import type {
  BotChatObservation,
  BotDecisionContext,
  BotKnowledgeView,
  BotPersonality,
} from "../src/bot/types";

/**
 * Task 3 (Bot nghe): `ingestDefenseReview` nghe MỌI actor còn sống trong
 * window DEFENSE, không chỉ bị cáo. Đọc qua `observe` với defense window,
 * đúng chữ ký hiện tại của `observe` — không đoán field.
 *
 * Người chết đã bị loại ở thượng nguồn (`resolveChat` đẩy sang kênh `dead`,
 * `visibleChatLog` lọc theo kênh, harness chỉ phát lời của người sống):
 * bộ lọc ở đây chỉ chọn actor CÒN SỐNG trong window, không dựng lại loại trừ.
 */

const SHARP: BotPersonality = {
  aggressiveness: 0.5,
  talkativeness: 0.5,
  riskTolerance: 0.5,
  deceptionSkill: 0.5,
  analyticalSkill: 1,
  loyalty: 0.5,
  stubbornness: 0.5,
};

const PLAYERS = ["me", "a", "b", "c", "d"];

function player(targetId: string): PublicVoteChoice {
  return { type: "PLAYER", targetId };
}

function recap(
  round: number,
  ballots: Record<string, string | null>,
  accusedId: string | null = null,
): DayVoteRecap {
  const list = Object.entries(ballots).map(([voterId, to], index) => ({
    id: `${round}:nomination:${index + 1}`,
    round,
    voterId,
    previousChoice: null,
    choice: (to === null ? { type: "NO_ELIMINATION" } : player(to)) as PublicVoteChoice,
    castAt: 1_000 * (index + 1),
    phaseStartedAt: 0,
    phaseEndsAt: 30_000,
    sequence: index + 1,
  }));
  return {
    round,
    mutations: list,
    finalBallots: list.map((m) => ({ voterId: m.voterId, choice: m.choice })),
    nomination: accusedId ? { kind: "TRIAL", accusedId } : { kind: "NONE", reason: "tie" },
    finalJudgment: null,
  };
}

const trialRound: DayVoteRecap[] = [recap(2, { me: "c", a: "c", b: "c", c: "a", d: "c" }, "c")];
const defenseWindow = { startedAt: 40_000, endedAt: 70_000 };

function context(over: Partial<BotKnowledgeView> = {}, chat: BotChatObservation[] = []): BotDecisionContext {
  return {
    knowledge: {
      botId: "me",
      round: 2,
      phase: "FINAL_VOTE",
      phaseStartedAt: 0,
      phaseEndsAt: 30_000,
      selfRole: "VILLAGER",
      players: PLAYERS.map((id) => ({ id, name: id.toUpperCase(), alive: true })),
      knownRoles: { me: "VILLAGER" },
      seerResult: null,
      sorcererResult: null,
      neutralRolesInPlay: [],
      night: null,
      trialAccusedId: "c",
      trialDefense: defenseWindow,
      canFinalVote: true,
      hunterShot: null,
      publicVoteHistory: trialRound,
      currentVoteCounts: { players: {}, noElimination: 0 },
      hasVoted: false,
      myVote: null,
      legalVoteChoices: [],
      lastNightDeaths: [],
      activeEventId: null,
      dayOfTruthClaims: {},
      ...over,
    },
    visibleChat: chat,
  };
}

function runtime(): BotRuntime {
  return new BotRuntime({
    playerId: "me",
    rng: () => 0,
    playerIds: PLAYERS,
    personality: SHARP,
    weights: BOT_WEIGHTS_V11,
  });
}

describe("ingestDefenseReview nghe moi actor con song trong window", () => {
  it("loi cua nguoi khac trong window duoc nghe: phong da thao luan thi khong phat bi cao im lang oan", () => {
    // Bị cáo c im lặng, nhưng b buộc tội A ngay trong window. Bộ lọc cũ
    // (chỉ bị cáo) thấy `spoken === 0` nên phạt silent; bộ lọc mới thấy
    // phòng đã thảo luận nên không còn tín hiệu silent.
    const other: BotChatObservation = { id: "m1", actorId: "b", text: "Tôi nghi A", at: 50_000 };
    const bot = runtime();
    bot.observe(context({}, [other]));
    expect(bot.state.suspicion.c?.reasons.map((r) => r.kind)).not.toContain("DEFENSE_QUALITY");
  });

  it("giu nguyen tin hieu cua bi cao khi phong cung noi", () => {
    // Bị cáo lái sang A, người khác bênh bị cáo: tín hiệu deflect của bị cáo
    // còn nguyên, lời người khác không làm lệch mục tiêu.
    const deflect: BotChatObservation = { id: "m1", actorId: "c", text: "Tôi nghi A", at: 50_000 };
    const defend: BotChatObservation = { id: "m2", actorId: "b", text: "Tôi tin C", at: 55_000 };
    const bot = runtime();
    bot.observe(context({}, [deflect, defend]));
    const reason = bot.state.suspicion.c?.reasons.find((r) => r.kind === "DEFENSE_QUALITY");
    expect(reason?.id).toBe("2:nomination:result:DEFENSE_QUALITY:deflect:a");
    expect(reason?.targetId).toBe("a");
  });

  it("loi cua nguoi da chet trong window khong duoc tinh", () => {
    // Thượng nguồn đã cách ly người chết; bộ lọc chỉ chọn actor CÒN SỐNG nên
    // câu của người chết không thành "phòng đã thảo luận".
    const dead: BotChatObservation = { id: "m1", actorId: "b", text: "Tôi nghi A", at: 50_000 };
    const bot = runtime();
    bot.observe(
      context(
        {
          players: PLAYERS.map((id) => ({ id, name: id.toUpperCase(), alive: id !== "b" })),
        },
        [dead],
      ),
    );
    const reason = bot.state.suspicion.c?.reasons.find((r) => r.kind === "DEFENSE_QUALITY");
    expect(reason?.id).toBe("2:nomination:result:DEFENSE_QUALITY:silent");
  });
});
