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
      killTarget: null,
      actedWolves: [],
      skippedWolves: [],
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

describe("snapshot tiến độ Sói bỏ cắn", () => {
  it("chỉ phe Sói thấy số lượt bỏ qua", () => {
    const room = nightRoom({ actedWolves: ["w1"], skippedWolves: ["w1"] });

    expect(buildSnapshot(room, "w2").night).toMatchObject({
      wolfSkipVotes: 1,
      wolfSkipRequired: 2,
      acted: false,
    });
    expect(buildSnapshot(room, "w1").night?.acted).toBe(true);

    for (const viewerId of ["s", "g", "t"]) {
      const night = buildSnapshot(room, viewerId).night;
      expect(night?.wolfSkipVotes).toBeUndefined();
      expect(night?.wolfSkipRequired).toBeUndefined();
      expect(night?.wolfTarget).toBeNull();
    }
    expect(buildSnapshot(room, "v").night).toBeNull();
  });

  it("chỉ đếm Sói còn sống vào tổng số cần hành động", () => {
    const room = nightRoom({ actedWolves: ["w1"], skippedWolves: ["w1"] });
    room.engine!.state.players.find((p) => p.id === "w2")!.alive = false;

    expect(buildSnapshot(room, "w1").night).toMatchObject({
      wolfSkipVotes: 1,
      wolfSkipRequired: 1,
    });
  });

  it("state cũ thiếu skippedWolves vẫn dựng được snapshot", () => {
    const room = nightRoom();
    const legacy = room.engine!.state as GameState & { night: { skippedWolves?: string[] } };
    delete legacy.night.skippedWolves;
    room.engine = new GameEngine(legacy as GameState);

    expect(room.engine.state.night.skippedWolves).toEqual([]);
    expect(buildSnapshot(room, "w1").night).toMatchObject({ wolfSkipVotes: 0 });
  });
});
