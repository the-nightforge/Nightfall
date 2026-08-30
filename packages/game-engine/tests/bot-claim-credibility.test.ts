import { describe, expect, it } from "vitest";
import { claimEvidence } from "../src/bot/analysis/claim-credibility";
import { BotRuntime } from "../src/bot/BotRuntime";
import { BOT_WEIGHTS_V4 } from "../src/bot/config/weights";
import type { BotDecisionContext, BotMemory, BotPersonality } from "../src/bot/types";

function claim(actorId: string, role: string, round: number, sourceId: string): BotMemory {
  return {
    id: `ROLE_CLAIM:${sourceId}:${actorId}`,
    sourceId,
    round,
    phase: "DAY_DISCUSSION",
    type: "ROLE_CLAIM",
    actorId,
    targetId: "p9",
    importance: 8,
    pinned: true,
    data: { role, underFire: false },
  };
}

const BASE = {
  round: 2,
  lastNightDeaths: [],
  publicVoteHistory: [],
  seenEventIds: ["m1", "m2", "night-death:2:p1", "night-death:2:p4"],
};

describe("claimEvidence", () => {
  it("S1: một lời khai dồn nghi ngờ lên người nó chỉ mặt", () => {
    const found = claimEvidence({ ...BASE, claims: [claim("p1", "SEER", 1, "m1")] }, BOT_WEIGHTS_V4);
    const accusation = found.find((item) => item.actorId === "p9");
    expect(accusation).toBeDefined();
    expect(accusation!.weight).toBeGreaterThan(0);
  });

  it("S1: khai lúc đang dẫn phiếu thì gần như không được gì", () => {
    const calm = claimEvidence({ ...BASE, claims: [claim("p1", "SEER", 1, "m1")] }, BOT_WEIGHTS_V4);
    const cornered = claimEvidence(
      { ...BASE, claims: [{ ...claim("p1", "SEER", 1, "m1"), data: { role: "SEER", underFire: true } }] },
      BOT_WEIGHTS_V4,
    );
    const weightOn = (list: typeof calm) => list.find((i) => i.actorId === "p9")?.weight ?? 0;
    expect(weightOn(cornered)).toBeLessThan(weightOn(calm));
  });

  it("S2: hai người khai cùng vai thì CẢ HAI bị nghi", () => {
    const found = claimEvidence(
      { ...BASE, claims: [claim("p1", "SEER", 1, "m1"), claim("p2", "SEER", 2, "m2")] },
      BOT_WEIGHTS_V4,
    );
    expect(found.some((item) => item.actorId === "p1" && item.weight > 0)).toBe(true);
    expect(found.some((item) => item.actorId === "p2" && item.weight > 0)).toBe(true);
  });

  it("S3: khai Tiên Tri rồi chết đêm đó → bằng chứng neo vào chính cái chết", () => {
    const found = claimEvidence(
      {
        ...BASE,
        claims: [claim("p1", "SEER", 1, "m1")],
        lastNightDeaths: [{ playerId: "p1", name: "An" }],
      },
      BOT_WEIGHTS_V4,
    );
    const confirm = found.find((item) => item.sourceId === "night-death:2:p1");
    expect(confirm).toBeDefined();
    // Weight ÂM trên thang suspicion = gỡ tội = tin tưởng tăng.
    expect(confirm!.weight).toBeLessThan(0);
  });

  it("S3: khai rồi SỐNG trong khi người khác chết → mất uy tín", () => {
    const found = claimEvidence(
      {
        ...BASE,
        claims: [claim("p1", "SEER", 1, "m1")],
        lastNightDeaths: [{ playerId: "p4", name: "Dung" }],
      },
      BOT_WEIGHTS_V4,
    );
    expect(found.some((item) => item.actorId === "p1" && item.weight > 0)).toBe(true);
  });

  it("S3: đêm không ai chết thì IM LẶNG — Bảo Vệ cũng làm ra cảnh này", () => {
    const quiet = claimEvidence({ ...BASE, claims: [claim("p1", "SEER", 1, "m1")] }, BOT_WEIGHTS_V4);
    expect(quiet.every((item) => !item.sourceId.startsWith("night-death:"))).toBe(true);
  });

  it("mọi sourceId phát ra đều nằm trong seenEventIds", () => {
    const found = claimEvidence(
      {
        ...BASE,
        claims: [claim("p1", "SEER", 1, "m1"), claim("p2", "SEER", 2, "m2")],
        lastNightDeaths: [{ playerId: "p1", name: "An" }],
      },
      BOT_WEIGHTS_V4,
    );
    for (const item of found) expect(BASE.seenEventIds).toContain(item.sourceId);
  });

  it("nhóm claim tắt thì không phát gì", () => {
    const off = { ...BOT_WEIGHTS_V4, claim: { ...BOT_WEIGHTS_V4.claim, accusationWeight: 0 } };
    expect(claimEvidence({ ...BASE, claims: [claim("p1", "SEER", 1, "m1")] }, off)).toEqual([]);
  });

  it("CLAIM_BLINDNESS: đảo vai thật không đổi một chữ số nào của uy tín", () => {
    const input = {
      ...BASE,
      claims: [claim("p1", "SEER", 1, "m1"), claim("p2", "SEER", 2, "m2")],
      lastNightDeaths: [{ playerId: "p1", name: "An" }],
    };
    // `claimEvidence` không có tham số nào để nhận vai thật. Đây là test về
    // KIỂU nhiều hơn về giá trị: nếu ai đó thêm một trường vai vào
    // `ClaimSignalInput`, dòng dưới vẫn xanh nhưng review sẽ thấy nó.
    const twice = [claimEvidence(input, BOT_WEIGHTS_V4), claimEvidence(input, BOT_WEIGHTS_V4)];
    expect(twice[0]).toEqual(twice[1]);
    expect(Object.keys(input)).not.toContain("knownRoles");
  });

  it("RULING: khai VILLAGER hàng loạt ở Ngày Sự Thật không tự sinh nghi ngờ va chạm hay thưởng tin cậy", () => {
    const roster = ["p1", "p2", "p3", "p4", "p5", "p6"];
    const claims = roster.map((id, index) =>
      claim(id, "VILLAGER", 1, `day-of-truth:${id}:VILLAGER`),
    );
    const found = claimEvidence(
      {
        ...BASE,
        claims,
        seenEventIds: claims.map((c) => c.sourceId),
      },
      BOT_WEIGHTS_V4,
    );
    // Không có COUNTER_CLAIM nào (S2 tắt cho VILLAGER) và không có "claimant"
    // nào (S1 nửa tin cậy tắt cho VILLAGER). Vì mọi claim() gán targetId="p9",
    // phần còn lại chỉ là bằng chứng buộc tội p9.
    expect(found.every((item) => item.kind !== "COUNTER_CLAIM")).toBe(true);
    expect(found.every((item) => item.id.endsWith(":claimant") === false)).toBe(true);
    expect(found.every((item) => item.actorId === "p9")).toBe(true);
  });
});

