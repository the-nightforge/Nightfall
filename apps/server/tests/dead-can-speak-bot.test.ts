import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameEngine, GAME_EVENTS } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG, GHOST_AUTHOR_ID, GHOST_AUTHOR_NAME } from "@masoi/shared";
import type { Room } from "../src/rooms/store";
import { clearBotSession } from "../src/bots/session-registry";
import { scheduleDeadCanSpeakBot, submitGhostMessage } from "../src/game/machine";
import { ROOM_SCAFFOLD } from "./helpers/room";

/**
 * Tiếng Vọng Người Chết ở tầng phòng.
 *
 * Người thật và BOT đi qua CÙNG một hàm `submitGhostMessage`. Hai đường riêng
 * sẽ trôi lệch, và đường trôi lệch ở đây không phải một bug hiển thị - nó là
 * một cú lộ danh tính không rút lại được.
 */

const emitted = vi.hoisted(() => ({ calls: [] as Array<{ recipients: string[]; message: any }> }));
const brainControl = vi.hoisted(() => ({ renderDaySpeech: vi.fn() }));

vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: () => undefined,
  persistRoom: async () => undefined,
  setRoomTimer: (_code: string, fn: () => void, ms: number) => setTimeout(fn, ms),
}));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: (recipients: string[], _event: string, message: unknown) => {
    emitted.calls.push({ recipients, message });
  },
}));

vi.mock("../src/db", () => ({ prisma: {} }));

vi.mock("../src/bots", async () => {
  const actual = await vi.importActual<typeof import("../src/bots")>("../src/bots");
  return {
    ...actual,
    botBrain: () => ({
      name: "test",
      renderDaySpeech: brainControl.renderDaySpeech,
    }),
  };
});

const NAMES = ["An", "Bình", "Cường", "Dũng", "Hạnh", "Khoa"] as const;
const ROLES = ["WEREWOLF", "SEER", "GUARD", "WITCH", "VILLAGER", "VILLAGER"] as const;

function echoRoom(options: { deadIds?: string[]; humanIds?: string[]; withEvent?: boolean } = {}): Room {
  const dead = options.deadIds ?? ["p5", "p6"];
  const humans = new Set(options.humanIds ?? []);
  const engine = GameEngine.create(
    NAMES.map((name, i) => ({ id: `p${i + 1}`, name, isBot: !humans.has(`p${i + 1}`) })),
    { ...DEFAULT_ROOM_CONFIG, werewolves: 1, mode: "chaos" },
  );
  engine.state.players.forEach((player, i) => {
    player.role = ROLES[i];
    player.alive = !dead.includes(player.id);
    player.isBot = !humans.has(player.id);
  });
  // rng 0 -> linh hồn đầu tiên trong danh sách người chết, tức p5.
  engine.startDay(60_000, Date.now(), () => 0, options.withEvent === false ? null : { ...GAME_EVENTS.DEAD_CAN_SPEAK, round: 1 });

  return {
    ...ROOM_SCAFFOLD,
    code: "ECHO1",
    hostId: "p1",
    status: "IN_GAME",
    members: engine.state.players.map((player) => ({
      playerId: player.id,
      name: player.name,
      ready: true,
      connected: true,
      isBot: player.isBot,
    })),
    config: { ...DEFAULT_ROOM_CONFIG, mode: "chaos" },
    engine,
    chatLog: [],
    createdAt: 0,
  };
}

/** Cho con ma một lý do để nghi ai đó, bằng đúng kênh mà nó vẫn đọc: chat. */
function seedSuspicion(room: Room, targetName: string): void {
  room.chatLog.push({
    id: "seed1",
    channel: "day",
    playerId: "p2",
    playerName: "Bình",
    text: `tôi nghi ${targetName}, ${targetName} là sói`,
    at: 1,
  });
}

const ghostMessages = () =>
  emitted.calls.map((call) => call.message).filter((m) => m.playerName === GHOST_AUTHOR_NAME);

