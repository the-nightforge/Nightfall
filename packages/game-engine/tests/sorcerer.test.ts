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

describe("Sói Pháp Sư", () => {
  const roster: Array<[string, Role, boolean?]> = [
    ["sorc", "SORCERER"],
    ["seer", "SEER"],
    ["wolf", "WEREWOLF"],
    ["v1", "VILLAGER"],
  ];

  it("soi trúng dòng Tiên Tri trả isSeerLine true", () => {
    const e = engineWith(roster);
    e.submitNightAction("sorc", "SORCERER_CHECK", "seer");
    expect(e.state.night.sorcererResults["sorc"]).toEqual({
      targetId: "seer",
      isSeerLine: true,
    });
  });

  it("soi Tiên Tri Tập Sự cũng trả true", () => {
    const e = engineWith([
      ["sorc", "SORCERER"],
      ["app", "APPRENTICE_SEER"],
      ["wolf", "WEREWOLF"],
      ["v1", "VILLAGER"],
    ]);
    e.submitNightAction("sorc", "SORCERER_CHECK", "app");
    expect(e.state.night.sorcererResults["sorc"]).toEqual({
      targetId: "app",
      isSeerLine: true,
    });
  });

  it("soi dân trả false; tự soi và soi người chết bị từ chối", () => {
    const e = engineWith(roster);
    e.submitNightAction("sorc", "SORCERER_CHECK", "v1");
    expect(e.state.night.sorcererResults["sorc"]).toEqual({
      targetId: "v1",
      isSeerLine: false,
    });

    const e2 = engineWith(roster);
    expect(() => e2.submitNightAction("sorc", "SORCERER_CHECK", "sorc")).toThrow();

    const e3 = engineWith([
      ["sorc", "SORCERER"],
      ["seer", "SEER"],
      ["dead", "VILLAGER", false],
      ["v1", "VILLAGER"],
    ]);
    expect(() => e3.submitNightAction("sorc", "SORCERER_CHECK", "dead")).toThrow();
  });

  it("một lượt mỗi đêm, chốt ngay lần nộp đầu", () => {
    const e = engineWith(roster);
    e.submitNightAction("sorc", "SORCERER_CHECK", "seer");
    expect(() =>
      e.submitNightAction("sorc", "SORCERER_CHECK", "v1"),
    ).toThrow(/đã kiểm tra/);
  });

  it("vai khác gọi SORCERER_CHECK bị từ chối", () => {
    const e = engineWith(roster);
    expect(() => e.submitNightAction("seer", "SORCERER_CHECK", "v1")).toThrow(
      /Sói Pháp Sư/,
    );
  });

  it("ghi lại lượt check vào NightRecap sau khi khép đêm", () => {
    const e = engineWith(roster);
    e.submitNightAction("sorc", "SORCERER_CHECK", "seer");
    e.resolveNight();
    const night = e.state.nightHistory[0];
    expect(night.sorcererChecks).toEqual([
      {
        sorcerer: { id: "sorc", name: "sorc" },
        target: { id: "seer", name: "seer" },
        isSeerLine: true,
      },
    ]);
  });
});
