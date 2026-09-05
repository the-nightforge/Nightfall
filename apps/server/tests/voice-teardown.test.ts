import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";
import type { VoiceConfig } from "../src/voice/livekit";
import {
  destroyVoiceRoom,
  dropVoiceParticipant,
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
  /**
   * Room LiveKit sống XUYÊN SUỐT vòng đời phòng game, không phải vòng đời một ván.
   *
   * Bản trước xoá room ở đây, và `deleteRoom` ngắt mọi participant: cả bàn vừa
   * bấm "Chơi lại" là mất kênh thoại giữa câu, rồi từng người phải tự bấm "Bật
   * mic" lần nữa trước ván mới. Lập luận cũ - "không ai được ngồi lại với quyền
   * của ván cũ" - không đứng vững: `resetToLobby` gọi `sync()`, mà `sync()` đồng
   * bộ quyền theo pha MỚI. Về lobby thì `desiredPermission` trả `true` cho mọi
   * người, đúng bằng thứ `destroyVoiceRoom` rồi cho phép họ lấy lại sau khi vào
   * lại. Nó phá kênh thoại để tới đúng cái đích nó vốn đã ở.
   */
  it("KHÔNG xoá room voice: ván mới không được bắt cả bàn join lại", async () => {
    const { admin, kinds } = fakeAdmin();
    setVoiceAdmin(admin, CONFIG);
    markVoiceJoined("ABCDE", "alive");

    resetToLobby(room("DAY_DISCUSSION"));
    await new Promise((resolve) => setImmediate(resolve));

    expect(kinds).not.toContain("delete");
  });

  it("và trả lại quyền nói cho người đã chết ở ván vừa xong", async () => {
    /*
     * Đây là phần việc mà `destroyVoiceRoom` từng làm hộ một cách thô bạo. Sau
     * reset, người chết ở ván cũ phải nói được ngay trong phòng chờ - không thì
     * họ ngồi câm suốt cả lúc bàn nhau ván tiếp theo.
     */
    const granted: Array<[string, boolean]> = [];
    setVoiceAdmin(
      {
        createRoom: async () => undefined,
        updateParticipant: async (_r, id, perm) => {
          granted.push([id, perm.canPublish]);
        },
        removeParticipant: async () => undefined,
        deleteRoom: async () => undefined,
      },
      CONFIG,
    );
    const target = room("NIGHT");
    markVoiceJoined("ABCDE", "ghost");
    // Trạng thái trước lúc reset: đêm, ai cũng bị thu quyền.
    await syncVoicePermissions(target);
    expect(granted).toEqual([["ghost", false]]);

    resetToLobby(target);
    await new Promise((resolve) => setImmediate(resolve));

    expect(granted).toEqual([
      ["ghost", false],
      ["ghost", true],
    ]);
  });

  it("giữ nguyên tập 'ai đã vào voice' - họ vẫn đang ngồi trong room LiveKit", async () => {
    /*
     * `destroyVoiceRoom` xoá luôn state của phòng. Quên tập `joined` nghĩa là
     * mọi vòng đồng bộ sau đó bỏ qua sạch mọi người, nên kể cả khi kênh thoại
     * còn sống thì quyền cũng không bao giờ được áp lại.
     */
    const granted: string[] = [];
    setVoiceAdmin(
      {
        createRoom: async () => undefined,
        updateParticipant: async (_r, id) => {
          granted.push(id);
        },
        removeParticipant: async () => undefined,
        deleteRoom: async () => undefined,
      },
      CONFIG,
    );
    markVoiceJoined("ABCDE", "alive");

    const target = room("DAY_DISCUSSION");
    resetToLobby(target);
    await new Promise((resolve) => setImmediate(resolve));
    granted.length = 0;

    await syncVoicePermissions(target);
    // Không cần gọi lại: pha mới cho phép đúng thứ pha cũ đã cho phép.
    expect(granted).toEqual([]);

    // Nhưng khi luật đổi thật thì người này vẫn được áp - tức state còn nguyên.
    await syncVoicePermissions(room("NIGHT"));
    expect(granted).toEqual(["alive"]);
  });
});

describe("những lối ra VẪN phải xoá room", () => {
  /**
   * Nới vòng đời không được nới thành "không bao giờ dọn". Hai lối ra dưới đây
   * là lúc phòng game thật sự hết tồn tại, và room LiveKit phải đi theo.
   */
  it("host tắt voice", async () => {
    const { admin, kinds } = fakeAdmin();
    setVoiceAdmin(admin, CONFIG);
    markVoiceJoined("ABCDE", "alive");

    await destroyVoiceRoom("ABCDE", "host tắt voice");

    expect(kinds).toContain("delete");
  });

  it("người chơi rời phòng: chỉ đá đúng người đó, room còn nguyên", async () => {
    const { admin, kinds } = fakeAdmin();
    setVoiceAdmin(admin, CONFIG);
    markVoiceJoined("ABCDE", "alive");

    await dropVoiceParticipant("ABCDE", "alive", "rời phòng");

    expect(kinds).toEqual(["remove"]);
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
