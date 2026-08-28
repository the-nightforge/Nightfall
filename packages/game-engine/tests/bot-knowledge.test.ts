import { describe, expect, it } from "vitest";
import { GameEngine } from "../src/engine";
import type { GameState } from "../src/types";
import { DEFAULT_ROOM_CONFIG, type GamePhase, type Role, type RoomConfig } from "@masoi/shared";

const CONFIG: RoomConfig = {
  ...DEFAULT_ROOM_CONFIG,
  werewolves: 2,
  guard: false,
  hunter: false,
};

const ROSTER: Array<{ id: string; name: string; role: Role }> = [
  { id: "villager", name: "Dân", role: "VILLAGER" },
  { id: "dead-seer", name: "Tiên Tri", role: "SEER" },
  { id: "witch", name: "Phù Thuỷ", role: "WITCH" },
  { id: "wolf-a", name: "Sói A", role: "WEREWOLF" },
  { id: "wolf-b", name: "Sói B", role: "WEREWOLF" },
];

function knowledgeFixture(phase: GamePhase = "VOTING") {
  const state: GameState = {
    phase,
    round: 2,
    phaseEndsAt: 130_000,
    phaseStartedAt: 100_000,
    players: ROSTER.map((player) => ({ ...player, alive: true, isBot: true, cursedTurned: false })),
    config: CONFIG,
    winner: null,
    night: {
      wolfVotes: {},
      killTarget: null,
      wolvesLocked: false,
      guardTarget: null,
      healTonight: false,
      poisonTarget: null,
      witchSkipped: false,
      seerResults: {},
    },
    votes: {},
    voteMutations: [],
    dayVoteHistory: [],
    guardPrevious: null,
    healUsed: false,
    poisonUsed: false,
    lastNightDeaths: [{ playerId: "ghost", name: "Ma" }],
    nightHistory: [],
    lastEliminated: null,
    trial: null,
    lastTrial: null,
    hunterReaction: null,
    hunterShots: [],
    log: [],
  };
  return new GameEngine(state);
}

function seerFixture() {
  const engine = knowledgeFixture();
  engine.state.night.seerResults["dead-seer"] = { targetId: "wolf-a", isWolf: true };
  return engine;
}

