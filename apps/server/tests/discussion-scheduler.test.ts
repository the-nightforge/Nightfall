import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_BOT_WEIGHTS,
  GameEngine,
  hasReplied,
  type GameState,
} from "@masoi/game-engine";
import type { BotSpeechIntention } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { ChatMessage } from "@masoi/shared";
import type { Room } from "../src/rooms/store";
import { botSessionFor, clearBotSession } from "../src/bots/session-registry";
import { ROOM_SCAFFOLD } from "./helpers/room";
import { NIGHT_SCAFFOLD } from "./helpers/night";
import { GAME_STATE_SCAFFOLD } from "./helpers/game-state";

const LIMITS = DEFAULT_BOT_WEIGHTS.conversation;

const timers = vi.hoisted(() => ({
  scheduled: [] as Array<{ fn: () => void; ms: number }>,
}));

/**
 * Mọi lượt hỏi nhà cung cấp, ghi lại nguyên trạng.
 *
 * Tin nhắn phát ra không mang `replyToMessageId` - đó là chuyện nội bộ của lõi,
 * không phải của giao thức chat. Nhưng quan hệ trả lời chính là thứ hai trần
 * `maxRepliesPerMessage` và `maxChainDepth` nói về, nên test phải nhìn thấy nó ở
 * đâu đó. Chỗ duy nhất nó đi qua là `SpeechRequest`.
 *
 * Ghi lại `at` để ghép một lượt hỏi với đúng câu nó sinh ra: hàng đợi là TUẦN
 * TỰ và đồng hồ giả không nhích trong lòng một checkpoint, nên `Date.now()` lúc
 * hỏi bằng đúng `at` của câu được phát.
 */
const provider = vi.hoisted(() => ({
  calls: [] as Array<{ at: number; botId: string; replyToMessageId: string | null }>,
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
    // Vẫn ghi lại lượt hỏi, vì "đã hỏi hay chưa" là một khẳng định của test.
    botBrain: () => ({
      name: "no-provider",
      renderDaySpeech: async (request: import("../src/bots/types").SpeechRequest) => {
        provider.calls.push({
          at: Date.now(),
          botId: request.speaker.id,
          replyToMessageId: request.intention.replyToMessageId ?? null,
        });
        return { ok: false as const };
      },
    }),
  };
});

const { runDiscussionScheduler, cancelDiscussionScheduler, PER_BOT_COOLDOWN_MS } =
  await import("../src/game/discussion-scheduler");

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
    ...GAME_STATE_SCAFFOLD,
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

interface ChainFacts {
  /** Độ sâu THẬT của từng câu BOT đã phát, dựng lại từ quan hệ trả lời. */
  depthOf: Map<string, number>;
  /** Câu mà mỗi câu đang trả lời; `null` là tự mở lời. */
  parentOf: Map<string, string | null>;
  /** Số phản hồi THẬT mà mỗi message đã nhận. */
  repliesTo: Map<string, number>;
  maxDepth: number;
  maxReplies: number;
}

/**
 * Dựng lại cây hội thoại từ những gì đã thật sự xảy ra.
 *
 * Ghép theo dấu thời gian: mỗi lượt hỏi nhà cung cấp và câu nó sinh ra nằm
 * trong cùng một checkpoint, và đồng hồ giả không nhích ở giữa. Message không
 * do scheduler phát - câu của người thật, câu có sẵn trước khi phiên mở - ngầm
 * hiểu là gốc, tức độ sâu 0.
 */
function chainFacts(room: Room): ChainFacts {
  const parentAt = new Map(
    provider.calls.map((call) => [call.at, call.replyToMessageId] as const),
  );
  const depthOf = new Map<string, number>();
  const parentOf = new Map<string, string | null>();
  const repliesTo = new Map<string, number>();

  for (const message of botLines(room)) {
    const parent = parentAt.get(message.at) ?? null;
    depthOf.set(message.id, parent === null ? 0 : (depthOf.get(parent) ?? 0) + 1);
    parentOf.set(message.id, parent);
    if (parent !== null) repliesTo.set(parent, (repliesTo.get(parent) ?? 0) + 1);
  }

  return {
    depthOf,
    parentOf,
    repliesTo,
    maxDepth: Math.max(0, ...depthOf.values()),
    maxReplies: Math.max(0, ...repliesTo.values()),
  };
}

