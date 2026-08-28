import { describe, expect, it } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG, gameActionPayload } from "@masoi/shared";
import { buildSnapshot } from "../src/rooms/snapshot";
import type { Room } from "../src/rooms/store";

const PLAYERS: GameState["players"] = [
  { id: "w1", name: "Sói 1", role: "WEREWOLF", alive: true, isBot: false },
  { id: "w2", name: "Sói 2", role: "WEREWOLF", alive: true, isBot: false },
  { id: "s", name: "Tiên Tri", role: "SEER", alive: true, isBot: false },
  { id: "g", name: "Bảo Vệ", role: "GUARD", alive: true, isBot: false },
  { id: "t", name: "Phù Thủy", role: "WITCH", alive: true, isBot: false },
  { id: "v", name: "Dân", role: "VILLAGER", alive: true, isBot: false },
];

function nightRoom(night: Partial<GameState["night"]> = {}): Room {
  const state: GameState = {
    phase: "NIGHT",
    round: 1,
    phaseEndsAt: null,
    players: PLAYERS.map((p) => ({ ...p })),
    config: { ...DEFAULT_ROOM_CONFIG },
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
      ...night,
    },
    votes: {},
    guardPrevious: null,
    healUsed: false,
    poisonUsed: false,
    lastNightDeaths: [],
    nightHistory: [],
    lastEliminated: null,
    log: [],
  };

  return {
    code: "WOLFSK",
    hostId: "w1",
    status: "IN_GAME",
    members: PLAYERS.map((p) => ({
      playerId: p.id,
      name: p.name,
      ready: true,
      connected: true,
      isBot: false,
    })),
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: new GameEngine(state),
    chatLog: [],
    createdAt: 0,
  };
}

describe("schema hành động Sói bỏ cắn", () => {
  it("chấp nhận SKIP không kèm mục tiêu", () => {
    expect(gameActionPayload.safeParse({ type: "SKIP", targetId: null }).success).toBe(true);
    expect(gameActionPayload.safeParse({ type: "SKIP" }).success).toBe(true);
  });
});

describe("snapshot tiến độ bỏ phiếu của Sói", () => {
  it("chỉ phe Sói thấy bảng phiếu", () => {
    const room = nightRoom({ wolfVotes: { w1: null, w2: "v" } });

    expect(buildSnapshot(room, "w2").night).toMatchObject({
      wolfSkipVotes: 1,
      wolfVoteCounts: { v: 1 },
      wolfVotesRequired: 2,
      myWolfVote: "v",
      acted: true,
    });
    expect(buildSnapshot(room, "w1").night).toMatchObject({ acted: true, myWolfVote: null });

    for (const viewerId of ["s", "g", "t"]) {
      const night = buildSnapshot(room, viewerId).night;
      expect(night?.wolfSkipVotes).toBeUndefined();
      expect(night?.wolfVotesRequired).toBeUndefined();
      expect(night?.wolfVoteCounts).toBeUndefined();
      expect(night?.wolfTarget).toBeNull();
    }
    expect(buildSnapshot(room, "v").night).toBeNull();
  });

  it("chỉ đếm Sói còn sống vào tổng số phiếu cần có", () => {
    const room = nightRoom({ wolfVotes: { w1: null } });
    room.engine!.state.players.find((p) => p.id === "w2")!.alive = false;

    expect(buildSnapshot(room, "w1").night).toMatchObject({
      wolfSkipVotes: 1,
      wolfVotesRequired: 1,
    });
  });

  it("Phù Thuỷ chỉ thấy nạn nhân sau khi bầy Sói chốt", () => {
    const pending = nightRoom({ wolfVotes: { w1: "v", w2: "v" } });
    expect(buildSnapshot(pending, "t").night).toMatchObject({
      canAct: false,
      wolvesLocked: false,
      wolfTarget: null,
    });

    const locked = nightRoom({ wolfVotes: { w1: "v", w2: "v" } });
    locked.engine!.lockWolves();
    expect(buildSnapshot(locked, "t").night).toMatchObject({
      canAct: true,
      wolvesLocked: true,
      wolfTarget: "v",
    });
  });

  it("state cũ thiếu wolfVotes vẫn dựng được snapshot", () => {
    const room = nightRoom();
    const legacy = room.engine!.state as GameState & {
      night: { wolfVotes?: Record<string, string | null> };
    };
    delete legacy.night.wolfVotes;
    room.engine = new GameEngine(legacy as GameState);

    expect(room.engine.state.night.wolfVotes).toEqual({});
    expect(buildSnapshot(room, "w1").night).toMatchObject({ wolfSkipVotes: 0 });
  });
});
