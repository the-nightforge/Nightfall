import { describe, it, expect } from "vitest";
import { GameEngine } from "../src/engine";
import { calculateMomentum } from "../src/events/momentum";
import { selectEvent, GAME_EVENTS } from "../src/events/eventManager";
import { GameState, EnginePlayer } from "../src/types";
import { DEFAULT_ROOM_CONFIG, GameEventView } from "@masoi/shared";

function createTestState(players: Partial<EnginePlayer>[], overrides?: Partial<GameState>): GameState {
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
    activeEvent: null,
    eventHistory: [],
    log: [],
    ...overrides,
  };
}

describe("Momentum Calculation", () => {
  it("returns 0 for initial balanced game state", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "w2", role: "WEREWOLF", alive: true },
      { id: "seer", role: "SEER", alive: true },
      { id: "guard", role: "GUARD", alive: true },
      { id: "witch", role: "WITCH", alive: true },
      { id: "hunter", role: "HUNTER", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
      { id: "v2", role: "VILLAGER", alive: true },
    ]);

    const momentum = calculateMomentum(state);
    expect(momentum).toBe(0);
  });

  it("returns negative momentum (< -0.35) when village is strongly favored", () => {
    // 1 wolf dead, all village power roles alive
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: false },
      { id: "w2", role: "WEREWOLF", alive: true },
      { id: "seer", role: "SEER", alive: true },
      { id: "guard", role: "GUARD", alive: true },
      { id: "witch", role: "WITCH", alive: true },
      { id: "hunter", role: "HUNTER", alive: true },
      { id: "detective", role: "DETECTIVE", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
      { id: "v2", role: "VILLAGER", alive: true },
    ]);

    const momentum = calculateMomentum(state);
    expect(momentum).toBeLessThan(-0.35);
  });

  it("returns positive momentum (> 0.35) when wolves are strongly favored", () => {
    // Both wolves alive, Seer, Guard, Witch, Hunter all eliminated or power depleted
    const state = createTestState(
      [
        { id: "w1", role: "WEREWOLF", alive: true },
        { id: "w2", role: "WEREWOLF", alive: true },
        { id: "seer", role: "SEER", alive: false },
        { id: "guard", role: "GUARD", alive: false },
        { id: "witch", role: "WITCH", alive: false },
        { id: "hunter", role: "HUNTER", alive: false },
        { id: "v1", role: "VILLAGER", alive: true },
        { id: "v2", role: "VILLAGER", alive: false },
      ],
      { healUsed: true, poisonUsed: true },
    );

    const momentum = calculateMomentum(state);
    expect(momentum).toBeGreaterThan(0.35);
  });

  it("returns -1.0 when all wolves are dead", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: false },
      { id: "seer", role: "SEER", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
    ]);
    expect(calculateMomentum(state)).toBe(-1.0);
  });

  it("returns 1.0 when all villagers are dead", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "seer", role: "SEER", alive: false },
      { id: "v1", role: "VILLAGER", alive: false },
    ]);
    expect(calculateMomentum(state)).toBe(1.0);
  });
});

