import { describe, it, expect, beforeEach } from "vitest";
import { GameEngine } from "../src/engine";
import { buildRoleDeck, assignRoles } from "../src/assignRoles";
import { GameState, EnginePlayer } from "../src/types";
import { DEFAULT_ROOM_CONFIG, RoomConfig } from "@masoi/shared";

function createTestState(players: Partial<EnginePlayer>[]): GameState {
  const fullPlayers: EnginePlayer[] = players.map((p, i) => ({
    id: p.id ?? `p${i + 1}`,
    name: p.name ?? `Player ${i + 1}`,
    role: p.role ?? "VILLAGER",
    alive: p.alive ?? true,
    isBot: p.isBot ?? false,
    cursedTurned: p.cursedTurned ?? false,
  }));

  const guardianAngelCharges: Record<string, number> = {};
  for (const p of fullPlayers) {
    if (p.role === "GUARDIAN_ANGEL") {
      guardianAngelCharges[p.id] = 2;
    }
  }

  return {
    phase: "NIGHT",
    round: 1,
    phaseEndsAt: Date.now() + 30000,
    phaseStartedAt: Date.now(),
    players: fullPlayers,
    config: {
      ...DEFAULT_ROOM_CONFIG,
      werewolves: 2,
    },
    winner: null,
    night: {
      wolfVotes: {},
      killTarget: null,
      wolfSecondaryTarget: null,
      wolfCubRageTonight: false,
      wolvesLocked: false,
      guardTarget: null,
      guardianAngelTarget: null,
      healTonight: false,
      poisonTarget: null,
      witchSkipped: false,
      seerResults: {},
      priestTarget: null,
      detectiveTargets: null,
      detectiveResults: {},
      priestResults: {},
    },
    votes: {},
    voteMutations: [],
    dayVoteHistory: [],
    guardPrevious: null,
    guardianAngelPrevious: null,
    guardianAngelCharges,
    priestHolyWaterUsed: {},
    apprenticeAwakened: false,
    wolfCubRageNextNight: false,
    healUsed: false,
    poisonUsed: false,
    lastNightDeaths: [],
    nightHistory: [],
    lastEliminated: null,
    trial: null,
    lastTrial: null,
    hunterReaction: null,
    hunterShots: [],
    log: [],
  };
}

describe("Extended Roles - Deck Building", () => {
  it("builds custom deck with all new roles", () => {
    const config: RoomConfig = {
      ...DEFAULT_ROOM_CONFIG,
      werewolves: 2,
      wolfCub: true,
      seer: true,
      apprenticeSeer: true,
      detective: true,
      guard: true,
      guardianAngel: true,
      priest: true,
      witch: true,
      hunter: true,
      mayor: true,
      cursed: true,
    };
    const deck = buildRoleDeck(config, 15);
    expect(deck).toHaveLength(15);
    expect(deck.filter((r) => r === "WEREWOLF")).toHaveLength(2);
    expect(deck).toContain("WOLF_CUB");
    expect(deck).toContain("SEER");
    expect(deck).toContain("APPRENTICE_SEER");
    expect(deck).toContain("DETECTIVE");
    expect(deck).toContain("GUARD");
    expect(deck).toContain("GUARDIAN_ANGEL");
    expect(deck).toContain("PRIEST");
    expect(deck).toContain("WITCH");
    expect(deck).toContain("HUNTER");
    expect(deck).toContain("MAYOR");
    expect(deck).toContain("CURSED");
    expect(deck).toContain("VILLAGER");
  });
});

