import { describe, expect, it } from "vitest";
import { BotRuntime } from "../src/bot/BotRuntime";
import { DEFAULT_BOT_WEIGHTS, resolveWeights } from "../src/bot/config/weights";
import { createSeededRng } from "../src/bot/rng";
import { speechSemanticFingerprint } from "../src/bot/conversation/fingerprint";
import { assertSpeechScope } from "../src/bot/types";
import type {
  BotChatObservation,
  BotDecisionContext,
  BotPersonality,
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

function personality(over: Partial<BotPersonality> = {}): BotPersonality {
  return {
    aggressiveness: 0.6,
    talkativeness: 0.9,
    riskTolerance: 0.5,
    deceptionSkill: 0.5,
    analyticalSkill: 0.8,
    loyalty: 0.5,
    stubbornness: 0.3,
    ...over,
  };
}

function bot(seed: string, traits: Partial<BotPersonality> = {}): BotRuntime {
  return new BotRuntime({
    playerId: "me",
    rng: createSeededRng(seed),
    playerIds: PLAYERS.map((player) => player.id),
    personality: personality(traits),
  });
}

function context(chat: BotChatObservation[], round = 1): BotDecisionContext {
  return {
    knowledge: {
      dayOfTruthClaims: {},
      neutralRolesInPlay: [],
      activeEventId: null,
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
      legalVoteChoices: [
        { type: "PLAYER", targetId: "p2" },
        { type: "PLAYER", targetId: "p3" },
        { type: "PLAYER", targetId: "p4" },
        { type: "NO_ELIMINATION" },
      ],
      lastNightDeaths: [],
    },
    visibleChat: chat,
  };
}

function vote(targetId: string | null = "p3"): BotVoteIntention {
  return targetId === null
    ? { kind: "VOTE", choice: { type: "NO_ELIMINATION" }, confidence: 0.3, evidence: [] }
    : { kind: "VOTE", choice: { type: "PLAYER", targetId }, confidence: 0.6, evidence: [] };
}

function say(id: string, actorId: string, text: string): BotChatObservation {
  return { id, actorId, text, at: 0 };
}

/** Chạy nhiều seed và gom lại: hành vi có xác suất phải đo trên mẫu, không trên một lần. */
function overSeeds(
  count: number,
  run: (seed: string) => BotSpeechIntention | null,
): Array<BotSpeechIntention | null> {
  return Array.from({ length: count }, (_, i) => run(`s${i}`));
}

describe("trả lời khi bị nhắm vào", () => {
  it("bị buộc tội thì đáp lại đúng câu đó", () => {
    const spoken = overSeeds(60, (seed) => {
      const runtime = bot(seed);
      const ctx = context([say("m1", "p2", "Tôi nghi An")]);
      runtime.observe(ctx);
      return runtime.decideSpeech(ctx, vote());
    }).filter((item): item is BotSpeechIntention => item !== null);

    const replies = spoken.filter((item) => item.replyToMessageId === "m1");
    expect(replies.length).toBeGreaterThan(0);

    for (const reply of replies) {
      expect(reply.replyToActorId).toBe("p2");
      expect(["DISAGREE", "CHALLENGE", "ASK_EVIDENCE", "DEFEND", "REPLY"]).toContain(reply.kind);
    }
  });

  it("bị hỏi thẳng thì thường trả lời, nhưng KHÔNG phải lúc nào cũng", () => {
    // Trần dưới 1 là một yêu cầu của thiết kế, không phải một chi tiết cài đặt:
    // một BOT đáp 100% số câu hỏi nhắm vào nó là một tổng đài.
    const results = overSeeds(200, (seed) => {
      const runtime = bot(seed);
      const ctx = context([say("m1", "p2", "An ơi sao lúc nãy đổi phiếu?")]);
      runtime.observe(ctx);
      return runtime.decideSpeech(ctx, vote());
    });

    const answered = results.filter((item) => item?.replyToMessageId === "m1").length;
    const rate = answered / results.length;

    expect(rate).toBeGreaterThan(0.4);
    expect(rate).toBeLessThan(1);
  });

  it("không đáp hai lần cùng một câu", () => {
    const runtime = bot("no-double-reply");
    const ctx = context([say("m1", "p2", "Tôi nghi An")]);

    let replies = 0;
    for (let turn = 0; turn < 8; turn += 1) {
      runtime.observe(ctx);
      const speech = runtime.decideSpeech(ctx, vote());
      if (speech?.replyToMessageId === "m1") replies += 1;
      if (speech) runtime.recordSpeech(speech, 1);
    }

    expect(replies).toBeLessThanOrEqual(1);
  });
});

describe("đồng tình và phản đối", () => {
  it("tố đúng người mình nghi nhất thì có lúc đồng tình", () => {
    const kinds = new Set<string>();
    for (let i = 0; i < 80; i += 1) {
      const runtime = bot(`agree-${i}`);
      runtime.state.suspicion["p3"] = { score: 60, reasons: [], lastUpdatedRound: 1 };
      const ctx = context([say("m1", "p2", "Chi là sói")]);
      runtime.observe(ctx);
      const speech = runtime.decideSpeech(ctx, vote("p3"));
      if (speech) kinds.add(speech.kind);
    }
    expect(kinds.has("AGREE")).toBe(true);
  });

  it("bênh người mình nghi thì có lúc phản đối", () => {
    const kinds = new Set<string>();
    for (let i = 0; i < 80; i += 1) {
      const runtime = bot(`disagree-${i}`);
      runtime.state.suspicion["p3"] = { score: 60, reasons: [], lastUpdatedRound: 1 };
      const ctx = context([say("m1", "p2", "Tôi tin Chi")]);
      runtime.observe(ctx);
      const speech = runtime.decideSpeech(ctx, vote("p3"));
      if (speech) kinds.add(speech.kind);
    }
    expect([...kinds].some((kind) => kind === "DISAGREE" || kind === "ASK_EVIDENCE")).toBe(true);
  });

  it("nghe người khác nhận vai thì có lúc đòi bằng chứng", () => {
    const kinds = new Set<string>();
    for (let i = 0; i < 80; i += 1) {
      const runtime = bot(`claim-${i}`);
      const ctx = context([say("m1", "p2", "Tôi là Tiên Tri")]);
      runtime.observe(ctx);
      const speech = runtime.decideSpeech(ctx, vote());
      if (speech) kinds.add(speech.kind);
    }
    expect([...kinds].some((kind) => kind === "ASK_EVIDENCE" || kind === "CHALLENGE")).toBe(true);
  });
});

describe("không lặp lại chính mình", () => {
  it("không bao giờ trả về một ý đã nói trong cửa sổ chống lặp", () => {
    const runtime = bot("no-repeat");
    const ctx = context([]);
    const seen: string[] = [];

    for (let turn = 0; turn < 12; turn += 1) {
      runtime.observe(ctx);
      const speech = runtime.decideSpeech(ctx, vote("p3"));
      if (!speech) continue;
      const fingerprint = speechSemanticFingerprint(speech);
      // Cửa sổ mặc định: 6 bản ghi gần nhất, trong 2 vòng.
      expect(seen.slice(-6)).not.toContain(fingerprint);
      seen.push(fingerprint);
      runtime.recordSpeech(speech, 1);
    }

    expect(seen.length).toBeGreaterThan(0);
  });

  it("hết ý mới thì IM, chứ không bịa ra ý để tránh trùng", () => {
    // Đây là ranh giới chống Goodhart: nếu cơ chế chống lặp buộc BOT phải nói
    // cái gì đó khác, chỉ số lặp sẽ đẹp và chất lượng hội thoại sẽ tệ hơn.
    const runtime = bot("goes-quiet");
    const ctx = context([]);
    let silent = 0;

    for (let turn = 0; turn < 20; turn += 1) {
      runtime.observe(ctx);
      const speech = runtime.decideSpeech(ctx, vote("p3"));
      if (speech === null) silent += 1;
      else runtime.recordSpeech(speech, 1);
    }

    expect(silent).toBeGreaterThan(0);
  });
});

describe("không hồi quy hành vi Phase 3", () => {
  it("vẫn cáo buộc khi có bằng chứng mới", () => {
    const runtime = bot("still-accuses");
    const ctx = context([]);
    runtime.observe(ctx);

    const withEvidence: BotVoteIntention = {
      kind: "VOTE",
      choice: { type: "PLAYER", targetId: "p3" },
      confidence: 0.8,
      evidence: [
        {
          id: "e1",
          kind: "LATE_SWITCH",
          sourceId: "recap:1",
          actorId: "p3",
          targetId: "p2",
          weight: 7,
          confidence: 0.6,
          round: 1,
          summary: "Đổi phiếu sát giờ chót.",
        },
      ],
    };
    runtime.state.seenEventIds.push("recap:1");

    const kinds = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      const fresh = bot(`accuse-${i}`);
      fresh.observe(ctx);
      fresh.state.seenEventIds.push("recap:1");
      const speech = fresh.decideSpeech(ctx, withEvidence);
      if (speech) kinds.add(speech.kind);
    }
    expect(kinds.has("ACCUSE")).toBe(true);
  });

  it("phiếu trắng vẫn ra WITHHOLD", () => {
    const kinds = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      const runtime = bot(`withhold-${i}`);
      const ctx = context([]);
      runtime.observe(ctx);
      const speech = runtime.decideSpeech(ctx, vote(null));
      if (speech) kinds.add(speech.kind);
    }
    expect(kinds.has("WITHHOLD")).toBe(true);
  });
});

