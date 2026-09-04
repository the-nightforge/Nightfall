import { beforeEach, describe, expect, it, vi } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";

const storeMocks = vi.hoisted(() => {
  const rooms = new Map<string, Room>();
  return { rooms, persistRoom: vi.fn(async () => undefined) };
});

vi.mock("../src/rooms/store", () => ({
  allRooms: () => [...storeMocks.rooms.values()],
  clearRoomTimers: () => undefined,
  getRoom: (code: string) => storeMocks.rooms.get(code),
  loadRoomFromRedis: async () => null,
  persistRoom: storeMocks.persistRoom,
  // Hẹn giờ KHÔNG chạy: các bài dưới đây gọi thẳng bước chuyển pha để đọc
  // chính xác thứ tự, chứ không đợi một chuỗi timeout thật.
  setRoomTimer: () => undefined,
}));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
  trackSocket: () => undefined,
  untrackSocket: () => undefined,
}));

vi.mock("../src/db", () => ({
  prisma: { player: { findUnique: vi.fn() }, gameResult: { create: async () => undefined } },
}));

vi.mock("../src/redis", () => ({
  getPlayerRoom: async () => null,
  updateSessionRoom: async () => undefined,
}));

import { continueAfterDeathResult, startGame } from "../src/game/machine";
import { NIGHT_SCAFFOLD } from "./helpers/night";
import { GAME_STATE_SCAFFOLD } from "./helpers/game-state";
import { ROOM_SCAFFOLD } from "./helpers/room";

