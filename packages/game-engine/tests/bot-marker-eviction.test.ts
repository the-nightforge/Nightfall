import { describe, expect, it } from "vitest";
import type { DayVoteRecap, Role } from "@masoi/shared";
import { BotRuntime } from "../src/bot/BotRuntime";
import { BOT_WEIGHTS_V1 } from "../src/bot/config/weights";
import { memoryKey } from "../src/bot/memory/memory-store";
import { createSeededRng } from "../src/bot/rng";
import type { BotDecisionContext, BotPersonality } from "../src/bot/types";

/**
 * Characterization cho tương tác giữa marker một-lần (`recap:`, `tracker-applied:`)
 * và trần `seenEventIds` của `remember()`.
 *
 * Trần chỉ được siết ở MỘT nơi (`memory-store.remember`), còn marker và message id
 * được đẩy trực tiếp không siết — nên một ván rất dài (> `limits.seenEvents` sự kiện)
 * có thể làm marker của vòng cũ trôi ra khỏi hàng đợi FIFO. Khi đó `observe()` chạy
 * lại từ đầu trên cùng một knowledge:
 *
 * - `ingestRecaps` đọc lại recap; `remember()` dedup memory cũ (KHÔNG đẩy lại
 *   sourceId đã bị evict), rồi `applyEvidence` với nguồn đã mất → hiện tại
 *   `validateEvidence` NÉM. Guard tương tự của `ingestVerdictReviews` (bỏ qua mảnh
 *   mất nguồn) tồn tại nhưng đường recap thì không.
 * - Đường tracker tự lành: `ensureSource` đăng ký lại nguồn trước khi áp, nên
 *   mất marker chỉ tốn đúng MỘT lần áp lại, rồi marker được đẩy lại và dừng.
 */

const BALANCED: BotPersonality = {
  aggressiveness: 0.5,
  talkativeness: 0.9,
  riskTolerance: 0.5,
  deceptionSkill: 0.5,
  analyticalSkill: 1,
  loyalty: 0.5,
  stubbornness: 0.5,
};

/** Recap vòng 1: b đổi phiếu muộn (LATE_SWITCH), phiên toà xử c, c là Sói. */
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
    ballots: [
      { voterId: "b", guilty: true },
      { voterId: "d", guilty: false },
    ],
    guilty: 1,
    innocent: 1,
    abstain: 0,
    lynched: true,
  },
};

function context(options: {
  round?: number;
  selfRole?: Role;
  knownRoles?: Record<string, Role>;
  publicVoteHistory?: DayVoteRecap[];
  revealRoleOnDeath?: boolean;
  trackerResult?: { targetId: string; acted: boolean } | null;
}): BotDecisionContext {
  const alive = (id: string, isAlive: boolean) => ({ id, name: id.toUpperCase(), alive: isAlive });
  return {
    knowledge: {
      botId: "me",
      round: options.round ?? 2,
      phase: "VOTING",
      phaseStartedAt: 0,
      phaseEndsAt: 30_000,
      selfRole: options.selfRole ?? "VILLAGER",
      players: [alive("me", true), alive("b", true), alive("c", false), alive("d", true)],
      knownRoles: options.knownRoles ?? { me: options.selfRole ?? "VILLAGER" },
      revealRoleOnDeath: options.revealRoleOnDeath,
      seerResult: null,
      sorcererResult: null,
      trackerResult: options.trackerResult ?? null,
      neutralRolesInPlay: [],
      night: null,
      trialAccusedId: null,
      canFinalVote: false,
      hunterShot: null,
      publicVoteHistory: options.publicVoteHistory ?? [],
      currentVoteCounts: { players: {}, noElimination: 0 },
      hasVoted: false,
      myVote: null,
      legalVoteChoices: [
        { type: "PLAYER", targetId: "b" },
        { type: "PLAYER", targetId: "d" },
        { type: "NO_ELIMINATION" },
      ],
      lastNightDeaths: [],
      activeEventId: null,
      dayOfTruthClaims: {},
    },
    visibleChat: [],
  };
}