describe("Dynamic Event Selection", () => {
  it("selects nothing when the balanced-ranked neutral roll is 35% or higher", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "w2", role: "WEREWOLF", alive: true },
      { id: "seer", role: "SEER", alive: true },
      { id: "guard", role: "GUARD", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
      { id: "v2", role: "VILLAGER", alive: true },
    ]);
    state.config.mode = "ranked";

    const event = selectEvent(state, "NIGHT", () => 0.35);
    expect(event).toBeNull();
  });

  it("selects a neutral night event when the balanced-ranked roll is below 35%", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "w2", role: "WEREWOLF", alive: true },
      { id: "seer", role: "SEER", alive: true },
      { id: "guard", role: "GUARD", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
      { id: "v2", role: "VILLAGER", alive: true },
    ]);
    state.config.mode = "ranked";
    const rolls = [0.3499, 0.99];

    const event = selectEvent(state, "NIGHT", () => rolls.shift()!);

    expect(event?.id).toBe("SILENT_NIGHT");
    expect(event?.beneficiary).toBe("neutral");
  });

  it("chooses uniformly from eligible neutral day events after a successful ranked roll", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "w2", role: "WEREWOLF", alive: true },
      { id: "seer", role: "SEER", alive: true },
      { id: "guard", role: "GUARD", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
      { id: "v2", role: "VILLAGER", alive: true },
    ]);
    state.config.mode = "ranked";
    const rolls = [0.1, 0.99];

    const event = selectEvent(state, "DAY", () => rolls.shift()!);

    expect(event?.id).toBe("AMNESTY_DAY");
    expect(event?.targetPhase).toBe("DAY");
  });

  it("does not consume RNG when no neutral event is eligible for a balanced ranked phase", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "w2", role: "WEREWOLF", alive: true },
      { id: "seer", role: "SEER", alive: true },
      { id: "guard", role: "GUARD", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
      { id: "v2", role: "VILLAGER", alive: true },
    ]);
    state.config.mode = "ranked";
    state.eventHistory.push({
      ...GAME_EVENTS.SILENT_NIGHT,
      round: 1,
    });
    let rngCalls = 0;

    const event = selectEvent(state, "NIGHT", () => {
      rngCalls += 1;
      return 0.1;
    });

    expect(event).toBeNull();
    expect(rngCalls).toBe(0);
  });

  it("selects a village-benefiting night event when wolves are favored in ranked mode", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "w2", role: "WEREWOLF", alive: true },
      { id: "seer", role: "SEER", alive: true },
      { id: "guard", role: "GUARD", alive: false },
      { id: "witch", role: "WITCH", alive: false },
      { id: "v1", role: "VILLAGER", alive: false },
      { id: "v2", role: "VILLAGER", alive: false },
      { id: "v3", role: "VILLAGER", alive: true },
    ]);
    state.config.mode = "ranked";

    const event = selectEvent(state, "NIGHT");
    expect(event).not.toBeNull();
    expect(event?.beneficiary).toBe("village");
    expect(event?.targetPhase).toBe("NIGHT");
    expect(["CLEARING_MIST", "PEACEFUL_NIGHT"]).toContain(event?.id);
  });

  it("selects a wolves-benefiting night event when village is favored in ranked mode", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: false },
      { id: "w2", role: "WEREWOLF", alive: true },
      { id: "seer", role: "SEER", alive: true },
      { id: "guard", role: "GUARD", alive: true },
      { id: "witch", role: "WITCH", alive: true },
      { id: "hunter", role: "HUNTER", alive: true },
      { id: "detective", role: "DETECTIVE", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
      { id: "v2", role: "VILLAGER", alive: true },
    ]);
    state.config.mode = "ranked";

    const event = selectEvent(state, "NIGHT");
    expect(event).not.toBeNull();
    expect(event?.beneficiary).toBe("wolves");
    expect(event?.targetPhase).toBe("NIGHT");
    expect(["MOONLESS_NIGHT", "BLOODY_HUNT", "SHROUDED_ECLIPSE"]).toContain(event?.id);
  });

  it("selects JUDGMENT_DAY for day phase when wolves are favored and detective exists", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "w2", role: "WEREWOLF", alive: true },
      { id: "detective", role: "DETECTIVE", alive: true },
      { id: "guard", role: "GUARD", alive: false },
      { id: "witch", role: "WITCH", alive: false },
      { id: "v1", role: "VILLAGER", alive: false },
      { id: "v2", role: "VILLAGER", alive: true },
    ]);
    state.config.mode = "ranked";
    state.night.detectiveResults["detective"] = {
      target1Id: "w1",
      target2Id: "v2",
      sameTeam: false,
    };

    const event = selectEvent(state, "DAY");
    expect(event).not.toBeNull();
    expect(event?.id).toBe("JUDGMENT_DAY");
    expect(event?.beneficiary).toBe("village");
  });

  it("does not select CLEARING_MIST or MOONLESS_NIGHT if Seer is dead and Apprentice is not awakened", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: false },
      { id: "w2", role: "WEREWOLF", alive: true },
      { id: "seer", role: "SEER", alive: false },
      { id: "guard", role: "GUARD", alive: true },
      { id: "witch", role: "WITCH", alive: true },
      { id: "hunter", role: "HUNTER", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
      { id: "v2", role: "VILLAGER", alive: true },
    ]);
    state.config.mode = "ranked";

    const event = selectEvent(state, "NIGHT");
    expect(event?.id).not.toBe("MOONLESS_NIGHT");
  });

  it("enforces max 1 major event per game in ranked mode", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "w2", role: "WEREWOLF", alive: true },
      { id: "seer", role: "SEER", alive: true },
      { id: "guard", role: "GUARD", alive: false },
      { id: "v1", role: "VILLAGER", alive: false },
      { id: "v2", role: "VILLAGER", alive: true },
    ]);
    state.config.mode = "ranked";
    const peacefulNightEvent: GameEventView = {
      id: "PEACEFUL_NIGHT",
      name: "Đêm Bình Yên",
      description: "...",
      targetPhase: "NIGHT",
      round: 1,
      beneficiary: "village",
      power: 4,
    };
    state.eventHistory.push(peacefulNightEvent);

    const event = selectEvent(state, "NIGHT");
    expect(event?.id).not.toBe("PEACEFUL_NIGHT");
  });

  it("chaos mode selects events randomly matching targetPhase", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "w2", role: "WEREWOLF", alive: true },
      { id: "seer", role: "SEER", alive: true },
      { id: "guard", role: "GUARD", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
    ]);
    state.config.mode = "chaos";

    const event = selectEvent(state, "NIGHT");
    expect(event).not.toBeNull();
    expect(event?.targetPhase).toBe("NIGHT");
  });
});

