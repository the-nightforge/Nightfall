import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG, type Phase } from "@masoi/shared";
import type { Room } from "../src/rooms/store";
import { VoiceNotFoundError } from "../src/voice/livekit";
import {
  destroyVoiceRoom,
  dropVoiceParticipant,
  markVoiceJoined,
  resetVoiceState,
  setVoiceAdmin,
  syncVoicePermissions,
  syncVoiceForPlayer,
  type VoiceAdmin,
} from "../src/voice/service";

interface Call {
  kind: "update" | "remove" | "delete" | "create";
  identity?: string;
  canPublish?: boolean;
}

function fakeAdmin(overrides: Partial<VoiceAdmin> = {}) {
  const calls: Call[] = [];
  const admin: VoiceAdmin = {
    createRoom: async () => {
      calls.push({ kind: "create" });
    },
    updateParticipant: async (_room, identity, perm) => {
      calls.push({ kind: "update", identity, canPublish: perm.canPublish });
    },
    removeParticipant: async (_room, identity) => {
      calls.push({ kind: "remove", identity });
    },
    deleteRoom: async () => {
      calls.push({ kind: "delete" });
    },
    ...overrides,
  };
  return { admin, calls };
}

function gameState(phase: Phase): GameState {
  return {
    phase,
    round: 1,
    phaseEndsAt: null,
    players: [
      { id: "alive", name: "Sống", role: "VILLAGER", alive: true, isBot: false },
      { id: "ghost", name: "Ma", role: "SEER", alive: false, isBot: false },
      { id: "bot-1", name: "Bot", role: "VILLAGER", alive: true, isBot: true },
    ],
    config: { ...DEFAULT_ROOM_CONFIG, voice: true },
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

function room(phase: Phase, voice = true): Room {
  const inLobby = phase === "LOBBY";
  return {
    code: "ABCDE",
    hostId: "alive",
    status: inLobby ? "LOBBY" : "IN_GAME",
    members: [
      { playerId: "alive", name: "Sống", ready: true, connected: true, isBot: false },
      { playerId: "ghost", name: "Ma", ready: true, connected: true, isBot: false },
      { playerId: "bot-1", name: "Bot", ready: true, connected: false, isBot: true },
    ],
    config: { ...DEFAULT_ROOM_CONFIG, voice },
    engine: inLobby ? null : new GameEngine(gameState(phase)),
    chatLog: [],
    createdAt: 0,
  } as unknown as Room;
}

/** Cho cả hai người thật vào voice rồi xoá dấu vết lời gọi lúc thiết lập. */
function joinBoth(calls: Call[]): void {
  markVoiceJoined("ABCDE", "alive");
  markVoiceJoined("ABCDE", "ghost");
  calls.length = 0;
}

beforeEach(() => {
  resetVoiceState();
});

afterEach(() => {
  resetVoiceState();
  setVoiceAdmin(null);
});

describe("syncVoicePermissions", () => {
  it("không gọi gì cho người chưa từng vào voice", async () => {
    const { admin, calls } = fakeAdmin();
    setVoiceAdmin(admin);
    await syncVoicePermissions(room("DAY_DISCUSSION"));
    expect(calls).toEqual([]);
  });

  it("không bao giờ gọi cho bot, kể cả khi bot bị đánh dấu đã vào voice", async () => {
    const { admin, calls } = fakeAdmin();
    setVoiceAdmin(admin);
    markVoiceJoined("ABCDE", "bot-1");
    await syncVoicePermissions(room("DAY_DISCUSSION"));
    expect(calls).toEqual([]);
  });

  it("ban ngày: người sống được nói, người chết bị thu quyền", async () => {
    const { admin, calls } = fakeAdmin();
    setVoiceAdmin(admin);
    joinBoth(calls);

    await syncVoicePermissions(room("DAY_DISCUSSION"));

    expect(calls).toEqual([
      { kind: "update", identity: "alive", canPublish: true },
      { kind: "update", identity: "ghost", canPublish: false },
    ]);
  });

  it("chỉ gọi cho người THỰC SỰ đổi quyền", async () => {
    const { admin, calls } = fakeAdmin();
    setVoiceAdmin(admin);
    joinBoth(calls);

    await syncVoicePermissions(room("DAY_DISCUSSION"));
    calls.length = 0;

    // Cùng pha, không ai đổi trạng thái - không được gọi thêm lần nào.
    await syncVoicePermissions(room("DAY_DISCUSSION"));
    expect(calls).toEqual([]);

    // Sang đêm thì người sống mất quyền; người chết vốn đã false nên im.
    await syncVoicePermissions(room("NIGHT"));
    expect(calls).toEqual([{ kind: "update", identity: "alive", canPublish: false }]);
  });

  it("voice tắt ở phòng thì không gọi gì", async () => {
    const { admin, calls } = fakeAdmin();
    setVoiceAdmin(admin);
    joinBoth(calls);
    await syncVoicePermissions(room("DAY_DISCUSSION", false));
    expect(calls).toEqual([]);
  });

  it("chưa cấu hình adapter thì im lặng bỏ qua, không nổ", async () => {
    setVoiceAdmin(null);
    markVoiceJoined("ABCDE", "alive");
    await expect(syncVoicePermissions(room("DAY_DISCUSSION"))).resolves.toBeUndefined();
  });
});

describe("phân loại lỗi", () => {
  it("NotFound là no-op: không thử lại, không leo thang, không ghi cache", async () => {
    const calls: Call[] = [];
    const admin: VoiceAdmin = {
      createRoom: async () => undefined,
      updateParticipant: async (_r, identity, perm) => {
        calls.push({ kind: "update", identity, canPublish: perm.canPublish });
        throw new VoiceNotFoundError("participant does not exist");
      },
      removeParticipant: async (_r, identity) => {
        calls.push({ kind: "remove", identity });
      },
      deleteRoom: async () => undefined,
    };
    setVoiceAdmin(admin);
    joinBoth(calls);

    await syncVoicePermissions(room("DAY_DISCUSSION"));

    // Đúng một lần thử cho mỗi người, và tuyệt đối không removeParticipant:
    // leo thang ở đây sẽ THU HỒI TOKEN của người chưa từng dùng voice.
    expect(calls.filter((c) => c.kind === "remove")).toEqual([]);
    expect(calls.filter((c) => c.kind === "update")).toHaveLength(2);
  });

  it("lỗi thật lúc THU quyền: thử lại một lần rồi đá khỏi room", async () => {
    const calls: Call[] = [];
    const admin: VoiceAdmin = {
      createRoom: async () => undefined,
      updateParticipant: async (_r, identity, perm) => {
        calls.push({ kind: "update", identity, canPublish: perm.canPublish });
        throw new Error("503 upstream");
      },
      removeParticipant: async (_r, identity) => {
        calls.push({ kind: "remove", identity });
      },
      deleteRoom: async () => undefined,
    };
    setVoiceAdmin(admin);
    markVoiceJoined("ABCDE", "ghost");
    calls.length = 0;

    // Người chết ở pha ban ngày = chiều thu quyền.
    await syncVoicePermissions(room("DAY_DISCUSSION"));

    expect(calls).toEqual([
      { kind: "update", identity: "ghost", canPublish: false },
      { kind: "update", identity: "ghost", canPublish: false },
      { kind: "remove", identity: "ghost" },
    ]);
  });

  it("lỗi thật lúc CẤP quyền: không leo thang, để lần sau thử lại", async () => {
    let fail = true;
    const calls: Call[] = [];
    const admin: VoiceAdmin = {
      createRoom: async () => undefined,
      updateParticipant: async (_r, identity, perm) => {
        calls.push({ kind: "update", identity, canPublish: perm.canPublish });
        if (fail) throw new Error("503 upstream");
      },
      removeParticipant: async (_r, identity) => {
        calls.push({ kind: "remove", identity });
      },
      deleteRoom: async () => undefined,
    };
    setVoiceAdmin(admin);
    markVoiceJoined("ABCDE", "alive");
    calls.length = 0;

    await syncVoicePermissions(room("DAY_DISCUSSION"));
    expect(calls.filter((c) => c.kind === "remove")).toEqual([]);

    // Cache KHÔNG được ghi khi lời gọi hỏng, nên lần sau phải thử lại.
    fail = false;
    calls.length = 0;
    await syncVoicePermissions(room("DAY_DISCUSSION"));
    expect(calls).toEqual([{ kind: "update", identity: "alive", canPublish: true }]);
  });
});

describe("hàng đợi và số hiệu thế hệ", () => {
  it("lượt sau không bao giờ chạy đè lên lượt trước còn dở", async () => {
    const applied: Array<boolean> = [];
    let openGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    let seen = 0;

    const admin: VoiceAdmin = {
      createRoom: async () => undefined,
      // Lời gọi ĐẦU TIÊN bị treo cho tới khi test mở cổng.
      updateParticipant: async (_r, _identity, perm) => {
        seen += 1;
        if (seen === 1) await gate;
        applied.push(perm.canPublish);
      },
      removeParticipant: async () => undefined,
      deleteRoom: async () => undefined,
    };
    setVoiceAdmin(admin);
    markVoiceJoined("ABCDE", "alive");

    // Lượt 1 (ban ngày, cấp quyền) phải THỰC SỰ bắt đầu chạy rồi mới xếp lượt 2,
    // nếu không nó bị số hiệu thế hệ loại từ trước khi kịp gọi và ta không dựng
    // được tình huống chồng lấn cần kiểm.
    const first = syncVoicePermissions(room("DAY_DISCUSSION"));
    await new Promise((resolve) => setImmediate(resolve));

    // Lượt 2 (ban đêm, thu quyền) xếp hàng trong lúc lượt 1 còn treo.
    const second = syncVoicePermissions(room("NIGHT"));
    openGate();
    await Promise.all([first, second]);

    // Hàng đợi tuần tự nên hai lượt không đan vào nhau, và trạng thái cuối là
    // của pha MỚI - đúng chiều thu quyền.
    expect(applied).toEqual([true, false]);
  });

  it("lượt cũ bị thay thế thì bỏ hẳn, không tiêu tốn lời gọi", async () => {
    const { admin, calls } = fakeAdmin();
    setVoiceAdmin(admin);
    markVoiceJoined("ABCDE", "alive");
    calls.length = 0;

    // Ba lượt xếp hàng cùng lúc: chỉ lượt cuối được thi hành.
    await Promise.all([
      syncVoicePermissions(room("DAY_DISCUSSION")),
      syncVoicePermissions(room("DAY_DISCUSSION")),
      syncVoicePermissions(room("NIGHT")),
    ]);

    expect(calls).toEqual([{ kind: "update", identity: "alive", canPublish: false }]);
  });
});

describe("lối ra tường minh", () => {
  it("dropVoiceParticipant đá người ra và quên luôn trạng thái của họ", async () => {
    const { admin, calls } = fakeAdmin();
    setVoiceAdmin(admin);
    joinBoth(calls);

    await dropVoiceParticipant("ABCDE", "alive");
    expect(calls).toEqual([{ kind: "remove", identity: "alive" }]);

    // Đã quên thì lần đồng bộ sau không đụng tới người này nữa.
    calls.length = 0;
    await syncVoicePermissions(room("DAY_DISCUSSION"));
    expect(calls.map((c) => c.identity)).toEqual(["ghost"]);
  });

  it("dropVoiceParticipant nuốt NotFound: người chưa vào voice là chuyện thường", async () => {
    const admin: VoiceAdmin = {
      createRoom: async () => undefined,
      updateParticipant: async () => undefined,
      removeParticipant: async () => {
        throw new VoiceNotFoundError("participant does not exist");
      },
      deleteRoom: async () => undefined,
    };
    setVoiceAdmin(admin);
    await expect(dropVoiceParticipant("ABCDE", "alive")).resolves.toBeUndefined();
  });

  it("destroyVoiceRoom xoá room và dọn sạch trạng thái", async () => {
    const { admin, calls } = fakeAdmin();
    setVoiceAdmin(admin);
    joinBoth(calls);

    await destroyVoiceRoom("ABCDE");
    expect(calls).toEqual([{ kind: "delete" }]);

    calls.length = 0;
    await syncVoicePermissions(room("DAY_DISCUSSION"));
    expect(calls).toEqual([]);
  });
});

describe("vào lại voice sau khi tải lại trang", () => {
  /**
   * Token không bao giờ mang quyền nói, nên một phiên LiveKit mới LUÔN bắt đầu ở
   * canPublish=false. Cache "đã áp" của phiên trước vì thế là sai ngay khoảnh
   * khắc người chơi vào lại - tin nó thì bỏ qua đúng người vừa cần cấp lại.
   */
  it("cấp lại quyền dù lần trước đã cấp rồi", async () => {
    const { admin, calls } = fakeAdmin();
    setVoiceAdmin(admin);

    await syncVoiceForPlayer(room("DAY_DISCUSSION"), "alive");
    expect(calls).toEqual([{ kind: "update", identity: "alive", canPublish: true }]);

    // Tải lại trang: vào lại room LiveKit bằng token mới.
    calls.length = 0;
    await syncVoiceForPlayer(room("DAY_DISCUSSION"), "alive");
    expect(calls).toEqual([{ kind: "update", identity: "alive", canPublish: true }]);
  });

  it("không đụng tới người khác đang ở yên trong phòng", async () => {
    const { admin, calls } = fakeAdmin();
    setVoiceAdmin(admin);
    joinBoth(calls);
    await syncVoicePermissions(room("DAY_DISCUSSION"));
    calls.length = 0;

    await syncVoiceForPlayer(room("DAY_DISCUSSION"), "alive");
    expect(calls).toEqual([{ kind: "update", identity: "alive", canPublish: true }]);
  });
});
