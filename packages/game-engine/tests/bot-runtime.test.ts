import { describe, expect, it } from "vitest";
import type { DayVoteRecap, PublicVoteChoice, Role } from "@masoi/shared";
import { BotRuntime } from "../src/bot/BotRuntime";
import { selectVote } from "../src/bot/decision/vote-decision";
import { createSeededRng } from "../src/bot/rng";
import type {
  BotChatObservation,
  BotDecisionContext,
  BotEvidence,
  BotPersonality,
} from "../src/bot/types";

const BALANCED: BotPersonality = {
  aggressiveness: 0.5,
  talkativeness: 0.9,
  riskTolerance: 0.5,
  deceptionSkill: 0.5,
  analyticalSkill: 1,
  loyalty: 0.5,
  stubbornness: 0.5,
};

/** Jitter đúng bằng 0 để mọi khẳng định về thứ hạng là xác định. */
const noJitter = () => 0.5;

function context(options: {
  legal?: string[];
  players?: string[];
  knownRoles?: Record<string, Role>;
  myVote?: PublicVoteChoice | null;
  publicVoteHistory?: DayVoteRecap[];
  visibleChat?: BotChatObservation[];
  round?: number;
  selfRole?: Role;
} = {}): BotDecisionContext {
  const legal = options.legal ?? ["b", "c"];
  const players = options.players ?? ["me", ...legal];
  const myVote = options.myVote ?? null;
  return {
    knowledge: {
      botId: "me",
      round: options.round ?? 1,
      phase: "VOTING",
      phaseStartedAt: 0,
      phaseEndsAt: 30_000,
      selfRole: options.selfRole ?? "VILLAGER",
      players: players.map((id) => ({ id, name: id.toUpperCase(), alive: true })),
      knownRoles: options.knownRoles ?? { me: options.selfRole ?? "VILLAGER" },
      seerResult: null,
      night: null,
      trialAccusedId: null,
      canFinalVote: false,
      hunterShot: null,
      publicVoteHistory: options.publicVoteHistory ?? [],
      currentVoteCounts: { players: {}, noElimination: 0 },
      hasVoted: myVote !== null,
      myVote,
      legalVoteChoices: [
        ...legal.map((targetId): PublicVoteChoice => ({ type: "PLAYER", targetId })),
        { type: "NO_ELIMINATION" },
      ],
      lastNightDeaths: [],
    },
    visibleChat: options.visibleChat ?? [],
  };
}

function reason(actorId: string): BotEvidence {
  return {
    id: `ev-${actorId}`,
    kind: "TIE_BREAK",
    sourceId: `1:nomination:${actorId}`,
    actorId,
    targetId: "z",
    weight: 10,
    confidence: 0.7,
    round: 1,
    summary: `Phiếu phá hoà của ${actorId}.`,
  };
}

function runtimeWithEvidence(
  scores: Record<string, number>,
  overrides: Partial<BotPersonality> = {},
  rng = noJitter,
): BotRuntime {
  const runtime = new BotRuntime({
    playerId: "me",
    rng,
    playerIds: ["me", ...Object.keys(scores)],
    personality: { ...BALANCED, ...overrides },
  });
  for (const [playerId, score] of Object.entries(scores)) {
    runtime.state.seenEventIds.push(`1:nomination:${playerId}`);
    runtime.state.suspicion[playerId] = {
      score,
      reasons: [reason(playerId)],
      lastUpdatedRound: 1,
    };
  }
  return runtime;
}

function neutralRuntime(rng = noJitter): BotRuntime {
  return new BotRuntime({
    playerId: "me",
    rng,
    playerIds: ["me", "b", "c"],
    personality: BALANCED,
  });
}