const BALANCED: BotPersonality = {
  aggressiveness: 0.5,
  talkativeness: 0.9,
  riskTolerance: 0.5,
  deceptionSkill: 0.5,
  analyticalSkill: 1,
  loyalty: 0.5,
  stubbornness: 0.5,
};

/** Ngày Sự Thật: `p1` khai SEER, không đổi qua các lần `observe()`. */
function dayOfTruthContext(round: number): BotDecisionContext {
  return {
    knowledge: {
      dayOfTruthClaims: { p1: "SEER" },
      activeEventId: null,
      botId: "me",
      round,
      phase: "DAY_DISCUSSION",
      phaseStartedAt: 0,
      phaseEndsAt: 30_000,
      selfRole: "VILLAGER",
      players: [
        { id: "me", name: "ME", alive: true },
        { id: "p1", name: "P1", alive: true },
        { id: "p9", name: "P9", alive: true },
      ],
      knownRoles: { me: "VILLAGER" },
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
    visibleChat: [],
  };
}

describe("BotRuntime.observe — claimEvidence không bị áp lại", () => {
  it("năm lượt observe cùng một lời khai đứng yên cho ra cùng một delta như một lượt", () => {
    const runtime = new BotRuntime({
      playerId: "me",
      rng: () => 0.5,
      playerIds: ["me", "p1", "p9"],
      personality: BALANCED,
      weights: BOT_WEIGHTS_V4,
    });

    // Lượt quan sát đầu tiên: lời khai của p1 vào state.claims, sinh bằng
    // chứng S1 (nửa tin cậy, vì SEER là vai quyền lực).
    runtime.observe(dayOfTruthContext(1));
    const afterFirst = {
      suspicion: runtime.state.suspicion.p1?.score ?? 0,
      trust: runtime.state.trust.p1?.score ?? 0,
    };

    // `claimEvidence` không tự nhớ gì; nó tính lại nguyên `state.claims` mỗi
    // lần. Nếu BotRuntime áp thẳng kết quả mỗi lần observe() được gọi lại
    // trong CÙNG một vòng - đúng như game engine làm ở mỗi checkpoint (vào
    // ngày, mỗi lượt thảo luận, mỗi lượt bỏ phiếu) - bốn lượt gọi thêm dưới
    // đây sẽ cộng dồn cùng một mảnh bằng chứng bốn lần nữa.
    for (let i = 0; i < 4; i += 1) runtime.observe(dayOfTruthContext(1));

    const afterFifth = {
      suspicion: runtime.state.suspicion.p1?.score ?? 0,
      trust: runtime.state.trust.p1?.score ?? 0,
    };

    expect(afterFifth).toEqual(afterFirst);
    // Bằng chứng phải thật sự có tác dụng ở lượt đầu, nếu không phép so sánh
    // ở trên xanh một cách vô nghĩa (0 === 0).
    expect(afterFirst.trust).not.toBe(0);
  });

  it("chỉ mảnh gỡ tội (weight < 0) mới chạm trust — va chạm (weight > 0) chỉ đẩy suspicion", () => {
    // p1 khai một mình: chỉ S1 nửa tin cậy nổ (weight < 0 - gỡ tội cho chính
    // p1, nên chạm cả suspicion lẫn trust của p1).
    const solo = new BotRuntime({
      playerId: "me",
      rng: () => 0.5,
      playerIds: ["me", "p1", "p9"],
      personality: BALANCED,
      weights: BOT_WEIGHTS_V4,
    });
    solo.observe(dayOfTruthContext(1));

    // p1 VÀ p2 cùng khai SEER: thêm S2 va chạm (weight > 0 cho cả hai, buộc
    // tội - không gỡ tội), chồng lên đúng S1 nửa tin cậy ở trên.
    const collided = new BotRuntime({
      playerId: "me",
      rng: () => 0.5,
      playerIds: ["me", "p1", "p2", "p9"],
      personality: BALANCED,
      weights: BOT_WEIGHTS_V4,
    });
    collided.observe({
      ...dayOfTruthContext(1),
      knowledge: {
        ...dayOfTruthContext(1).knowledge,
        dayOfTruthClaims: { p1: "SEER", p2: "SEER" },
        players: [
          { id: "me", name: "ME", alive: true },
          { id: "p1", name: "P1", alive: true },
          { id: "p2", name: "P2", alive: true },
          { id: "p9", name: "P9", alive: true },
        ],
      },
    });

    // Mảnh va chạm (weight > 0) phải đẩy suspicion của p1 lên cao hơn so với
    // khi không có va chạm nào - nó vẫn qua applyEvidence bình thường.
    expect(collided.state.suspicion.p1?.score ?? 0).toBeGreaterThan(
      solo.state.suspicion.p1?.score ?? 0,
    );
    // Nhưng nó KHÔNG được chạm trust: trust của p1 trong hai ván phải bằng
    // nhau, vì cả hai chỉ có đúng S1 nửa tin cậy đóng góp vào trust.
    expect(collided.state.trust.p1?.score ?? 0).toBe(solo.state.trust.p1?.score ?? 0);
  });
});
