import { beforeEach, describe, expect, it } from "vitest";
import type { DayVoteRecap, PublicVoteChoice, VoteMutation } from "@masoi/shared";
import { createBotPersonality } from "../src/bot/personality/personality";
import { createSeededRng } from "../src/bot/rng";
import { createBotBrainState, remember } from "../src/bot/memory/memory-store";
import { analyzeVoteRecap } from "../src/bot/analysis/vote-analysis";
import {
  applySocialEvidence,
  possibleWolfPairScore,
  socialEdgeKey,
} from "../src/bot/analysis/social-analysis";
import { analyzeChat } from "../src/bot/analysis/chat-analysis";
import type {
  BotBrainState,
  BotChatObservation,
  BotEvidence,
  BotPlayerKnowledge,
} from "../src/bot/types";

const PHASE_START = 0;
const PHASE_END = 30_000;

function player(targetId: string): PublicVoteChoice {
  return { type: "PLAYER", targetId };
}

function mutations(
  entries: Array<{ voterId: string; from: string | null; to: string; at: number }>,
  round = 2,
): VoteMutation[] {
  return entries.map((entry, index) => ({
    id: `${round}:nomination:${index + 1}`,
    round,
    voterId: entry.voterId,
    previousChoice: entry.from === null ? null : player(entry.from),
    choice: player(entry.to),
    castAt: entry.at,
    phaseStartedAt: PHASE_START,
    phaseEndsAt: PHASE_END,
    sequence: index + 1,
  }));
}

function recapOf(list: VoteMutation[], round = 2): DayVoteRecap {
  const finalByVoter = new Map<string, PublicVoteChoice>();
  for (const mutation of list) finalByVoter.set(mutation.voterId, mutation.choice);
  return {
    round,
    mutations: list,
    finalBallots: [...finalByVoter].map(([voterId, choice]) => ({ voterId, choice })),
    nomination: { kind: "NONE", reason: "tie" },
    finalJudgment: null,
  };
}

/** Hoà 3-3 giữa A và B, rồi C đổi từ D sang B ở 90% thời gian bỏ phiếu. */
function decisiveLateSwitchRecap(): DayVoteRecap {
  return recapOf(
    mutations([
      { voterId: "a1", from: null, to: "a", at: 2_000 },
      { voterId: "a2", from: null, to: "a", at: 3_000 },
      { voterId: "a3", from: null, to: "a", at: 4_000 },
      { voterId: "b1", from: null, to: "b", at: 5_000 },
      { voterId: "b2", from: null, to: "b", at: 6_000 },
      { voterId: "b3", from: null, to: "b", at: 7_000 },
      { voterId: "c", from: null, to: "d", at: 8_000 },
      { voterId: "c", from: "d", to: "b", at: 27_000 },
    ]),
  );
}

/** A dẫn 3-2, rồi một cử tri của A bỏ sang B khiến B vượt lên. */
function saveVoteRecap(): DayVoteRecap {
  return recapOf(
    mutations([
      { voterId: "a1", from: null, to: "a", at: 1_000 },
      { voterId: "a2", from: null, to: "a", at: 2_000 },
      { voterId: "a3", from: null, to: "a", at: 3_000 },
      { voterId: "b1", from: null, to: "b", at: 4_000 },
      { voterId: "b2", from: null, to: "b", at: 5_000 },
      { voterId: "a3", from: "a", to: "b", at: 6_000 },
    ]),
  );
}

/** B đã dẫn một mình, rồi một người mới nhảy vào bỏ phiếu cho B. */
function bandwagonRecap(): DayVoteRecap {
  return recapOf(
    mutations([
      { voterId: "b1", from: null, to: "b", at: 1_000 },
      { voterId: "b2", from: null, to: "b", at: 2_000 },
      { voterId: "a1", from: null, to: "a", at: 3_000 },
      { voterId: "b3", from: null, to: "b", at: 4_000 },
    ]),
  );
}

const alwaysNotice = () => 0;

