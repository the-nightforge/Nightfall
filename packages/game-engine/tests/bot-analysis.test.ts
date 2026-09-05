import { beforeEach, describe, expect, it } from "vitest";
import type { DayVoteRecap, PublicVoteChoice, VoteMutation } from "@masoi/shared";
import { createBotPersonality } from "../src/bot/personality/personality";
import { createSeededRng } from "../src/bot/rng";
import { createBotBrainState, remember } from "../src/bot/memory/memory-store";
import {
  analyzeAvoidance,
  analyzeDefense,
  analyzeVoteRecap,
} from "../src/bot/analysis/vote-analysis";
import { BOT_WEIGHTS_V10, BOT_WEIGHTS_V11 } from "../src/bot/config/weights";
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
  BotMemory,
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

function mercyMutation(
  voterId: string,
  from: string | null,
  at: number,
  sequence: number,
  round = 2,
): VoteMutation {
  return {
    id: `${round}:nomination:${sequence}`,
    round,
    voterId,
    previousChoice: from === null ? null : player(from),
    choice: { type: "NO_ELIMINATION" },
    castAt: at,
    phaseStartedAt: PHASE_START,
    phaseEndsAt: PHASE_END,
    sequence,
  };
}

/** Ba nguoi cung chon "khong treo ai" khi lua chon do da dan phieu. */
function mercyRecap(): DayVoteRecap {
  const recap = recapOf([
    mercyMutation("m1", null, 1_000, 1),
    mercyMutation("m2", null, 2_000, 2),
    mercyMutation("m3", null, 3_000, 3),
  ]);
  return { ...recap, nomination: { kind: "NONE", reason: "no-elimination" } };
}

