import { describe, expect, it } from "vitest";
import type { DayVoteRecap, PublicVoteChoice } from "@masoi/shared";
import { runBotScenario, type BotScenarioInput, type BotScenarioResult } from "../src/bot/scenario";
import type { BotBrainState, BotDecisionContext } from "../src/bot/types";

const PLAYERS = ["me", "b", "c", "d", "e"];

function step(round: number, history: DayVoteRecap[], chatId: string): BotDecisionContext {
  const legal = PLAYERS.filter((id) => id !== "me");
  return {
    knowledge: {
      botId: "me",
      round,
      phase: "VOTING",
      phaseStartedAt: 0,
      phaseEndsAt: 30_000,
      selfRole: "VILLAGER",
      players: PLAYERS.map((id) => ({ id, name: id.toUpperCase(), alive: true })),
      knownRoles: { me: "VILLAGER" },
      seerResult: null,
      night: null,
      trialAccusedId: null,
      canFinalVote: false,
      hunterShot: null,
      publicVoteHistory: history,
      currentVoteCounts: { players: {}, noElimination: 0 },
      hasVoted: false,
      myVote: null,
      legalVoteChoices: [
        ...legal.map((targetId): PublicVoteChoice => ({ type: "PLAYER", targetId })),
        { type: "NO_ELIMINATION" },
      ],
      lastNightDeaths: round > 1 ? [{ playerId: "e", name: "E" }] : [],
    },
    visibleChat: [
      { id: `${chatId}-1`, actorId: "b", text: "Tôi là Tiên Tri", at: 10 },
      { id: `${chatId}-2`, actorId: "c", text: "Tôi nghi D", at: 20 },
      { id: `${chatId}-3`, actorId: "d", text: "Đừng treo B", at: 30 },
    ],
  };
}

function recap(round: number): DayVoteRecap {
  const mutations = [
    { voterId: "b", from: null as string | null, to: "d", at: 1_000 },
    { voterId: "c", from: null as string | null, to: "d", at: 2_000 },
    { voterId: "d", from: null as string | null, to: "b", at: 3_000 },
    { voterId: "e", from: null as string | null, to: "b", at: 4_000 },
    { voterId: "e", from: "b" as string | null, to: "d", at: 28_000 },
  ].map((entry, index) => ({
    id: `${round}:nomination:${index + 1}`,
    round,
    voterId: entry.voterId,
    previousChoice:
      entry.from === null ? null : ({ type: "PLAYER", targetId: entry.from } as PublicVoteChoice),
    choice: { type: "PLAYER", targetId: entry.to } as PublicVoteChoice,
    castAt: entry.at,
    phaseStartedAt: 0,
    phaseEndsAt: 30_000,
    sequence: index + 1,
  }));

  return {
    round,
    mutations,
    finalBallots: [
      { voterId: "b", choice: { type: "PLAYER", targetId: "d" } },
      { voterId: "c", choice: { type: "PLAYER", targetId: "d" } },
      { voterId: "d", choice: { type: "PLAYER", targetId: "b" } },
      { voterId: "e", choice: { type: "PLAYER", targetId: "d" } },
    ],
    nomination: { kind: "TRIAL", accusedId: "d" },
    finalJudgment: {
      ballots: [
        { voterId: "b", guilty: true },
        { voterId: "c", guilty: false },
      ],
      guilty: 1,
      innocent: 1,
      abstain: 0,
      lynched: false,
    },
  };
}

function scenario(seed: string): BotScenarioInput {
  return {
    seed,
    playerId: "me",
    playerIds: PLAYERS,
    steps: [step(1, [], "d1"), step(2, [recap(1)], "d2"), step(3, [recap(1), recap(2)], "d3")],
  };
}

function allBeliefsInRange(state: BotBrainState): boolean {
  return [state.suspicion, state.trust].every((map) =>
    Object.values(map).every((entry) => entry.score >= 0 && entry.score <= 100),
  );
}

function hasOnlyRealEvidence(
  decision: BotScenarioResult["decisions"][number],
  state: BotBrainState,
): boolean {
  const items = [...decision.vote.evidence, ...(decision.speech?.evidence ?? [])];
  return items.every((item) => state.seenEventIds.includes(item.sourceId));
}

describe("bot scenario invariants", () => {
  it("holds every invariant across one hundred seeds", () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const result = runBotScenario(scenario(String(seed)));

      expect(allBeliefsInRange(result.state)).toBe(true);
      expect(
        result.decisions.every((decision) => hasOnlyRealEvidence(decision, result.state)),
      ).toBe(true);
      expect(result.state.memories.length).toBeLessThanOrEqual(120);
      expect(result.decisions).toHaveLength(3);
      for (const decision of result.decisions) {
        if (decision.vote.choice.type === "PLAYER") {
          expect(decision.vote.choice.targetId).not.toBe("me");
        }
      }
    }
  });

  it("replays identically for the same seed", () => {
    expect(runBotScenario(scenario("same"))).toEqual(runBotScenario(scenario("same")));
  });

  it("does not produce identical brains for every seed", () => {
    const brains = new Set(
      Array.from({ length: 20 }, (_, index) =>
        JSON.stringify(runBotScenario(scenario(`seed-${index}`)).state.personality),
      ),
    );

    expect(brains.size).toBeGreaterThan(1);
  });

  it("never claims to know another player's role from public play alone", () => {
    const result = runBotScenario(scenario("secrecy"));

    expect(result.state.knownInformation.knownRoles).toEqual({ me: "VILLAGER" });
  });
});