describe("vote recap analysis", () => {
  it("finds the late switch that broke a tie", () => {
    const evidence = analyzeVoteRecap(decisiveLateSwitchRecap(), 1, alwaysNotice);

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "LATE_SWITCH", actorId: "c", targetId: "b" }),
        expect.objectContaining({ kind: "TIE_BREAK", actorId: "c", targetId: "b" }),
      ]),
    );
    expect(evidence.every((item) => item.sourceId.startsWith("2:nomination:"))).toBe(true);
    expect(evidence.every((item) => item.summary.length > 0)).toBe(true);
  });

  it("does not call an early first vote a late switch", () => {
    const evidence = analyzeVoteRecap(decisiveLateSwitchRecap(), 1, alwaysNotice);

    expect(evidence.filter((item) => item.kind === "LATE_SWITCH")).toHaveLength(1);
    expect(evidence.some((item) => item.kind === "LATE_SWITCH" && item.actorId === "a1")).toBe(
      false,
    );
  });

  it("finds a save vote when the leader's own voter pushes someone else ahead", () => {
    const evidence = analyzeVoteRecap(saveVoteRecap(), 1, alwaysNotice);

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "SAVE_VOTE", actorId: "a3", targetId: "b" }),
      ]),
    );
  });

  it("weighs a bandwagon below a tie break and a save vote", () => {
    const bandwagon = analyzeVoteRecap(bandwagonRecap(), 1, alwaysNotice).find(
      (item) => item.kind === "BANDWAGON",
    );
    const tieBreak = analyzeVoteRecap(decisiveLateSwitchRecap(), 1, alwaysNotice).find(
      (item) => item.kind === "TIE_BREAK",
    );
    const saveVote = analyzeVoteRecap(saveVoteRecap(), 1, alwaysNotice).find(
      (item) => item.kind === "SAVE_VOTE",
    );

    expect(bandwagon).toBeDefined();
    expect(bandwagon!.actorId).toBe("b3");
    expect(bandwagon!.weight).toBeLessThanOrEqual(4);
    expect(bandwagon!.weight).toBeLessThan(tieBreak!.weight);
    expect(bandwagon!.weight).toBeLessThan(saveVote!.weight);
  });

  it("emits vote alignment for voters who ended on the same target", () => {
    const evidence = analyzeVoteRecap(bandwagonRecap(), 1, alwaysNotice).filter(
      (item) => item.kind === "VOTE_ALIGNMENT",
    );

    expect(evidence.length).toBeGreaterThan(0);
    const pairs = evidence.map((item) => `${item.actorId}->${item.targetId}`).sort();
    expect(pairs).toEqual(["b1->b2", "b1->b3", "b2->b1", "b2->b3", "b3->b1", "b3->b2"]);
    expect(evidence.every((item) => item.sourceId.startsWith("2:nomination:"))).toBe(true);
  });

  it("misses candidates when analytical skill is below the rng draw", () => {
    const distracted = analyzeVoteRecap(decisiveLateSwitchRecap(), 0.5, () => 0.9);

    expect(distracted).toEqual([]);
  });

  it("is deterministic for the same seed and skill", () => {
    const left = analyzeVoteRecap(decisiveLateSwitchRecap(), 0.6, createSeededRng("seed"));
    const right = analyzeVoteRecap(decisiveLateSwitchRecap(), 0.6, createSeededRng("seed"));

    expect(left).toEqual(right);
  });

  it("never invents a source that is not a real mutation", () => {
    const recap = decisiveLateSwitchRecap();
    const realIds = new Set(recap.mutations.map((mutation) => mutation.id));

    for (const item of analyzeVoteRecap(recap, 1, alwaysNotice)) {
      expect(realIds.has(item.sourceId)).toBe(true);
    }
  });
});

