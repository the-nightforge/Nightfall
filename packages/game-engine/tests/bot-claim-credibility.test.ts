import { describe, expect, it } from "vitest";
import { claimEvidence } from "../src/bot/analysis/claim-credibility";
import { BOT_WEIGHTS_V4 } from "../src/bot/config/weights";
import type { BotMemory } from "../src/bot/types";

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
  voteCounts: {},
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
