import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ROOM_CONFIG,
  MIN_PLAYERS_TO_START,
  PRESET_DECKS,
  SERVER_EVENTS,
  addBotPayload,
  updateConfigPayload,
  type RoomSnapshot,
} from "@masoi/shared";
import {
  GUIDE_PREP_RETRY_MS,
  hasGuideDeck,
  initialGuidePrepState,
  stepGuidePrep,
  type GuidePrepEmit,
  type GuidePrepState,
} from "../../web/src/lib/guide-prep";

/*
 * Ván hướng dẫn: máy trạng thái phía web (`apps/web/src/lib/guide-prep.ts`)
 * chạy trên SERVER THẬT - `roomService.updateConfig` / `addBot` thật, `store`
 * thật, `broadcastRoom` thật dựng snapshot cá nhân hoá bằng `buildSnapshot`
 * thật rồi bắn vào một socket giả. Chỉ Redis, Prisma và voice là giả.
 *
 * Thứ được kiểm ở đây là hợp đồng sự kiện <-> snapshot: máy chỉ được tin
 * snapshot mà server phát, và server chỉ nhận đúng payload mà `ws.ts` chấp
 * nhận (schema strict). Test thuần của máy (mất gói, chậm, lặp) nằm ở
 * `apps/web/src/lib/guide-prep.test.ts`.
 */

vi.mock("../src/redis", () => ({
  redis: { get: async () => null, set: async () => "OK", del: async () => 1 },
  getPlayerRoom: async () => null,
  updateSessionRoom: async () => undefined,
}));
vi.mock("../src/db", () => ({
  prisma: { player: { findUnique: async () => null }, gameResult: { create: async () => undefined } },
}));
vi.mock("../src/voice/service", () => ({
  destroyVoiceRoom: async () => undefined,
  syncVoicePermissions: async () => undefined,
  voiceViewFor: () => undefined,
  dropVoiceParticipant: async () => undefined,
}));

const { createRoom, removeRoom } = await import("../src/rooms/store");
const { setIo, trackSocket, untrackSocket } = await import("../src/rooms/broadcast");
const { roomService, RoomError } = await import("../src/rooms/service");

const CODE = "GUIDE";
const HOST = "host-1";

/** Socket giả: chỉ ghi lại snapshot server bắn cho chủ phòng. */
function fakeSocket() {
  const snapshots: RoomSnapshot[] = [];
  const socket = {
    emit: (event: string, payload: unknown) => {
      if (event === SERVER_EVENTS.SNAPSHOT) snapshots.push(payload as RoomSnapshot);
    },
  };
  return { socket: socket as never, snapshots };
}

/** Đợi `persistRoom().then(broadcastRoom)` chạy xong. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

/** Đúng cửa vào của `ws.ts`: parse strict rồi mới gọi service. */
function dispatch(emit: GuidePrepEmit): void {
  if (emit.event === "room:update-config") {
    const { config } = updateConfigPayload.parse(emit.payload);
    roomService.updateConfig(HOST, config);
  } else {
    addBotPayload.parse(emit.payload);
    roomService.addBot(HOST);
  }
}

let sockets: ReturnType<typeof fakeSocket>;

beforeEach(() => {
  sockets = fakeSocket();
  setIo({} as never);
  trackSocket(HOST, sockets.socket);
  createRoom(CODE, {
    playerId: HOST,
    name: "Chủ phòng",
    ready: false,
    connected: true,
    disconnectedAt: null,
    isBot: false,
  });
});

afterEach(() => {
  untrackSocket(HOST, sockets.socket);
  removeRoom(CODE);
});

/**
 * Vòng lặp của client: mỗi snapshot server phát là một lượt chạy máy; gửi gì
 * thì đưa thẳng vào service. Trả về số sự kiện đã gửi theo loại.
 */
