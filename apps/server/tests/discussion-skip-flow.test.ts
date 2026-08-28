import { afterEach, describe, expect, it, vi } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import {
  resetToLobby,
  submitDiscussionSkip,
} from "../src/game/machine";
import {
  clearDiscussionSkipVotes,
  discussionSkipVotes,
} from "../src/game/discussion-skip";
import type { Room } from "../src/rooms/store";

const storeMocks = vi.hoisted(() => ({
  clearRoomTimers: vi.fn(),
  setRoomTimer: vi.fn(),
}));

vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: storeMocks.clearRoomTimers,
  persistRoom: async () => undefined,
  setRoomTimer: storeMocks.setRoomTimer,
}));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));

vi.mock("../src/db", () => ({
  prisma: {},
}));

function discussionRoom(): Room {
  const state: GameState = {
    phase: "DAY_DISCUSSION",
    round: 1,
    phaseEndsAt: Date.now() + 60_000,
    players: [
      { id: "human1", name: "Người 1", role: "VILLAGER", alive: true, isBot: false },
      { id: "human2", name: "Người 2", role: "SEER", alive: true, isBot: false },
      { id: "bot", name: "Bot Sói", role: "WEREWOLF", alive: true, isBot: true },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    winner: null,
    night: {
      killTarget: null,
      actedWolves: [],
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
    log: [],
  };

  return {
    code: "ABCDE",
    hostId: "human1",
    status: "IN_GAME",
    members: [
      { playerId: "human1", name: "Người 1", ready: true, connected: true, isBot: false },
      { playerId: "human2", name: "Người 2", ready: true, connected: true, isBot: false },
      { playerId: "bot", name: "Bot Sói", ready: true, connected: false, isBot: true },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: new GameEngine(state),
    chatLog: [],
    createdAt: 0,
  };
}

afterEach(() => {
  storeMocks.clearRoomTimers.mockClear();
  storeMocks.setRoomTimer.mockClear();
  clearDiscussionSkipVotes("ABCDE");
});

describe("skip discussion flow", () => {
  it("chỉ chuyển sang bỏ phiếu khi người thật cuối cùng đồng ý", () => {
    const room = discussionRoom();

    expect(submitDiscussionSkip(room, "human1", true)).toBeNull();
    expect(room.engine!.getState().phase).toBe("DAY_DISCUSSION");

    expect(submitDiscussionSkip(room, "human2", true)).toBeNull();
    expect(room.engine!.getState().phase).toBe("VOTING");
    expect(storeMocks.clearRoomTimers).toHaveBeenCalledWith(room.code);
    expect(storeMocks.setRoomTimer).toHaveBeenCalledTimes(2);
  });

  it("không giảm ngưỡng khi một người thật mất kết nối và từ chối bot", () => {
    const room = discussionRoom();
    room.members.find((member) => member.playerId === "human2")!.connected = false;

    expect(submitDiscussionSkip(room, "human1", true)).toBeNull();
    expect(room.engine!.getState().phase).toBe("DAY_DISCUSSION");
    expect(submitDiscussionSkip(room, "bot", true)).toBe("Bot không thể skip thảo luận");

    expect(submitDiscussionSkip(room, "human2", true)).toBeNull();
    expect(room.engine!.getState().phase).toBe("VOTING");
  });

  it("không thể chuyển pha hoặc đặt timer lần hai sau khi đã đạt đồng thuận", () => {
    const room = discussionRoom();
    submitDiscussionSkip(room, "human1", true);
    submitDiscussionSkip(room, "human2", true);
    const timersAfterTransition = storeMocks.setRoomTimer.mock.calls.length;

    expect(submitDiscussionSkip(room, "human1", true)).toBe("Chỉ có thể skip trong lúc thảo luận");
    expect(room.engine!.getState().phase).toBe("VOTING");
    expect(storeMocks.setRoomTimer).toHaveBeenCalledTimes(timersAfterTransition);
  });

  it("xoá phiếu skip khi reset về phòng chờ", () => {
    const room = discussionRoom();
    discussionSkipVotes.set(room.code, new Set(["human1"]));

    resetToLobby(room);

    expect(discussionSkipVotes.has(room.code)).toBe(false);
  });
});