describe("bot knowledge security boundary", () => {
  it("does not expose living or dead hidden roles to a villager", () => {
    const e = knowledgeFixture();
    e.mustPlayer("dead-seer").alive = false;

    const view = e.botKnowledgeFor("villager");

    expect(view.knownRoles).toEqual({ villager: "VILLAGER" });
    expect(JSON.stringify(view)).not.toContain("SEER");
    expect(JSON.stringify(view)).not.toContain("WITCH");
    expect(JSON.stringify(view)).not.toContain("WEREWOLF");
  });

  it("keeps a dead player visible as a person while hiding the role", () => {
    const e = knowledgeFixture();
    e.mustPlayer("dead-seer").alive = false;

    const view = e.botKnowledgeFor("villager");

    expect(view.players).toContainEqual({ id: "dead-seer", name: "Tiên Tri", alive: false });
    expect(view.knownRoles).not.toHaveProperty("dead-seer");
  });

  it("only exposes known wolf teammates to a living wolf", () => {
    const view = knowledgeFixture().botKnowledgeFor("wolf-a");

    expect(view.knownRoles).toEqual({ "wolf-a": "WEREWOLF", "wolf-b": "WEREWOLF" });
    expect(JSON.stringify(view)).not.toContain("SEER");
  });

  it("hides teammates from a dead wolf", () => {
    const e = knowledgeFixture();
    e.mustPlayer("wolf-a").alive = false;

    expect(e.botKnowledgeFor("wolf-a").knownRoles).toEqual({ "wolf-a": "WEREWOLF" });
  });

  it("exposes only the viewer seer result", () => {
    const view = seerFixture().botKnowledgeFor("dead-seer");

    expect(view.seerResult).toEqual({ targetId: "wolf-a", targetName: "Sói A", isWolf: true });
    expect(seerFixture().botKnowledgeFor("villager").seerResult).toBeNull();
  });

  it("reports legal vote choices only while the viewer can actually vote", () => {
    const e = knowledgeFixture();

    expect(e.botKnowledgeFor("villager").legalVoteChoices).toEqual([
      { type: "PLAYER", targetId: "villager" },
      { type: "PLAYER", targetId: "dead-seer" },
      { type: "PLAYER", targetId: "witch" },
      { type: "PLAYER", targetId: "wolf-a" },
      { type: "PLAYER", targetId: "wolf-b" },
      { type: "NO_ELIMINATION" },
    ]);

    e.mustPlayer("dead-seer").alive = false;
    expect(e.botKnowledgeFor("villager").legalVoteChoices).not.toContainEqual({
      type: "PLAYER",
      targetId: "dead-seer",
    });
    expect(e.botKnowledgeFor("dead-seer").legalVoteChoices).toEqual([]);
    expect(knowledgeFixture("DAY_DISCUSSION").botKnowledgeFor("villager").legalVoteChoices).toEqual([]);
  });

  it("reports the viewer's own current vote and the public tally", () => {
    const e = knowledgeFixture();
    e.submitVote("villager", "wolf-a", 110_000);
    e.submitVote("witch", null, 111_000);

    const view = e.botKnowledgeFor("villager");

    expect(view.hasVoted).toBe(true);
    expect(view.myVote).toEqual({ type: "PLAYER", targetId: "wolf-a" });
    expect(view.currentVoteCounts).toEqual({ players: { "wolf-a": 1 }, noElimination: 1 });
    expect(e.botKnowledgeFor("wolf-b").hasVoted).toBe(false);
    expect(e.botKnowledgeFor("wolf-b").myVote).toBeNull();
  });

  it("distinguishes a no-elimination vote from not having voted", () => {
    const e = knowledgeFixture();
    e.submitVote("villager", null, 110_000);

    expect(e.botKnowledgeFor("villager").myVote).toEqual({ type: "NO_ELIMINATION" });
    expect(e.botKnowledgeFor("villager").hasVoted).toBe(true);
  });

  it("copies public vote history so callers cannot mutate engine state", () => {
    const e = knowledgeFixture();
    e.submitVote("villager", "wolf-a", 110_000);
    e.submitVote("witch", "wolf-a", 111_000);
    e.resolveNomination(20_000, 130_000);

    const view = e.botKnowledgeFor("villager");
    expect(view.publicVoteHistory).toHaveLength(1);
    view.publicVoteHistory[0]!.mutations[0]!.choice = { type: "NO_ELIMINATION" };
    view.publicVoteHistory[0]!.mutations.push(view.publicVoteHistory[0]!.mutations[0]!);

    expect(e.state.dayVoteHistory[0]!.mutations).toHaveLength(2);
    expect(e.state.dayVoteHistory[0]!.mutations[0]!.choice).toEqual({
      type: "PLAYER",
      targetId: "wolf-a",
    });
    expect(JSON.stringify(view.publicVoteHistory)).not.toContain("WEREWOLF");
  });

  it("carries phase timing, round and public deaths for the runtime", () => {
    const view = knowledgeFixture().botKnowledgeFor("villager");

    expect(view.botId).toBe("villager");
    expect(view.round).toBe(2);
    expect(view.phase).toBe("VOTING");
    expect(view.phaseStartedAt).toBe(100_000);
    expect(view.phaseEndsAt).toBe(130_000);
    expect(view.selfRole).toBe("VILLAGER");
    expect(view.lastNightDeaths).toEqual([{ playerId: "ghost", name: "Ma" }]);
  });

  it("rejects an unknown viewer instead of inventing a view", () => {
    expect(() => knowledgeFixture().botKnowledgeFor("nobody")).toThrow(
      "Người chơi không tồn tại trong trận",
    );
  });
});
