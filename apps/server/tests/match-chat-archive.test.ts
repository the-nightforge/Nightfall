import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ROOM_CONFIG, type ChatMessage } from "@masoi/shared";
import { GameEngine } from "@masoi/game-engine";
import type { Room } from "../src/rooms/store";
import { ROOM_SCAFFOLD } from "./helpers/room";

const db = vi.hoisted(() => ({ created: [] as Array<Record<string, unknown>> }));

vi.mock("../src/db", () => ({
  prisma: {
    gameResult: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        db.created.push(data);
        return data;
      },
    },
  },
}));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));

vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: () => undefined,
  persistRoom: async () => undefined,
  setRoomTimer: () => undefined,
}));

vi.mock("../src/redis", () => ({ redis: { status: "ready" } }));

const { pushChat } = await import("../src/rooms/snapshot");
const { MAX_ARCHIVED_MESSAGES } = await import("../src/game/match-chat");
const { writeGameResultOnce } = await import("../src/game/game-result");

/**
 * Bàn 8 người TOÀN BOT - đúng cấu hình mà việc kiểm tra này nói về.
 *
 * Dựng engine thật chứ không giả lập state: `round` và `phase` đi vào từng dòng
 * chat là đọc thẳng từ engine, nên một engine giả sẽ kiểm chính cái giả đó.
 */
function botTable(overrides: Partial<Room> = {}): Room {
  const players = Array.from({ length: 8 }, (_, index) => ({
    id: `b${index + 1}`,
    name: `Bot ${index + 1}`,
    isBot: true,
  }));
  const config = { ...DEFAULT_ROOM_CONFIG, werewolves: 2 };
  const engine = GameEngine.create(players, config, 1_000);

  return {
    ...ROOM_SCAFFOLD,
    code: "BOT08",
    hostId: "b1",
    status: "IN_GAME",
    members: players.map((player) => ({
      playerId: player.id,
      name: player.name,
      ready: true,
      connected: true,
      isBot: true,
    })),
    config,
    engine,
    chatLog: [],
    createdAt: Date.now() - 300_000,
    startedAt: Date.now() - 300_000,
    gameId: "game-bot-08",
    ...overrides,
  };
}

function say(room: Room, index: number, channel: string, text: string): void {
  const message: ChatMessage = {
    id: `m${index}`,
    channel,
    playerId: room.members[index % room.members.length]!.playerId,
    playerName: room.members[index % room.members.length]!.name,
    text,
    // Cùng một mốc thời gian cho MỌI tin: đây chính là ca mà `createdAt` không
    // phân biệt nổi, và là lý do `seq` tồn tại.
    at: 5_000,
  };
  pushChat(room, message);
}

beforeEach(() => {
  db.created.length = 0;
});

describe("sổ chat của ván", () => {
  it("ghim mọi kênh kèm vòng và pha lúc nói", () => {
    const room = botTable();
    room.engine!.state.round = 2;
    room.engine!.state.phase = "DAY_DISCUSSION";
    say(room, 0, "day", "tôi là tiên tri");
    room.engine!.state.phase = "NIGHT";
    say(room, 1, "wolves", "ăn thằng 3 đi");
    say(room, 2, "dead", "tiếc quá");

    expect(room.matchChat?.map((m) => [m.seq, m.channel, m.round, m.phase])).toEqual([
      [0, "day", 2, "DAY_DISCUSSION"],
      [1, "wolves", 2, "NIGHT"],
      [2, "dead", 2, "NIGHT"],
    ]);
  });

  it("giữ trọn ván kể cả khi chatLog đã bị cắt đầu còn 100", () => {
    // Đây là lý do sổ này tồn tại tách khỏi `chatLog`. Không có nó thì một ván
    // dài chỉ lưu được 100 câu cuối - tức mất đúng phần mở đầu, chỗ người ta
    // khai vai.
    const room = botTable();
    for (let index = 0; index < 250; index += 1) say(room, index, "day", `câu ${index}`);

    expect(room.chatLog).toHaveLength(100);
    expect(room.matchChat).toHaveLength(250);
    expect(room.matchChat![0]!.text).toBe("câu 0");
    expect(room.matchChat!.map((m) => m.seq)).toEqual(room.matchChat!.map((_, i) => i));
  });

  it("không ghim gì khi phòng còn ở sảnh chờ", () => {
    const room = botTable({ engine: null, status: "LOBBY", gameId: null });
    say(room, 0, "lobby", "chào cả nhà");

    expect(room.chatLog).toHaveLength(1);
    expect(room.matchChat ?? []).toEqual([]);
  });

  it("không ghim gì sau khi ván đã lật bài", () => {
    // Kết quả có thể đã ghi xuống DB rồi; thêm vào lúc này chỉ tạo ra một khúc
    // không bao giờ được lưu, và `seq` sẽ nói dối về độ dài thật của ván.
    const room = botTable();
    room.engine!.finishGame("village", 9_000);
    say(room, 0, "lobby", "hay quá");

    expect(room.matchChat ?? []).toEqual([]);
  });

  it("dừng ở trần thay vì cắt đầu: khúc giữ lại phải liền mạch từ đầu ván", () => {
    const room = botTable();
    for (let index = 0; index < MAX_ARCHIVED_MESSAGES + 25; index += 1) {
      say(room, index, "day", `câu ${index}`);
    }

    expect(room.matchChat).toHaveLength(MAX_ARCHIVED_MESSAGES);
    expect(room.matchChat![0]!.text).toBe("câu 0");
    expect(room.matchChat!.at(-1)!.seq).toBe(MAX_ARCHIVED_MESSAGES - 1);
  });
});