describe("Detective Role Actions", () => {
  it("checks two players on same team (village)", () => {
    const state = createTestState([
      { id: "det", role: "DETECTIVE" },
      { id: "v1", role: "VILLAGER" },
      { id: "seer", role: "SEER" },
      { id: "w1", role: "WEREWOLF" },
    ]);
    const engine = new GameEngine(state);

    engine.submitNightAction("det", "DETECTIVE_CHECK", "v1", "seer");
    const snap = engine.snapshotFor("det");

    expect(snap.nightInfo?.detectiveResult).toBeDefined();
    expect(snap.nightInfo?.detectiveResult?.sameTeam).toBe(true);
    expect(snap.nightInfo?.acted).toBe(true);
  });

  it("checks two players on different teams (village vs wolf)", () => {
    const state = createTestState([
      { id: "det", role: "DETECTIVE" },
      { id: "v1", role: "VILLAGER" },
      { id: "w1", role: "WEREWOLF" },
    ]);
    const engine = new GameEngine(state);

    engine.submitNightAction("det", "DETECTIVE_CHECK", "v1", "w1");
    const snap = engine.snapshotFor("det");

    expect(snap.nightInfo?.detectiveResult).toBeDefined();
    expect(snap.nightInfo?.detectiveResult?.sameTeam).toBe(false);
  });

  it("checks two wolves on same team (werewolf vs wolf cub)", () => {
    const state = createTestState([
      { id: "det", role: "DETECTIVE" },
      { id: "w1", role: "WEREWOLF" },
      { id: "wc", role: "WOLF_CUB" },
    ]);
    const engine = new GameEngine(state);

    engine.submitNightAction("det", "DETECTIVE_CHECK", "w1", "wc");
    const snap = engine.snapshotFor("det");

    expect(snap.nightInfo?.detectiveResult?.sameTeam).toBe(true);
  });

  it("rejects invalid targets for detective", () => {
    const state = createTestState([
      { id: "det", role: "DETECTIVE" },
      { id: "v1", role: "VILLAGER" },
      { id: "dead", role: "VILLAGER", alive: false },
    ]);
    const engine = new GameEngine(state);

    // Target dead
    expect(() => engine.submitNightAction("det", "DETECTIVE_CHECK", "v1", "dead")).toThrow();
    // Same target twice
    expect(() => engine.submitNightAction("det", "DETECTIVE_CHECK", "v1", "v1")).toThrow();
    // Missing secondary target
    expect(() => engine.submitNightAction("det", "DETECTIVE_CHECK", "v1", null)).toThrow();
  });
});

describe("Guardian Angel Role Actions", () => {
  it("protects player and consumes charge, prevents wolf kill", () => {
    const state = createTestState([
      { id: "ga", role: "GUARDIAN_ANGEL" },
      { id: "v1", role: "VILLAGER" },
      { id: "w1", role: "WEREWOLF" },
    ]);
    const engine = new GameEngine(state);

    expect(engine.snapshotFor("ga").nightInfo?.guardianAngelCharges).toBe(2);

    engine.submitNightAction("ga", "GUARDIAN_PROTECT", "v1");
    expect(engine.snapshotFor("ga").nightInfo?.guardianAngelCharges).toBe(1);

    engine.submitNightAction("w1", "KILL", "v1");
    const deaths = engine.resolveNight();

    expect(deaths).toHaveLength(0);
    expect(engine.player("v1")?.alive).toBe(true);
  });

  it("cannot protect same player two nights in a row", () => {
    const state = createTestState([
      { id: "ga", role: "GUARDIAN_ANGEL" },
      { id: "v1", role: "VILLAGER" },
      { id: "v2", role: "VILLAGER" },
      { id: "w1", role: "WEREWOLF" },
    ]);
    const engine = new GameEngine(state);

    engine.submitNightAction("ga", "GUARDIAN_PROTECT", "v1");
    engine.resolveNight();

    engine.setPhase("NIGHT", 30000);

    // Attempting same target on next night
    expect(() => engine.submitNightAction("ga", "GUARDIAN_PROTECT", "v1")).toThrow();

    // Protecting different target succeeds
    engine.submitNightAction("ga", "GUARDIAN_PROTECT", "v2");
    expect(engine.snapshotFor("ga").nightInfo?.guardianAngelCharges).toBe(0);
  });

  it("cannot protect when 0 charges left", () => {
    const state = createTestState([
      { id: "ga", role: "GUARDIAN_ANGEL" },
      { id: "v1", role: "VILLAGER" },
      { id: "v2", role: "VILLAGER" },
      { id: "v3", role: "VILLAGER" },
      { id: "w1", role: "WEREWOLF" },
    ]);
    state.guardianAngelCharges["ga"] = 0;
    const engine = new GameEngine(state);

    expect(() => engine.submitNightAction("ga", "GUARDIAN_PROTECT", "v1")).toThrow();
  });
});

