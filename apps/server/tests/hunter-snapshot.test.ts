import { afterEach, describe, expect, it, vi } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG, MAX_PLAYERS_PER_ROOM } from "@masoi/shared";
import type { Room } from "../src/rooms/store";

const redisMocks = vi.hoisted(() => ({
  get: vi.fn<() => Promise<string | null>>(),
  set: vi.fn(async () => "OK"),
  del: vi.fn(async () => 1),
  eval: vi.fn(async () => 1),
  exists: vi.fn(async () => 0),
}));

vi.mock("../src/redis", () => ({
  redis: redisMocks,
  getPlayerRoom: async () => null,
  updateSessionRoom: async () => undefined,
}));

vi.mock("../src/db", () => ({ prisma: {} }));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));

import { buildSnapshot } from "../src/rooms/snapshot";
import { createRoom, loadRoomSnapshot, removeRoom } from "../src/rooms/store";
import { PERSISTENCE_VERSION } from "../src/persistence/schema";
import { roomService } from "../src/rooms/service";
import { ROOM_SCAFFOLD } from "./helpers/room";
import { NIGHT_SCAFFOLD } from "./helpers/night";
import { GAME_STATE_SCAFFOLD } from "./helpers/game-state";

function hunterState(phase: GameState["phase"]): GameState {
  return {
    ...GAME_STATE_SCAFFOLD,
    phase,
    round: 2,
    phaseEndsAt: 20_000,
    players: [
      { id: "hunter", name: "Thợ Săn", role: "HUNTER", alive: false, isBot: false },
      { id: "wolf", name: "Sói", role: "WEREWOLF", alive: true, isBot: false },
      { id: "seer", name: "Tiên Tri", role: "SEER", alive: true, isBot: false },
      { id: "villager", name: "Dân", role: "VILLAGER", alive: true, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG, hunter: true },
    winner: phase === "GAME_OVER" ? "village" : null,
    night: {
      ...NIGHT_SCAFFOLD,
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
    hunterReaction:
      phase === "HUNTER_SHOT" ? { hunterId: "hunter", source: "night", resolved: false } : null,
    hunterShots: [
      {
        round: 1,
        hunter: { id: "hunter", name: "Thợ Săn" },
        target: { id: "wolf", name: "Sói" },
        source: "night",
      },
    ],
    log: [],
  };
}

function snapshotRoom(phase: GameState["phase"]): Room {
  const state = hunterState(phase);
  return {
    ...ROOM_SCAFFOLD,
    code: "SNAP1",
    hostId: "villager",
    status: "IN_GAME",
    members: state.players.map((player) => ({
      playerId: player.id,
      name: player.name,
      ready: true,
      connected: true,
      isBot: false,
    })),
    config: { ...state.config },
    engine: new GameEngine(state),
    chatLog: [],
    createdAt: 0,
  };
}

afterEach(() => {
  redisMocks.get.mockReset();
  for (const code of ["OLD01", "OLD02", "CFG01"]) removeRoom(code);
});

describe("Hunter snapshot privacy", () => {
  it("allows only the pending Hunter to act without revealing other secret roles", () => {
    const room = snapshotRoom("HUNTER_SHOT");
    const hunter = buildSnapshot(room, "hunter");
    const observer = buildSnapshot(room, "villager");

    expect(hunter.hunterShot).toEqual({
      hunterId: "hunter",
      hunterName: "Thợ Săn",
      canAct: true,
      resolved: false,
      target: null,
    });
    expect(observer.hunterShot?.canAct).toBe(false);
    expect(hunter.players.find((player) => player.id === "wolf")?.role).toBeUndefined();
    expect(observer.players.find((player) => player.id === "seer")?.role).toBeUndefined();
    expect(hunter.hunterShots).toEqual([]);
    expect(observer.hunterShots).toEqual([]);
  });

  it("publishes the resolved shot target without revealing secret roles", () => {
    const room = snapshotRoom("HUNTER_SHOT");
    room.engine!.submitHunterShot("hunter", "wolf");

    const observer = buildSnapshot(room, "villager");
    const hunterView = buildSnapshot(room, "hunter");

    // Chỉ thợ săn thấy mục tiêu, người quan sát chỉ thấy ẩn danh
    expect(observer.hunterShot).toEqual({
      hunterId: "",
      hunterName: "Ẩn danh",
      canAct: false,
      resolved: true,
      target: null,
    });
    expect(hunterView.hunterShot).toEqual({
      hunterId: "hunter",
      hunterName: "Thợ Săn",
      canAct: false,
      resolved: true,
      target: { id: "wolf", name: "Sói" },
    });
    expect(observer.players.find((player) => player.id === "seer")?.role).toBeUndefined();
    expect(observer.hunterShots).toEqual([]);
  });

  it("publishes the complete Hunter recap only after game over", () => {
    const snapshot = buildSnapshot(snapshotRoom("GAME_OVER"), "villager");

    expect(snapshot.hunterShot).toBeNull();
    expect(snapshot.hunterShots).toEqual([
      {
        round: 1,
        hunter: { id: "hunter", name: "Thợ Săn" },
        target: { id: "wolf", name: "Sói" },
        source: "night",
      },
    ]);
  });
});

describe("Hunter config compatibility", () => {
  it("cách ly payload không có persistenceVersion thay vì đoán nghĩa nó", async () => {
    const state = hunterState("ROLE_REVEAL");
    redisMocks.get.mockResolvedValueOnce(
      JSON.stringify({
        ...ROOM_SCAFFOLD,
        code: "OLD01",
        hostId: "villager",
        status: "LOBBY",
        members: snapshotRoom("ROLE_REVEAL").members,
        config: state.config,
        engineState: state,
        chatLog: [],
        createdAt: 0,
      }),
    );

    const result = await loadRoomSnapshot("OLD01");

    expect(result.status).toBe("corrupt");
  });

  it("phòng đang chơi được nạp lại NGUYÊN VẸN, không còn bị trả về sảnh chờ", async () => {
    const state = hunterState("HUNTER_SHOT");
    redisMocks.get.mockResolvedValueOnce(
      JSON.stringify({
        persistenceVersion: PERSISTENCE_VERSION,
        savedAt: 0,
        opSeq: 1,
        room: {
          ...ROOM_SCAFFOLD,
          code: "OLD02",
          hostId: "villager",
          status: "IN_GAME",
          members: snapshotRoom("HUNTER_SHOT").members,
          config: state.config,
          engineState: new GameEngine(state).getState(),
          chatLog: [],
          createdAt: 0,
          gameId: "game-old02",
          resultWritten: false,
          pendingStep: null,
          phaseSeq: 3,
          botSession: null,
          governorCalls: 0,
          discussionSkipVotes: [],
          discussionRun: null,
        },
      }),
    );

    const result = await loadRoomSnapshot("OLD02");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.room.status).toBe("IN_GAME");
    expect(result.room.engine?.state.phase).toBe("HUNTER_SHOT");
    expect(result.room.engine?.state.hunterReaction).toEqual({
      hunterId: "hunter",
      source: "night",
      resolved: false,
    });
    expect(result.room.config.hunter).toBe(true);
    removeRoom("OLD02");
  });

  it("counts Hunter in the server-side special-role guard", () => {
    createRoom("CFG01", {
      playerId: "host",
      name: "Chủ phòng",
      ready: false,
      connected: true,
      isBot: false,
    });

    /*
     * Ngưỡng của chốt này là `MAX_PLAYERS_PER_ROOM`, nên fixture phải SUY RA từ
     * hằng số chứ không ghim số: cấu hình này không khai `villagers`, nên nó đi
     * đường tương thích, nơi Dân Làng còn lấp phần trống - và thứ duy nhất chắc
     * chắn sai là một bộ bài không chừa nổi một ghế trong phòng đông nhất.
     *
     * Ngưỡng cũ là `MAX_PLAYERS_PER_ROOM - 1` và lệch đúng một ghế: 19 lá đặc
     * biệt trong phòng 20 người vẫn còn chỗ cho một Dân Làng. Nó cũng chỉ đếm
     * SÁU trường (Sói, Tiên Tri, Bảo Vệ, Phù Thuỷ, Thợ Săn, Kẻ Nguyền Rủa) và
     * mù với mười một vai còn lại; `deckSeats` đếm đủ.
     *
     * `- 4` là để ba vai còn lại (Tiên Tri, Bảo Vệ, Phù Thuỷ) cộng Thợ Săn đưa
     * tổng lên đúng `MAX_PLAYERS_PER_ROOM`: chạm ngưỡng nhờ ĐÚNG lá cuối cùng,
     * tức Thợ Săn.
     */
    const base = {
      ...DEFAULT_ROOM_CONFIG,
      werewolves: MAX_PLAYERS_PER_ROOM - 4,
      seer: true,
      guard: true,
      witch: true,
    };

    // Không có Thợ Săn thì tổng thiếu đúng 1 để chạm ngưỡng - phải đi qua được.
    expect(() => roomService.updateConfig("host", { ...base, hunter: false })).not.toThrow();

    // Thêm Thợ Săn là chạm ngưỡng. Đây mới là điều test này nói: lá đó ĐƯỢC ĐẾM.
    expect(() =>
      roomService.updateConfig("host", { ...base, hunter: true }),
    ).toThrow("Phải còn chỗ cho Dân Làng");
  });
});
