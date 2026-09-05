import { beforeEach, describe, expect, it } from "vitest";
import { createBotPersonality } from "../src/bot/personality/personality";
import { createSeededRng } from "../src/bot/rng";
import { createBotBrainState, remember } from "../src/bot/memory/memory-store";
import { decayAndPrune } from "../src/bot/memory/memory-decay";
import { validateEvidence } from "../src/bot/belief/evidence";
import { applyEvidence, applyTrustEvidence } from "../src/bot/belief/belief-state";
import { neutralProfile, observeProfile, profileFor } from "../src/bot/belief/player-profile";
import { profileStrength } from "../src/bot/types";
import type { BotBrainState, BotEvidence, BotMemory, BotPersonality } from "../src/bot/types";

const PLAYERS = ["me", "b", "c", "d"];

function personality(overrides: Partial<BotPersonality> = {}): BotPersonality {
  return { ...createBotPersonality(createSeededRng("fixed")), ...overrides };
}

function memory(overrides: Partial<BotMemory> = {}): BotMemory {
  return {
    id: "mem-1",
    sourceId: "1:nomination:1",
    round: 1,
    phase: "VOTING",
    type: "VOTE_CAST",
    actorId: "b",
    targetId: "c",
    importance: 5,
    pinned: false,
    data: {},
    ...overrides,
  };
}

function evidence(overrides: Partial<BotEvidence> = {}): BotEvidence {
  return {
    id: "ev-1",
    kind: "LATE_SWITCH",
    sourceId: "vote:1",
    actorId: "c",
    targetId: "d",
    weight: 20,
    confidence: 0.5,
    round: 1,
    summary: "Đổi phiếu sát giờ chót.",
    ...overrides,
  };
}

describe("bot memory store", () => {
  let state: BotBrainState;

  beforeEach(() => {
    state = createBotBrainState("me", personality(), PLAYERS);
  });

  it("creates neutral, self-excluding belief entries for every other player", () => {
    expect(Object.keys(state.suspicion).sort()).toEqual(["b", "c", "d"]);
    expect(Object.keys(state.trust).sort()).toEqual(["b", "c", "d"]);
    expect(state.suspicion.b).toEqual({ score: 0, reasons: [], lastUpdatedRound: 0 });
    expect(state.playerId).toBe("me");
    expect(state.memories).toEqual([]);
    expect(state.seenEventIds).toEqual([]);
  });

  it("deduplicates memories by source and type", () => {
    const voteMemory = memory();

    remember(state, voteMemory);
    remember(state, voteMemory);

    expect(state.memories).toHaveLength(1);
  });

  it("keeps memories that differ in type, source, actor or target", () => {
    remember(state, memory());
    remember(state, memory({ type: "VOTE_CHANGED" }));
    remember(state, memory({ sourceId: "1:nomination:2" }));
    remember(state, memory({ actorId: "d" }));
    remember(state, memory({ targetId: "b" }));

    expect(state.memories).toHaveLength(5);
  });

  it("copies the memory so later caller mutation cannot corrupt state", () => {
    const original = memory({ data: { note: "x" } });
    remember(state, original);
    original.importance = 999;
    (original.data as Record<string, unknown>).note = "y";

    expect(state.memories[0]!.importance).toBe(5);
    expect(state.memories[0]!.data).toEqual({ note: "x" });
  });

  it("mirrors claims and seer results into the pinned stores", () => {
    remember(state, memory({ type: "ROLE_CLAIM", sourceId: "m1", pinned: true }));
    remember(state, memory({ type: "COUNTER_CLAIM", sourceId: "m2", pinned: true }));
    remember(state, memory({ type: "SEER_RESULT", sourceId: "seer:1", pinned: true }));

    expect(state.claims.map((claim) => claim.type)).toEqual(["ROLE_CLAIM", "COUNTER_CLAIM"]);
    expect(state.knownInformation.seerResults.map((item) => item.sourceId)).toEqual(["seer:1"]);
    expect(state.memories).toHaveLength(3);
  });

  it("records the source id so evidence built from it validates", () => {
    remember(state, memory({ sourceId: "vote:9" }));

    expect(state.seenEventIds).toContain("vote:9");
  });
});

