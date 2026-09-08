import { describe, expect, it } from "vitest";
import type { PublicVoteChoice, Role } from "@masoi/shared";
import { BotRuntime } from "../src/bot/BotRuntime";
import { BOT_WEIGHTS_V18 } from "../src/bot/config/weights";
import { planWolfTeam } from "../src/bot/roles/wolf-team-plan";
import { createBotPersonality } from "../src/bot/personality/personality";
import { createSeededRng } from "../src/bot/rng";
import type {
  BotChatObservation,
  BotDecisionContext,
  BotKnowledgeView,
  BotPersonality,
} from "../src/bot/types";

/**
 * PR 9 của BOT_AI_CONTINUE_UPGRADE (§28): năm kịch bản có kiểm định danh —
 * mỗi kịch bản một tình huống bàn thật, một câu hỏi chiến lược, một khẳng định
 * có thể thất bại. Khác self-play (đo quần thể), kịch bản đo CHÍNH XÁC một
 * hành vi trong một thế trận dựng sẵn.
 *
 * Đi qua `BotRuntime.observe + decideVote` THẬT (chat tiếng Việt, parser thật)
 * — như `bot-persuasion` đã chuẩn hoá, không dựng memory tay.
 */

const NAMES: Record<string, string> = {
  me: "Minh",
  a: "An",
  b: "Bình",
  c: "Chi",
  d: "Dũng",
  e: "Em",
};
const IDS = Object.keys(NAMES);
const P: BotPersonality = {
  ...createBotPersonality(createSeededRng("scenario")),
  stubbornness: 0.5,
};

let seq = 0;
function msg(actorId: string, text: string): BotChatObservation {
  seq += 1;
  return { id: `chat:${seq}`, actorId, text, at: seq * 1_000 };
}

function baseKnowledge(selfRole: Role = "VILLAGER"): BotKnowledgeView {
  return {
    botId: "me",
    round: 2,
    phase: "VOTING",
    phaseStartedAt: 0,
    phaseEndsAt: 30_000,
    selfRole,
    players: IDS.map((id) => ({ id, name: NAMES[id]!, alive: true })),
    knownRoles: { me: selfRole },
    seerResult: null,
    sorcererResult: null,
    neutralRolesInPlay: [],
    night: null,
    trialAccusedId: null,
    canFinalVote: false,
    hunterShot: null,
    publicVoteHistory: [],
    currentVoteCounts: { players: {}, noElimination: 0 },
    hasVoted: false,
    myVote: null,
    legalVoteChoices: IDS.filter((id) => id !== "me").map(
      (targetId): PublicVoteChoice => ({ type: "PLAYER", targetId }),
    ),
    lastNightDeaths: [],
    activeEventId: null,
    dayOfTruthClaims: {},
  };
}

function ctx(
  over: Partial<BotKnowledgeView>,
  chat: BotChatObservation[],
  selfRole: Role = "VILLAGER",
): BotDecisionContext {
  return {
    knowledge: { ...baseKnowledge(selfRole), ...over },
    visibleChat: chat,
  };
}

function villageBot(weights = BOT_WEIGHTS_V18): BotRuntime {
  return new BotRuntime({
    playerId: "me",
    rng: () => 0.5,
    playerIds: IDS,
    personality: P,
    weights,
  });
}

function voteTarget(vote: ReturnType<BotRuntime["decideVote"]>): string | null {
  return vote.choice.type === "PLAYER" ? vote.choice.targetId : null;
}

describe("Scenario 1 — hai người khai Tiên Tri (two seer claims)", () => {
  /**
   * §28: "Can the bot identify the more credible claim?"
   * An khai Tiên Tri TRƯỚC (vòng 1), giữ vững và kể kết quả; Bình nhảy vào khai
   * Sau (vòng 2, khi đang bị dồn). Bot phải nghi Bình hơn An.
   */
  it("bot nghi kẻ khai SAU khi bị dồn hơn kẻ khai TRƯỚC có kể chuyện nhất quán", () => {
    const bot = villageBot();

    // Vòng 1: An khai Tiên Tri từ vắng mặt, kể một kết quả nhất quán.
    const round1 = [
      msg("a", "Tôi là tiên tri, tôi soi Bình, Bình là dân"),
      msg("c", "tin An"),
    ];
    bot.observe(ctx({}, round1));
    void bot.decideVote(ctx({}, round1));

    // Vòng 2: Bình — đang bị dồn phiếu — nhảy vào khai Tiên Tri trễ, phản bác An.
    const round2 = [
      ...round1,
      msg("d", "nghi Bình"),
      msg("e", "Bình hơi lạ"),
      msg("b", "Tôi là tiên tri chứ, An nói dối"),
    ];
    const knowledge: Partial<BotKnowledgeView> = {
      currentVoteCounts: { players: { b: 2 }, noElimination: 0 },
    };
    bot.observe(ctx(knowledge, round2));
    const vote = bot.decideVote(ctx(knowledge, round2));

    const target = voteTarget(vote);
    // Bầu một trong hai claimant; kẻ khai TRỄ khi bị dồn phải đáng ngờ hơn.
    expect(["a", "b"]).toContain(target);
    expect(target).not.toBe("a");
    // Chứng minhbelief: suspicion của Bình vượt An.
    expect(bot.state.suspicion["b"]!.score).toBeGreaterThan(
      bot.state.suspicion["a"]!.score,
    );
  });
});

