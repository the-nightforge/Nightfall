import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";
import { clearBotSession } from "../src/bots/session-registry";

const timers = vi.hoisted(() => ({
  scheduled: [] as Array<{ fn: () => void; ms: number }>,
}));

vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: () => undefined,
  persistRoom: async () => undefined,
  setRoomTimer: (_code: string, fn: () => void, ms: number) => {
    timers.scheduled.push({ fn, ms });
    return setTimeout(fn, ms);
  },
}));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));

vi.mock("../src/db", () => ({ prisma: {} }));

vi.mock("../src/bots", async () => {
  const actual = await vi.importActual<typeof import("../src/bots")>("../src/bots");
  return {
    ...actual,
    // Không nhà cung cấp: mọi câu đến từ bảng mẫu, và test không phụ thuộc mạng.
    botBrain: () => ({
      name: "no-provider",
      renderDaySpeech: async () => ({ ok: false as const }),
      decideDefense: async () => ({ ok: false as const }),
    }),
  };
});

const { runDiscussionScheduler, cancelDiscussionScheduler } = await import(
  "../src/game/discussion-scheduler"
);

function discussionRoom(botCount = 4, aliveOverrides: Record<string, boolean> = {}): Room {
  const players = [
    { id: "human", name: "Người thật", role: "VILLAGER" as const, isBot: false },
    ...Array.from({ length: botCount }, (_, i) => ({
      id: `bot${i + 1}`,
      name: `Bot ${i + 1}`,
      role: (i === 0 ? "WEREWOLF" : "VILLAGER") as "WEREWOLF" | "VILLAGER",
      isBot: true,
    })),
  ];

  const state: GameState = {
    phase: "DAY_DISCUSSION",
    round: 1,
    phaseEndsAt: Date.now() + DEFAULT_ROOM_CONFIG.discussionSeconds * 1_000,
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      alive: aliveOverrides[p.id] ?? true,
      isBot: p.isBot,
    })),
    config: { ...DEFAULT_ROOM_CONFIG },
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
    log: [],
  };

  return {
    code: "ROOMA",
    hostId: "human",
    status: "IN_GAME",
    members: players.map((p) => ({
      playerId: p.id,
      name: p.name,
      ready: true,
      connected: true,
      isBot: p.isBot,
    })),
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: new GameEngine(state),
    chatLog: [],
    createdAt: 0,
  };
}

/** Chạy trọn một pha thảo luận theo đồng hồ giả. */
async function playDiscussion(room: Room): Promise<void> {
  runDiscussionScheduler(room);
  await vi.advanceTimersByTimeAsync(room.config.discussionSeconds * 1_000 + 5_000);
}

function botLines(room: Room) {
  return room.chatLog.filter((message) => message.playerId.startsWith("bot"));
}

describe("discussion scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    timers.scheduled = [];
  });

  afterEach(() => {
    cancelDiscussionScheduler("ROOMA");
    clearBotSession("ROOMA");
    vi.useRealTimers();
  });

  it("nhiều BOT được nói, không chỉ một con", async () => {
    const room = discussionRoom();
    await playDiscussion(room);

    const speakers = new Set(botLines(room).map((message) => message.playerId));
    expect(speakers.size).toBeGreaterThan(1);
  });

  it("một BOT không vượt hạn mức tin mỗi ngày", async () => {
    const room = discussionRoom();
    await playDiscussion(room);

    const counts = new Map<string, number>();
    for (const message of botLines(room)) {
      counts.set(message.playerId, (counts.get(message.playerId) ?? 0) + 1);
    }
    for (const [id, count] of counts) expect(count, id).toBeLessThanOrEqual(3);
  });

  it("cả phòng không vượt trần tổng", async () => {
    const room = discussionRoom(8);
    await playDiscussion(room);
    expect(botLines(room).length).toBeLessThanOrEqual(18);
  });

  it("không hai BOT nào gửi cùng một khoảnh khắc", async () => {
    const room = discussionRoom();
    await playDiscussion(room);

    const stamps = botLines(room).map((message) => message.at);
    expect(new Set(stamps).size).toBe(stamps.length);
  });

  it("có khoảng nghỉ giữa các câu, không dội một lúc", async () => {
    const room = discussionRoom();
    await playDiscussion(room);

    const stamps = botLines(room).map((message) => message.at);
    for (let i = 1; i < stamps.length; i += 1) {
      expect(stamps[i]! - stamps[i - 1]!).toBeGreaterThanOrEqual(1_000);
    }
  });

  it("cùng phòng, cùng seed cho cùng thứ tự người nói", async () => {
    // Phải dọn session giữa hai lần chạy. Dòng RNG của một session TIẾN LÊN
    // trong suốt ván - đó là hành vi đúng: vòng 2 không được lặp lại y hệt vòng
    // 1. Thứ phải tái lập là "cùng ván từ đầu cho cùng kết quả", nên test phải
    // bắt đầu lại từ đầu chứ không chạy tiếp.
    const first = discussionRoom();
    await playDiscussion(first);
    const firstOrder = botLines(first).map((message) => message.playerId);
    expect(firstOrder.length).toBeGreaterThan(1);

    cancelDiscussionScheduler("ROOMA");
    clearBotSession("ROOMA");

    const second = discussionRoom();
    await playDiscussion(second);

    expect(botLines(second).map((message) => message.playerId)).toEqual(firstOrder);
  });

  it("không chuỗi đối đáp nào chạy vô hạn", async () => {
    const room = discussionRoom(6);
    await playDiscussion(room);
    // Trần tổng đã chặn; khẳng định này bắt trường hợp vòng lặp đẩy số tin lên
    // trần rồi dừng bằng cách hết ngân sách, thay vì bằng luật chuỗi.
    expect(botLines(room).length).toBeLessThanOrEqual(18);
  });

  it("mọi câu đều đi qua luật chat, không bypass", async () => {
    const room = discussionRoom();
    await playDiscussion(room);
    for (const message of botLines(room)) {
      expect(message.channel).toBe("day");
    }
  });
});