describe("bot memory decay and pruning", () => {
  let state: BotBrainState;

  beforeEach(() => {
    state = createBotBrainState("me", personality(), PLAYERS);
  });

  it("keeps pinned facts while pruning low-importance memories", () => {
    for (let i = 0; i < 130; i += 1) {
      remember(state, memory({ sourceId: `vote:${i}`, importance: 1 + (i % 4) }));
    }
    remember(
      state,
      memory({ type: "SEER_RESULT", sourceId: "seer:1", pinned: true, importance: 1 }),
    );

    decayAndPrune(state, 5, 120);

    expect(state.memories.length).toBeLessThanOrEqual(120);
    expect(state.memories).toContainEqual(
      expect.objectContaining({ type: "SEER_RESULT", pinned: true }),
    );
  });

  it("decays ordinary memories by round age but never pinned facts", () => {
    remember(state, memory({ sourceId: "old", round: 1, importance: 10 }));
    remember(state, memory({ sourceId: "pinned", round: 1, importance: 10, pinned: true }));

    decayAndPrune(state, 4);

    const decayed = state.memories.find((item) => item.sourceId === "old")!;
    const pinned = state.memories.find((item) => item.sourceId === "pinned")!;
    expect(decayed.importance).toBeCloseTo(10 * 0.88 ** 3, 10);
    expect(pinned.importance).toBe(10);
  });

  it("drops the least important ordinary memories first", () => {
    remember(state, memory({ sourceId: "weak", importance: 1 }));
    remember(state, memory({ sourceId: "strong", importance: 9 }));

    decayAndPrune(state, 1, 1);

    expect(state.memories.map((item) => item.sourceId)).toEqual(["strong"]);
  });

  it("never drops a pinned fact even when pinned facts fill the budget", () => {
    for (let i = 0; i < 70; i += 1) {
      remember(
        state,
        memory({ type: "ROLE_CLAIM", sourceId: `claim:${i}`, importance: 1, pinned: true }),
      );
    }
    for (let i = 0; i < 80; i += 1) {
      remember(state, memory({ sourceId: `vote:${i}`, importance: 5 }));
    }

    decayAndPrune(state, 5, 120);

    const pinned = state.memories.filter((item) => item.pinned);
    // Kho pinned bị chặn trần ngay lúc ghi, nên nó không chiếm hết ngân sách...
    expect(pinned).toHaveLength(60);
    // ...và không có pinned fact nào bị bước prune bỏ đi.
    expect(state.claims).toHaveLength(60);
    expect(state.claims.every((claim) => state.memories.includes(claim))).toBe(true);
    expect(state.memories.some((item) => !item.pinned)).toBe(true);
  });

  it("keeps the mirrored claim and seer stores in step with memories", () => {
    remember(state, memory({ type: "ROLE_CLAIM", sourceId: "m1" }));
    remember(state, memory({ type: "SEER_RESULT", sourceId: "seer:1" }));

    // Kể cả khi caller quên đặt cờ, hai loại này vẫn được ghim theo type.
    expect(state.memories.every((item) => item.pinned)).toBe(true);

    decayAndPrune(state, 9, 1);

    expect(state.claims.every((claim) => state.memories.includes(claim))).toBe(true);
    expect(
      state.knownInformation.seerResults.every((item) => state.memories.includes(item)),
    ).toBe(true);
  });

  it("defaults to the documented 120 memory budget", () => {
    for (let i = 0; i < 140; i += 1) {
      remember(state, memory({ sourceId: `vote:${i}`, importance: 1 }));
    }

    decayAndPrune(state, 1);

    expect(state.memories).toHaveLength(120);
  });
});