describe("Priest Role Actions", () => {
  it("kills werewolf when holy water used on wolf", () => {
    const state = createTestState([
      { id: "priest", role: "PRIEST" },
      { id: "w1", role: "WEREWOLF" },
      { id: "w2", role: "WEREWOLF" },
      { id: "v1", role: "VILLAGER" },
    ]);
    const engine = new GameEngine(state);

    engine.submitNightAction("priest", "HOLY_WATER", "w1");
    const snap = engine.snapshotFor("priest");
    expect(snap.nightInfo?.priestHolyWaterUsed).toBe(true);

    const deaths = engine.resolveNight();
    expect(deaths).toContainEqual({
      playerId: "w1",
      name: "Player 2",
      cause: "priest",
    });
    expect(engine.player("w1")?.alive).toBe(false);
    expect(engine.player("priest")?.alive).toBe(true);
  });

  it("backfires and kills priest when holy water used on villager", () => {
    const state = createTestState([
      { id: "priest", role: "PRIEST" },
      { id: "w1", role: "WEREWOLF" },
      { id: "v1", role: "VILLAGER" },
    ]);
    const engine = new GameEngine(state);

    engine.submitNightAction("priest", "HOLY_WATER", "v1");
    const deaths = engine.resolveNight();

    expect(deaths).toContainEqual({
      playerId: "priest",
      name: "Player 1",
      cause: "priest_backfire",
    });
    expect(engine.player("priest")?.alive).toBe(false);
    expect(engine.player("v1")?.alive).toBe(true);
  });

  it("cannot use holy water twice", () => {
    const state = createTestState([
      { id: "priest", role: "PRIEST" },
      { id: "w1", role: "WEREWOLF" },
      { id: "v1", role: "VILLAGER" },
    ]);
    state.priestHolyWaterUsed["priest"] = true;
    const engine = new GameEngine(state);

    expect(() => engine.submitNightAction("priest", "HOLY_WATER", "w1")).toThrow();
  });
});

describe("Apprentice Seer Mechanics", () => {
  it("cannot act while Seer is alive", () => {
    const state = createTestState([
      { id: "seer", role: "SEER" },
      { id: "app", role: "APPRENTICE_SEER" },
      { id: "v1", role: "VILLAGER" },
      { id: "w1", role: "WEREWOLF" },
    ]);
    const engine = new GameEngine(state);

    expect(engine.hasNightAction("APPRENTICE_SEER")).toBe(false);
    expect(() => engine.submitNightAction("app", "SEE", "w1")).toThrow();
  });

  it("awakens when Seer dies in night and can act next night", () => {
    const state = createTestState([
      { id: "seer", role: "SEER" },
      { id: "app", role: "APPRENTICE_SEER" },
      { id: "v1", role: "VILLAGER" },
      { id: "w1", role: "WEREWOLF" },
    ]);
    const engine = new GameEngine(state);

    // Wolf kills Seer
    engine.submitNightAction("w1", "KILL", "seer");
    engine.resolveNight();

    expect(engine.state.apprenticeAwakened).toBe(true);

    // Start next night
    engine.setPhase("NIGHT", 30000);
    expect(engine.hasNightAction("APPRENTICE_SEER")).toBe(true);

    engine.submitNightAction("app", "SEE", "w1");
    const snap = engine.snapshotFor("app");
    expect(snap.nightInfo?.seerResult?.isWolf).toBe(true);
  });

  it("awakens when Seer dies in day voting", () => {
    const state = createTestState([
      { id: "seer", role: "SEER" },
      { id: "app", role: "APPRENTICE_SEER" },
      { id: "v1", role: "VILLAGER" },
      { id: "w1", role: "WEREWOLF" },
    ]);
    const engine = new GameEngine(state);

    engine.setPhase("VOTING", 30000);
    engine.submitVote("v1", "seer");
    engine.submitVote("w1", "seer");
    engine.submitVote("app", "seer");

    engine.resolveNomination(20000);
    engine.beginFinalVote(20000);
    engine.submitFinalVote("v1", true);
    engine.submitFinalVote("w1", true);
    engine.submitFinalVote("app", true);

    engine.resolveFinalVote();

    expect(engine.player("seer")?.alive).toBe(false);
    expect(engine.state.apprenticeAwakened).toBe(true);
  });
});