describe("deterministic vote decision", () => {
  it("votes the strongest evidenced target", () => {
    const runtime = runtimeWithEvidence({ b: 62, c: 81 });

    const result = runtime.decideVote(context());

    expect(result.kind).toBe("VOTE");
    expect(result.choice).toEqual({ type: "PLAYER", targetId: "c" });
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence.every((item) => item.sourceId)).toBe(true);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("chooses no elimination below the confidence threshold", () => {
    expect(neutralRuntime().decideVote(context()).choice).toEqual({ type: "NO_ELIMINATION" });
  });

  it("does not switch without enough hysteresis", () => {
    const runtime = runtimeWithEvidence({ b: 70, c: 72 });

    const result = runtime.decideVote(context({ myVote: { type: "PLAYER", targetId: "b" } }));

    expect(result.choice).toEqual({ type: "PLAYER", targetId: "b" });
  });

  it("does switch once the gap clears hysteresis", () => {
    const runtime = runtimeWithEvidence({ b: 70, c: 95 });

    const result = runtime.decideVote(context({ myVote: { type: "PLAYER", targetId: "b" } }));

    expect(result.choice).toEqual({ type: "PLAYER", targetId: "c" });
  });

  it("applies a loyalty penalty to a known wolf teammate", () => {
    const runtime = runtimeWithEvidence({ ally: 90, villager: 75 });

    const result = runtime.decideVote(
      context({
        legal: ["ally", "villager"],
        selfRole: "WEREWOLF",
        knownRoles: { me: "WEREWOLF", ally: "WEREWOLF" },
      }),
    );

    expect(result.choice).toEqual({ type: "PLAYER", targetId: "villager" });
  });

  it("never votes for itself even when self is a legal target", () => {
    const runtime = runtimeWithEvidence({ b: 20 });
    runtime.state.suspicion.me = { score: 99, reasons: [reason("me")], lastUpdatedRound: 1 };

    const result = runtime.decideVote(context({ legal: ["me", "b"], players: ["me", "b"] }));

    expect(result.choice).not.toEqual({ type: "PLAYER", targetId: "me" });
  });

  it("refuses to vote a target whose only lead is jitter", () => {
    const runtime = new BotRuntime({
      playerId: "me",
      rng: () => 1,
      playerIds: ["me", "b", "c"],
      personality: BALANCED,
    });
    runtime.state.suspicion.b = { score: 99, reasons: [], lastUpdatedRound: 1 };

    expect(runtime.decideVote(context()).choice).toEqual({ type: "NO_ELIMINATION" });
  });

  it("only offers choices the engine said are legal", () => {
    const runtime = runtimeWithEvidence({ b: 90, c: 95 });

    const result = runtime.decideVote(context({ legal: ["b"], players: ["me", "b", "c"] }));

    expect(result.choice).toEqual({ type: "PLAYER", targetId: "b" });
  });

  it("returns no elimination when no player choice is legal at all", () => {
    const runtime = runtimeWithEvidence({ b: 90 });
    const empty = context();
    empty.knowledge.legalVoteChoices = [{ type: "NO_ELIMINATION" }];

    expect(runtime.decideVote(empty).choice).toEqual({ type: "NO_ELIMINATION" });
  });

  it("is a pure function of context, state and rng", () => {
    const left = runtimeWithEvidence({ b: 62, c: 81 });
    const right = runtimeWithEvidence({ b: 62, c: 81 });

    expect(selectVote(context(), left.state, createSeededRng("same"))).toEqual(
      selectVote(context(), right.state, createSeededRng("same")),
    );
  });
});

describe("bot runtime observation pipeline", () => {
  const recap: DayVoteRecap = {
    round: 1,
    mutations: [
      {
        id: "1:nomination:1",
        round: 1,
        voterId: "b",
        previousChoice: null,
        choice: { type: "PLAYER", targetId: "c" },
        castAt: 1_000,
        phaseStartedAt: 0,
        phaseEndsAt: 30_000,
        sequence: 1,
      },
      {
        id: "1:nomination:2",
        round: 1,
        voterId: "d",
        previousChoice: null,
        choice: { type: "PLAYER", targetId: "c" },
        castAt: 2_000,
        phaseStartedAt: 0,
        phaseEndsAt: 30_000,
        sequence: 2,
      },
      {
        id: "1:nomination:3",
        round: 1,
        voterId: "b",
        previousChoice: { type: "PLAYER", targetId: "c" },
        choice: { type: "PLAYER", targetId: "d" },
        castAt: 28_000,
        phaseStartedAt: 0,
        phaseEndsAt: 30_000,
        sequence: 3,
      },
    ],
    finalBallots: [
      { voterId: "b", choice: { type: "PLAYER", targetId: "d" } },
      { voterId: "d", choice: { type: "PLAYER", targetId: "c" } },
    ],
    nomination: { kind: "TRIAL", accusedId: "c" },
    finalJudgment: {
      ballots: [{ voterId: "b", guilty: true }],
      guilty: 1,
      innocent: 0,
      abstain: 0,
      lynched: true,
    },
  };

  function observingRuntime() {
    return new BotRuntime({
      playerId: "me",
      rng: createSeededRng("observe"),
      playerIds: ["me", "b", "c", "d"],
      personality: BALANCED,
    });
  }

  it("turns a public recap into memories and beliefs backed by real sources", () => {
    const runtime = observingRuntime();

    runtime.observe(context({ legal: ["b", "c", "d"], publicVoteHistory: [recap], round: 2 }));

    const sources = new Set(runtime.state.memories.map((memory) => memory.sourceId));
    expect(sources.has("1:nomination:3")).toBe(true);
    expect(runtime.state.memories.some((memory) => memory.type === "VOTE_CHANGED")).toBe(true);
    expect(runtime.state.memories.some((memory) => memory.type === "NOMINATED")).toBe(true);
    expect(runtime.state.memories.some((memory) => memory.type === "FINAL_JUDGMENT")).toBe(true);
    for (const entry of Object.values(runtime.state.suspicion)) {
      for (const item of entry.reasons) {
        expect(runtime.state.seenEventIds).toContain(item.sourceId);
      }
    }
  });

  it("applies the same recap only once", () => {
    const runtime = observingRuntime();
    const ctx = context({ legal: ["b", "c", "d"], publicVoteHistory: [recap], round: 2 });

    runtime.observe(ctx);
    const afterFirst = JSON.stringify(runtime.state);
    runtime.observe(ctx);

    expect(JSON.stringify(runtime.state)).toBe(afterFirst);
  });

  it("records night deaths and its own seer result", () => {
    const runtime = observingRuntime();
    const ctx = context({ legal: ["b", "c"], round: 2 });
    ctx.knowledge.lastNightDeaths = [{ playerId: "d", name: "D" }];
    ctx.knowledge.seerResult = { targetId: "b", targetName: "B", isWolf: true };

    runtime.observe(ctx);

    expect(runtime.state.memories).toContainEqual(
      expect.objectContaining({ type: "PLAYER_DIED", sourceId: "night-death:2:d" }),
    );
    expect(runtime.state.knownInformation.seerResults).toHaveLength(1);
    expect(runtime.state.knownInformation.seerResults[0]!.pinned).toBe(true);
  });

  it("keeps its own known roles in knownInformation rather than in suspicion", () => {
    const runtime = observingRuntime();

    runtime.observe(
      context({
        legal: ["b", "c"],
        selfRole: "WEREWOLF",
        knownRoles: { me: "WEREWOLF", b: "WEREWOLF" },
      }),
    );

    expect(runtime.state.knownInformation.knownRoles).toEqual({ me: "WEREWOLF", b: "WEREWOLF" });
    expect(runtime.state.suspicion).not.toHaveProperty("me");
  });

  it("ingests chat claims once and never stores the raw sentence", () => {
    const runtime = observingRuntime();
    const chat: BotChatObservation[] = [
      { id: "m1", actorId: "b", text: "Tôi là Tiên Tri và tôi vừa soi C", at: 10 },
      { id: "m2", actorId: "c", text: "Tôi nghi B", at: 20 },
    ];
    const ctx = context({ legal: ["b", "c", "d"], visibleChat: chat });

    runtime.observe(ctx);
    runtime.observe(ctx);

    expect(runtime.state.memories.filter((memory) => memory.sourceId === "m1")).toHaveLength(1);
    expect(runtime.state.claims).toHaveLength(1);
    expect(JSON.stringify(runtime.state)).not.toContain("vừa soi C");
  });

  it("keeps every belief score inside 0-100 after observing", () => {
    const runtime = observingRuntime();

    runtime.observe(context({ legal: ["b", "c", "d"], publicVoteHistory: [recap], round: 2 }));

    for (const map of [runtime.state.suspicion, runtime.state.trust]) {
      for (const entry of Object.values(map)) {
        expect(entry.score).toBeGreaterThanOrEqual(0);
        expect(entry.score).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("bot speech intention", () => {
  function talkativeRuntime(talkativeness: number, rngValue: number) {
    const runtime = new BotRuntime({
      playerId: "me",
      rng: () => rngValue,
      playerIds: ["me", "b", "c"],
      personality: { ...BALANCED, talkativeness },
    });
    runtime.state.seenEventIds.push("1:nomination:c");
    runtime.state.suspicion.c = { score: 90, reasons: [reason("c")], lastUpdatedRound: 1 };
    return runtime;
  }

  it("stays silent when the personality draw says so", () => {
    const runtime = talkativeRuntime(0.2, 0.9);

    expect(runtime.decideSpeech(context(), runtime.decideVote(context()))).toBeNull();
  });

  it("accuses with at most three unspoken pieces of evidence", () => {
    const runtime = talkativeRuntime(1, 0.1);
    const vote = runtime.decideVote(context());

    const speech = runtime.decideSpeech(context(), vote)!;

    expect(speech.kind).toBe("ACCUSE");
    expect(speech.targetId).toBe("c");
    expect(speech.evidence.length).toBeGreaterThan(0);
    expect(speech.evidence.length).toBeLessThanOrEqual(3);
  });

  it("withholds when the deterministic vote is no elimination", () => {
    const runtime = new BotRuntime({
      playerId: "me",
      rng: () => 0.1,
      playerIds: ["me", "b", "c"],
      personality: BALANCED,
    });

    const speech = runtime.decideSpeech(context(), runtime.decideVote(context()))!;

    expect(speech.kind).toBe("WITHHOLD");
    expect(speech.evidence).toEqual([]);
    expect(speech.targetId).toBeUndefined();
  });

  it("does not repeat evidence it already used", () => {
    const runtime = talkativeRuntime(1, 0.1);
    const vote = runtime.decideVote(context());
    const first = runtime.decideSpeech(context(), vote)!;
    runtime.recordSpeech(first, 1);

    const second = runtime.decideSpeech(context(), vote)!;

    expect(first.kind).toBe("ACCUSE");
    expect(second.kind).toBe("QUESTION");
    expect(second.evidence).toEqual([]);
  });

  it("never puts evidence without a source into a speech", () => {
    const runtime = talkativeRuntime(1, 0.1);
    const vote = runtime.decideVote(context());

    const speech = runtime.decideSpeech(context(), vote)!;

    for (const item of speech.evidence) {
      expect(runtime.state.seenEventIds).toContain(item.sourceId);
    }
  });
});