/**
 * Câu của người thật, có sẵn trước khi phiên thảo luận mở.
 *
 * `text` mặc định KHÔNG nêu tên ai: đó là câu dùng cho mọi test về kế toán
 * chuỗi, và một cái tên trong đó sẽ kích hoạt luật "ai bị hỏi thì nói trước",
 * tức đổi thứ tự người nói của những test không nói gì về luật ấy.
 */
function seedHumanLine(
  room: Room,
  id: string,
  text = "Sáng nay ai thấy gì lạ không, nói đi.",
): ChatMessage {
  const message: ChatMessage = {
    id,
    channel: "day",
    playerId: "human",
    playerName: "Người thật",
    text,
    at: Date.now() - 1_000,
  };
  room.chatLog.push(message);
  return message;
}

/**
 * Ép mọi BOT trong phòng nói đúng thứ ta muốn, để test được KẾ TOÁN của phòng.
 *
 * Lõi quyết định BOT có muốn đáp hay không, và nó cố tình hiếm khi muốn - đúng
 * như thiết kế. Nhưng hai trần này phải đúng cả trong trường hợp xấu nhất, tức
 * khi con nào cũng muốn đáp. Runtime vẫn là runtime THẬT: chỉ một phương thức
 * bị thay, nên `declineSpeech` và trí nhớ hội thoại vẫn là hàng thật.
 */
function scriptEveryBot(
  room: Room,
  plan: (botId: string) => BotSpeechIntention | null,
): void {
  const session = botSessionFor(room);
  for (const member of room.members.filter((entry) => entry.isBot)) {
    const runtime = session.runtimeFor(member.playerId);
    vi.spyOn(runtime, "decideSpeech").mockImplementation(() => plan(member.playerId));
  }
}

function replyTo(messageId: string, targetId: string): BotSpeechIntention {
  return {
    kind: "REPLY",
    targetId,
    replyToMessageId: messageId,
    replyToActorId: targetId,
    topic: "PROCESS",
    confidence: 0.5,
    evidence: [],
    tone: "NEUTRAL",
  };
}

