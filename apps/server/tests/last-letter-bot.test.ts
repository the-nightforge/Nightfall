import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameEngine } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG, LAST_LETTER_MAX_LENGTH } from "@masoi/shared";
import type { Role } from "@masoi/shared";
import type { Room } from "../src/rooms/store";
import { ROOM_SCAFFOLD } from "./helpers/room";

vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: () => undefined,
  persistRoom: async () => undefined,
  setRoomTimer: (_code: string, fn: () => void, ms: number) => setTimeout(fn, ms),
}));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));

vi.mock("../src/db", () => ({ prisma: {} }));

const { scheduleLastLetterBots } = await import("../src/game/machine");
const { lastLetterStateOf } = await import("../src/game/last-letter");
const { clearBotSession, startBotSession } = await import("../src/bots/session-registry");

/**
 * BOT viết Phong thư sau cùng.
 *
 * Toàn bộ QUYẾT ĐỊNH nằm ở lõi tất định trong `game-engine` và đã có test riêng
 * ở đó. Bài này hỏi phần còn lại, thứ chỉ tồn tại ở tầng phòng: ai được xếp
 * lịch, khi nào, và cùng một seed có ra cùng một tập thư hay không.
 *
 * Không có nhà cung cấp LLM nào bị mock ở đây, và đó là chủ ý: nếu ngày mai ai
 * đó đấu tính năng này vào `renderBotSpeech`, bài test sẽ vẫn xanh nhưng file
 * mock rỗng ở trên sẽ là chỗ chứng minh rằng đường đó chưa từng cần tới.
 */

const NAMES = ["An", "Bình", "Cường", "Dũng", "Hạnh", "Khoa"] as const;
const ROLES: Role[] = ["WEREWOLF", "SEER", "GUARD", "WITCH", "VILLAGER", "VILLAGER"];

interface Options {
  enabled?: boolean;
  phase?: "DAY_DISCUSSION" | "NIGHT";
  deadIds?: string[];
  humanIds?: string[];
  code?: string;
}

function botRoom(options: Options = {}): Room {
  const code = options.code ?? "LTRBT";
  const humans = new Set(options.humanIds ?? []);
  const config = { ...DEFAULT_ROOM_CONFIG, werewolves: 1, lastLetter: options.enabled ?? true };
  const engine = GameEngine.create(
    NAMES.map((name, index) => ({ id: `p${index + 1}`, name, isBot: !humans.has(`p${index + 1}`) })),
    config,
  );
  engine.state.players.forEach((player, index) => {
    player.role = ROLES[index];
    player.alive = !(options.deadIds ?? []).includes(player.id);
    player.isBot = !humans.has(player.id);
  });
  engine.state.round = 2;

  if ((options.phase ?? "DAY_DISCUSSION") === "DAY_DISCUSSION") {
    engine.startDay(60_000, Date.now(), () => 0, null);
  } else {
    engine.setPhase("NIGHT", 30_000);
  }

  const room: Room = {
    ...ROOM_SCAFFOLD,
    code,
    hostId: "p1",
    status: "IN_GAME",
    members: engine.state.players.map((player) => ({
      playerId: player.id,
      name: player.name,
      ready: true,
      connected: true,
      isBot: player.isBot,
    })),
    config,
    engine,
    chatLog: [],
    createdAt: 0,
  };

  clearBotSession(code);
  startBotSession(room);
  return room;
}

/**
 * Gieo một chút nghi ngờ CÔNG KHAI cho mọi bot.
 *
 * Không nghi ai thì lõi cố tình im lặng, nên nếu không gieo gì thì mọi bài dưới
 * đây đều xanh vì cùng một lý do sai: chẳng con nào viết cả.
 */
async function seedSuspicion(room: Room): Promise<void> {
  const { botSessionFor } = await import("../src/bots/session-registry");
  const session = botSessionFor(room);
  for (const member of room.members) {
    if (!member.isBot) continue;
    const state = session.runtimeFor(member.playerId).state;
    for (const [index, other] of room.members.entries()) {
      if (other.playerId === member.playerId) continue;
      state.suspicion[other.playerId] = { score: 30 - index, reasons: [], lastUpdatedRound: 1 };
    }
  }
}

