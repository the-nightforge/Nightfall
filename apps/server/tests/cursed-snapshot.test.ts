import { describe, expect, it } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { buildSnapshot, resolveChat } from "../src/rooms/snapshot";
import type { Room } from "../src/rooms/store";

function cursedRoom(phase: GameState["phase"], turned: boolean): Room {
  const state: GameState = {
    phase,
    round: 2,
    phaseEndsAt: null,
    players: [
      { id: "wolf", name: "Sói", role: "WEREWOLF", alive: true, isBot: false },
      {
        id: "cursed",
        name: "Nguyền",
        role: turned ? "WEREWOLF" : "CURSED",
        alive: true,
        isBot: false,
        cursedTurned: turned,
      },
      { id: "villager", name: "Dân", role: "VILLAGER", alive: true, isBot: false },
      { id: "seer", name: "Tiên Tri", role: "SEER", alive: true, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG, cursed: true },
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
    guardPrevious: null,
    healUsed: false,
    poisonUsed: false,
    lastNightDeaths: [],
    nightHistory: [
      {
        round: 1,
        wolfTarget: { id: "cursed", name: "Nguyền" },
        guardTarget: null,
        seerChecks: [],
        witch: { usedHeal: false, healedTarget: null, poisonTarget: null },
        deaths: [],
        cursedTurned: turned ? { id: "cursed", name: "Nguyền" } : null,
      },
    ],
    lastEliminated: null,
    hunterReaction: null,
    hunterShots: [],
    log: [],
  };

  return {
    code: "CURSE",
    hostId: "villager",
    status: "IN_GAME",
    members: state.players.map((p) => ({
      playerId: p.id,
      name: p.name,
      ready: true,
      connected: true,
      isBot: false,
    })),
    config: state.config,
    engine: new GameEngine(state),
    chatLog: [],
    createdAt: 0,
  };
}

describe("Snapshot của Kẻ Nguyền Rủa", () => {
  it("không lộ vai lẫn trạng thái đã chuyển phe cho người khác", () => {
    const room = cursedRoom("DAY_DISCUSSION", true);
    const view = buildSnapshot(room, "villager");
    const cursed = view.players.find((p) => p.id === "cursed")!;

    expect(cursed.role).toBeUndefined();
    expect(cursed.cursedTurned).toBeUndefined();
    expect(view.nightHistory).toEqual([]);
  });

  it("cho chính người bị nguyền biết mình đã hoá Ma Sói", () => {
    const room = cursedRoom("DAY_DISCUSSION", true);
    const view = buildSnapshot(room, "cursed");

    expect(view.you?.role).toBe("WEREWOLF");
    expect(view.you?.cursedTurned).toBe(true);
  });

  it("giữ Kẻ Nguyền Rủa chưa chuyển phe ở phe làng trong snapshot của chính họ", () => {
    const room = cursedRoom("DAY_DISCUSSION", false);
    const view = buildSnapshot(room, "cursed");

    expect(view.you?.role).toBe("CURSED");
    expect(view.you?.cursedTurned).toBe(false);
  });

  it("lộ đủ vai và gốc nguyền rủa khi ván kết thúc", () => {
    const room = cursedRoom("GAME_OVER", true);
    const view = buildSnapshot(room, "villager");
    const cursed = view.players.find((p) => p.id === "cursed")!;

    expect(cursed.role).toBe("WEREWOLF");
    expect(cursed.cursedTurned).toBe(true);
    expect(view.nightHistory[0].cursedTurned).toEqual({ id: "cursed", name: "Nguyền" });
  });

  it("đưa Kẻ Nguyền Rủa đã chuyển phe vào kênh chat của bầy Sói", () => {
    const room = cursedRoom("NIGHT", true);
    const chat = resolveChat(room, "cursed");

    expect(chat.ok).toBe(true);
    if (!chat.ok) return;
    expect(chat.channel).toBe("wolves");
    expect(chat.recipients.sort()).toEqual(["cursed", "wolf"]);
  });

  it("chưa chuyển phe thì vẫn im lặng ban đêm như dân làng", () => {
    const room = cursedRoom("NIGHT", false);
    expect(resolveChat(room, "cursed").ok).toBe(false);
  });
});
