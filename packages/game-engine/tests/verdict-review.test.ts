import { describe, expect, it } from "vitest";
import type { DayVoteRecap, PublicVoteChoice, Role } from "@masoi/shared";
import { analyzeRevealedVerdict, lynchedIdOf } from "../src/bot/analysis/verdict-review";
import { BotRuntime } from "../src/bot/BotRuntime";
import { BOT_WEIGHTS_V1 } from "../src/bot/config/weights";
import type { BotDecisionContext, BotPersonality } from "../src/bot/types";

const SHARP: BotPersonality = {
  aggressiveness: 0.5,
  talkativeness: 0.5,
  riskTolerance: 0.5,
  deceptionSkill: 0.5,
  analyticalSkill: 1,
  loyalty: 0.5,
  stubbornness: 0.5,
};

const always = () => 0;

function player(targetId: string): PublicVoteChoice {
  return { type: "PLAYER", targetId };
}

/**
 * Vòng 2: cả bàn đề cử `accused`, phiên toà xử, `guilty` bỏ Treo và `innocent`
 * bỏ Tha. `lynched` bám theo đa số phiếu Treo đúng như engine.
 */
function trialRecap(options: {
  accused: string;
  guilty: string[];
  innocent: string[];
  lynched?: boolean;
  round?: number;
}): DayVoteRecap {
  const round = options.round ?? 2;
  const voters = [...options.guilty, ...options.innocent];
  return {
    round,
    mutations: voters.map((voterId, index) => ({
      id: `${round}:nomination:${index + 1}`,
      round,
      voterId,
      previousChoice: null,
      choice: player(options.accused),
      castAt: 1_000 * (index + 1),
      phaseStartedAt: 0,
      phaseEndsAt: 30_000,
      sequence: index + 1,
    })),
    finalBallots: voters.map((voterId) => ({ voterId, choice: player(options.accused) })),
    nomination: { kind: "TRIAL", accusedId: options.accused },
    finalJudgment: {
      ballots: [
        ...options.guilty.map((voterId) => ({ voterId, guilty: true })),
        ...options.innocent.map((voterId) => ({ voterId, guilty: false })),
      ],
      guilty: options.guilty.length,
      innocent: options.innocent.length,
      abstain: 0,
      lynched: options.lynched ?? true,
    },
  };
}

describe("analyzeRevealedVerdict", () => {
  const recap = trialRecap({ accused: "x", guilty: ["a", "b"], innocent: ["c"] });

  it("treo trúng Sói: người bỏ Treo được gỡ tội, người bỏ Tha bị buộc tội", () => {
    const found = analyzeRevealedVerdict(recap, "WEREWOLF", 1, always, BOT_WEIGHTS_V1);

    const byActor = Object.fromEntries(found.map((item) => [item.actorId, item]));
    expect(byActor.a.kind).toBe("VERDICT_HIT");
    expect(byActor.b.kind).toBe("VERDICT_HIT");
    expect(byActor.c.kind).toBe("VERDICT_MISS");
    // Quy ước dấu của lõi: âm là gỡ tội, dương là buộc tội.
    expect(byActor.a.weight).toBeLessThan(0);
    expect(byActor.c.weight).toBeGreaterThan(0);
  });

  it("treo nhầm phe làng: đảo ngược hoàn toàn", () => {
    const found = analyzeRevealedVerdict(recap, "VILLAGER", 1, always, BOT_WEIGHTS_V1);

    const byActor = Object.fromEntries(found.map((item) => [item.actorId, item]));
    expect(byActor.a.kind).toBe("VERDICT_MISS");
    expect(byActor.a.weight).toBeGreaterThan(0);
    expect(byActor.c.kind).toBe("VERDICT_HIT");
    expect(byActor.c.weight).toBeLessThan(0);
  });

  it("Kẻ Nguyền Rủa đã hoá Sói tính theo PHE, không theo mã vai gốc", () => {
    // Engine ghi đè `role` thành WEREWOLF khi bị nguyền, nên phe mới là thứ
    // duy nhất cần đọc - một kiểm tra so chuỗi với "WEREWOLF" sẽ trượt ở đúng
    // những vai mà nó cần đúng nhất.
    const wolfCub = analyzeRevealedVerdict(recap, "WOLF_CUB", 1, always, BOT_WEIGHTS_V1);
    expect(wolfCub.find((item) => item.actorId === "a")?.kind).toBe("VERDICT_HIT");
  });

  it("nguồn của mỗi mảnh là lá phiếu Treo/Tha có thật trong recap", () => {
    const found = analyzeRevealedVerdict(recap, "WEREWOLF", 1, always, BOT_WEIGHTS_V1);
    expect(found.map((item) => item.sourceId).sort()).toEqual([
      "2:final:a",
      "2:final:b",
      "2:final:c",
    ]);
  });

  it("không ai bị treo thì không có gì để chấm lại", () => {
    const spared = trialRecap({ accused: "x", guilty: ["a"], innocent: ["b", "c"], lynched: false });
    expect(analyzeRevealedVerdict(spared, "WEREWOLF", 1, always, BOT_WEIGHTS_V1)).toEqual([]);
    expect(lynchedIdOf(spared)).toBeNull();
  });

  it("bot kém tinh ý bỏ SÓT tín hiệu chứ không đọc ra tín hiệu ngược", () => {
    expect(analyzeRevealedVerdict(recap, "WEREWOLF", 0, always, BOT_WEIGHTS_V1)).toEqual([]);
  });
});