/** Chạy hết mọi timer đã hẹn. */
async function runTimers(): Promise<void> {
  await vi.runAllTimersAsync();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  clearBotSession("LTRBT");
  clearBotSession("LTRB2");
});

describe("khi nào bot được xếp lịch viết", () => {
  it("viết trong DAY_DISCUSSION khi add-on bật", async () => {
    const room = botRoom();
    await seedSuspicion(room);
    scheduleLastLetterBots(room);
    await runTimers();

    const drafts = lastLetterStateOf(room).drafts;
    expect(Object.keys(drafts).length).toBeGreaterThan(0);
    for (const draft of Object.values(drafts)) {
      expect(draft.text.length).toBeGreaterThan(0);
      expect(draft.text.length).toBeLessThanOrEqual(LAST_LETTER_MAX_LENGTH);
      expect(draft.updatedRound).toBe(2);
    }
  });

  it("không viết gì khi add-on tắt", async () => {
    const room = botRoom({ enabled: false });
    await seedSuspicion(room);
    scheduleLastLetterBots(room);
    await runTimers();

    expect(lastLetterStateOf(room).drafts).toEqual({});
  });

  it("không viết ngoài pha thảo luận", async () => {
    const room = botRoom({ phase: "NIGHT" });
    await seedSuspicion(room);
    scheduleLastLetterBots(room);
    await runTimers();

    expect(lastLetterStateOf(room).drafts).toEqual({});
  });

  it("bot đã chết không viết", async () => {
    const room = botRoom({ deadIds: ["p5", "p6"] });
    await seedSuspicion(room);
    scheduleLastLetterBots(room);
    await runTimers();

    const drafts = lastLetterStateOf(room).drafts;
    expect(drafts["p5"]).toBeUndefined();
    expect(drafts["p6"]).toBeUndefined();
  });

  it("không cướp lượt của người thật", async () => {
    const room = botRoom({ humanIds: ["p1", "p2"] });
    await seedSuspicion(room);
    scheduleLastLetterBots(room);
    await runTimers();

    const drafts = lastLetterStateOf(room).drafts;
    expect(drafts["p1"]).toBeUndefined();
    expect(drafts["p2"]).toBeUndefined();
  });
});

describe("tất định", () => {
  it("cùng seed và cùng trạng thái cho ra cùng bộ thư", async () => {
    const run = async (code: string) => {
      const room = botRoom({ code });
      await seedSuspicion(room);
      scheduleLastLetterBots(room);
      await runTimers();
      return lastLetterStateOf(room).drafts;
    };

    // Cùng mã phòng nghĩa là cùng seed session; hai lần chạy phải trùng khít.
    const first = await run("LTRBT");
    clearBotSession("LTRBT");
    const second = await run("LTRBT");

    expect(second).toEqual(first);
  });

  it("bot viết đi viết lại vẫn chỉ giữ MỘT bản, không tích thành nhiều thư", async () => {
    const room = botRoom();
    await seedSuspicion(room);
    scheduleLastLetterBots(room);
    await runTimers();
    const after = { ...lastLetterStateOf(room).drafts };

    scheduleLastLetterBots(room);
    await runTimers();

    expect(Object.keys(lastLetterStateOf(room).drafts)).toEqual(Object.keys(after));
  });
});

describe("không rò bí mật ra lá thư", () => {
  it("không lá thư nào của bot nhắc tới vai trò", async () => {
    const room = botRoom();
    await seedSuspicion(room);
    scheduleLastLetterBots(room);
    await runTimers();

    const all = Object.values(lastLetterStateOf(room).drafts)
      .map((draft) => draft.text)
      .join(" | ");
    expect(all).not.toMatch(/WEREWOLF|SEER|WITCH|GUARD|VILLAGER/);
    expect(all).not.toMatch(/Phù Thu[ỷy]|Bảo Vệ|đồng bọn/i);
  });

  it("không bot nào tự tố chính mình", async () => {
    const room = botRoom();
    await seedSuspicion(room);
    scheduleLastLetterBots(room);
    await runTimers();

    for (const [authorId, draft] of Object.entries(lastLetterStateOf(room).drafts)) {
      const authorName = room.members.find((member) => member.playerId === authorId)!.name;
      expect(draft.text).not.toContain(authorName);
    }
  });
});