describe("social graph analysis", () => {
  let state: BotBrainState;

  function evidence(overrides: Partial<BotEvidence> = {}): BotEvidence {
    return {
      id: "ev-1",
      kind: "VOTE_ALIGNMENT",
      sourceId: "2:nomination:1",
      actorId: "b",
      targetId: "c",
      weight: 3,
      confidence: 0.5,
      round: 2,
      summary: "Cùng chốt một mục tiêu.",
      ...overrides,
    };
  }

  beforeEach(() => {
    state = createBotBrainState(
      "me",
      createBotPersonality(createSeededRng("fixed")),
      ["me", "b", "c", "d"],
    );
    state.seenEventIds.push("2:nomination:1", "2:nomination:2");
  });

  it("rejects social evidence without an existing source", () => {
    expect(() => applySocialEvidence(state, evidence({ sourceId: "ghost" }))).toThrow(
      "Evidence source không tồn tại",
    );
  });

  it("builds a directed edge and counts samples", () => {
    applySocialEvidence(state, evidence());
    applySocialEvidence(state, evidence({ id: "ev-2", sourceId: "2:nomination:2" }));

    const edge = state.relationships[socialEdgeKey("b", "c")]!;
    expect(edge.samples).toBe(2);
    expect(edge.voteAlignment).toBeGreaterThan(0);
    expect(state.relationships[socialEdgeKey("c", "b")]).toBeUndefined();
  });

  it("keeps every edge value inside 0-1 and at most eight reasons", () => {
    for (let i = 0; i < 20; i += 1) {
      state.seenEventIds.push(`ev-src-${i}`);
      applySocialEvidence(
        state,
        evidence({ id: `ev-${i}`, sourceId: `ev-src-${i}`, weight: 90, confidence: 1 }),
      );
    }

    const edge = state.relationships[socialEdgeKey("b", "c")]!;
    expect(edge.voteAlignment).toBeLessThanOrEqual(1);
    expect(edge.support).toBeGreaterThanOrEqual(0);
    expect(edge.hostility).toBeGreaterThanOrEqual(0);
    expect(edge.reasons).toHaveLength(8);
    expect(edge.samples).toBe(20);
  });

  it("routes accusations to hostility and defences to support", () => {
    applySocialEvidence(state, evidence({ kind: "ACCUSE" }));
    applySocialEvidence(
      state,
      evidence({ id: "ev-2", sourceId: "2:nomination:2", kind: "DEFEND", actorId: "d" }),
    );

    expect(state.relationships[socialEdgeKey("b", "c")]!.hostility).toBeGreaterThan(0);
    expect(state.relationships[socialEdgeKey("b", "c")]!.support).toBe(0);
    expect(state.relationships[socialEdgeKey("d", "c")]!.support).toBeGreaterThan(0);
  });

  it("ignores evidence with no target because an edge needs two ends", () => {
    applySocialEvidence(state, evidence({ targetId: undefined }));

    expect(Object.keys(state.relationships)).toEqual([]);
  });

  it("returns a soft pair score that starts at zero and stays bounded", () => {
    expect(possibleWolfPairScore(state, "b", "c")).toBe(0);

    for (let i = 0; i < 30; i += 1) {
      state.seenEventIds.push(`pair-${i}`);
      applySocialEvidence(
        state,
        evidence({ id: `l-${i}`, sourceId: `pair-${i}`, weight: 60, confidence: 1 }),
      );
      applySocialEvidence(
        state,
        evidence({
          id: `r-${i}`,
          sourceId: `pair-${i}`,
          actorId: "c",
          targetId: "b",
          weight: 60,
          confidence: 1,
        }),
      );
    }

    const score = possibleWolfPairScore(state, "b", "c");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
    expect(possibleWolfPairScore(state, "b", "c")).toBe(possibleWolfPairScore(state, "c", "b"));
  });

  it("never turns a pair score into a hard role conclusion", () => {
    for (let i = 0; i < 30; i += 1) {
      state.seenEventIds.push(`pair-${i}`);
      applySocialEvidence(
        state,
        evidence({ id: `l-${i}`, sourceId: `pair-${i}`, weight: 60, confidence: 1 }),
      );
    }
    possibleWolfPairScore(state, "b", "c");

    expect(state.knownInformation.knownRoles).toEqual({});
  });

  it("lowers the pair score when the two are hostile to each other", () => {
    for (let i = 0; i < 10; i += 1) {
      state.seenEventIds.push(`al-${i}`);
      applySocialEvidence(
        state,
        evidence({ id: `al-${i}`, sourceId: `al-${i}`, weight: 40, confidence: 1 }),
      );
    }
    const friendly = possibleWolfPairScore(state, "b", "c");

    for (let i = 0; i < 10; i += 1) {
      state.seenEventIds.push(`ho-${i}`);
      applySocialEvidence(
        state,
        evidence({ id: `ho-${i}`, sourceId: `ho-${i}`, kind: "ACCUSE", weight: 40, confidence: 1 }),
      );
    }

    expect(possibleWolfPairScore(state, "b", "c")).toBeLessThan(friendly);
  });
});