function runtime(): BotRuntime {
  return new BotRuntime({
    playerId: "me",
    rng: createSeededRng("marker-eviction"),
    playerIds: ["me", "b", "c", "d"],
    personality: BALANCED,
    weights: BOT_WEIGHTS_V1,
  });
}

/**
 * Mô phỏng đúng kỷ luật của `remember()`: đẩy một loạt id giả rồi cắt về trần
 * bằng cách shift từ ĐẦU hàng đợi. Trần lấy từ weights của chính runtime.
 */
function evictOldest(runtime_: BotRuntime, count: number): void {
  const cap = runtime_.weights.limits.seenEvents;
  const ids = runtime_.state.seenEventIds;
  for (let index = 0; index < count; index += 1) {
    ids.push(`evict-dummy:${index}`);
    if (ids.length > cap) ids.shift();
  }
}

describe("marker eviction khi seenEventIds tràn", () => {
  it("đọc lại recap sau khi marker và nguồn bị evict: không ném, bằng chứng đã tiêu không bị áp lại", () => {
    const bot = runtime();
    const ctx = context({
      publicVoteHistory: [recap],
      revealRoleOnDeath: true,
      knownRoles: { me: "VILLAGER", c: "WEREWOLF" },
    });

    bot.observe(ctx);
    expect(bot.state.seenEventIds).toContain("recap:1");
    expect(bot.state.seenEventIds).toContain("1:final:b");
    const suspicionBefore = JSON.stringify(bot.state.suspicion);
    const trustBefore = JSON.stringify(bot.state.trust);
    const keysBefore = bot.state.memories.map(memoryKey).sort();
    expect(keysBefore).toContain("VOTE_CAST:1:nomination:1:b:c");

    evictOldest(bot, bot.weights.limits.seenEvents);
    expect(bot.state.seenEventIds).not.toContain("recap:1");
    expect(bot.state.seenEventIds).not.toContain("1:nomination:3");

    expect(() => bot.observe(ctx)).not.toThrow();

    // Marker được đẩy lại để lần sau không đọc lại nữa.
    expect(bot.state.seenEventIds).toContain("recap:1");
    // Bằng chứng đã áp ở observe đầu không được cộng thêm lần hai.
    expect(JSON.stringify(bot.state.suspicion)).toBe(suspicionBefore);
    expect(JSON.stringify(bot.state.trust)).toBe(trustBefore);
    // Memory không nhân đôi (dedup theo memoryKey vẫn giữ).
    expect(bot.state.memories.map(memoryKey).sort()).toEqual(keysBefore);

    // Lần observe thứ ba: marker còn nguyên, trạng thái đứng yên.
    bot.observe(ctx);
    expect(JSON.stringify(bot.state.suspicion)).toBe(suspicionBefore);
  });

  it("tracker marker bị evict: nguồn hồi sinh, evidence áp lại đúng một lần rồi dừng", () => {
    const bot = runtime();
    const ctx = context({ trackerResult: { targetId: "c", acted: true }, selfRole: "TRACKER" });

    bot.observe(ctx);
    const first = bot.state.suspicion["c"]!.score;
    expect(first).toBeGreaterThan(0);

    evictOldest(bot, bot.weights.limits.seenEvents);
    expect(bot.state.seenEventIds).not.toContain("tracker-applied:2:c");

    expect(() => bot.observe(ctx)).not.toThrow();
    // `ensureSource` đăng ký lại nguồn trước khi áp, nên chỉ tốn đúng một lần áp lại.
    expect(bot.state.seenEventIds).toContain("tracker:2:c");
    const second = bot.state.suspicion["c"]!.score;
    expect(second).toBeGreaterThan(first);

    bot.observe(ctx);
    expect(bot.state.suspicion["c"]!.score).toBe(second);
  });
});
