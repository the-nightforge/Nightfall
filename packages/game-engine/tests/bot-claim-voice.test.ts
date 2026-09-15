import { describe, expect, it } from "vitest";
import type { Role } from "@masoi/shared";
import { BOT_WEIGHTS_PRESETS } from "../src/bot/config/presets";
import { BOT_WEIGHTS_V33, type BotWeights } from "../src/bot/config/weights";
import { planSpeech } from "../src/bot/conversation/speech-planner";
import { createBotBrainState } from "../src/bot/memory/memory-store";
import { deriveSpeechStyle } from "../src/bot/personality/speech-style";
import type { BotDecisionContext, BotPersonality } from "../src/bot/types";

/**
 * Giọng lời khai theo LOẠI lời khai, không theo tính cách (`claimToneByKind`).
 *
 * Tự khai mà đọc "Ép tôi lộ ra thì đây" là câu của một người bị dồn, trong khi
 * chưa ai dồn. Ba bản cùng đợt (nói tên người bị chỉ mặt, ngưỡng "sắp bị treo")
 * đã đo và bị xoá - xem `BOT_WEIGHTS_V37`.
 */

const PLAYERS = [
  { id: "p1", name: "An", alive: true },
  { id: "p2", name: "Bình", alive: true },
  { id: "p3", name: "Chi", alive: true },
  { id: "p4", name: "Dương", alive: true },
];

const PERSONALITY: BotPersonality = {
  aggressiveness: 0.5,
  talkativeness: 0.9,
  riskTolerance: 0.5,
  deceptionSkill: 0.5,
  analyticalSkill: 0.5,
  loyalty: 0.5,
  stubbornness: 0.5,
};

const HARSH = { ...deriveSpeechStyle(PERSONALITY), harshness: 0.9 };

const TONE_ON: BotWeights = {
  ...BOT_WEIGHTS_V33,
  claim: { ...BOT_WEIGHTS_V33.claim, claimToneByKind: 1 },
};

function plan(
  selfRole: Role,
  weights: BotWeights,
  knowledge: Partial<BotDecisionContext["knowledge"]> = {},
  seerHitOn?: string,
) {
  const context: BotDecisionContext = {
    knowledge: {
      activeEventId: null,
      neutralRolesInPlay: [],
      botId: "p2",
      // Vòng muộn: `seerHoldsForHumans` không được giữ kết quả soi lại.
      round: 5,
      phase: "DAY_DISCUSSION",
      phaseStartedAt: 0,
      phaseEndsAt: 60_000,
      selfRole,
      players: PLAYERS,
      knownRoles: { p2: selfRole },
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
      ...knowledge,
    },
    visibleChat: [],
  };
  const state = createBotBrainState("p2", PERSONALITY, PLAYERS.map((player) => player.id));
  if (seerHitOn) {
    state.knownInformation.seerResults.push({
      id: `SEER_RESULT:s1:p2`,
      sourceId: "s1",
      round: 4,
      phase: "NIGHT",
      type: "SEER_RESULT",
      actorId: "p2",
      targetId: seerHitOn,
      importance: 10,
      pinned: true,
      data: { isWolf: true },
    });
  }
  return planSpeech({
    context,
    state,
    vote: { kind: "VOTE", choice: { type: "PLAYER", targetId: seerHitOn ?? "p3" }, confidence: 0.8, evidence: [] },
    style: HARSH,
    rng: () => 0,
    weights,
  });
}

const leading = (votes: number) => ({ currentVoteCounts: { players: { p2: votes }, noElimination: 0 } });

describe("giọng theo loại lời khai", () => {
  it("tự khai (có kết quả soi) dùng giọng chắc, không phải giọng bị ép", () => {
    expect(plan("SEER", TONE_ON, {}, "p3")).toMatchObject({ kind: "CLAIM_ROLE", tone: "FIRM" });
  });

  it("khai lúc bị dồn vẫn được căng", () => {
    expect(plan("GUARD", TONE_ON, leading(3))).toMatchObject({ kind: "CLAIM_ROLE", tone: "TENSE" });
  });

  it("knob tắt (v33) giữ giọng theo tính cách", () => {
    expect(plan("SEER", BOT_WEIGHTS_V33, {}, "p3")).toMatchObject({ kind: "CLAIM_ROLE", tone: "TENSE" });
  });
});

describe("preset", () => {
  it("v37 = v33 + giọng khai theo loại", () => {
    expect(BOT_WEIGHTS_PRESETS["37.0.0"]).toEqual({ ...TONE_ON, version: "37.0.0" });
  });

  it("v34, v35, v36 (đo xong, trượt tiêu chí) không còn đăng ký", () => {
    for (const version of ["34.0.0", "35.0.0", "36.0.0"]) {
      expect(BOT_WEIGHTS_PRESETS[version]).toBeUndefined();
    }
  });
});