function roomWith(over: Partial<GameState>, code = "EXFL1"): Room {
  const state: GameState = {
    ...GAME_STATE_SCAFFOLD,
    phase: "NIGHT_RESULT",
    round: 2,
    phaseEndsAt: Date.now() + 8_000,
    config: { ...DEFAULT_ROOM_CONFIG, werewolves: 1, executioner: true },
    night: { ...NIGHT_SCAFFOLD },
    executionerTargets: { exec: "target" },
    ...over,
  };
  const room: Room = {
    ...ROOM_SCAFFOLD,
    code,
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
  storeMocks.rooms.set(code, room);
  return room;
}

beforeEach(() => {
  storeMocks.rooms.clear();
});

describe("máy trạng thái chốt chuyển vai đúng chỗ", () => {
  it("mục tiêu chết trong đêm: chuyển vai xảy ra ở bước sau kết quả đêm", () => {
    const room = roomWith({
      players: [
        { id: "wolf", name: "Sói", role: "WEREWOLF", alive: true, isBot: false },
        { id: "exec", name: "Báo Thù", role: "EXECUTIONER", alive: true, isBot: false },
        { id: "target", name: "Mục Tiêu", role: "VILLAGER", alive: false, isBot: false },
        { id: "villager", name: "Dân", role: "VILLAGER", alive: true, isBot: false },
        { id: "villager2", name: "Dân 2", role: "VILLAGER", alive: true, isBot: false },
        { id: "villager3", name: "Dân 3", role: "VILLAGER", alive: true, isBot: false },
      ],
    });

    expect(room.engine!.player("exec")!.role).toBe("EXECUTIONER");
    continueAfterDeathResult(room, "night");

    expect(room.engine!.player("exec")!.role).toBe("JESTER");
    expect(room.engine!.state.winner).toBeNull();
  });

  it("chuyển vai đứng SAU phát bắn của Thợ Săn, không trước", () => {
    /*
     * Đây là lý do `settleExecutioner` nằm trong `checkWinOrContinue` chứ không
     * ngay sau `resolveNight`. Ở đây Thợ Săn đang chờ bắn, và người sắp trúng
     * đạn chính là Kẻ Báo Thù: nếu chốt sớm, nó đã kịp hoá Thằng Hề rồi mới
     * chết - tức một người chết mang vai của một ván họ không còn được chơi.
     */
    const room = roomWith(
      {
        players: [
          { id: "wolf", name: "Sói", role: "WEREWOLF", alive: true, isBot: false },
          { id: "exec", name: "Báo Thù", role: "EXECUTIONER", alive: true, isBot: false },
          { id: "target", name: "Mục Tiêu", role: "VILLAGER", alive: false, isBot: false },
          { id: "hunter", name: "Thợ Săn", role: "HUNTER", alive: false, isBot: false },
          { id: "villager", name: "Dân", role: "VILLAGER", alive: true, isBot: false },
          { id: "villager2", name: "Dân 2", role: "VILLAGER", alive: true, isBot: false },
        ],
        config: { ...DEFAULT_ROOM_CONFIG, werewolves: 1, hunter: true, executioner: true },
        hunterReaction: { hunterId: "hunter", source: "night", resolved: false },
      },
      "EXFL2",
    );

    // Bước đầu chỉ mở lượt bắn: chưa ai đổi vai.
    continueAfterDeathResult(room, "night");
    expect(room.engine!.state.phase).toBe("HUNTER_SHOT");
    expect(room.engine!.player("exec")!.role).toBe("EXECUTIONER");

    room.engine!.submitHunterShot("hunter", "exec");
    room.engine!.completeHunterReaction();
    room.engine!.settleExecutioner();

    expect(room.engine!.player("exec")!.alive).toBe(false);
    expect(room.engine!.player("exec")!.role).toBe("EXECUTIONER");
  });

  it("bước chạy lại sau khôi phục không đổi vai lần hai", () => {
    const room = roomWith(
      {
        players: [
          { id: "wolf", name: "Sói", role: "WEREWOLF", alive: true, isBot: false },
          { id: "exec", name: "Báo Thù", role: "EXECUTIONER", alive: true, isBot: false },
          { id: "target", name: "Mục Tiêu", role: "VILLAGER", alive: false, isBot: false },
          { id: "villager", name: "Dân", role: "VILLAGER", alive: true, isBot: false },
          { id: "villager2", name: "Dân 2", role: "VILLAGER", alive: true, isBot: false },
          { id: "villager3", name: "Dân 3", role: "VILLAGER", alive: true, isBot: false },
        ],
      },
      "EXFL3",
    );

    continueAfterDeathResult(room, "night");
    const after = JSON.stringify(room.engine!.state.players);
    continueAfterDeathResult(room, "night");

    expect(JSON.stringify(room.engine!.state.players)).toBe(after);
    expect(room.engine!.personalWins()).toEqual([]);
  });
});

describe("bắt đầu ván với Kẻ Báo Thù", () => {
  function lobby(config = { ...DEFAULT_ROOM_CONFIG, executioner: true }): Room {
    const room: Room = {
      ...ROOM_SCAFFOLD,
      code: "EXSTA",
      hostId: "p1",
      status: "LOBBY",
      members: Array.from({ length: 8 }, (_, i) => ({
        playerId: `p${i + 1}`,
        name: `Người ${i + 1}`,
        ready: true,
        connected: true,
        isBot: false,
      })),
      config,
      engine: null,
      chatLog: [{ id: "c1", channel: "lobby", playerId: "p1", playerName: "A", text: "hi", at: 1 }],
      createdAt: 0,
    };
    storeMocks.rooms.set(room.code, room);
    return room;
  }

  it("ván bắt đầu bình thường thì có đúng một nhiệm vụ được cấp", () => {
    const room = lobby();
    startGame(room);

    expect(room.status).toBe("IN_GAME");
    const targets = room.engine!.executionerTargets();
    expect(Object.keys(targets)).toHaveLength(1);
    const [execId, targetId] = Object.entries(targets)[0];
    expect(room.engine!.player(execId)!.role).toBe("EXECUTIONER");
    expect(targetId).not.toBe(execId);
  });

  it("bộ bài không có mục tiêu hợp lệ thì phòng KHÔNG bị bỏ lại nửa chừng", () => {
    /*
     * Engine ném trước khi `startGame` động vào phòng, nên mọi sổ sách còn
     * nguyên: vẫn ở sảnh chờ, chat chưa bị xoá, chưa có `gameId` mới. Người
     * chơi thấy đúng một thông báo lỗi thay vì một cái phòng đã bị dọn cho một
     * ván không bao giờ bắt đầu.
     */
    const room = lobby({
      ...DEFAULT_ROOM_CONFIG,
      werewolves: 4,
      seer: false,
      guard: false,
      witch: false,
      hunter: false,
      cursed: false,
      jester: true,
      serialKiller: true,
      executioner: true,
    });
    room.members = room.members.slice(0, 7);
    const chatBefore = room.chatLog.length;

    expect(() => startGame(room)).toThrow(/Kẻ Báo Thù/);

    expect(room.status).toBe("LOBBY");
    expect(room.engine).toBeNull();
    expect(room.gameId).toBeNull();
    expect(room.chatLog).toHaveLength(chatBefore);
  });
});
