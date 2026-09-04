import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DayVoteRecap } from "@masoi/shared";
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

/**
 * Một câu PHẢN BÁC: "anh không thể là Tiên Tri, tôi mới là Tiên Tri".
 *
 * `targetId` ở đây là người bị phản bác - nghĩa "người này khai láo vai", KHÔNG
 * phải "người này là Sói". Khác biệt đó là lý do S1 nửa buộc tội và S4 không
 * được đọc trường này.
 */
function counter(actorId: string, role: string, round: number, sourceId: string): BotMemory {
  return {
    id: `COUNTER_CLAIM:${sourceId}:${actorId}`,
    sourceId,
    round,
    phase: "DAY_DISCUSSION",
    type: "COUNTER_CLAIM",
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

  /**
   * Kịch bản đảo ngược mục đích của cả cơ chế, và là lỗi mà đợt sửa này bịt.
   *
   * Sói khai láo Tiên Tri ở vòng 2 rồi ăn trọn thưởng tin cậy của S1. Tiên Tri
   * thật đứng lên phản bác - và trước đây câu phản bác đó không sinh ra MỘT mảnh
   * bằng chứng nào, vì `chat-analysis` phát ra `COUNTER_CLAIM` (chứ không kèm
   * một `ROLE_CLAIM`) còn mô hình uy tín thì chỉ lọc `ROLE_CLAIM`. Kẻ nói dối
   * được lời, người nói thật trắng tay.
   */
  it("FIX: phản bác cũng là một lời khai — S1 tin cậy và S2 va chạm đều nổ", () => {
    const found = claimEvidence(
      { ...BASE, claims: [claim("p1", "SEER", 1, "m1"), counter("p2", "SEER", 2, "m2")] },
      BOT_WEIGHTS_V4,
    );

    // S1 nửa tin cậy cho NGƯỜI PHẢN BÁC: đứng lên nhận Tiên Tri phơi mình trước
    // bầy Sói y hệt người khai trước.
    expect(found.some((item) => item.id === "m2:ROLE_CLAIM:claimant" && item.weight < 0)).toBe(true);

    // S2 va chạm cho CẢ HAI: đây chính là cú va chạm mà tín hiệu sinh ra để bắt.
    expect(found.some((item) => item.id.includes("collision:SEER:p1"))).toBe(true);
    expect(found.some((item) => item.id.includes("collision:SEER:p2"))).toBe(true);
  });

  it("FIX: `targetId` của phản bác KHÔNG bị đọc thành một lời tố Sói", () => {
    // Câu phản bác nói "p9 khai láo vai", không nói "p9 là Sói". Đổ nó vào kênh
    // buộc tội sẽ dựng lên một cáo buộc chưa ai từng nói ra.
    const found = claimEvidence(
      { ...BASE, claims: [counter("p2", "SEER", 2, "m2")] },
      BOT_WEIGHTS_V4,
    );
    expect(found.some((item) => item.actorId === "p9")).toBe(false);

    // Và S4 cũng không được coi phản bác là "đã gọi tên một con Sói rồi không
    // treo người đó".
    const withRecap = claimEvidence(
      {
        ...BASE,
        claims: [counter("p2", "SEER", 1, "m2")],
        publicVoteHistory: [
          {
            round: 1,
            mutations: [],
            finalBallots: [],
            nomination: { kind: "NONE", reason: "no-votes" },
            finalJudgment: null,
          } satisfies DayVoteRecap,
        ],
        seenEventIds: [...BASE.seenEventIds, "recap:1"],
      },
      BOT_WEIGHTS_V4,
    );
    expect(withRecap.some((item) => item.id.includes("inconsistent"))).toBe(false);
  });

  it("FIX: phản bác cũng bị đêm kiểm chứng", () => {
    const found = claimEvidence(
      {
        ...BASE,
        claims: [counter("p1", "SEER", 1, "m1")],
        lastNightDeaths: [{ playerId: "p1", name: "An" }],
      },
      BOT_WEIGHTS_V4,
    );
    const confirm = found.find((item) => item.sourceId === "night-death:2:p1");
    expect(confirm).toBeDefined();
    expect(confirm!.weight).toBeLessThan(0);
  });

  /**
   * FIX 3: `PRIEST` là chỗ nấp AN TOÀN NHẤT của một con Sói bị dồn (nó đứng
   * trong `BLUFF_COVERS`), nhưng tập `POWER_ROLES` chép tay cũ của file này bỏ
   * sót nó - nên đúng lời nói dối rẻ nhất lại là lời mô hình mù hoàn toàn.
   */
  it("FIX: PRIEST/GUARDIAN_ANGEL/MAYOR nay cũng là vai quyền lực", () => {
    for (const role of ["PRIEST", "GUARDIAN_ANGEL", "MAYOR"]) {
      const found = claimEvidence(
        { ...BASE, claims: [claim("p1", role, 1, "m1"), claim("p2", role, 2, "m2")] },
        BOT_WEIGHTS_V4,
      );
      expect({ role, collided: found.some((item) => item.id.includes(`collision:${role}`)) }).toEqual(
        { role, collided: true },
      );
    }
  });

  it("nhóm claim tắt thì không phát gì", () => {
    const off = { ...BOT_WEIGHTS_V4, claim: { ...BOT_WEIGHTS_V4.claim, accusationWeight: 0 } };
    expect(claimEvidence({ ...BASE, claims: [claim("p1", "SEER", 1, "m1")] }, off)).toEqual([]);
  });

  /**
   * CLAIM_BLINDNESS được bảo đảm bởi ĐÚNG MỘT thứ: danh sách import của module.
   *
   * Bản trước của test này khẳng định một hàm thuần bằng chính nó và khẳng định
   * một object literal tự viết trong test không có khoá `knownRoles` - cả hai
   * đều xanh vĩnh viễn kể cả khi ai đó thêm một trường vai vào
   * `ClaimSignalInput` RỒI ĐỌC NÓ. Một test báo an toàn mà không thể đỏ thì tệ
   * hơn không có test: nó làm người đọc tiếp theo thôi không kiểm nữa.
   *
   * Nên đọc thẳng source. Nếu `claim-credibility.ts` bao giờ import
   * `knownRoles`/`knownInformation` - hoặc kéo về `private-info`,
   * `knowledge.ts`, hay bất cứ đường nào chở tri thức riêng - test này đỏ.
   */
  it("CLAIM_BLINDNESS: module không có đường nào chạm tới tri thức riêng", () => {
    const source = readFileSync(
      join(__dirname, "..", "src", "bot", "analysis", "claim-credibility.ts"),
      "utf8",
    );
    // Bỏ chú thích trước khi soi: file này NÓI về `knownRoles` trong doc-comment
    // để giải thích chính ranh giới đang được giữ, và một phép tìm chuỗi thô sẽ
    // đỏ vì đúng câu văn mô tả ràng buộc.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    for (const forbidden of ["knownRoles", "knownInformation", "selfRole", "seerResults"]) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }

    // Danh sách import phải ngắn và chỉ gồm ba nguồn: kiểu vai công khai, bảng
    // trọng số, và kiểu memory. Bất cứ import thứ tư nào cũng phải được người
    // thêm nó nhìn thẳng vào dòng này.
    const imports = [...code.matchAll(/^import[\s\S]*?from "([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["../config/weights", "../types", "@masoi/shared"]);
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
      neutralRolesInPlay: [],
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

  /**
   * FIX 2: "bị dồn" là ĐANG DẪN PHIẾU, không phải "có ít nhất một phiếu".
   *
   * Hai file từng hiểu hai kiểu: `decideChatClaim` mở nhánh UNDER_FIRE khi bot
   * dẫn phiếu, còn chỗ đóng dấu ở đây thì chỉ cần một phiếu. Hệ quả: từ vòng 3
   * trở đi hầu như ai cũng cõng một phiếu lạc, nên `underFireFactor` (0.25) cắt
   * tin cậy của MỌI lời khai xuống một phần tư - đúng lúc lời khai quan trọng
   * nhất. Nay hai chỗ gọi chung một hàm.
   */
  it("underFire chỉ bật cho NGƯỜI ĐANG DẪN PHIẾU, không phải ai có một phiếu lạc", () => {
    function runWith(counts: Record<string, number>): boolean {
      const runtime = new BotRuntime({
        playerId: "me",
        rng: () => 0.5,
        playerIds: ["me", "p1", "p2", "p9"],
        personality: BALANCED,
        weights: BOT_WEIGHTS_V4,
      });
      const base = dayOfTruthContext(3);
      runtime.observe({
        knowledge: {
          ...base.knowledge,
          dayOfTruthClaims: {},
          players: [
            { id: "me", name: "ME", alive: true },
            { id: "p1", name: "P1", alive: true },
            { id: "p2", name: "P2", alive: true },
            { id: "p9", name: "P9", alive: true },
          ],
          currentVoteCounts: { players: counts, noElimination: 0 },
        },
        visibleChat: [{ id: "chat-1", actorId: "p1", text: "tôi là tiên tri", at: 0 }],
      });
      return runtime.state.claims.some(
        (memory) => memory.actorId === "p1" && memory.data.underFire === true,
      );
    }

    // p1 cõng một phiếu lạc trong khi p2 đang thật sự bị dồn: KHÔNG phải áp lực.
    expect(runWith({ p1: 1, p2: 3 })).toBe(false);
    // p1 dẫn phiếu: đây mới là khai lúc bị dồn.
    expect(runWith({ p1: 3, p2: 1 })).toBe(true);
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