describe("bot evidence validation and belief updates", () => {
  let state: BotBrainState;

  beforeEach(() => {
    state = createBotBrainState("me", personality({ stubbornness: 0.5 }), PLAYERS);
  });

  it("rejects evidence without an existing source and clamps suspicion", () => {
    expect(() => applyEvidence(state, evidence({ sourceId: "vote:missing" }))).toThrow(
      "Evidence source không tồn tại",
    );

    state.seenEventIds.push("vote:1");
    applyEvidence(state, evidence({ sourceId: "vote:1", weight: 500 }));

    expect(state.suspicion.c!.score).toBe(100);
  });

  it("accepts a source supplied by the current context", () => {
    expect(() => validateEvidence(evidence({ sourceId: "m7" }), ["m7"])).not.toThrow();
    expect(() => validateEvidence(evidence({ sourceId: "m7" }), [])).toThrow(
      "Evidence source không tồn tại",
    );
  });

  it("never lets a belief score leave the 0-100 range", () => {
    state.seenEventIds.push("vote:1");
    applyEvidence(state, evidence({ sourceId: "vote:1", weight: -500 }));
    expect(state.suspicion.c!.score).toBe(0);

    applyEvidence(state, evidence({ id: "ev-up", sourceId: "vote:1", weight: 500 }));
    expect(state.suspicion.c!.score).toBe(100);
  });

  it("bounds the seen-event cursor so a long game cannot grow it forever", () => {
    for (let i = 0; i < 2_100; i += 1) {
      remember(state, memory({ sourceId: `evt:${i}`, importance: 1 }));
    }

    expect(state.seenEventIds.length).toBeLessThanOrEqual(2_000);
  });

  it("applies stubbornness as inertia on the update size", () => {
    const calm = createBotBrainState("me", personality({ stubbornness: 0.25 }), PLAYERS);
    const stubborn = createBotBrainState("me", personality({ stubbornness: 0.9 }), PLAYERS);
    calm.seenEventIds.push("vote:1");
    stubborn.seenEventIds.push("vote:1");

    applyEvidence(calm, evidence());
    applyEvidence(stubborn, evidence());

    expect(calm.suspicion.c!.score).toBeGreaterThan(stubborn.suspicion.c!.score);
    expect(stubborn.suspicion.c!.score).toBeGreaterThan(0);
  });

  it("stores the evidence as a reason, deduplicated by id and capped at twelve", () => {
    for (let i = 0; i < 15; i += 1) {
      state.seenEventIds.push(`vote:${i}`);
      applyEvidence(state, evidence({ id: `ev-${i}`, sourceId: `vote:${i}`, weight: 1 }));
    }
    applyEvidence(state, evidence({ id: "ev-14", sourceId: "vote:14", weight: 1 }));

    const reasons = state.suspicion.c!.reasons;
    expect(reasons).toHaveLength(12);
    expect(new Set(reasons.map((reason) => reason.id)).size).toBe(12);
    expect(reasons.at(-1)!.id).toBe("ev-14");
    expect(reasons.every((reason) => state.seenEventIds.includes(reason.sourceId))).toBe(true);
  });

  it("records the evidence round on the belief entry", () => {
    state.seenEventIds.push("vote:1");
    applyEvidence(state, evidence({ round: 4 }));

    expect(state.suspicion.c!.lastUpdatedRound).toBe(4);
  });

  it("creates a belief entry for a player who joined the roster later", () => {
    state.seenEventIds.push("vote:1");
    applyEvidence(state, evidence({ actorId: "late" }));

    expect(state.suspicion.late!.score).toBeGreaterThan(0);
  });

  it("moves trust in the opposite direction to suspicion for one evidence", () => {
    state.seenEventIds.push("vote:1");
    const accusing = evidence({ weight: 40 });

    applyEvidence(state, accusing);
    applyTrustEvidence(state, accusing);

    // Buộc tội: nghi ngờ tăng, tin tưởng giảm (đã chạm sàn 0).
    expect(state.suspicion.c!.score).toBeGreaterThan(0);
    expect(state.trust.c!.score).toBe(0);
  });

  it("lets exculpatory evidence raise trust and lower suspicion", () => {
    state.seenEventIds.push("vote:1", "vote:2");
    applyEvidence(state, evidence({ id: "ev-a", sourceId: "vote:1", weight: 60 }));
    const before = state.suspicion.c!.score;

    const exculpatory = evidence({ id: "ev-b", sourceId: "vote:2", kind: "DEFEND", weight: -20 });
    applyEvidence(state, exculpatory);
    applyTrustEvidence(state, exculpatory);

    expect(state.suspicion.c!.score).toBeLessThan(before);
    expect(state.trust.c!.score).toBeGreaterThan(0);
  });

  it("keeps trust as its own accumulator, not a mirror of suspicion", () => {
    state.seenEventIds.push("vote:1", "vote:2");
    applyEvidence(state, evidence({ id: "ev-a", sourceId: "vote:1", weight: 40 }));
    applyTrustEvidence(
      state,
      evidence({ id: "ev-b", sourceId: "vote:2", kind: "DEFEND", weight: -30 }),
    );

    // Hai bảng có lịch sử lý do riêng: cùng một người có thể vừa đáng ngờ vừa
    // đáng tin khi bằng chứng mâu thuẫn.
    expect(state.suspicion.c!.score).toBeGreaterThan(0);
    expect(state.trust.c!.score).toBeGreaterThan(0);
    expect(state.trust.c!.score).not.toBe(100 - state.suspicion.c!.score);
    expect(state.suspicion.c!.reasons.map((item) => item.id)).toEqual(["ev-a"]);
    expect(state.trust.c!.reasons.map((item) => item.id)).toEqual(["ev-b"]);
  });

  it("never attributes evidence to the bot itself", () => {
    state.seenEventIds.push("vote:1");
    applyEvidence(state, evidence({ actorId: "me" }));

    expect(state.suspicion).not.toHaveProperty("me");
  });
});

