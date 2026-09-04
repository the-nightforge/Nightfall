import { describe, expect, it } from "vitest";
import { BotRuntime } from "../src/bot/BotRuntime";
import { DEFAULT_BOT_WEIGHTS, resolveWeights } from "../src/bot/config/weights";
import { createSeededRng } from "../src/bot/rng";
import { findConversationTriggers } from "../src/bot/conversation/triggers";
import { markReplied } from "../src/bot/conversation/speech-memory";
import type {
  BotChatObservation,
  BotDecisionContext,
  BotPlayerKnowledge,
} from "../src/bot/types";

const PLAYERS: BotPlayerKnowledge[] = [
  { id: "me", name: "An", alive: true },
  { id: "p2", name: "Bình", alive: true },
  { id: "p3", name: "Chi", alive: true },
  { id: "dead", name: "Dũng", alive: false },
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

function runtime(seed = "trigger"): BotRuntime {
  return new BotRuntime({
    playerId: "me",
    rng: createSeededRng(seed),
    playerIds: PLAYERS.map((player) => player.id),
  });
}

function say(id: string, actorId: string, text: string): BotChatObservation {
  return { id, actorId, text, at: 0 };
}

/** Quan sát chat rồi trả về trigger, đúng thứ tự lõi sẽ thấy. */
function triggersFor(
  bot: BotRuntime,
  chat: BotChatObservation[],
  round = 1,
  weights = DEFAULT_BOT_WEIGHTS,
) {
  const ctx = context(chat, round);
  bot.observe(ctx);
  return findConversationTriggers(ctx, bot.state, weights);
}

describe("findConversationTriggers", () => {
  it("ai đó buộc tội chính mình là trigger ưu tiên cao nhất", () => {
    const found = triggersFor(runtime(), [say("m1", "p2", "Tôi nghi An")]);
    const accused = found.find((item) => item.kind === "ACCUSED_ME");

    expect(accused).toBeDefined();
    expect(accused!.messageId).toBe("m1");
    expect(accused!.actorId).toBe("p2");
    expect(accused!.subjectId).toBe("me");
    expect(found[0]!.kind).toBe("ACCUSED_ME");
  });

  it("bị hỏi thẳng được ưu tiên hơn chỉ bị gọi tên", () => {
    const found = triggersFor(runtime(), [
      say("m1", "p2", "An giải thích đi"),
      say("m2", "p3", "An ơi sao lúc nãy đổi phiếu?"),
    ]);

    const asked = found.find((item) => item.kind === "QUESTIONED_ME");
    const called = found.find((item) => item.kind === "ADDRESSED_ME");
    expect(asked).toBeDefined();
    expect(called).toBeDefined();
    expect(asked!.priority).toBeGreaterThan(called!.priority);
  });

  it("người mình TIN bị tố thì đáng bênh", () => {
    const bot = runtime();
    bot.state.trust["p3"] = { score: 40, reasons: [], lastUpdatedRound: 1 };

    const found = triggersFor(bot, [say("m1", "p2", "Tôi nghi Chi")]);
    const defend = found.find((item) => item.kind === "ACCUSED_MY_TRUSTED");
    expect(defend).toBeDefined();
    expect(defend!.subjectId).toBe("p3");
  });

  it("người mình NGHI được bênh thì đáng phản đối", () => {
    const bot = runtime();
    bot.state.suspicion["p3"] = { score: 40, reasons: [], lastUpdatedRound: 1 };

    const found = triggersFor(bot, [say("m1", "p2", "Tôi tin Chi")]);
    expect(found.map((item) => item.kind)).toContain("DEFENDED_MY_SUSPECT");
  });

  it("nghe người khác nhận vai là một móc treo hội thoại", () => {
    const found = triggersFor(runtime(), [say("m1", "p2", "Tôi là Tiên Tri")]);
    expect(found.map((item) => item.kind)).toContain("ROLE_CLAIM_HEARD");
  });

  it("ai đó tố đúng người mình đang nghi nhất thì đáng đồng tình", () => {
    const bot = runtime();
    bot.state.suspicion["p3"] = { score: 60, reasons: [], lastUpdatedRound: 1 };

    const found = triggersFor(bot, [say("m1", "p2", "Chi là sói")]);
    expect(found.map((item) => item.kind)).toContain("SHARED_SUSPICION");
  });

  it("lời nhận vai bị phản bác nhắm vào mình là trigger riêng", () => {
    const found = triggersFor(runtime(), [
      say("m1", "p2", "An không thể là Tiên Tri, tôi mới là Tiên Tri"),
    ]);
    expect(found.map((item) => item.kind)).toContain("COUNTER_CLAIM_ON_ME");
  });

  it("không tự phản hồi lời của chính mình", () => {
    const found = triggersFor(runtime(), [say("m1", "me", "Tôi nghi An")]);
    expect(found).toEqual([]);
  });

  it("bỏ qua người đã chết", () => {
    // Người chết nói trong kênh riêng của họ; nếu một câu như vậy lọt vào tầm
    // nhìn thì đáp lại nó là tự lộ rằng mình đọc được kênh không được phép.
    const found = triggersFor(runtime(), [say("m1", "dead", "Tôi nghi An")]);
    expect(found).toEqual([]);
  });

  it("bỏ qua câu đã trả lời rồi", () => {
    const bot = runtime();
    const chat = [say("m1", "p2", "Tôi nghi An")];
    expect(triggersFor(bot, chat)).not.toEqual([]);

    markReplied(bot.state, "m1", DEFAULT_BOT_WEIGHTS);
    expect(triggersFor(bot, chat)).toEqual([]);
  });

  it("bỏ qua câu đã quá cũ", () => {
    const bot = runtime();
    const chat = [say("m1", "p2", "Tôi nghi An")];
    expect(triggersFor(bot, chat, 1)).not.toEqual([]);
    // `triggerFreshnessRounds: 1` nghĩa là chỉ vòng hiện tại còn đáng đáp.
    expect(triggersFor(bot, chat, 3)).toEqual([]);
  });

  it("cửa sổ bằng 0 tắt hẳn - đúng hành vi Phase 3", () => {
    const off = resolveWeights({ conversation: { triggerFreshnessRounds: 0 } });
    expect(triggersFor(runtime(), [say("m1", "p2", "Tôi nghi An")], 1, off)).toEqual([]);
  });

  it("thứ tự trả về ổn định và không phụ thuộc thứ tự chèn", () => {
    const bot = runtime();
    const chat = [
      say("m3", "p3", "An ơi nghĩ sao?"),
      say("m1", "p2", "Tôi nghi An"),
      say("m2", "p3", "Tôi là Tiên Tri"),
    ];

    const first = triggersFor(bot, chat).map((item) => `${item.kind}:${item.messageId}`);
    const second = findConversationTriggers(
      context(chat),
      bot.state,
      DEFAULT_BOT_WEIGHTS,
    ).map((item) => `${item.kind}:${item.messageId}`);

    expect(second).toEqual(first);
    // Sắp theo (ưu tiên giảm dần, messageId tăng dần): không có chỗ nào để thứ
    // tự chèn của Map hay thứ tự đọc chat lọt vào kết quả.
    const priorities = findConversationTriggers(context(chat), bot.state, DEFAULT_BOT_WEIGHTS).map(
      (item) => item.priority,
    );
    expect([...priorities].sort((a, b) => b - a)).toEqual(priorities);
  });

  it("mọi trigger đều trỏ tới một message và một người có thật", () => {
    const bot = runtime();
    bot.state.trust["p3"] = { score: 40, reasons: [], lastUpdatedRound: 1 };
    const chat = [
      say("m1", "p2", "Tôi nghi An"),
      say("m2", "p2", "Tôi nghi Chi"),
      say("m3", "p3", "An ơi nghĩ sao?"),
      say("m4", "p3", "Tôi là Tiên Tri"),
    ];

    const known = new Set(PLAYERS.map((player) => player.id));
    const messages = new Set(chat.map((item) => item.id));
    for (const trigger of triggersFor(bot, chat)) {
      expect(messages.has(trigger.messageId), trigger.messageId).toBe(true);
      expect(known.has(trigger.actorId), trigger.actorId).toBe(true);
      expect(known.has(trigger.subjectId), trigger.subjectId).toBe(true);
    }
  });
});