describe("ghi sổ chat cùng kết quả ván", () => {
  it("ván bot 8 người: đủ tin, đúng thứ tự, trong CÙNG một lệnh với kết quả", async () => {
    const room = botTable();
    room.engine!.state.round = 1;
    const script: Array<[string, string]> = [
      ["day", "tôi là tt nhé"],
      ["day", "nhận pt, tối qua cứu b5"],
      ["wolves", "ăn b2 đi"],
      ["dead", "b2 die rồi"],
      ["day", "b7 là sw đó"],
    ];
    script.forEach(([channel, text], index) => say(room, index, channel, text));
    room.engine!.finishGame("wolves", 9_000);

    await writeGameResultOnce(room);

    expect(db.created).toHaveLength(1);
    const created = db.created[0]!;
    // Một lệnh create duy nhất mang cả hai: Prisma gói nested-create vào một
    // transaction, nên hoặc có cả kết quả lẫn log, hoặc không có gì.
    expect(created.winner).toBe("wolves");
    const chat = (created.chat as { create: Array<Record<string, unknown>> }).create;
    expect(chat.map((row) => [row.seq, row.channel, row.text])).toEqual(
      script.map(([channel, text], index) => [index, channel, text]),
    );
    expect(chat.every((row) => row.createdAt instanceof Date)).toBe(true);
  });

  it("ván KHÔNG có bot nào cũng lưu - đó mới là nguồn slang người thật", async () => {
    const room = botTable();
    for (const member of room.members) member.isBot = false;
    for (const player of room.engine!.state.players) player.isBot = false;
    say(room, 0, "day", "mình là bv nha");
    room.engine!.finishGame("village", 9_000);

    await writeGameResultOnce(room);

    const chat = (db.created[0]!.chat as { create: Array<Record<string, unknown>> }).create;
    expect(chat).toHaveLength(1);
    expect(chat[0]!.text).toBe("mình là bv nha");
  });

  it("ván không ai nói câu nào vẫn ghi được kết quả, chỉ là log rỗng", async () => {
    const room = botTable();
    room.engine!.finishGame("village", 9_000);

    await writeGameResultOnce(room);

    expect(db.created).toHaveLength(1);
    expect((db.created[0]!.chat as { create: unknown[] }).create).toEqual([]);
  });

  it("sắp theo seq chứ không theo mốc thời gian", async () => {
    // Mọi tin trong bài này có cùng `at`, nên nếu chỗ ghi sắp theo thời gian
    // thì thứ tự trả về sẽ do thứ tự ngẫu nhiên của mảng quyết định.
    const room = botTable();
    say(room, 0, "day", "một");
    say(room, 1, "day", "hai");
    say(room, 2, "day", "ba");
    room.matchChat!.reverse();
    room.engine!.finishGame("village", 9_000);

    await writeGameResultOnce(room);

    const chat = (db.created[0]!.chat as { create: Array<Record<string, unknown>> }).create;
    expect(chat.map((row) => row.text)).toEqual(["một", "hai", "ba"]);
  });
});