describe("ranh giới hiểu biết", () => {
  it("mọi ID và mọi bằng chứng đều nằm trong tầm nhìn đã lọc", () => {
    for (let i = 0; i < 500; i += 1) {
      const runtime = bot(`scope-${i}`);
      const chat = [
        say("m1", "p2", "Tôi nghi An"),
        say("m2", "p3", "Tôi là Tiên Tri"),
        say("m3", "p4", "An ơi nghĩ sao?"),
      ];
      const ctx = context(chat);
      runtime.observe(ctx);
      const speech = runtime.decideSpeech(ctx, vote("p3"));
      if (!speech) continue;

      expect(
        assertSpeechScope(speech, {
          players: PLAYERS,
          chat,
          seenSourceIds: runtime.state.seenEventIds,
        }),
        `seed ${i}`,
      ).toEqual([]);
    }
  });

  it("lời nói không đổi lá phiếu đã chốt", () => {
    for (let i = 0; i < 200; i += 1) {
      const runtime = bot(`sealed-${i}`);
      const ctx = context([say("m1", "p2", "Tôi nghi An")]);
      runtime.observe(ctx);

      const ballot = vote("p3");
      const sealed = JSON.stringify(ballot);
      runtime.decideSpeech(ctx, ballot);
      expect(JSON.stringify(ballot)).toBe(sealed);
    }
  });
});