describe("hồ sơ người chơi trong ván (P1.1)", () => {
  let state: BotBrainState;

  beforeEach(() => {
    state = createBotBrainState("me", personality(), PLAYERS);
  });

  it("khởi tạo trung tính cho mọi người khác, không có cho chính mình", () => {
    expect(Object.keys(state.profiles).sort()).toEqual(["b", "c", "d"]);
    expect(state.profiles.b).toEqual({
      bluffRate: 0,
      aggroRate: 0,
      accuracy: 0.5,
      samples: 0,
      lastUpdatedRound: 0,
    });
    expect(neutralProfile()).toEqual(state.profiles.b);
  });

  it("một mẫu đặt tỉ lệ đúng bằng mẫu, mẫu sau kéo về trung bình", () => {
    observeProfile(state, "b", "bluff", 1, 2);
    expect(state.profiles.b).toMatchObject({ bluffRate: 1, samples: 1, lastUpdatedRound: 2 });

    observeProfile(state, "b", "bluff", 0, 3);
    expect(state.profiles.b!.bluffRate).toBeCloseTo(0.5);
    expect(state.profiles.b!.samples).toBe(2);
    expect(state.profiles.b!.lastUpdatedRound).toBe(3);
  });

  it("là hàm tất định: cùng dãy mẫu cho cùng hồ sơ", () => {
    const other = createBotBrainState("me", personality(), PLAYERS);
    for (const target of [state, other]) {
      observeProfile(target, "c", "accuracy", 1, 1);
      observeProfile(target, "c", "aggro", 1, 1);
      observeProfile(target, "c", "accuracy", 0, 2);
    }
    expect(state.profiles.c).toEqual(other.profiles.c);
  });

  it("không lập hồ sơ về chính mình", () => {
    observeProfile(state, "me", "bluff", 1, 1);
    expect(state.profiles.me).toBeUndefined();
  });

  it("tự tạo hồ sơ trung tính cho người vào roster sau", () => {
    expect(profileFor(state, "late")).toEqual(neutralProfile());
    observeProfile(state, "late", "aggro", 1, 1);
    expect(state.profiles.late!.aggroRate).toBe(1);
  });

  it("sức nặng hồ sơ tăng theo số mẫu và bị prior kìm", () => {
    const profile = neutralProfile();
    expect(profileStrength(profile, 2)).toBe(0);
    profile.samples = 1;
    expect(profileStrength(profile, 2)).toBeCloseTo(1 / 3);
    profile.samples = 3;
    expect(profileStrength(profile, 2)).toBeCloseTo(0.6);
    profile.samples = 100;
    expect(profileStrength(profile, 2)).toBeLessThan(1);
  });

  it("mẫu ngoài 0..1 bị kẹp lại", () => {
    observeProfile(state, "b", "accuracy", 5, 1);
    expect(state.profiles.b!.accuracy).toBe(1);
  });
});