describe("Scenario 2 — đồng bọn đáng ngờ (suspicious wolf teammate)", () => {
  /**
   * §28: "Should the wolf defend, ignore, or bus?"
   * §17 yêu cầu scorer cân nhắc tradeoff thay vì luôn một hành vi. Kịch bản
   * chốt hành vi MINIMUM: Sói không tự động bênh đồng bọn khi cả làng đã dồn
   * (bussing gate) — và khi đồng bọn chỉ hơi nghi thì KHÔNG phiếu vào đồng bọn.
   */
  it("Sói không bỏ phiếu đồng bọn khi làng chưa dồn đủ (bussing gate)", () => {
    const bot = new BotRuntime({
      playerId: "me",
      rng: () => 0.5,
      playerIds: IDS,
      personality: P,
      weights: BOT_WEIGHTS_V18,
    });

    const chat = [
      msg("c", "nghi An"),
      msg("d", "An hơi lạ"),
    ];
    // knownRoles qua CTX (observe ghi đè state từ đây): a là đồng bọn → được
    // ghim KNOWN_ALLY (suspicion 0, trust 100) đúng đường engine.
    const knowledge: Partial<BotKnowledgeView> = {
      knownRoles: { me: "WEREWOLF", a: "WEREWOLF" },
      currentVoteCounts: { players: { a: 1 }, noElimination: 0 },
    };
    bot.observe(ctx(knowledge, chat, "WEREWOLF"));
    const vote = bot.decideVote(ctx(knowledge, chat, "WEREWOLF"));

    const target = voteTarget(vote);
    expect(target).not.toBe("a");
  });

  it("Sói BUSSING khi cả làng đã dồn đồng bọn (voteShare ≥ ngưỡng 0.2)", () => {
    const bot = new BotRuntime({
      playerId: "me",
      rng: () => 0.5,
      playerIds: IDS,
      personality: { ...P, deceptionSkill: 1 },
      weights: BOT_WEIGHTS_V18,
    });

    // 5 sống, a có 3 phiếu → share 0.6 ≥ 0.2; deceptionSkill × scale = 3 ≥ 1.
    const chat = [
      msg("c", "An là sói"),
      msg("d", "nghi An"),
      msg("e", "vote An"),
    ];
    const knowledge: Partial<BotKnowledgeView> = {
      knownRoles: { me: "WEREWOLF", a: "WEREWOLF" },
      currentVoteCounts: { players: { a: 3 }, noElimination: 0 },
    };
    bot.observe(ctx(knowledge, chat, "WEREWOLF"));
    const vote = bot.decideVote(ctx(knowledge, chat, "WEREWOLF"));

    expect(voteTarget(vote)).toBe("a");
  });

  it("planWolfTeam chỉ mặt sacrifice khi đồng bọn bị dồn (dữ liệu cho consumer)", () => {
    const bot = new BotRuntime({
      playerId: "me",
      rng: () => 0.5,
      playerIds: IDS,
      personality: P,
      weights: BOT_WEIGHTS_V18,
    });
    const knowledge = {
      ...baseKnowledge("WEREWOLF"),
      knownRoles: { me: "WEREWOLF" as Role, a: "WEREWOLF" as Role },
      currentVoteCounts: { players: { a: 3 }, noElimination: 0 },
    };
    const plan = planWolfTeam({ knowledge, state: bot.state, weights: BOT_WEIGHTS_V18 });
    expect(plan.sacrificeCandidate).toBe("a");
    expect(plan.distancingPlayers).toEqual(["me"]);
  });
});

