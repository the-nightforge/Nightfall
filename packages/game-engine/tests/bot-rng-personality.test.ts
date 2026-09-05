import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createBotPersonality,
  createSeededRng,
  type BotBrainState,
  type BotDecisionContext,
  type BotEvidence,
  type BotPersonality,
  type BotSpeechIntention,
  type BotVoteIntention,
} from "../src/index";

const PERSONALITY_KEYS = [
  "aggressiveness",
  "talkativeness",
  "riskTolerance",
  "deceptionSkill",
  "analyticalSkill",
  "loyalty",
  "stubbornness",
] as const satisfies readonly (keyof BotPersonality)[];

function botSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? botSourceFiles(full) : [full];
  });
}

describe("bot seeded randomness and personality", () => {
  it("replays the same sequence from the same seed", () => {
    const a = createSeededRng("ROOM:bot-a");
    const b = createSeededRng("ROOM:bot-a");

    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("creates bounded personality values", () => {
    const personality = createBotPersonality(createSeededRng("bot-a"));

    for (const value of Object.values(personality)) {
      expect(value).toBeGreaterThanOrEqual(0.25);
      expect(value).toBeLessThanOrEqual(0.9);
    }
  });

  it("uses exactly seven seeded values to create a personality", () => {
    let calls = 0;
    const rng = () => {
      calls += 1;
      return 0.5;
    };

    createBotPersonality(rng);

    expect(calls).toBe(7);
  });

  it("produces different sequences for different seeds", () => {
    const a = createSeededRng("ROOM:bot-a");
    const b = createSeededRng("ROOM:bot-b");

    expect([a(), a(), a()]).not.toEqual([b(), b(), b()]);
  });

  it("stays inside the unit interval over a long run", () => {
    const rng = createSeededRng("ROOM:long-run");

    for (let index = 0; index < 5_000; index += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("rebuilds an identical personality from the same seed", () => {
    expect(createBotPersonality(createSeededRng("room:bot-a:brain"))).toEqual(
      createBotPersonality(createSeededRng("room:bot-a:brain")),
    );
  });

  it("fills every personality trait used by the decision layer", () => {
    const personality = createBotPersonality(createSeededRng("bot-traits"));

    expect(Object.keys(personality).sort()).toEqual([...PERSONALITY_KEYS].sort());
  });

  it("exposes the bot contracts through the package entry point", () => {
    const evidence: BotEvidence = {
      id: "ev-1",
      kind: "LATE_SWITCH",
      sourceId: "1:nomination:2",
      actorId: "a",
      targetId: "b",
      weight: 6,
      confidence: 0.8,
      round: 1,
      summary: "Đổi phiếu sát giờ chót.",
    };
    const vote: BotVoteIntention = {
      kind: "VOTE",
      choice: { type: "PLAYER", targetId: "b" },
      confidence: 0.7,
      evidence: [evidence],
    };
    const speech: BotSpeechIntention = {
      kind: "ACCUSE",
      targetId: "b",
      confidence: 0.7,
      evidence: [evidence],
      tone: "FIRM",
    };
    const context: BotDecisionContext = {
      knowledge: {
        dayOfTruthClaims: {},
        neutralRolesInPlay: [],
        activeEventId: null,
        botId: "a",
        round: 1,
        phase: "VOTING",
        phaseStartedAt: 0,
        phaseEndsAt: 30_000,
        selfRole: "VILLAGER",
        players: [{ id: "a", name: "An", alive: true }],
        knownRoles: { a: "VILLAGER" },
        seerResult: null,
        mediumResult: null,
        night: null,
        trialAccusedId: null,
        canFinalVote: false,
        hunterShot: null,
        publicVoteHistory: [],
        currentVoteCounts: { players: {}, noElimination: 0 },
        hasVoted: false,
        myVote: null,
        legalVoteChoices: [{ type: "NO_ELIMINATION" }],
        lastNightDeaths: [],
      },
      visibleChat: [{ id: "m1", actorId: "a", text: "Chào", at: 0 }],
    };
    const state: BotBrainState = {
      playerId: "a",
      personality: createBotPersonality(createSeededRng("a")),
      suspicion: {},
      trust: {},
      knownInformation: { knownRoles: {}, seerResults: [] },
      claims: [],
      myClaim: null,
      memories: [],
      relationships: {},
      currentTheory: null,
      currentTargets: [],
      confidence: 0,
      previousVotes: [],
      previousNightActions: [],
      speechMemory: [],
      speechSequence: 0,
      repliedMessageIds: [],
      seenEventIds: [],
      appliedClaimEvidenceIds: [],
    };

    // Giá trị thật của test này nằm ở typecheck: `npm run lint` chạy
    // tsconfig.test.json (bao gồm cả tests/), nên đổi tên hoặc đổi kiểu một
    // trường contract sẽ làm lint đỏ ngay tại các fixture bên trên.
    expect([vote, speech, context, state].every((value) => value !== null)).toBe(true);
  });

  it("keeps the bot core free of global randomness", () => {
    const offenders = botSourceFiles(join(__dirname, "..", "src", "bot")).filter((file) =>
      readFileSync(file, "utf8").includes("Math.random"),
    );

    expect(offenders).toEqual([]);
  });
});