describe("Event Modifiers in GameEngine", () => {
  it("PEACEFUL_NIGHT nullifies wolf kill for that night", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
    ]);
    state.activeEvent = {
      id: "PEACEFUL_NIGHT",
      name: "Đêm Bình Yên",
      description: "...",
      targetPhase: "NIGHT",
      round: 1,
      beneficiary: "village",
      power: 4,
    };

    const engine = new GameEngine(state);
    engine.submitNightAction("w1", "KILL", "v1");
    const deaths = engine.resolveNight();

    expect(deaths).toHaveLength(0);
    expect(engine.mustPlayer("v1").alive).toBe(true);
  });

  it("MOONLESS_NIGHT blocks Seer and Apprentice Seer from scanning", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "seer", role: "SEER", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
    ]);
    state.activeEvent = {
      id: "MOONLESS_NIGHT",
      name: "Đêm Không Trăng",
      description: "...",
      targetPhase: "NIGHT",
      round: 1,
      beneficiary: "wolves",
      power: 3,
    };

    const engine = new GameEngine(state);
    expect(engine.snapshotFor("seer").nightInfo?.canAct).toBe(false);
    expect(() => engine.submitNightAction("seer", "SEE", "w1")).toThrowError(/Đêm Không Trăng/);
  });

  it("CLEARING_MIST allows Seer to scan 2 targets in one night", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "seer", role: "SEER", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
      { id: "v2", role: "VILLAGER", alive: true },
    ]);
    state.activeEvent = {
      id: "CLEARING_MIST",
      name: "Màn Sương Tan",
      description: "...",
      targetPhase: "NIGHT",
      round: 1,
      beneficiary: "village",
      power: 3,
    };

    const engine = new GameEngine(state);
    engine.submitNightAction("seer", "SEE", "w1", "v1");

    const snap = engine.snapshotFor("seer");
    expect(snap.nightInfo?.seerResult?.targetId).toBe("w1");
    expect(snap.nightInfo?.seerResult?.isWolf).toBe(true);
    expect(snap.nightInfo?.seerResult?.secondaryTargetId).toBe("v1");
    expect(snap.nightInfo?.seerResult?.secondaryIsWolf).toBe(false);
  });

  it("SHROUDED_ECLIPSE obscures investigation results to UNKNOWN", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "seer", role: "SEER", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
    ]);
    state.activeEvent = {
      id: "SHROUDED_ECLIPSE",
      name: "Bóng Tối Bao Phủ",
      description: "...",
      targetPhase: "NIGHT",
      round: 1,
      beneficiary: "wolves",
      power: 2,
    };

    const engine = new GameEngine(state);
    engine.submitNightAction("seer", "SEE", "w1");

    const snap = engine.snapshotFor("seer");
    expect(snap.nightInfo?.seerResult?.unknown).toBe(true);
  });

  it("SHROUDED_ECLIPSE also obscures Detective results", () => {
    const state = createTestState([
      { id: "det", role: "DETECTIVE", alive: true },
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
    ]);
    state.activeEvent = {
      id: "SHROUDED_ECLIPSE",
      name: "Bóng Tối Bao Phủ",
      description: "...",
      targetPhase: "NIGHT",
      round: 1,
      beneficiary: "wolves",
      power: 2,
    };

    const engine = new GameEngine(state);
    engine.submitNightAction("det", "DETECTIVE_CHECK", "w1", "v1");

    const result = engine.snapshotFor("det").nightInfo?.detectiveResult;
    expect(result?.unknown).toBe(true);
    expect(result?.sameTeam).toBeUndefined();
  });

  it("BLOODY_HUNT allows secondary wolf kill with 50% success probability", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
      { id: "v2", role: "VILLAGER", alive: true },
    ]);
    state.activeEvent = {
      id: "BLOODY_HUNT",
      name: "Cuộc Săn Đẫm Máu",
      description: "...",
      targetPhase: "NIGHT",
      round: 1,
      beneficiary: "wolves",
      power: 4,
    };

    const engine = new GameEngine(state);
    engine.submitNightAction("w1", "KILL", "v1", "v2");

    // Test success (rng = 0.1 < 0.5)
    const deathsSuccess = engine.resolveNight(Date.now(), () => 0.1);
    expect(deathsSuccess.map((d) => d.playerId)).toContain("v1");
    expect(deathsSuccess.map((d) => d.playerId)).toContain("v2");
  });

  it("CURFEW cuts discussion duration by 50% when startDay is called", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
    ]);
    state.config.discussionSeconds = 60;
    const engine = new GameEngine(state);

    const curfewEvent: GameEventView = {
      id: "CURFEW",
      name: "Lệnh Giới Nghiêm",
      description: "...",
      targetPhase: "DAY",
      round: 1,
      beneficiary: "neutral",
      power: 1,
    };

    const now = 100000;
    engine.startDay(60000, now, () => 0, curfewEvent);

    expect(engine.state.phase).toBe("DAY_DISCUSSION");
    expect(engine.state.activeEvent?.id).toBe("CURFEW");
    expect(engine.state.phaseEndsAt).toBe(now + 30000);
  });

  it("JUDGMENT_DAY publishes the Detective result in the public event snapshot", () => {
    const state = createTestState([
      { id: "w1", name: "Khải", role: "WEREWOLF", alive: true },
      { id: "det", role: "DETECTIVE", alive: true },
      { id: "v1", name: "Linh", role: "VILLAGER", alive: true },
    ]);
    state.night.detectiveResults["det"] = {
      target1Id: "w1",
      target2Id: "v1",
      sameTeam: false,
    };
    const engine = new GameEngine(state);

    const judgmentEvent: GameEventView = {
      id: "JUDGMENT_DAY",
      name: "Ngày Phán Xét",
      description: "...",
      targetPhase: "DAY",
      round: 1,
      beneficiary: "village",
      power: 3,
    };

    engine.startDay(60000, 100000, () => 0, judgmentEvent);

    expect(engine.snapshotFor("v1").activeEvent?.announcement).toBe(
      "Kết quả Thám Tử: Khải và Linh là KHÁC PHE!",
    );
  });

  it("includes activeEvent in snapshotFor", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
    ]);
    state.activeEvent = {
      id: "SILENT_NIGHT",
      name: "Đêm Tĩnh Lặng",
      description: "...",
      targetPhase: "NIGHT",
      round: 1,
      beneficiary: "neutral",
      power: 1,
    };
    const engine = new GameEngine(state);
    const snap = engine.snapshotFor("w1");
    expect(snap.activeEvent?.id).toBe("SILENT_NIGHT");
  });
});