describe("conservative chat analysis", () => {
  const players: BotPlayerKnowledge[] = [
    { id: "a", name: "An", alive: true },
    { id: "b", name: "Bình", alive: true },
    { id: "c", name: "Chi", alive: true },
  ];

  function message(id: string, actorId: string, text: string): BotChatObservation {
    return { id, actorId, text, at: 1_000 };
  }

  it("keeps an explicit role claim and drops a vague remark", () => {
    expect(
      analyzeChat(
        [message("m1", "a", "Tôi là Tiên Tri"), message("m2", "b", "Tôi thấy An hơi lạ")],
        players,
      ),
    ).toEqual([
      expect.objectContaining({
        type: "ROLE_CLAIM",
        sourceId: "m1",
        actorId: "a",
        data: { role: "SEER" },
      }),
    ]);
  });

  it("pins claims and counter-claims so they survive pruning", () => {
    const memories = analyzeChat(
      [
        message("m1", "a", "Tôi là Tiên Tri"),
        message("m2", "b", "An không thể là Tiên Tri, tôi mới là Tiên Tri"),
      ],
      players,
    );

    expect(memories.map((item) => item.type)).toEqual(["ROLE_CLAIM", "COUNTER_CLAIM"]);
    expect(memories.every((item) => item.pinned)).toBe(true);
    expect(memories[1]).toMatchObject({ actorId: "b", targetId: "a", data: { role: "SEER" } });
  });

  it("recognises explicit accusations and defences", () => {
    const memories = analyzeChat(
      [
        message("m1", "a", "Tôi nghi Bình"),
        message("m2", "b", "Chi là sói"),
        message("m3", "c", "Tôi tin An"),
        message("m4", "a", "Đừng treo Chi"),
      ],
      players,
    );

    expect(memories.map((item) => [item.type, item.actorId, item.targetId])).toEqual([
      ["ACCUSE", "a", "b"],
      ["ACCUSE", "b", "c"],
      ["DEFEND", "c", "a"],
      ["DEFEND", "a", "c"],
    ]);
  });

  it("drops a message whose short name matches two players", () => {
    const ambiguous: BotPlayerKnowledge[] = [
      { id: "x", name: "Nguyễn An", alive: true },
      { id: "y", name: "Trần An", alive: true },
      { id: "z", name: "Chi", alive: true },
    ];

    expect(analyzeChat([message("m1", "z", "Tôi nghi An")], ambiguous)).toEqual([]);
  });

  it("drops messages from an actor who is not in the game", () => {
    expect(analyzeChat([message("m1", "ghost", "Tôi là Tiên Tri")], players)).toEqual([]);
  });

  it("never copies the raw message text into the memory", () => {
    const memories = analyzeChat([message("m1", "a", "Tôi là Tiên Tri và tôi soi Bình rồi")], players);

    expect(JSON.stringify(memories)).not.toContain("soi Bình rồi");
  });

  it("produces memories whose source ids are real message ids", () => {
    const state = createBotBrainState(
      "me",
      createBotPersonality(createSeededRng("fixed")),
      ["me", "a", "b", "c"],
    );
    const memories = analyzeChat([message("m1", "a", "Tôi nghi Bình")], players);
    for (const item of memories) remember(state, item);

    expect(state.seenEventIds).toEqual(["m1"]);
  });
});