describe("discussion scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    timers.scheduled = [];
    provider.calls = [];
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

    // Khẳng định trên QUAN HỆ TRẢ LỜI thật, không trên tổng số tin. Trần tổng
    // vốn đã chặn ở 18, nên một test đếm tổng sẽ xanh kể cả khi luật chuỗi chưa
    // hề chạy - nó chỉ chứng minh ngân sách hết, không chứng minh chuỗi dừng.
    const facts = chainFacts(room);
    expect(facts.maxDepth).toBeLessThanOrEqual(LIMITS.maxChainDepth);
    expect(facts.maxReplies).toBeLessThanOrEqual(LIMITS.maxRepliesPerMessage);
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
    provider.calls = [];
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
    provider.calls = [];
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

/**
 * Hai trần của một chuỗi đối đáp, thi hành ở PHÒNG chứ không ở BOT.
 *
 * Một con BOT không biết cả phòng đã đáp một câu bao nhiêu lần, và không nên
 * biết. Vì vậy `maxRepliesPerMessage` và `maxChainDepth` là việc của scheduler.
 * Self-play cũng thi hành đúng hai trần này, qua đúng một hàm chung
 * (`judgeChainPosition`), nên "chuỗi sâu nhất là 3" trong báo cáo self-play nói
 * đúng về căn phòng thật.
 */
describe("trần chuỗi đối đáp", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    timers.scheduled = [];
    provider.calls = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cancelDiscussionScheduler("ROOMA");
    clearBotSession("ROOMA");
    vi.useRealTimers();
  });

  it("một câu chỉ nhận tối đa maxRepliesPerMessage phản hồi, dù cả ba BOT đều muốn đáp", async () => {
    const room = discussionRoom(3);
    const seed = seedHumanLine(room, "human-1");
    scriptEveryBot(room, () => replyTo(seed.id, "human"));

    await playDiscussion(room);

    expect(chainFacts(room).repliesTo.get(seed.id)).toBe(LIMITS.maxRepliesPerMessage);
    expect(botLines(room)).toHaveLength(LIMITS.maxRepliesPerMessage);
  });

  it("ý định bị chặn KHÔNG bao giờ tới nhà cung cấp", async () => {
    // Trần là để tiết kiệm cả sự chú ý của người chơi lẫn tiền gọi API. Chặn
    // sau khi đã trả tiền viết câu thì chỉ còn tiết kiệm được một nửa.
    const room = discussionRoom(3);
    const seed = seedHumanLine(room, "human-1");
    scriptEveryBot(room, () => replyTo(seed.id, "human"));

    await playDiscussion(room);

    const asked = provider.calls.filter((call) => call.replyToMessageId === seed.id);
    expect(asked).toHaveLength(LIMITS.maxRepliesPerMessage);
  });

  it("một message đã chạm trần không bị thử lại ở checkpoint sau", async () => {
    const room = discussionRoom(3);
    const seed = seedHumanLine(room, "human-1");
    const session = botSessionFor(room);

    // Kịch bản này hành xử như lõi THẬT: nó chỉ đề nghị đáp một câu mà trí nhớ
    // hội thoại của chính nó chưa đánh dấu là đã xử lý - đúng như
    // `findConversationTriggers` bỏ qua mọi message đã `hasReplied`. Nhờ vậy
    // test đo được đúng thứ cần đo: một lần bị từ chối có DỪNG được vòng lặp
    // hay không.
    scriptEveryBot(room, (botId) =>
      hasReplied(session.runtimeFor(botId).state, seed.id)
        ? null
        : replyTo(seed.id, "human"),
    );

    await playDiscussion(room);

    // Hai con nói được, con thứ ba bị chặn. Ba lượt đề nghị, không hơn - nếu
    // scheduler nuốt lời từ chối thay vì báo cho lõi, con thứ ba sẽ đề nghị lại
    // ở mọi checkpoint còn lại của pha.
    expect(provider.calls.filter((call) => call.replyToMessageId === seed.id))
      .toHaveLength(LIMITS.maxRepliesPerMessage);
    expect(botLines(room)).toHaveLength(LIMITS.maxRepliesPerMessage);

    // Cả ba đều đã đánh dấu là xử lý xong, kể cả con không được nói.
    for (const member of room.members.filter((entry) => entry.isBot)) {
      const state = session.runtimeFor(member.playerId).state;
      expect(hasReplied(state, seed.id), member.playerId).toBe(true);
    }

    // Và con bị từ chối KHÔNG có bản ghi phát ngôn giả nào.
    const silent = room.members
      .filter((entry) => entry.isBot)
      .map((entry) => entry.playerId)
      .filter((id) => !botLines(room).some((message) => message.playerId === id));
    expect(silent).toHaveLength(1);
    expect(session.runtimeFor(silent[0]!).state.speechMemory).toHaveLength(0);
  });

  it("chuỗi A→B→A→B dừng đúng tại maxChainDepth", async () => {
    const room = discussionRoom(2);
    seedHumanLine(room, "human-1");
    // Mỗi con đáp câu mới nhất mà nó KHÔNG phải tác giả: đó là một cuộc đối đáp
    // qua lại, và nếu không có trần thì nó chạy tới hết pha.
    scriptEveryBot(room, (botId) => {
      const newest = [...room.chatLog].reverse().find((m) => m.playerId !== botId);
      return newest ? replyTo(newest.id, newest.playerId) : null;
    });

    await playDiscussion(room);

    const facts = chainFacts(room);
    // Chạm trần - nếu không thì test này chưa hề thử được cái nó định thử.
    expect(facts.maxDepth).toBe(LIMITS.maxChainDepth);
    // ...và không vượt.
    expect([...facts.depthOf.values()].filter((d) => d > LIMITS.maxChainDepth)).toEqual([]);

    // Và nó đúng là A→B→A→B: mỗi câu do con kia đáp, độ sâu tăng đúng một bậc
    // mỗi lượt. Nếu cùng một con nói hai câu liền thì đó không phải chuỗi đối
    // đáp, và khẳng định độ sâu ở trên sẽ nói về một thứ khác.
    // Và nó đúng là một cuộc ĐỐI ĐÁP: đi ngược từ câu sâu nhất về gốc phải ra
    // một đường người-thật → A → B → A, mỗi bậc một người khác. Nếu cùng một
    // con nói hai bậc liền thì "sâu 3" nói về một thứ khác, không phải về hai
    // con BOT đang đáp qua đáp lại.
    const authorOf = new Map(room.chatLog.map((m) => [m.id, m.playerId] as const));
    const deepest = botLines(room).find(
      (message) => facts.depthOf.get(message.id) === LIMITS.maxChainDepth,
    )!;
    const path: string[] = [];
    for (let id: string | null = deepest.id; id !== null; id = facts.parentOf.get(id) ?? null) {
      path.unshift(id);
    }
    const speakers = path.map((id) => authorOf.get(id));
    expect(speakers).toHaveLength(LIMITS.maxChainDepth + 1);
    expect(speakers[0]).toBe("human");
    for (let i = 1; i < speakers.length; i += 1) {
      expect(speakers[i], speakers.join(" → ")).not.toBe(speakers[i - 1]);
    }

    // Trần thứ hai cũng bịt nốt đường vòng: khi chuỗi hết chỗ để sâu thêm, BOT
    // quay sang đáp lại câu ở bậc trên - và câu đó cũng chỉ nhận đúng hai lần.
    expect(facts.maxReplies).toBe(LIMITS.maxRepliesPerMessage);
  });

  it("câu tự mở lời vẫn có độ sâu 0, không bị chuỗi cũ chặn", async () => {
    const room = discussionRoom(2);
    scriptEveryBot(room, () => ({
      kind: "ACCUSE",
      targetId: "human",
      topic: "SUSPICION",
      confidence: 0.6,
      evidence: [],
      tone: "FIRM",
    }));

    await playDiscussion(room);

    const facts = chainFacts(room);
    expect(botLines(room).length).toBeGreaterThan(LIMITS.maxChainDepth);
    expect(facts.maxDepth).toBe(0);
  });
});