describe("BotRuntime chấm lại phán quyết", () => {
  function context(
    knownRoles: Record<string, Role>,
    recap: DayVoteRecap,
    options: { reveal?: boolean; selfRole?: Role } = {},
  ): BotDecisionContext {
    return {
      knowledge: {
        dayOfTruthClaims: {},
        activeEventId: null,
        // Bàn của bộ test này không có vai trung lập nào; xem `neutralRolesInPlay`.
        neutralRolesInPlay: [],
        botId: "me",
        round: 3,
        phase: "VOTING",
        phaseStartedAt: 0,
        phaseEndsAt: 30_000,
        selfRole: options.selfRole ?? "VILLAGER",
        players: ["me", "a", "b", "c", "x"].map((id) => ({
          id,
          name: id.toUpperCase(),
          alive: id !== "x",
        })),
        knownRoles: { me: options.selfRole ?? "VILLAGER", ...knownRoles },
        revealRoleOnDeath: options.reveal ?? true,
        seerResult: null,
        mediumResult: null,
        night: null,
        trialAccusedId: null,
        canFinalVote: false,
        hunterShot: null,
        publicVoteHistory: [recap],
        currentVoteCounts: { players: {}, noElimination: 0 },
        hasVoted: false,
        myVote: null,
        legalVoteChoices: [{ type: "NO_ELIMINATION" }],
        lastNightDeaths: [],
      },
      visibleChat: [],
    };
  }

  function runtime(): BotRuntime {
    return new BotRuntime({
      playerId: "me",
      rng: always,
      playerIds: ["me", "a", "b", "c", "x"],
      personality: SHARP,
      weights: BOT_WEIGHTS_V1,
    });
  }

  const recap = trialRecap({ accused: "x", guilty: ["a", "b"], innocent: ["c"] });

  it("vai chưa lộ: luật mặc định chạy y như cũ, không có mảnh nào", () => {
    const bot = runtime();
    bot.observe(context({}, recap));

    const kinds = Object.values(bot.state.suspicion).flatMap((entry) =>
      entry.reasons.map((item) => item.kind),
    );
    expect(kinds).not.toContain("VERDICT_MISS");
    expect(kinds).not.toContain("VERDICT_HIT");
  });

  it("vai đã lộ là Dân: người đẩy phiếu Treo bị nghi, người bỏ Tha được tin", () => {
    const bot = runtime();
    bot.observe(context({ x: "VILLAGER" }, recap));

    expect(bot.state.suspicion.a.score).toBeGreaterThan(0);
    expect(bot.state.suspicion.b.score).toBeGreaterThan(0);
    expect(bot.state.trust.c.score).toBeGreaterThan(0);
    expect(bot.state.suspicion.a.reasons.map((item) => item.kind)).toContain("VERDICT_MISS");
  });

  it("cờ tắt: Sói nhớ vai đồng bọn vừa bị treo cũng KHÔNG được chấm lại", () => {
    // Thông tin riêng, không phải thông tin cả bàn cùng thấy. Cho nó chạy ở
    // đây là đổi hành vi luật mặc định và làm hỏng tính "chỉ đổi một biến" của
    // `reveal-ab.ts`.
    const bot = runtime();
    bot.observe(
      context({ x: "WEREWOLF" }, recap, { reveal: false, selfRole: "WEREWOLF" }),
    );

    const kinds = Object.values(bot.state.suspicion).flatMap((entry) =>
      entry.reasons.map((item) => item.kind),
    );
    expect(kinds).not.toContain("VERDICT_HIT");
    expect(kinds).not.toContain("VERDICT_MISS");
  });

  it("chấm đúng MỘT lần, dù observe chạy bao nhiêu lần trong vòng", () => {
    const bot = runtime();
    const ctx = context({ x: "VILLAGER" }, recap);

    bot.observe(ctx);
    const once = bot.state.suspicion.a.score;
    bot.observe(ctx);
    bot.observe(ctx);

    expect(bot.state.suspicion.a.score).toBe(once);
  });
});