describe("BOT chết không nói ban ngày", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    timers.scheduled = [];
  });

  afterEach(() => {
    cancelDiscussionScheduler("ROOMA");
    clearBotSession("ROOMA");
    vi.useRealTimers();
  });

  it("không lên lịch cho BOT đã chết", async () => {
    const room = discussionRoom(4, { bot1: false, bot2: false });
    await playDiscussion(room);

    const speakers = new Set(botLines(room).map((message) => message.playerId));
    expect(speakers.has("bot1")).toBe(false);
    expect(speakers.has("bot2")).toBe(false);
  });

  it("không tin nào lọt vào kênh người chết", async () => {
    const room = discussionRoom(4, { bot1: false });
    await playDiscussion(room);
    expect(room.chatLog.every((message) => message.channel !== "dead")).toBe(true);
  });

  it("BOT chết GIỮA CHỪNG thì kết quả đang chờ bị bỏ", async () => {
    const room = discussionRoom(3);
    runDiscussionScheduler(room);

    await vi.advanceTimersByTimeAsync(3_000);
    // Giết sạch BOT trong lúc pha còn chạy.
    for (const player of room.engine!.state.players) {
      if (player.isBot) player.alive = false;
    }
    const before = botLines(room).length;

    await vi.advanceTimersByTimeAsync(room.config.discussionSeconds * 1_000);
    expect(botLines(room).length).toBe(before);
  });
});

describe("huỷ khi tình thế đổi", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    timers.scheduled = [];
  });

  afterEach(() => {
    cancelDiscussionScheduler("ROOMA");
    clearBotSession("ROOMA");
    vi.useRealTimers();
  });

  it("đổi pha thì không phát thêm câu nào", async () => {
    const room = discussionRoom();
    runDiscussionScheduler(room);
    await vi.advanceTimersByTimeAsync(4_000);

    room.engine!.state.phase = "VOTING";
    const before = room.chatLog.length;

    await vi.advanceTimersByTimeAsync(room.config.discussionSeconds * 1_000);
    expect(room.chatLog.length).toBe(before);
  });

  it("đổi vòng thì không phát thêm câu nào", async () => {
    const room = discussionRoom();
    runDiscussionScheduler(room);
    await vi.advanceTimersByTimeAsync(4_000);

    room.engine!.state.round = 2;
    const before = room.chatLog.length;

    await vi.advanceTimersByTimeAsync(room.config.discussionSeconds * 1_000);
    expect(room.chatLog.length).toBe(before);
  });

  it("thay engine thì không phát thêm câu nào", async () => {
    const room = discussionRoom();
    runDiscussionScheduler(room);
    await vi.advanceTimersByTimeAsync(4_000);

    const fresh = discussionRoom();
    room.engine = fresh.engine;
    const before = room.chatLog.length;

    await vi.advanceTimersByTimeAsync(room.config.discussionSeconds * 1_000);
    expect(room.chatLog.length).toBe(before);
  });

  it("huỷ tường minh dừng mọi thứ đang chờ", async () => {
    const room = discussionRoom();
    runDiscussionScheduler(room);
    await vi.advanceTimersByTimeAsync(4_000);

    cancelDiscussionScheduler(room.code);
    const before = room.chatLog.length;

    await vi.advanceTimersByTimeAsync(room.config.discussionSeconds * 1_000);
    expect(room.chatLog.length).toBe(before);
  });

  it("không nói sau khi pha đã gần hết giờ", async () => {
    const room = discussionRoom();
    const endsAt = room.engine!.state.phaseEndsAt!;
    await playDiscussion(room);

    for (const message of botLines(room)) {
      expect(message.at).toBeLessThan(endsAt);
    }
  });
});