/**
 * Nhịp riêng của từng BOT.
 *
 * Trần `messagesPerBotPerRound` nói BOT được nói bao nhiêu câu một ngày, nhưng
 * không nói gì về KHOẢNG CÁCH giữa chúng - nên một con BOT có thể tiêu hết ba
 * câu trong ba checkpoint liền nhau, tức tám giây, rồi im suốt phần còn lại.
 * Đọc lên nó là một cái loa vừa bật vừa tắt, không phải một người đang bàn.
 */
describe("nhịp riêng của từng BOT", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    timers.scheduled = [];
    provider.calls = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cancelDiscussionScheduler("ROOMA");
    clearBotSession("ROOMA");
    vi.useRealTimers();
  });

  it("một BOT không nói hai câu sát nhau", async () => {
    // Ba con lúc nào cũng muốn nói. Đây là trường hợp XẤU NHẤT cho nhịp:
    // scheduler rút thăm lại ở mỗi checkpoint, nên nó hoàn toàn có thể trúng
    // cùng một con hai lượt liền - hai câu cách nhau đúng một `MIN_GAP_MS`,
    // tức hai giây rưỡi. Một bàn đông và ít lời thì hiếm khi chạm vào chuyện
    // này, và đó chính là lý do phải dựng ra nó chứ không ngồi chờ.
    const room = discussionRoom(3);
    scriptEveryBot(room, () => ({
      kind: "ACCUSE",
      targetId: "human",
      topic: "SUSPICION",
      confidence: 0.6,
      evidence: [],
      tone: "FIRM",
    }));

    await playDiscussion(room);

    // Có đủ lời để phép đo có nghĩa.
    expect(botLines(room).length).toBeGreaterThan(LIMITS.messagesPerBotPerRound);

    const previous = new Map<string, number>();
    for (const message of botLines(room)) {
      const last = previous.get(message.playerId);
      if (last !== undefined) {
        expect(message.at - last, message.playerId).toBeGreaterThanOrEqual(
          PER_BOT_COOLDOWN_MS,
        );
      }
      previous.set(message.playerId, message.at);
    }
  });

  it("cả phòng cùng nghỉ thì hàng đợi vẫn sống, không dừng vĩnh viễn", async () => {
    // ĐÚNG MỘT con BOT, và đó là điểm mấu chốt: khoảng cách giữa hai checkpoint
    // nhiều nhất là `MIN_GAP_MS + JITTER_MS` = 6,5 giây, ngắn hơn nhịp nghỉ 7
    // giây. Nên ngay sau mỗi câu, checkpoint kế tiếp CHẮC CHẮN rơi vào cảnh
    // "không còn ai đủ điều kiện" - đúng nhánh cần thử.
    //
    // Với hai con trở lên, con kia gần như luôn rảnh và nhánh này không bao giờ
    // chạy; một test như thế xanh kể cả khi scheduler dừng hẳn ở đó.
    const room = discussionRoom(1);
    scriptEveryBot(room, () => ({
      kind: "ACCUSE",
      targetId: "human",
      topic: "SUSPICION",
      confidence: 0.6,
      evidence: [],
      tone: "FIRM",
    }));

    await playDiscussion(room);

    // Nếu nhánh đó dừng hàng đợi thay vì hẹn lại, con BOT nói đúng một câu rồi
    // im tới hết pha.
    expect(botLines(room)).toHaveLength(LIMITS.messagesPerBotPerRound);
    const stamps = botLines(room).map((message) => message.at);
    for (let i = 1; i < stamps.length; i += 1) {
      expect(stamps[i]! - stamps[i - 1]!).toBeGreaterThanOrEqual(PER_BOT_COOLDOWN_MS);
    }
  });

  it("nhịp nghỉ không đụng tới trần mỗi BOT và trần cả phòng", async () => {
    const room = discussionRoom(2);
    scriptEveryBot(room, () => ({
      kind: "ACCUSE",
      targetId: "human",
      topic: "SUSPICION",
      confidence: 0.6,
      evidence: [],
      tone: "FIRM",
    }));

    await playDiscussion(room);

    const counts = new Map<string, number>();
    for (const message of botLines(room)) {
      counts.set(message.playerId, (counts.get(message.playerId) ?? 0) + 1);
    }
    // Cả hai con vẫn tiêu hết hạn mức ngày của mình, chỉ là rải ra.
    expect(counts.get("bot1")).toBe(LIMITS.messagesPerBotPerRound);
    expect(counts.get("bot2")).toBe(LIMITS.messagesPerBotPerRound);
  });

  it("con khác vẫn nói được trong lúc con vừa nói đang nghỉ", async () => {
    // Nhịp nghỉ là của TỪNG BOT, không phải của căn phòng. Nếu nó khoá cả
    // phòng thì cuộc thảo luận chậm lại đúng bằng lượng vừa chữa được.
    const room = discussionRoom(3);
    scriptEveryBot(room, () => ({
      kind: "ACCUSE",
      targetId: "human",
      topic: "SUSPICION",
      confidence: 0.6,
      evidence: [],
      tone: "FIRM",
    }));

    await playDiscussion(room);

    const lines = botLines(room);
    const opener = lines[0]!;
    const duringCooldown = lines.filter(
      (message) =>
        message.at > opener.at && message.at < opener.at + PER_BOT_COOLDOWN_MS,
    );
    expect(duringCooldown.length).toBeGreaterThan(0);
    for (const message of duringCooldown) {
      expect(message.playerId).not.toBe(opener.playerId);
    }
  });

  it("hết nghỉ thì được chọn lại, không bị loại khỏi vòng", async () => {
    const room = discussionRoom(3);
    scriptEveryBot(room, () => ({
      kind: "ACCUSE",
      targetId: "human",
      topic: "SUSPICION",
      confidence: 0.6,
      evidence: [],
      tone: "FIRM",
    }));

    await playDiscussion(room);

    const counts = new Map<string, number>();
    for (const message of botLines(room)) {
      counts.set(message.playerId, (counts.get(message.playerId) ?? 0) + 1);
    }
    // Mỗi con nói lại nhiều lần: nhịp nghỉ HOÃN một lượt, nó không tước lượt.
    for (const member of room.members.filter((entry) => entry.isBot)) {
      expect(counts.get(member.playerId), member.playerId).toBe(
        LIMITS.messagesPerBotPerRound,
      );
    }
  });

  it("lượt không phát ra câu nào KHÔNG bị tính là đã nói", async () => {
    // Nhà cung cấp hỏng, BOT im lặng, hoặc ý định bị trần chặn - cả ba đều kết
    // thúc mà không có câu nào. Nếu chúng vẫn nạp nhịp nghỉ thì một con BOT bị
    // phạt vì một câu nó chưa từng nói, và càng hỏng nó càng bị bịt miệng.
    //
    // Ở đây: ý định thuộc loại cần người để nói tới nhưng không có ai, nên cả
    // nhà cung cấp lẫn bảng mẫu đều không ra được chữ nào.
    const room = discussionRoom(2);
    scriptEveryBot(room, () => ({
      kind: "REPLY",
      topic: "PROCESS",
      confidence: 0.5,
      evidence: [],
      tone: "NEUTRAL",
    }));

    await playDiscussion(room);

    expect(botLines(room)).toHaveLength(0);

    // Không có nhịp nghỉ giả: cùng một con được hỏi lại trong khoảng ngắn hơn
    // cả cooldown, vì nó chưa hề nói gì.
    const askedAgainQuickly = provider.calls.some((call, index) =>
      provider.calls
        .slice(index + 1)
        .some(
          (later) =>
            later.botId === call.botId &&
            later.at - call.at < PER_BOT_COOLDOWN_MS,
        ),
    );
    expect(askedAgainQuickly).toBe(true);
  });
});