async function runClient(
  state: GuidePrepState,
  options: { now?: number; maxTurns?: number } = {},
): Promise<{ state: GuidePrepState; sent: GuidePrepEmit[]; snapshots: number }> {
  const sent: GuidePrepEmit[] = [];
  let now = options.now ?? 10_000;
  let seen = 0;
  // Snapshot đầu tiên: client vừa vào phòng (server phát khi join).
  let latest: RoomSnapshot | null = (await import("../src/rooms/snapshot")).buildSnapshot(
    (await import("../src/rooms/store")).getRoom(CODE)!,
    HOST,
  );
  for (let turn = 0; turn < (options.maxTurns ?? 40); turn += 1) {
    const step = stepGuidePrep(state, { snapshot: latest, isHost: true, connected: true, now });
    state = step.state;
    if (step.emit) {
      sent.push(step.emit);
      dispatch(step.emit);
      await settle();
    }
    if (!step.emit && step.wakeAt === null) break;
    if (sockets.snapshots.length > seen) {
      latest = sockets.snapshots[sockets.snapshots.length - 1]!;
      seen = sockets.snapshots.length;
      now += 20;
    } else {
      now = step.wakeAt ?? now + GUIDE_PREP_RETRY_MS;
    }
  }
  return { state, sent, snapshots: seen };
}