describe("submitGhostMessage", () => {
  beforeEach(() => {
    emitted.calls = [];
    clearBotSession("ECHO1");
  });

  it("đăng lời nhắn dưới tên một linh hồn, không phải tên người gửi", () => {
    const room = echoRoom();

    submitGhostMessage(room, "p5", "đừng tin Cường");

    const message = room.chatLog.at(-1)!;
    expect(message.playerName).toBe(GHOST_AUTHOR_NAME);
    expect(message.playerId).toBe(GHOST_AUTHOR_ID);
    expect(message.text).toBe("đừng tin Cường");
  });

  it("payload phát đi không chứa id thật của người gửi", () => {
    // Client vẽ thế nào không quan trọng: id thật nằm trong payload là đã lộ.
    const room = echoRoom();

    submitGhostMessage(room, "p5", "đừng tin Cường");

    expect(JSON.stringify(ghostMessages())).not.toContain("p5");
  });

  it("người sống vẫn đọc được, vì đó là điểm của sự kiện", () => {
    const room = echoRoom({ humanIds: ["p1", "p5"] });

    submitGhostMessage(room, "p5", "đừng tin Cường");

    const call = emitted.calls.at(-1)!;
    expect(call.recipients).toContain("p1");
  });

  it("không phải linh hồn được chọn thì engine chặn, và không có gì được đăng", () => {
    const room = echoRoom();

    expect(() => submitGhostMessage(room, "p6", "cho tôi nói")).toThrow();
    expect(room.chatLog).toHaveLength(0);
  });
});

describe("scheduleDeadCanSpeakBot", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    emitted.calls = [];
    brainControl.renderDaySpeech.mockReset();
    brainControl.renderDaySpeech.mockResolvedValue({ ok: false });
    clearBotSession("ECHO1");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("BOT được chọn sẽ nói, và nói ẩn danh", async () => {
    const room = echoRoom();
    seedSuspicion(room, "Cường");

    scheduleDeadCanSpeakBot(room);
    await vi.advanceTimersByTimeAsync(60_000);

    const ghost = ghostMessages();
    expect(ghost).toHaveLength(1);
    expect(ghost[0].playerId).toBe(GHOST_AUTHOR_ID);
    expect(room.engine!.state.deadCanSpeakUsed).toBe(true);
  });

  it("lời nhắn không bao giờ vượt 120 ký tự", () => {
    // Engine từ chối câu dài, và một cú từ chối ở đây là mất trắng lượt duy
    // nhất của cả ván.
    const room = echoRoom();
    seedSuspicion(room, "Cường");
    brainControl.renderDaySpeech.mockResolvedValue({
      ok: true,
      value: { chat: "x".repeat(400) },
    });

    scheduleDeadCanSpeakBot(room);
    return vi.advanceTimersByTimeAsync(60_000).then(() => {
      const ghost = ghostMessages();
      expect(ghost).toHaveLength(1);
      expect(ghost[0].text.length).toBeLessThanOrEqual(120);
    });
  });

  it("câu tự xưng tên mình bị chặn, vì đó là lộ danh tính", async () => {
    // Prompt có mang tên BOT vào để nó xưng hô tự nhiên. Ở mọi lượt nói khác
    // điều đó vô hại; ở đây nó phá đúng thứ sự kiện này dựa vào.
    const room = echoRoom();
    seedSuspicion(room, "Cường");
    brainControl.renderDaySpeech.mockResolvedValue({
      ok: true,
      value: { chat: "Hạnh đây, tôi nghi Cường" },
    });

    scheduleDeadCanSpeakBot(room);
    await vi.advanceTimersByTimeAsync(60_000);

    const ghost = ghostMessages();
    expect(ghost).toHaveLength(1);
    expect(ghost[0].text).not.toContain("Hạnh");
  });

  it("không nghi ai thì im lặng, và giữ nguyên lượt", async () => {
    const room = echoRoom();

    scheduleDeadCanSpeakBot(room);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(ghostMessages()).toHaveLength(0);
    expect(room.engine!.state.deadCanSpeakUsed).toBe(false);
  });

  it("linh hồn là người thật thì scheduler không đụng vào", async () => {
    const room = echoRoom({ humanIds: ["p5"] });
    seedSuspicion(room, "Cường");

    scheduleDeadCanSpeakBot(room);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(ghostMessages()).toHaveLength(0);
    expect(room.engine!.state.deadCanSpeakUsed).toBe(false);
  });

  it("không có sự kiện thì không xếp lịch gì", async () => {
    const room = echoRoom({ withEvent: false });
    seedSuspicion(room, "Cường");

    scheduleDeadCanSpeakBot(room);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(ghostMessages()).toHaveLength(0);
  });

  it("kết quả về muộn không lọt sang pha sau", async () => {
    const room = echoRoom();
    seedSuspicion(room, "Cường");

    scheduleDeadCanSpeakBot(room);
    room.engine!.setPhase("VOTING", 30_000, Date.now());
    room.engine!.state.activeEvent = null;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(ghostMessages()).toHaveLength(0);
  });
});