/**
 * Phòng không có BOT nào.
 *
 * Hoàn toàn bình thường - tám người thật ngồi với nhau là một ván hợp lệ. Lúc
 * đó scheduler không có việc gì để làm, và "không có việc gì để làm" phải là
 * một lối ra sạch: không đồng hồ, không runtime, không ngoại lệ.
 */
describe("phòng không có BOT", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    timers.scheduled = [];
    provider.calls = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cancelDiscussionScheduler("ROOMA");
    clearBotSession("ROOMA");
    vi.useRealTimers();
  });

  it("không ném, không câu nào, và không hẹn lịch gì cả", async () => {
    const room = discussionRoom(0);
    expect(room.members.every((member) => !member.isBot)).toBe(true);

    await expect(playDiscussion(room)).resolves.toBeUndefined();

    expect(botLines(room)).toHaveLength(0);
    expect(room.chatLog).toHaveLength(0);
    // Không một checkpoint nào được đặt: không có ai để xếp lịch.
    expect(timers.scheduled).toHaveLength(0);
  });

  it("không dựng BotRuntime cho người thật chỉ để đọc bảng cấu hình", async () => {
    // Bảng `conversation` là hằng số của cấu hình, không phải tài sản của một
    // người chơi. Đọc nó qua `runtimeFor(<người thật>)` vừa cấp phát một bộ não
    // cho người không cần não, vừa nói sai ai là chủ của con số đó.
    const room = discussionRoom(2);
    const session = botSessionFor(room);
    const runtimeFor = vi.spyOn(session, "runtimeFor");

    await playDiscussion(room);

    const asked = runtimeFor.mock.calls.map(([botId]) => botId);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked).not.toContain("human");
  });
});