describe("ván hướng dẫn trên server thật: bộ bài + bot đi qua đúng sự kiện và snapshot", () => {
  it("phòng mới dùng DEFAULT_ROOM_CONFIG - KHÔNG có Thợ Săn/Thám Tử - và đó là chỗ lệch cần đồng bộ", () => {
    const first = sockets.snapshots.length === 0 ? null : sockets.snapshots[0];
    expect(first).toBeNull();
    expect(DEFAULT_ROOM_CONFIG.hunter).toBe(false);
    expect(DEFAULT_ROOM_CONFIG.detective).toBeUndefined();
    expect(PRESET_DECKS[8]!.hunter).toBe(true);
    expect(PRESET_DECKS[8]!.detective).toBe(true);
    expect(hasGuideDeck(DEFAULT_ROOM_CONFIG)).toBe(false);
  });

  it("chủ phòng: 1 update-config rồi 7 add-bot, mỗi bước chờ snapshot server xác nhận; kết thúc đúng preset 8 và 8 người", async () => {
    const { state, sent } = await runClient(initialGuidePrepState(false));
    expect(state.stage).toBe("done");
    expect(sent.map((e) => e.event)).toEqual([
      "room:update-config",
      ...Array.from({ length: MIN_PLAYERS_TO_START - 1 }, () => "room:add-bot"),
    ]);

    const last = sockets.snapshots[sockets.snapshots.length - 1]!;
    expect(last.players).toHaveLength(MIN_PLAYERS_TO_START);
    expect(hasGuideDeck(last.config)).toBe(true);
    expect(last.config.hunter).toBe(true);
    expect(last.config.detective).toBe(true);
    // Bot là bot thật của server, chủ phòng vẫn là người.
    expect(last.players.filter((p) => p.id !== HOST).every((p) => p.id.startsWith("bot-"))).toBe(true);
    // Server không báo mất cân bằng cho bộ bài chuẩn ở 8 người.
    expect(last.balanceWarning?.blocking ?? false).toBe(false);
  });

  it("bắt đầu ván sau khi chuẩn bị: server chấp nhận (bộ bài hợp lệ với 8 người)", async () => {
    await runClient(initialGuidePrepState(false));
    roomService.setReady(HOST, true);
    await settle();
    expect(() => roomService.start(HOST)).not.toThrow();
    const room = (await import("../src/rooms/store")).getRoom(CODE)!;
    expect(room.status).toBe("IN_GAME");
    // Trong ván, máy không gửi gì nữa.
    const snapshot = (await import("../src/rooms/snapshot")).buildSnapshot(room, HOST);
    const step = stepGuidePrep(initialGuidePrepState(false), { snapshot, isHost: true, connected: true, now: 1 });
    expect(step.emit).toBeNull();
    expect(step.state.stage).toBe("done");
  });

  it("thứ tự cấu hình TRƯỚC bot là bắt buộc: đổi bộ bài khi bàn đã 8 người vẫn được, nhưng đi qua phép chấm cân bằng của server", async () => {
    // Đủ 8 người với bộ bài mặc định trước.
    for (let i = 0; i < MIN_PLAYERS_TO_START - 1; i += 1) roomService.addBot(HOST);
    await settle();
    // Preset 8 ở bàn 8 người: hợp lệ, server nhận.
    expect(() => roomService.updateConfig(HOST, PRESET_DECKS[8]!)).not.toThrow();
    // Còn một bộ bài "mất cân bằng" thì bị chặn ở bàn 8 - đây là lý do máy
    // đổi bộ bài lúc bàn còn 1 người, khi phép chấm chưa chạy.
    expect(() =>
      roomService.updateConfig(HOST, { ...PRESET_DECKS[8]!, werewolves: 4, seer: false, witch: false, guard: false }),
    ).toThrow(RoomError);
  });

  it("server phát lại cùng một snapshot (reconnect) hay client đọc lại nó (re-render): không thêm bot thừa", async () => {
    let state = initialGuidePrepState(false);
    let now = 10_000;
    const snapshotOf = async () =>
      (await import("../src/rooms/snapshot")).buildSnapshot((await import("../src/rooms/store")).getRoom(CODE)!, HOST);

    // Bước cấu hình + 2 bot.
    for (let i = 0; i < 3; i += 1) {
      const step = stepGuidePrep(state, { snapshot: await snapshotOf(), isHost: true, connected: true, now });
      state = step.state;
      dispatch(step.emit!);
      await settle();
      now += 20;
    }
    const before = (await snapshotOf()).players.length;
    expect(before).toBe(3);

    // Cùng snapshot, đọc lại 6 lần trong cửa sổ chờ: máy vừa gửi bot #3, đang chờ.
    const same = await snapshotOf();
    const step3 = stepGuidePrep(state, { snapshot: same, isHost: true, connected: true, now });
    state = step3.state;
    dispatch(step3.emit!);
    await settle();
    for (let i = 0; i < 6; i += 1) {
      // Mô phỏng reconnect: snapshot CŨ (trước khi bot #3 vào) được phát lại.
      const again = stepGuidePrep(state, { snapshot: same, isHost: true, connected: true, now: now + 100 + i });
      state = again.state;
      expect(again.emit).toBeNull();
    }
    expect((await snapshotOf()).players.length).toBe(4);
  });

  it("đã chuẩn bị xong rồi (tải lại trang): host đuổi một bot và bỏ Thợ Săn thì máy không sửa lại", async () => {
    await runClient(initialGuidePrepState(false));
    const store = await import("../src/rooms/store");
    const room = store.getRoom(CODE)!;
    const bot = room.members.find((m) => m.isBot)!;
    // Đổi bộ bài khi còn đủ 8 (server chặn đổi cấu hình ở bàn 6-7 người), rồi đuổi bot.
    roomService.updateConfig(HOST, { ...PRESET_DECKS[8]!, hunter: false });
    await settle();
    await roomService.kick(HOST, bot.playerId);
    await settle();
    const snapshot = (await import("../src/rooms/snapshot")).buildSnapshot(store.getRoom(CODE)!, HOST);
    expect(snapshot.players).toHaveLength(MIN_PLAYERS_TO_START - 1);
    expect(snapshot.config.hunter).toBe(false);

    // Tải lại: cờ "đã chuẩn bị" còn trong sessionStorage -> trạng thái đầu là done.
    const step = stepGuidePrep(initialGuidePrepState(true), { snapshot, isHost: true, connected: true, now: 1 });
    expect(step.emit).toBeNull();
    expect(step.state.stage).toBe("done");
  });

  it("không phải chủ phòng thì không gửi gì, dù có ?guide=1", async () => {
    const snapshot = (await import("../src/rooms/snapshot")).buildSnapshot(
      (await import("../src/rooms/store")).getRoom(CODE)!,
      HOST,
    );
    const step = stepGuidePrep(initialGuidePrepState(false), { snapshot, isHost: false, connected: true, now: 1 });
    expect(step.emit).toBeNull();
    expect(step.wakeAt).toBeNull();
  });
});