describe("Wolf Cub Rage Mechanics", () => {
  it("triggers rage on next night when Wolf Cub dies", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF" },
      { id: "wc", role: "WOLF_CUB" },
      { id: "v1", role: "VILLAGER" },
      { id: "v2", role: "VILLAGER" },
      { id: "priest", role: "PRIEST" },
    ]);
    const engine = new GameEngine(state);

    // Priest kills wolf cub
    engine.submitNightAction("priest", "HOLY_WATER", "wc");
    engine.resolveNight();

    expect(engine.state.wolfCubRageNextNight).toBe(true);

    // Transition to next night
    engine.setPhase("NIGHT", 30000);
    expect(engine.state.night.wolfCubRageTonight).toBe(true);
    expect(engine.state.wolfCubRageNextNight).toBe(false);

    // Wolf bites two targets
    engine.state.night.wolfSecondaryTarget = "v2";
    engine.submitNightAction("w1", "KILL", "v1");

    const deaths = engine.resolveNight();
    expect(deaths.map((d) => d.playerId)).toContain("v1");
    expect(deaths.map((d) => d.playerId)).toContain("v2");
  });
});

describe("Mayor 2x Vote Weight", () => {
  it("counts Mayor nomination vote as 2 votes", () => {
    const state = createTestState([
      { id: "mayor", role: "MAYOR" },
      { id: "v1", role: "VILLAGER" },
      { id: "v2", role: "VILLAGER" },
      { id: "pA", role: "VILLAGER" },
      { id: "pB", role: "VILLAGER" },
    ]);
    const engine = new GameEngine(state);

    engine.setPhase("VOTING", 30000);
    // 2 villagers vote pA (2 votes)
    engine.submitVote("v1", "pA");
    engine.submitVote("v2", "pA");
    // Mayor votes pB (counts as 2 votes)
    engine.submitVote("mayor", "pB");

    const tally = engine.voteTally();
    expect(tally.players["pA"]).toBe(2);
    expect(tally.players["pB"]).toBe(2);
  });

  it("counts Mayor final vote as 2 in trial", () => {
    const state = createTestState([
      { id: "accused", role: "VILLAGER" },
      { id: "mayor", role: "MAYOR" },
      { id: "v1", role: "VILLAGER" },
    ]);
    const engine = new GameEngine(state);

    engine.state.trial = {
      accusedId: "accused",
      finalVotes: {},
    };
    engine.setPhase("FINAL_VOTE", 20000);

    // Mayor votes guilty (2 votes)
    engine.submitFinalVote("mayor", true);
    // v1 votes innocent (1 vote)
    engine.submitFinalVote("v1", false);

    const tally = engine.finalVoteTally();
    expect(tally.guilty).toBe(2);
    expect(tally.innocent).toBe(1);
    expect(tally.eligible).toBe(3);

    const eliminated = engine.resolveFinalVote();
    expect(eliminated?.playerId).toBe("accused");
    expect(engine.player("accused")?.alive).toBe(false);
  });
});