describe("tất định và tính cách", () => {
  it("cùng seed, cùng đầu vào cho cùng chuỗi ý định", () => {
    const play = (): string => {
      const runtime = bot("replay-me");
      const ctx = context([say("m1", "p2", "Tôi nghi An"), say("m2", "p3", "Tôi là Tiên Tri")]);
      const log: string[] = [];
      for (let turn = 0; turn < 6; turn += 1) {
        runtime.observe(ctx);
        const speech = runtime.decideSpeech(ctx, vote("p3"));
        log.push(speech ? JSON.stringify(speech) : "im lặng");
        if (speech) runtime.recordSpeech(speech, 1);
      }
      return log.join("\n");
    };

    expect(play()).toBe(play());
  });

  it("người kiệm lời nói ít hơn người hoạt ngôn, đo trên mẫu", () => {
    const count = (traits: Partial<BotPersonality>): number => {
      let spoken = 0;
      for (let i = 0; i < 120; i += 1) {
        const runtime = bot(`talk-${i}`, traits);
        const ctx = context([say("m1", "p2", "An ơi nghĩ sao?")]);
        runtime.observe(ctx);
        if (runtime.decideSpeech(ctx, vote("p3")) !== null) spoken += 1;
      }
      return spoken;
    };

    const quiet = count({ talkativeness: 0.05, analyticalSkill: 0.05, aggressiveness: 0.05 });
    const loud = count({ talkativeness: 0.95, analyticalSkill: 0.95, aggressiveness: 0.95 });

    expect(loud).toBeGreaterThan(quiet);
    // Kể cả người kiệm lời nhất cũng phải đáp KHI BỊ GỌI THẲNG TÊN, ít nhất
    // đôi lần: câm tuyệt đối là bug, không phải tính cách.
    expect(quiet).toBeGreaterThan(0);
  });

  it("cấu hình trung tính tái lập đúng hành vi Phase 3", () => {
    // v2 tắt hết hội thoại. Với cùng đầu vào, lõi chỉ được ra ba loại cũ.
    const legacy = resolveWeights({}, DEFAULT_BOT_WEIGHTS);
    void legacy;

    const kinds = new Set<string>();
    for (let i = 0; i < 60; i += 1) {
      const runtime = new BotRuntime({
        playerId: "me",
        rng: createSeededRng(`legacy-${i}`),
        playerIds: PLAYERS.map((player) => player.id),
        personality: personality(),
        weights: resolveWeights({
          conversation: {
            directReplyFloor: 0,
            replyCeiling: 0,
            triggerFreshnessRounds: 0,
            humorChance: 0,
            reactionChance: 0,
          },
        }),
      });
      const ctx = context([say("m1", "p2", "Tôi nghi An")]);
      runtime.observe(ctx);
      const speech = runtime.decideSpeech(ctx, vote("p3"));
      if (speech) kinds.add(speech.kind);
    }

    // Không có bằng chứng mới trong lá phiếu nên nhánh ACCUSE không mở; điều
    // đáng khẳng định là KHÔNG loại nào của Phase 4 lọt ra.
    expect([...kinds].every((kind) => ["ACCUSE", "QUESTION", "WITHHOLD"].includes(kind))).toBe(
      true,
    );
    expect(kinds.size).toBeGreaterThan(0);
  });

  it("đổi ý được nói ra thành lời khi giả thuyết cũ không còn đứng vững", () => {
    const kinds = new Set<string>();
    for (let i = 0; i < 80; i += 1) {
      const runtime = bot(`mind-${i}`, { stubbornness: 0.05 });
      const ctx = context([]);
      runtime.observe(ctx);
      // Giả thuyết đang giữ nói nghi p2, nhưng lá phiếu giờ nhắm p3.
      runtime.state.currentTheory = { summary: "nghi p2 nhất sau vòng 1", evidenceIds: [] };
      runtime.state.suspicion["p3"] = { score: 60, reasons: [], lastUpdatedRound: 1 };
      const speech = runtime.decideSpeech(ctx, vote("p3"));
      if (speech) kinds.add(speech.kind);
    }
    expect(kinds.has("CHANGE_MIND")).toBe(true);
  });
});
