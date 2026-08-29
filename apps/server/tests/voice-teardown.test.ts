import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";
import type { VoiceConfig } from "../src/voice/livekit";
import {
  markVoiceJoined,
  resetVoiceState,
  setVoiceAdmin,
  syncVoicePermissions,
  type VoiceAdmin,
} from "../src/voice/service";

vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: () => undefined,
  persistRoom: async () => undefined,
  setRoomTimer: () => undefined,
}));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));

vi.mock("../src/db", () => ({ prisma: {} }));

const { resetToLobby } = await import("../src/game/machine");

const CONFIG: VoiceConfig = {
  url: "wss://demo.livekit.cloud",
  apiKey: "k",
  apiSecret: "sssssssssssssssssssssssssssssss",
  env: "prod",
};

function fakeAdmin() {
  const kinds: string[] = [];
  const admin: VoiceAdmin = {
    createRoom: async () => {
      kinds.push("create");
    },
    updateParticipant: async () => {
      kinds.push("update");
    },
    removeParticipant: async () => {
      kinds.push("remove");
    },
    deleteRoom: async () => {
      kinds.push("delete");
    },
  };
  return { admin, kinds };
}

function gameState(phase: string): GameState {
  return {
    phase,
    round: 1,
    phaseEndsAt: null,
    players: [
      { id: "alive", name: "Sống", role: "VILLAGER", alive: true, isBot: false },
      { id: "ghost", name: "Ma", role: "SEER", alive: false, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG, voice: true },
    winner: phase === "GAME_OVER" ? "village" : null,
    night: {
      killTarget: null,
      actedWolves: [],
      skippedWolves: [],
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
    trial: null,
    log: [],
  } as unknown as GameState;
}

function room(phase: string): Room {
  return {
    code: "ABCDE",
    hostId: "alive",
    status: "IN_GAME",
    members: [
      { playerId: "alive", name: "Sống", ready: true, connected: true, isBot: false },
      { playerId: "ghost", name: "Ma", ready: true, connected: true, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG, voice: true },
    engine: new GameEngine(gameState(phase)),
    chatLog: [],
    createdAt: 0,
  } as unknown as Room;
}

beforeEach(() => resetVoiceState());
afterEach(() => {
  resetVoiceState();
  setVoiceAdmin(null);
});

describe("resetToLobby", () => {
  it("xoá hẳn room voice - không ai được ngồi lại với quyền của ván cũ", async () => {
    const { admin, kinds } = fakeAdmin();
    setVoiceAdmin(admin, CONFIG);
    markVoiceJoined("ABCDE", "alive");

    resetToLobby(room("DAY_DISCUSSION"));
    await new Promise((resolve) => setImmediate(resolve));

    expect(kinds).toContain("delete");
  });
});

describe("GAME_OVER giữ nguyên room", () => {
  /**
   * Quyết định thiết kế, không phải chi tiết cài đặt: lúc lật bài xong là lúc
   * đáng nói nhất cả ván. Không có test này thì ai đó thêm một dòng dọn dẹp vào
   * `onGameOver` sẽ không thấy đỏ ở đâu cả.
   */
  it("đồng bộ ở GAME_OVER không xoá room", async () => {
    const { admin, kinds } = fakeAdmin();
    setVoiceAdmin(admin, CONFIG);
    markVoiceJoined("ABCDE", "alive");
    markVoiceJoined("ABCDE", "ghost");

    await syncVoicePermissions(room("GAME_OVER"));

    expect(kinds).not.toContain("delete");
  });

  it("và trả quyền nói lại cho cả người chết", async () => {
    const granted: boolean[] = [];
    const admin: VoiceAdmin = {
      createRoom: async () => undefined,
      updateParticipant: async (_r, _id, perm) => {
        granted.push(perm.canPublish);
      },
      removeParticipant: async () => undefined,
      deleteRoom: async () => undefined,
    };
    setVoiceAdmin(admin, CONFIG);
    markVoiceJoined("ABCDE", "ghost");

    await syncVoicePermissions(room("GAME_OVER"));

    expect(granted).toEqual([true]);
  });
});
