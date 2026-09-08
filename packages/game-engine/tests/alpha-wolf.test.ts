import { describe, expect, it } from "vitest";
import { GameEngine } from "../src/engine";
import type { EnginePlayer, GameState, NightState } from "../src/types";
import { DEFAULT_ROOM_CONFIG, type Role } from "@masoi/shared";

function emptyNight(): NightState {
  return {
    wolfVotes: {},
    killTarget: null,
    wolvesLocked: false,
    guardTarget: null,
    guardSecondTarget: null,
    healTonight: false,
    poisonTarget: null,
    witchSkipped: false,
    seerResults: {},
    wolfSecondaryTarget: null,
    wolfCubRageTonight: false,
    detectiveTargets: null,
    detectiveResults: {},
    sorcererResults: {},
  } as NightState;
}

function stateWith(players: Array<[string, Role, boolean?]>): GameState {
  return {
    deadCanSpeakChosenId: null,
    phase: "NIGHT",
    round: 1,
    phaseEndsAt: 30_000,
    phaseStartedAt: 0,
    voteMutations: [],
    dayVoteHistory: [],
    trial: null,
    lastTrial: null,
    players: players.map(([id, role, alive]) => ({
      id,
      name: id,
      role,
      alive: alive ?? true,
      isBot: false,
    })) as EnginePlayer[],
    config: { ...DEFAULT_ROOM_CONFIG, werewolves: 1, hunter: false },
    winner: null,
    night: emptyNight(),
    votes: {},
    guardPrevious: null,
    healUsed: false,
    poisonUsed: false,
    lastNightDeaths: [],
    nightHistory: [],
    lastEliminated: null,
    hunterReaction: null,
    hunterShots: [],
    alphaShieldUsed: {},
    apprenticeAwakened: false,
    wolfCubRageNextNight: false,
    activeEvent: null,
    eventHistory: [],
    log: [],
    pendingLastStandVictim: null,
    bloodMoonArmed: false,
    bloodMoonUsed: false,
    deadCanSpeakUsed: false,
    howlBonusDay: null,
    dayOfTruthClaims: {},
  } as GameState;
}

const engineWith = (players: Array<[string, Role, boolean?]>) =>
  new GameEngine(stateWith(players));

describe("Sói Alpha", () => {
  const roster: Array<[string, Role, boolean?]> = [
    ["seer", "SEER"],
    ["alpha", "ALPHA_WOLF"],
    ["wolf", "WEREWOLF"],
    ["v1", "VILLAGER"],
  ];

  it("SEE lần đầu lên Alpha trả làng + bật khiên", () => {
    const e = engineWith(roster);
    e.submitNightAction("seer", "SEE", "alpha");
    expect(e.state.night.seerResults["seer"]).toMatchObject({
      targetId: "alpha",
      isWolf: false,
      team: "village",
    });
    expect(e.state.alphaShieldUsed["alpha"]).toBe(true);
  });

  it("SEE lần hai hiện nguyên hình sói", () => {
    const e = engineWith(roster);
    e.submitNightAction("seer", "SEE", "alpha");
    expect(e.state.night.seerResults["seer"]?.isWolf).toBe(false);

    e.setPhase("DAY_DISCUSSION", 30_000);
    e.setPhase("NIGHT", 30_000);
    e.submitNightAction("seer", "SEE", "alpha");
    expect(e.state.night.seerResults["seer"]).toMatchObject({
      targetId: "alpha",
      isWolf: true,
      team: "wolves",
    });
  });

  it("Alpha cắn cùng bầy và bị treo như sói thường", () => {
    const e = engineWith(roster);
    expect(() => e.submitNightAction("alpha", "KILL", "v1")).not.toThrow();
    expect(e.state.night.wolfVotes["alpha"]).toBe("v1");
  });
});