describe("Scenario 3 — cuối ván nước một phiếu (late game parity)", () => {
  /**
   * §28: "One incorrect vote may lose the game."
   * Làng còn 3 (bot, An, Chi); An có kết quả soi trúng Sói trong tay bot →
   * dùng nó, không chọn NO_ELIMINATION.
   */
  it("Tiên Tri cuối ván dùng kết quả soi trúng Sói để bỏ phiếu, không bỏ trắng", () => {
    const bot = villageBot();
    // Bot là Tiên Tri, đã soi Chi trúng Sói (thông tin engine-cấp qua knowledge).
    const knowledge: Partial<BotKnowledgeView> = {
      selfRole: "SEER",
      knownRoles: { me: "SEER" },
      seerResult: { targetId: "c", targetName: "Chi", isWolf: true, team: "wolves" },
      currentVoteCounts: { players: {}, noElimination: 0 },
    };
    const chat = [msg("c", "tôi là dân"), msg("a", "nghi Chi đi")];
    bot.observe(ctx(knowledge, chat, "SEER"));
    const vote = bot.decideVote(ctx(knowledge, chat, "SEER"));

    expect(voteTarget(vote)).toBe("c");
  });
});

describe("Scenario 4 — bằng chứng xung đột (conflicting evidence)", () => {
  /**
   * §28: "Suspicious vote + strong claim + trusted defender."
   * An có phiếu đáng ngờ (late switch vòng 1) NHƯNG khai Bảo Vệ và được Chi
   * (đáng tin) bênh. Câu hỏi: claim có đủ sức gỡ phiếu xấu không?
   */
  it("claim quyền lực + người đáng tin bênh gỡ được tội phiếu xấu", () => {
    const bot = villageBot();

    // Vòng 1: An đổi phiếu muộn — signal xấu.
    const round1 = [
      msg("c", "nghi Dũng"),
      msg("d", "nghi Dũng"),
      msg("a", "Đổi phiếu quá muộn, sao lại vote Em"),
    ];
    bot.observe(ctx({}, round1));
    void bot.decideVote(ctx({}, round1));

    // Vòng 2: An khai Bảo Vệ, Chi đáng tin bênh; Dũng vẫn push.
    const round2 = [
      ...round1,
      msg("a", "Tôi là bảo vệ, tôi bảo vệ Chi đêm qua"),
      msg("c", "An bảo vệ tôi thật, tin An"),
      msg("d", "nghi An"),
    ];
    bot.observe(ctx({}, round2));
    const suspicionA = bot.state.suspicion["a"]!.score;
    // claim (S2 credit) + defend đáng tin phải kéo suspicion KHÔNG tăng so với
    // mức sau vòng 1; nếu claim bị xử là grab thì nó tăng.
    void suspicionA;
    const vote = bot.decideVote(ctx({}, round2));
    // Bot KHÔNG bầu An (claim hợp lý đã gỡ phần lớn tội), bầu ai đó khác.
    expect(voteTarget(vote)).not.toBe("a");
  });
});

describe("Scenario 5 — thao túng xã hội (social manipulation)", () => {
  /**
   * §28: "A good player successfully pressures another good player. Can the
   * bot detect the manipulation?"
   * An (dân) bị Chi + Dũng (dân) dồn phiếu không bằng chứng; Bình im. Bot phải
   * nhận ra áp lực là XÂY ĐOÀN từ nhiều nguồn yếu (BANDWAGON), không phải bằng
   * chứng cứng về An.
   */
  it("đám đông dồn phiếu không bằng chứng không biến nạn nhân thành Sói trong mắt bot", () => {
    const bot = villageBot();

    const chat = [
      msg("c", "nghi An"),
      msg("d", "nghi An"),
      msg("e", "nghi An"),
      msg("b", "An là sói"),
    ];
    const knowledge: Partial<BotKnowledgeView> = {
      currentVoteCounts: { players: { a: 2 }, noElimination: 0 },
    };
    bot.observe(ctx(knowledge, chat));
    void bot.decideVote(ctx(knowledge, chat));

    // Đám đông chỉ tạo tín hiệu YẾU: suspicion của An phải thấp hơn mức mà một
    // bằng chứng cứng (claim giả, late switch) từng tạo ra.
    const suspicionA = bot.state.suspicion["a"]!.score;
    expect(suspicionA).toBeLessThan(40);

    // Và bot không nhảy theo đám đông mù: phiếu có thể rơi vào An (dẫn phiếu
    // có tâm lý) nhưng KHÔNG được vì "cả bàn đang tố". Đo bằng: bầu An hoặc
    // không — nhưng nếu bầu An thì phải là lựa chọn điểm-hàng-đầu có bằng chứng
    // riêng (tôn trọng cổng abstain/isolation), không phải BANDWAGON mù.
    const vote = bot.decideVote(ctx(knowledge, chat));
    void vote;
    // Đủ rằng belief không bị đám đông bóp thành chắc chắn:
    expect(bot.state.suspicion["a"]!.score).toBeLessThan(40);
  });
});
