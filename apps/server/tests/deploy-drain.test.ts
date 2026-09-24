import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameEngine } from "@masoi/game-engine";

/**
 * File riêng vì `store.ts` phải là hàng THẬT: hai hàm dưới đọc thẳng bản đồ
 * phòng trong RAM. Chỉ Redis là giả.
 */
const written = vi.hoisted(() => ({ keys: [] as string[] }));

vi.mock("../src/redis", () => ({
  redis: {
    set: async () => "OK",
    del: async () => 1,
    get: async () => null,
    exists: async () => 0,
    // Khoá đầu tiên luôn là khoá phòng, dù script CAS nhận một hay hai khoá.
    eval: async (_script: string, _numKeys: number, key: string) => {
      written.keys.push(key);
      return 1;
    },
  },
}));

const { activeGameCount, allRooms, createRoom, flushAllRooms, removeRoom } = await import(
  "../src/rooms/store"
);

function human(playerId: string, connected = true) {
  return { playerId, name: playerId, ready: true, connected, isBot: false };
}

function bot(playerId: string) {
  return { playerId, name: playerId, ready: true, connected: true, isBot: true };
}

function inGame(code: string, phase: string, members = [human(`${code}-h`)]) {
  const room = createRoom(code, members[0]);
  room.members = members;
  room.status = "IN_GAME";
  room.engine = { state: { phase } } as unknown as GameEngine;
  return room;
}

beforeEach(() => {
  for (const room of allRooms()) removeRoom(room.code);
  written.keys = [];
});

describe("flushAllRooms", () => {
  it("ghi mọi phòng đang trong RAM", async () => {
    createRoom("AAAAA", human("a"));
    createRoom("BBBBB", human("b"));

    await flushAllRooms();

    expect(written.keys.sort()).toEqual(["room:AAAAA", "room:BBBBB"]);
  });

  it("một phòng ghi hỏng không chặn phòng khác và không ném ra ngoài", async () => {
    // Engine giả không có `getState`, nên dựng envelope cho phòng này sẽ ném.
    inGame("CCCCC", "NIGHT");
    createRoom("DDDDD", human("d"));

    await expect(flushAllRooms()).resolves.toBeUndefined();
    expect(written.keys).toContain("room:DDDDD");
  });
});

describe("activeGameCount", () => {
  it("đếm ván đang chạy có người thật đang kết nối", () => {
    inGame("AAAAA", "NIGHT");
    inGame("BBBBB", "DAY_DISCUSSION");

    expect(activeGameCount()).toBe(2);
  });

  it("bỏ qua sảnh chờ, ván đã xong, phòng chỉ còn bot, phòng mà mọi người thật đã rớt", () => {
    createRoom("LOBBY", human("l"));
    inGame("OVERR", "GAME_OVER");
    inGame("BOTSS", "NIGHT", [bot("b1"), bot("b2")]);
    inGame("GONEE", "NIGHT", [human("g", false), bot("g-b")]);

    expect(activeGameCount()).toBe(0);
  });
});