/** Doi sang "khong treo ai" o 90% thoi gian bo phieu. */
function lateMercyRecap(): DayVoteRecap {
  return recapOf([
    ...mutations([
      { voterId: "a1", from: null, to: "a", at: 1_000 },
      { voterId: "c", from: null, to: "a", at: 2_000 },
    ]),
    mercyMutation("c", "a", 27_000, 3),
  ]);
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

  it("never notices anything at all with zero analytical skill", () => {
    expect(analyzeVoteRecap(decisiveLateSwitchRecap(), 0, () => 0)).toEqual([]);
  });

  it("misses only some candidates at middling skill", () => {
    const full = analyzeVoteRecap(decisiveLateSwitchRecap(), 1, alwaysNotice);
    const partial = analyzeVoteRecap(decisiveLateSwitchRecap(), 0.6, createSeededRng("seed"));

    expect(partial.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThan(full.length);
    // Bo sot la bo sot, khong phai bia: moi thu con lai van la candidate that.
    const fullIds = new Set(full.map((item) => item.id));
    expect(partial.every((item) => fullIds.has(item.id))).toBe(true);
  });

  it("is deterministic for the same seed and skill", () => {
    const left = analyzeVoteRecap(decisiveLateSwitchRecap(), 0.6, createSeededRng("seed"));
    const right = analyzeVoteRecap(decisiveLateSwitchRecap(), 0.6, createSeededRng("seed"));

    expect(left.length).toBeGreaterThan(0);
    expect(left).toEqual(right);
    expect(analyzeVoteRecap(decisiveLateSwitchRecap(), 0.6, createSeededRng("other"))).not.toEqual(
      left,
    );
  });

  it("never invents a source that is not a real mutation", () => {
    const recap = decisiveLateSwitchRecap();
    const realIds = new Set(recap.mutations.map((mutation) => mutation.id));
    const evidence = analyzeVoteRecap(recap, 1, alwaysNotice);

    expect(evidence.length).toBeGreaterThan(0);
    for (const item of evidence) {
      expect(realIds.has(item.sourceId)).toBe(true);
    }
  });

  it("does not treat a mercy vote as a bandwagon or a tie break", () => {
    const evidence = analyzeVoteRecap(mercyRecap(), 1, alwaysNotice);

    expect(evidence.some((item) => item.kind === "BANDWAGON")).toBe(false);
    expect(evidence.some((item) => item.kind === "TIE_BREAK")).toBe(false);
  });

  it("still spots a late switch into no elimination", () => {
    const evidence = analyzeVoteRecap(lateMercyRecap(), 1, alwaysNotice);

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "LATE_SWITCH", actorId: "c", targetId: undefined }),
      ]),
    );
  });

  it("does not pair voters who chose no elimination together", () => {
    const evidence = analyzeVoteRecap(mercyRecap(), 1, alwaysNotice).filter(
      (item) => item.kind === "VOTE_ALIGNMENT",
    );

    expect(evidence).toEqual([]);
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

  it("ignores rhetorical, conditional and negated self-role mentions", () => {
    const memories = analyzeChat(
      [
        message("m1", "a", "Ai bao toi la soi?"),
        message("m2", "b", "\u0110\u1eebng n\u00f3i t\u00f4i l\u00e0 s\u00f3i"),
        message("m3", "c", "N\u1ebfu t\u00f4i l\u00e0 S\u00f3i th\u00ec t\u00f4i \u0111\u00e3 gi\u1ebft B\u00ecnh r\u1ed3i"),
      ],
      players,
    );

    expect(memories).toEqual([]);
  });

  it("ignores negated accusations instead of inverting them", () => {
    const memories = analyzeChat(
      [
        message("m1", "a", "B\u00ecnh kh\u00f4ng th\u1ec3 l\u00e0 s\u00f3i"),
        message("m2", "b", "T\u00f4i kh\u00f4ng nghi Chi"),
        message("m3", "c", "T\u00f4i kh\u00f4ng tin An"),
      ],
      players,
    );

    expect(memories).toEqual([]);
  });

  it("does not confuse the verb nghi with the verb nghi-tilde", () => {
    const memories = analyzeChat(
      [message("m1", "a", "T\u00f4i ngh\u0129 B\u00ecnh v\u00f4 t\u1ed9i")],
      players,
    );

    expect(memories).toEqual([]);
  });

  it("still understands a player typing without diacritics", () => {
    const memories = analyzeChat(
      [message("m1", "a", "Toi la tien tri"), message("m2", "b", "Dung treo Chi")],
      players,
    );

    expect(memories.map((item) => [item.type, item.targetId])).toEqual([
      ["ROLE_CLAIM", undefined],
      ["DEFEND", "c"],
    ]);
  });

  it("keeps every clause of a multi-part message", () => {
    const memories = analyzeChat(
      [message("m1", "a", "\u0110\u1eebng treo B\u00ecnh, t\u00f4i nghi Chi")],
      players,
    );

    expect(memories.map((item) => [item.type, item.targetId])).toEqual([
      ["DEFEND", "b"],
      ["ACCUSE", "c"],
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
    const memories = analyzeChat(
      [message("m1", "a", "Tôi là Tiên Tri và tôi soi Bình rồi")],
      players,
    );

    expect(memories).toHaveLength(1);
    // Kiem tra theo hinh dang du lieu, khong theo mot chuoi cu the: mot ban
    // chuan hoa cua cau goc cung la ro ri.
    expect(Object.keys(memories[0]!.data)).toEqual(["role"]);
    const serialized = JSON.stringify(memories);
    for (const needle of ["soi Bình rồi", "soi binh roi", "và tôi", "va toi"]) {
      expect(serialized).not.toContain(needle);
    }
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

  /**
   * Task C — cách người Việt thật gõ trong chat.
   *
   * Vẫn bảo thủ: mỗi alias một test, và mỗi câu đùa có thể bị hiểu nhầm cũng
   * một test. Nới parser mà không có test cho câu đùa là nới cả hai chiều.
   */
  describe("slang và teencode", () => {
    function claims(text: string) {
      return analyzeChat([message("m1", "a", text)], players).filter(
        (item) => item.type === "ROLE_CLAIM" || item.type === "COUNTER_CLAIM",
      );
    }

    it("t là tt đây → tự nhận Tiên Tri", () => {
      expect(claims("t là tt đây")).toEqual([
        expect.objectContaining({ type: "ROLE_CLAIM", data: { role: "SEER" } }),
      ]);
    });

    it("tt / tien tri / tiên tri đều là Tiên Tri", () => {
      for (const text of ["tôi là tt", "toi la tien tri", "tôi là tiên tri nè", "Tui là TT nha"]) {
        expect(claims(text), text).toEqual([
          expect.objectContaining({ type: "ROLE_CLAIM", data: { role: "SEER" } }),
        ]);
      }
    });

    it("bv / bảo vệ / bao ve đều là Bảo Vệ", () => {
      for (const text of ["mình là bv", "tôi là bảo vệ", "toi la bao ve", "t là bv đây"]) {
        expect(claims(text), text).toEqual([
          expect.objectContaining({ type: "ROLE_CLAIM", data: { role: "GUARD" } }),
        ]);
      }
    });

    it("dan / dân là Dân Làng", () => {
      for (const text of ["tôi là dân", "toi la dan thoi", "t là dân thường mà"]) {
        expect(claims(text), text).toEqual([
          expect.objectContaining({ type: "ROLE_CLAIM", data: { role: "VILLAGER" } }),
        ]);
      }
    });

    it("tớ/tui/mình cũng là ngôi thứ nhất", () => {
      for (const text of ["tớ là tiên tri", "tui là bảo vệ", "mình là dân"]) {
        expect(claims(text), text).toHaveLength(1);
      }
    });

    it("sói trong câu cáo buộc vẫn là cáo buộc, không phải lời khai", () => {
      const memories = analyzeChat([message("m1", "a", "Bình là sói, chắc luôn")], players);
      expect(memories.map((item) => [item.type, item.targetId])).toEqual([["ACCUSE", "b"]]);
    });

    it("Nam không thể là sói: không cáo buộc, không phản bác", () => {
      const withNam = [...players, { id: "n", name: "Nam", alive: true }];
      const substantive = (text: string) =>
        analyzeChat([message("m1", "a", text)], withNam).filter(
          (item) => item.type !== "DIRECT_QUESTION" && item.type !== "DIRECT_ADDRESS",
        );
      expect(substantive("Nam không thể là sói")).toEqual([]);
      // "đâu" cuối câu vẫn bị đọc là từ để hỏi nhắm vào Nam - đó là chuyện của
      // parseDirectAddress, không phải của phần cáo buộc/khai vai đang kiểm.
      expect(substantive("Nam ko thể là sói đâu")).toEqual([]);
    });

    it("phủ định teencode k/ko/hok giết mệnh đề như không", () => {
      for (const text of ["t ko phải tt", "tôi k phải là tiên tri", "t hok phải bv", "tôi ko nghi Bình"]) {
        expect(analyzeChat([message("m1", "a", text)], players), text).toEqual([]);
      }
    });

    it("câu đùa không thành lời khai giả", () => {
      for (const text of [
        "tôi mà là tt thì tôi đã soi Bình rồi",
        "ai bảo t là tt",
        "nếu t là bv thì đã che An",
        "tt đây",
        "t tưởng t là tt =))",
        "ước gì tôi là tiên tri",
      ]) {
        expect(claims(text), text).toEqual([]);
      }
    });

    it("k đứng trong chữ khác (ok, kk) không phải phủ định", () => {
      expect(claims("ok tôi là tiên tri")).toHaveLength(1);
      expect(claims("kk tôi là tiên tri đây")).toHaveLength(1);
    });
  });

  /**
   * Alias lấy từ tờ đề xuất `reports/alias-proposal.md` (`npm run mine-aliases`).
   * Mỗi alias một test, và mỗi alias chỉ được khớp NGAY SAU một cách tự xưng.
   */
  describe("alias vai từ log người chơi", () => {
    function claims(text: string) {
      return analyzeChat([message("m1", "a", text)], players).filter(
        (item) => item.type === "ROLE_CLAIM" || item.type === "COUNTER_CLAIM",
      );
    }
    const claimOf = (role: string) => [
      expect.objectContaining({ type: "ROLE_CLAIM", data: { role } }),
    ];

    it("pt / phù thuỷ là Phù Thuỷ", () => {
      for (const text of ["mình là pt nè", "t là pt", "toi la phu thuy"]) {
        expect(claims(text), text).toEqual(claimOf("WITCH"));
      }
    });

    it("lm / linh mục là Linh Mục", () => {
      for (const text of ["mình là lm nha", "tôi là linh mục"]) {
        expect(claims(text), text).toEqual(claimOf("PRIEST"));
      }
    });

    it("ts / thợ săn là Thợ Săn", () => {
      for (const text of ["tôi là ts nhé", "t là thợ săn", "tui la tho san"]) {
        expect(claims(text), text).toEqual(claimOf("HUNTER"));
      }
    });

    it("bd / bà đồng là Bà Đồng", () => {
      for (const text of ["mình là bd", "tôi là bà đồng"]) {
        expect(claims(text), text).toEqual(claimOf("MEDIUM"));
      }
    });

    it("dl / dân đen là Dân Làng", () => {
      for (const text of ["tôi là dl thôi", "t là dân đen", "mình là dân thường"]) {
        expect(claims(text), text).toEqual(claimOf("VILLAGER"));
      }
    });

    it("thầy bói là Tiên Tri", () => {
      expect(claims("tôi là thầy bói")).toEqual(claimOf("SEER"));
      expect(claims("t la thay boi ne")).toEqual(claimOf("SEER"));
    });

    it("hộ vệ / bảo kê là Bảo Vệ", () => {
      for (const text of ["tôi là hộ vệ", "tôi là bảo kê của làng", "t la ho ve"]) {
        expect(claims(text), text).toEqual(claimOf("GUARD"));
      }
    });

    it("sát thủ là Sát Nhân", () => {
      expect(claims("tôi là sát thủ")).toEqual(claimOf("SERIAL_KILLER"));
    });

    it("sw là Sói", () => {
      expect(claims("tôi là sw, đừng treo tôi")).toEqual(claimOf("WEREWOLF"));
    });

    it("alias ngắn nằm giữa câu không thành lời khai", () => {
      for (const text of [
        "pt nào cũng được",
        "ts đâu rồi",
        "cho tôi hỏi lm là gì",
        "bd với ts chưa lên tiếng",
        "sw cắn ai tối qua",
      ]) {
        expect(claims(text), text).toEqual([]);
      }
    });

    it("câu đùa với alias mới không thành lời khai", () => {
      for (const text of [
        "t mà là pt thì đã cứu Bình rồi",
        "ai bảo t là ts",
        "ước gì tôi là bà đồng",
        "nếu mình là lm thì đã rảy Chi",
        "t k phải pt nha",
        "tôi hem phải thợ săn",
        "mình hổng phải bd đâu",
      ]) {
        expect(claims(text), text).toEqual([]);
      }
    });
  });

  /**
   * Cáo buộc và bênh vực theo cách người chơi thật gõ: không có "tôi", không
   * có "là", nhiều khi không có dấu. Mỗi mẫu một test, kèm test phủ định.
   */
  describe("cáo buộc và bênh vực kiểu người thật", () => {
    const substantive = (text: string, list = players) =>
      analyzeChat([message("m1", "a", text)], list)
        .filter((item) => item.type === "ACCUSE" || item.type === "DEFEND")
        .map((item) => [item.type, item.targetId]);

    it("nghi X (không có tôi) là cáo buộc X", () => {
      for (const text of ["nghi Bình", "nghi Bình lắm", "t nghi Bình", "mình nghi Bình rồi", "nghi ngờ Bình"]) {
        expect(substantive(text), text).toEqual([["ACCUSE", "b"]]);
      }
    });

    it("nghi không dấu vẫn bị bỏ qua vì trùng với nghĩ", () => {
      expect(substantive("nghi Binh")).toEqual([]);
      expect(substantive("t nghi Binh")).toEqual([]);
    });

    it("vote X / treo X / chốt X là cáo buộc X", () => {
      for (const text of ["vote Bình", "vote cho Bình đi", "treo Bình", "treo Binh di", "chốt Bình nhé", "vote Bình thôi"]) {
        expect(substantive(text), text).toEqual([["ACCUSE", "b"]]);
      }
    });

    it("X sói (không có là) là cáo buộc X", () => {
      for (const text of ["Bình sói", "Bình sói chắc luôn", "Bình sói rồi", "thằng Bình sói 100%"]) {
        expect(substantive(text), text).toEqual([["ACCUSE", "b"]]);
      }
    });

    it("soi không dấu là động từ soi, không phải Sói", () => {
      // "An soi Bình" = Tiên Tri An soi Bình. Không suy ra ai là Sói cả.
      expect(substantive("Binh soi Chi")).toEqual([]);
      expect(substantive("Bình soi Chi ra dân")).toEqual([]);
    });

    it("tin X / tha X / đừng vote X là bênh vực X", () => {
      for (const text of ["tin Bình", "t tin Bình", "mình tin Bình mà", "tha Bình đi", "đừng vote Bình", "dung treo Binh"]) {
        expect(substantive(text), text).toEqual([["DEFEND", "b"]]);
      }
    });

    it("X dân / X sạch là bênh vực X", () => {
      for (const text of ["Bình dân", "Bình dân chắc", "Bình sạch", "Bình sạch rồi"]) {
        expect(substantive(text), text).toEqual([["DEFEND", "b"]]);
      }
    });

    it("phủ định teencode giết cả mẫu mới", () => {
      for (const text of [
        "ko nghi Bình",
        "k vote Bình",
        "hok treo Bình",
        "Bình ko sói",
        "Bình hem sói đâu",
        "t k tin Bình",
        "Bình đếch phải dân",
        "Bình éo sạch",
      ]) {
        expect(substantive(text), text).toEqual([]);
      }
    });

    it("mẫu mới vẫn chỉ nhận ở đầu mệnh đề", () => {
      // "ai vote Bình" là câu hỏi; "sao treo Bình" là thắc mắc.
      for (const text of ["ai vote Bình", "sao lại treo Bình", "ai nghi Bình giơ tay"]) {
        expect(substantive(text), text).toEqual([]);
      }
    });

    it("tên trùng thì mẫu mới cũng bỏ qua", () => {
      const twins: BotPlayerKnowledge[] = [
        { id: "x", name: "Lê Bình", alive: true },
        { id: "y", name: "Trần Bình", alive: true },
        { id: "a", name: "An", alive: true },
      ];
      expect(substantive("vote Bình", twins)).toEqual([]);
      expect(substantive("Bình sói", twins)).toEqual([]);
    });

    it("marker không dấu phải khớp trọn từ: tha ≠ thằng, tin ≠ tính", () => {
      expect(substantive("thằng Bình sói")).toEqual([["ACCUSE", "b"]]);
      expect(substantive("thang Binh la soi")).toEqual([["ACCUSE", "b"]]);
      expect(substantive("tính Bình sao")).toEqual([]);
    });

    it("chắc/chào/chạy không phải phủ định dù chứa chả khi bỏ dấu", () => {
      expect(substantive("Bình là sói chắc luôn")).toEqual([["ACCUSE", "b"]]);
      expect(substantive("Binh la soi chac luon")).toEqual([["ACCUSE", "b"]]);
      expect(substantive("Bình chả phải sói")).toEqual([]);
      // "cha" không dấu là cha xứ/cha nội, không phải "chả".
      expect(substantive("cha noi Binh la soi")).toEqual([["ACCUSE", "b"]]);
    });
  });
});

/**
 * Một vòng đề cử rút gọn: chỉ cần ai bỏ cho ai (phiếu cuối) và ai bị đưa ra xử.
 * `null` là phiếu trắng; vắng mặt trong bảng là không có mặt vòng đó.
 */
function roundOf(
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
    phaseStartedAt: PHASE_START,
    phaseEndsAt: PHASE_END,
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

describe("AVOIDANCE: né tránh suốt nhiều vòng", () => {
  const alive = ["a", "b", "c", "d", "e", "f"];
  const weights = BOT_WEIGHTS_V11;

  /**
   * Ba vòng: a và b đều đặn tố c; c và f tố ngược lại cùng một người; d luôn
   * bỏ phiếu trắng; e mỗi vòng bỏ một phiếu lẻ không ai theo.
   */
  function history() {
    return [
      roundOf(1, { a: "c", b: "c", c: "a", f: "a", d: null, e: "b" }, "c"),
      roundOf(2, { a: "c", b: "c", c: "a", f: "a", d: null, e: "b" }),
      roundOf(3, { a: "c", b: "c", c: "b", f: "b", d: null, e: "a" }, "c"),
    ];
  }

  it("bắt người ba vòng liền chỉ bỏ phiếu trắng hoặc phiếu lẻ", () => {
    const found = analyzeAvoidance(
      { history: history(), round: 3, playerIds: alive },
      1,
      alwaysNotice,
      weights,
    );
    const throwaway = found.filter((item) => item.id.includes(":throwaway:"));
    expect(throwaway.map((item) => item.actorId).sort()).toEqual(["d", "e"]);
    for (const item of throwaway) {
      expect(item).toMatchObject({
        kind: "AVOIDANCE",
        sourceId: "recap:3",
        round: 3,
        targetId: undefined,
      });
      expect(item.weight).toBe(weights.evidence.AVOIDANCE.weight);
    }
  });

  it("bắt người ba vòng liền không ai đụng tới dù vẫn bỏ phiếu", () => {
    const found = analyzeAvoidance(
      { history: history(), round: 3, playerIds: alive },
      1,
      alwaysNotice,
      weights,
    );
    const untouched = found.filter((item) => item.id.includes(":untouched:"));
    // c bị đưa ra xử, a và b từng nhận phiếu; d, e, f sạch phiếu suốt ba vòng -
    // f dù đứng vào cáo buộc chung vẫn "không ai đụng tới", hai nhãn độc lập.
    expect(untouched.map((item) => item.actorId).sort()).toEqual(["d", "e", "f"]);
  });

  it("không sinh gì khi chưa đủ ba vòng liên tiếp", () => {
    const short = history().slice(1);
    expect(
      analyzeAvoidance({ history: short, round: 3, playerIds: alive }, 1, alwaysNotice, weights),
    ).toEqual([]);
    // Có ba vòng nhưng thiếu vòng giữa thì không phải "liên tiếp".
    const gap = [roundOf(1, { a: "c", d: null }), roundOf(3, { a: "c", d: null })];
    expect(
      analyzeAvoidance({ history: gap, round: 3, playerIds: alive }, 1, alwaysNotice, weights),
    ).toEqual([]);
  });

  it("người vắng mặt một vòng không bị tính - né là hành vi của người có mặt", () => {
    const list = history();
    // e không bỏ phiếu ở vòng 2.
    list[1] = roundOf(2, { a: "c", b: "c", c: "a", f: "a", d: null });
    const found = analyzeAvoidance(
      { history: list, round: 3, playerIds: alive },
      1,
      alwaysNotice,
      weights,
    );
    expect(found.some((item) => item.actorId === "e")).toBe(false);
    expect(found.some((item) => item.actorId === "d")).toBe(true);
  });

  it("đứng vào một cáo buộc chung dù chỉ một lần là thoát nhãn throwaway", () => {
    const list = history();
    list[2] = roundOf(3, { a: "c", b: "c", c: "b", f: "b", d: "c", e: "a" }, "c");
    const found = analyzeAvoidance(
      { history: list, round: 3, playerIds: alive },
      1,
      alwaysNotice,
      weights,
    );
    expect(found.filter((item) => item.id.includes(":throwaway:")).map((i) => i.actorId)).toEqual(
      ["e"],
    );
  });

  it("chỉ xét người còn trong danh sách được đưa vào", () => {
    const found = analyzeAvoidance(
      { history: history(), round: 3, playerIds: ["a", "b", "c"] },
      1,
      alwaysNotice,
      weights,
    );
    expect(found).toEqual([]);
  });

  it("mỗi mảnh có id duy nhất và ổn định", () => {
    const found = analyzeAvoidance(
      { history: history(), round: 3, playerIds: alive },
      1,
      alwaysNotice,
      weights,
    );
    expect(new Set(found.map((item) => item.id)).size).toBe(found.length);
    expect(found.map((item) => item.id)).toEqual(
      analyzeAvoidance(
        { history: history(), round: 3, playerIds: alive },
        1,
        alwaysNotice,
        weights,
      ).map((item) => item.id),
    );
  });

  it("tắt hoàn toàn ở v10 và không rút một số ngẫu nhiên nào", () => {
    let draws = 0;
    const counting = () => {
      draws += 1;
      return 0;
    };
    expect(
      analyzeAvoidance(
        { history: history(), round: 3, playerIds: alive },
        1,
        counting,
        BOT_WEIGHTS_V10,
      ),
    ).toEqual([]);
    expect(draws).toBe(0);
  });

  it("bot kém tinh ý bỏ sót, không bao giờ bịa", () => {
    expect(
      analyzeAvoidance(
        { history: history(), round: 3, playerIds: alive },
        0.2,
        () => 0.9,
        weights,
      ),
    ).toEqual([]);
  });
});

describe("DEFENSE_QUALITY: chất lượng lời bào chữa", () => {
  const weights = BOT_WEIGHTS_V11;
  const base = { round: 2, accusedId: "c", claimedBefore: false };

  function statement(type: BotMemory["type"], overrides: Partial<BotMemory> = {}): BotMemory {
    return {
      id: `${type}:m1:`,
      sourceId: "m1",
      round: 2,
      phase: "DEFENSE",
      type,
      actorId: "c",
      importance: 4,
      pinned: false,
      data: {},
      ...overrides,
    };
  }

  it("im lặng suốt lượt bào chữa", () => {
    const found = analyzeDefense({ ...base, spoken: 0, statements: [] }, 1, alwaysNotice, weights);
    expect(found).toEqual([
      expect.objectContaining({
        id: "2:nomination:result:DEFENSE_QUALITY:silent",
        kind: "DEFENSE_QUALITY",
        sourceId: "2:nomination:result",
        actorId: "c",
        targetId: undefined,
        round: 2,
        weight: weights.evidence.DEFENSE_QUALITY.weight,
      }),
    ]);
  });

  it("lái sang người khác thay vì tự bào chữa", () => {
    const found = analyzeDefense(
      { ...base, spoken: 2, statements: [statement("ACCUSE", { targetId: "a" })] },
      1,
      alwaysNotice,
      weights,
    );
    expect(found).toEqual([
      expect.objectContaining({
        id: "2:nomination:result:DEFENSE_QUALITY:deflect:a",
        actorId: "c",
        targetId: "a",
      }),
    ]);
  });

  it("nhận vơ: lần đầu khai vai chức năng đúng lúc bị đưa ra xử", () => {
    const found = analyzeDefense(
      { ...base, spoken: 1, statements: [statement("ROLE_CLAIM", { data: { role: "SEER" } })] },
      1,
      alwaysNotice,
      weights,
    );
    expect(found).toEqual([
      expect.objectContaining({ id: "2:nomination:result:DEFENSE_QUALITY:grab", actorId: "c" }),
    ]);
  });

  it("đã khai vai từ trước rồi nhắc lại thì không phải nhận vơ", () => {
    const found = analyzeDefense(
      {
        ...base,
        claimedBefore: true,
        spoken: 1,
        statements: [statement("ROLE_CLAIM", { data: { role: "SEER" } })],
      },
      1,
      alwaysNotice,
      weights,
    );
    expect(found).toEqual([]);
  });

  it("khai Dân thường lúc bị xử không phải nhận vơ - không ai nhận vơ cái vai không có gì", () => {
    const found = analyzeDefense(
      { ...base, spoken: 1, statements: [statement("ROLE_CLAIM", { data: { role: "VILLAGER" } })] },
      1,
      alwaysNotice,
      weights,
    );
    expect(found).toEqual([]);
  });

  it("khai vai kèm chỉ mặt là bào chữa có nội dung, không phải lái đi", () => {
    const found = analyzeDefense(
      {
        ...base,
        claimedBefore: true,
        spoken: 2,
        statements: [
          statement("ROLE_CLAIM", { data: { role: "SEER" } }),
          statement("ACCUSE", { sourceId: "m2", targetId: "a" }),
        ],
      },
      1,
      alwaysNotice,
      weights,
    );
    expect(found).toEqual([]);
  });

  it("nói nhưng parser không hiểu gì thì không có tín hiệu - bảo thủ", () => {
    expect(
      analyzeDefense({ ...base, spoken: 3, statements: [] }, 1, alwaysNotice, weights),
    ).toEqual([]);
  });

  it("tắt ở v10, không rút số ngẫu nhiên", () => {
    let draws = 0;
    const counting = () => {
      draws += 1;
      return 0;
    };
    expect(
      analyzeDefense({ ...base, spoken: 0, statements: [] }, 1, counting, BOT_WEIGHTS_V10),
    ).toEqual([]);
    expect(draws).toBe(0);
  });
});
