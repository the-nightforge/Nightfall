import { afterEach, describe, expect, it, vi } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";

const roomHolder = vi.hoisted(() => ({ room: null as Room | null }));
const storeSpies = vi.hoisted(() => ({ removeRoom: vi.fn() }));

vi.mock("../src/rooms/store", () => ({
  allRooms: () => (roomHolder.room ? [roomHolder.room] : []),
  clearRoomTimers: () => undefined,
  deletePersistedRoom: async () => undefined,
  getRoom: (code: string) => (roomHolder.room?.code === code ? roomHolder.room : undefined),
  loadRoomFromRedis: async () => null,
  persistRoom: async () => undefined,
  removeRoom: storeSpies.removeRoom,
  setRoomTimer: () => undefined,
}));

vi.mock("../src/redis", () => ({
  getPlayerRoom: async () => null,
  updateSessionRoom: async () => undefined,
}));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));

vi.mock("../src/db", () => ({
  prisma: {},
}));

vi.mock("../src/voice/service", () => ({
  dropVoiceParticipant: async () => undefined,
  destroyVoiceRoom: async () => undefined,
  syncVoicePermissions: async () => undefined,
}));

const { roomService } = await import("../src/rooms/service");

function roomWith(
  members: Array<{ id: string; isBot: boolean }>,
  status: "LOBBY" | "IN_GAME" = "IN_GAME",
): Room {
  const state: GameState = {
    phase: "NIGHT",
    round: 1,
    phaseEndsAt: Date.now() + 30_000,
    players: members.map((m) => ({
      id: m.id,
      name: m.id,
      role: "VILLAGER",
      alive: true,
      isBot: m.isBot,
    })),
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
    },
    votes: {},
    guardPrevious: null,
    healUsed: false,
    poisonUsed: false,
    lastNightDeaths: [],
    nightHistory: [],
    lastEliminated: null,
    hunterReaction: null,
    hunterShots: [],
    log: [],
  } as GameState;

  return {
    code: "LEAVE1",
    hostId: members[0].id,
    status,
    members: members.map((m) => ({
      playerId: m.id,
      name: m.id,
      ready: true,
      connected: true,
      isBot: m.isBot,
    })),
    config: { ...state.config },
    engine: status === "IN_GAME" ? new GameEngine(state) : null,
    chatLog: [],
    createdAt: 0,
  };
}

afterEach(() => {
  roomHolder.room = null;
  storeSpies.removeRoom.mockClear();
});

describe("roomService.leave - dọn phòng khi người thật cuối cùng chủ động rời", () => {
  it("người chơi duy nhất rời phòng solo-với-bot: ván về lobby thay vì treo IN_GAME mãi mãi", async () => {
    const room = roomWith([
      { id: "host", isBot: false },
      { id: "bot1", isBot: true },
      { id: "bot2", isBot: true },
    ]);
    roomHolder.room = room;

    await roomService.leave("host");

    expect(room.status).toBe("LOBBY");
  });

  it("còn người thật khác thì ván vẫn tiếp tục bình thường", async () => {
    const room = roomWith([
      { id: "host", isBot: false },
      { id: "b", isBot: false },
      { id: "bot1", isBot: true },
    ]);
    roomHolder.room = room;

    await roomService.leave("host");

    expect(room.status).toBe("IN_GAME");
    expect(room.hostId).toBe("b");
  });
});

describe("roomService.leave - không được gán bot làm host ở LOBBY", () => {
  it("người chơi thật cuối cùng rời LOBBY toàn bot: phòng bị xoá hẳn, không gán host cho bot", async () => {
    const room = roomWith(
      [
        { id: "host", isBot: false },
        { id: "bot1", isBot: true },
        { id: "bot2", isBot: true },
      ],
      "LOBBY",
    );
    roomHolder.room = room;

    await roomService.leave("host");

    expect(storeSpies.removeRoom).toHaveBeenCalledWith("LEAVE1");
    const newHost = room.members.find((m) => m.playerId === room.hostId);
    expect(newHost?.isBot).not.toBe(true);
  });

  it("còn người thật khác ở LOBBY thì chuyển host cho người đó, không đụng phòng", async () => {
    const room = roomWith(
      [
        { id: "host", isBot: false },
        { id: "b", isBot: false },
        { id: "bot1", isBot: true },
      ],
      "LOBBY",
    );
    roomHolder.room = room;

    await roomService.leave("host");

    expect(storeSpies.removeRoom).not.toHaveBeenCalled();
    expect(room.hostId).toBe("b");
  });
});
