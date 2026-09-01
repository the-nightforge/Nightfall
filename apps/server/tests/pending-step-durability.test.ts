import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";
import type { RoomEnvelopeV1 } from "../src/persistence/schema";
import { ROOM_SCAFFOLD } from "./helpers/room";

const store = vi.hoisted(() => ({ data: new Map<string, string>() }));

vi.mock("../src/redis", () => ({
  redis: {
    get: async (key: string) => store.data.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.data.set(key, value);
      return "OK";
    },
    del: async (key: string) => (store.data.delete(key) ? 1 : 0),
    exists: async (key: string) => (store.data.has(key) ? 1 : 0),
    eval: async (_s: string, _n: number, key: string, value: string) => {
      store.data.set(key, value);
      return 1;
    },
  },
  getPlayerRoom: async () => null,
  updateSessionRoom: async () => undefined,
}));

vi.mock("../src/db", () => ({ prisma: { gameResult: { create: async () => undefined } } }));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));

vi.mock("../src/voice/service", () => ({
  destroyVoiceRoom: async () => undefined,
  syncVoicePermissions: async () => undefined,
  dropVoiceParticipant: async () => undefined,
  voiceViewFor: () => null,
}));

const { startGame } = await import("../src/game/machine");
const { runPendingStep } = await import("../src/game/steps");
const { resumeRoom } = await import("../src/game/resume");
const { clearBotSession } = await import("../src/bots/session-registry");

function lobby(code: string): Room {
  return {
    ...ROOM_SCAFFOLD,
    code,
    hostId: "p1",
    status: "LOBBY",
    members: Array.from({ length: 8 }, (_, i) => ({
      playerId: `p${i + 1}`,
      name: `Người ${i + 1}`,
      ready: true,
      connected: true,
      disconnectedAt: null,
      isBot: i >= 4,
      avatarUrl: null,
    })),
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: null,
    chatLog: [],
    createdAt: Date.now(),
    gameId: null,
    resultWritten: false,
    pendingStep: null,
    phaseSeq: 0,
  };
}

function persisted(code: string): RoomEnvelopeV1 {
  const raw = store.data.get(`room:${code}`);
  expect(raw).toBeDefined();
  return JSON.parse(raw!) as RoomEnvelopeV1;
}

beforeEach(() => {
  store.data.clear();
});

describe("bước chờ luôn có mặt trong snapshot", () => {
  it("mọi lần chuyển pha đều để lại bước chờ ĐÃ LƯU, không chỉ nằm trong RAM", async () => {
    const code = "DURAB";
    clearBotSession(code);
    const room = lobby(code);
    startGame(room);

    // Đi qua một chuỗi dài các pha; sau MỖI bước, thứ nằm trong Redis phải khớp
    // với thứ nằm trong RAM. Đây chính là chỗ từng hở: vài handler gọi `sync()`
    // rồi mới hẹn bước, nên bản lưu cuối cùng mang `pendingStep: null` và một
    // process mới sẽ không biết ván đang chờ gì.
    for (let step = 0; step < 8 && room.pendingStep; step += 1) {
      await Promise.resolve();
      expect(persisted(code).room.pendingStep).toEqual(room.pendingStep);

      runPendingStep(room, room.pendingStep);
      await Promise.resolve();

      if (room.engine!.state.phase === "GAME_OVER") break;
      expect(room.pendingStep).not.toBeNull();
      expect(persisted(code).room.pendingStep).toEqual(room.pendingStep);
    }
  });
});

describe("snapshot chụp đúng khe không còn bước chờ", () => {
  const CASES: Array<{ phase: string; expected: string; prepare?: (room: Room) => void }> = [
    { phase: "NIGHT", expected: "lockWolves" },
    {
      phase: "NIGHT",
      expected: "endNight",
      prepare: (room) => {
        room.engine!.state.night.wolvesLocked = true;
      },
    },
    { phase: "DAY_DISCUSSION", expected: "beginVoting" },
    { phase: "VOTING", expected: "endVoting" },
  ];

  for (const { phase, expected, prepare } of CASES) {
    it(`${phase} không có bước chờ vẫn hồi được bước ${expected}`, () => {
      const code = `GAP${expected.slice(0, 2)}`;
      clearBotSession(code);
      const room = lobby(code);
      startGame(room);

      let guard = 0;
      while (room.engine!.state.phase !== phase && room.pendingStep && guard < 20) {
        runPendingStep(room, room.pendingStep);
        guard += 1;
      }
      expect(room.engine!.state.phase).toBe(phase);

      prepare?.(room);
      // Khe hở: process chết đúng giữa lúc bước cũ vừa bị tiêu và bước mới chưa
      // kịp hẹn. Phòng KHÔNG được treo vĩnh viễn vì chuyện đó.
      room.pendingStep = null as Room["pendingStep"];

      resumeRoom(room);

      expect(room.pendingStep?.name).toBe(expected);
    });
  }

  it("HUNTER_SHOT không có bước chờ vẫn hồi được hạn chót bắn", () => {
    const code = "GAPHU";
    clearBotSession(code);
    const room = lobby(code);
    startGame(room);
    runPendingStep(room, room.pendingStep!);

    const target = room.engine!.state.players[0]!;
    room.engine!.state.hunterReaction = {
      hunterId: target.id,
      source: "night",
      resolved: false,
    };
    room.engine!.beginHunterShot(15_000);
    room.pendingStep = null as Room["pendingStep"];

    resumeRoom(room);

    expect(room.pendingStep?.name).toBe("timeoutHunterShot");
  });

  it("ván đã kết thúc thì không hồi bước nào cả", () => {
    const code = "GAPGO";
    clearBotSession(code);
    const room = lobby(code);
    startGame(room);
    room.engine!.finishGame("village");
    room.pendingStep = null as Room["pendingStep"];

    resumeRoom(room);

    expect(room.pendingStep).toBeNull();
  });
});
