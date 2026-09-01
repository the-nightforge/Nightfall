import { afterEach, describe, expect, it, vi } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import {
  clearDiscussionSkipVotes,
  discussionSkipVotes,
  getDiscussionSkipView,
  updateDiscussionSkipVote,
} from "../src/game/discussion-skip";
import type { Room } from "../src/rooms/store";
import { roomService } from "../src/rooms/service";
import { ROOM_SCAFFOLD } from "./helpers/room";
import { NIGHT_SCAFFOLD } from "./helpers/night";
import { GAME_STATE_SCAFFOLD } from "./helpers/game-state";

const roomHolder = vi.hoisted(() => ({ room: null as Room | null }));
const sessionControl = vi.hoisted(() => ({ updateSessionRoom: vi.fn() }));

vi.mock("../src/rooms/store", () => ({
  allRooms: () => roomHolder.room ? [roomHolder.room] : [],
  clearRoomTimers: () => undefined,
  createRoom: () => undefined,
  deletePersistedRoom: async () => undefined,
  getRoom: (code: string) => roomHolder.room?.code === code ? roomHolder.room : undefined,
  loadRoomFromRedis: async () => null,
  persistRoom: async () => undefined,
  removeRoom: () => undefined,
  setRoomTimer: () => undefined,
}));

vi.mock("../src/redis", () => ({
  getPlayerRoom: async () => null,
  updateSessionRoom: sessionControl.updateSessionRoom,
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
    ...GAME_STATE_SCAFFOLD,
    phase: "DAY_DISCUSSION",
    round: 1,
    phaseEndsAt: Date.now() + 60_000,
    players: [
      { id: "a", name: "A", role: "VILLAGER", alive: true, isBot: false },
      { id: "b", name: "B", role: "SEER", alive: true, isBot: false },
      { id: "c", name: "C", role: "WEREWOLF", alive: true, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    winner: null,
    night: {
      ...NIGHT_SCAFFOLD,
      killTarget: null,
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
    ...ROOM_SCAFFOLD,
    code: "ABCDE",
    hostId: "a",
    status: "IN_GAME",
    members: [
      { playerId: "a", name: "A", ready: true, connected: true, isBot: false },
      { playerId: "b", name: "B", ready: true, connected: true, isBot: false },
      { playerId: "c", name: "C", ready: true, connected: true, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: new GameEngine(state),
    chatLog: [],
    createdAt: 0,
  };
}

afterEach(() => {
  roomHolder.room = null;
  sessionControl.updateSessionRoom.mockReset();
  clearDiscussionSkipVotes("ABCDE");
});

describe("leave during discussion skip", () => {
  it("chuyển ngay sang bỏ phiếu khi người chưa đồng ý rời phòng", async () => {
    const room = discussionRoom();
    roomHolder.room = room;
    updateDiscussionSkipVote(room, "a", true);
    updateDiscussionSkipVote(room, "b", true);
    expect(getDiscussionSkipView(room, "a")).toMatchObject({ votes: 2, required: 3 });

    let signalSessionStarted!: () => void;
    let releaseSession!: () => void;
    const sessionStarted = new Promise<void>((resolve) => {
      signalSessionStarted = resolve;
    });
    sessionControl.updateSessionRoom.mockImplementation(
      () => new Promise<void>((resolve) => {
        releaseSession = resolve;
        signalSessionStarted();
      }),
    );

    const leaving = roomService.leave("c");
    await sessionStarted;
    const phaseBeforeRedisCompletes = room.engine!.getState().phase;
    releaseSession();
    await leaving;

    expect(room.members.map((member) => member.playerId)).toEqual(["a", "b"]);
    expect(phaseBeforeRedisCompletes).toBe("VOTING");
    expect(room.engine!.getState().phase).toBe("VOTING");
    expect(discussionSkipVotes.has(room.code)).toBe(false);
  });
});