/**
 * Người thật hỏi thẳng một con BOT.
 *
 * Trước luật này, ai nói ở checkpoint kế tiếp là do RNG của phòng chọn đều trên
 * mọi BOT đủ điều kiện. Pha thảo luận mặc định 60 giây với nhịp 2,5-6,5 giây
 * cho khoảng 13 checkpoint chia cho cả bàn - nên con BOT vừa bị gọi đích danh
 * có đúng 1/n cơ hội mỗi lượt, và người hỏi thường nhận về câu của một con
 * khác, nói chuyện khác. Đó là triệu chứng "bot không nghe mình" rõ nhất mà
 * người chơi thật gặp, và nó nằm ở tầng XẾP LƯỢT chứ không ở lõi: lõi đã có
 * `QUESTIONED_ME` với priority 95 và một sàn xác suất trả lời riêng, nhưng nó
 * không bao giờ được hỏi tới.
 */
describe("người thật hỏi thẳng một BOT", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    timers.scheduled = [];
    provider.calls = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cancelDiscussionScheduler("ROOMA");
    clearBotSession("ROOMA");
    vi.useRealTimers();
  });

  it("con BOT bị gọi đích danh là con nói trước", async () => {
    const room = discussionRoom(6);
    const asked = seedHumanLine(room, "human-1", "Bot 4 nghĩ sao?");
    scriptEveryBot(room, () => replyTo(asked.id, "human"));

    await playDiscussion(room);

    expect(botLines(room)[0]?.playerId).toBe("bot4");
  });

  it("chỉ mua ĐÚNG MỘT lượt: con được gọi không nói thì cả bàn vẫn nói tiếp", async () => {
    // Không có ràng buộc này thì mỗi checkpoint lại thấy đúng câu hỏi cũ ở
    // cuối log, lại chọn đúng con BOT vừa từ chối, và cả phòng câm tới hết pha.
    const room = discussionRoom(6);
    const asked = seedHumanLine(room, "human-1", "Bot 4 nghĩ sao?");
    scriptEveryBot(room, (botId) => (botId === "bot4" ? null : replyTo(asked.id, "human")));

    await playDiscussion(room);

    expect(botLines(room).length).toBeGreaterThan(0);
    expect(botLines(room).every((message) => message.playerId !== "bot4")).toBe(true);
  });

  it("câu người thật không nêu tên ai thì thứ tự nói không đổi một chút nào", async () => {
    // Khoá lời hứa về CHUỖI RNG: luật mới đọc `pick()` y như cũ rồi mới ghi đè
    // lựa chọn, nên khi nó không nổ, mọi preset và mọi test cũ chạy từng bit
    // như trước.
    const withHuman = discussionRoom(6);
    seedHumanLine(withHuman, "human-1");
    await playDiscussion(withHuman);
    const order = botLines(withHuman).map((message) => message.playerId);
    expect(order.length).toBeGreaterThan(1);

    cancelDiscussionScheduler("ROOMA");
    clearBotSession("ROOMA");

    const without = discussionRoom(6);
    await playDiscussion(without);

    expect(botLines(without).map((message) => message.playerId)).toEqual(order);
  });

  it("câu của một BOT khác không mua được lượt ưu tiên nào", async () => {
    // Luật này là để phục vụ NGƯỜI THẬT. Cho câu của bot kích hoạt nó nghĩa là
    // hai con BOT gọi tên nhau sẽ khoá chặt lượt nói của cả bàn vào một cặp.
    const room = discussionRoom(6);
    room.chatLog.push({
      id: "bot-said",
      channel: "day",
      playerId: "bot1",
      playerName: "Bot 1",
      text: "Bot 4 nghĩ sao?",
      at: Date.now() - 1_000,
    });
    scriptEveryBot(room, () => replyTo("bot-said", "bot1"));

    await playDiscussion(room);

    const speakers = new Set(botLines(room).map((message) => message.playerId));
    expect(speakers.size).toBeGreaterThan(1);
  });
});
