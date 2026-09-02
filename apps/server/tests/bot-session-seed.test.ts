import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";
import { ROOM_SCAFFOLD } from "./helpers/room";
import { clearBotSession, startBotSession } from "../src/bots/session-registry";

vi.mock("../src/redis", () => ({
  redis: { set: async () => undefined, get: async () => null, del: async () => undefined },
}));
vi.mock("../src/db", () => ({ prisma: {} }));

/**
 * Hạt của một ván phải đi theo VÁN, không theo PHÒNG.
 *
 * `room.createdAt` bất biến suốt đời phòng, nên gieo bằng nó khiến ván thứ hai
 * trong cùng phòng - tức mỗi lần bấm "Chơi lại", luồng phổ biến nhất - mở lại
 * đúng dòng số của ván trước: cùng tie-break, cùng biến thiên câu chữ, cùng
 * nhịp phát biểu. `gameId` sinh mới ở mỗi `startGame` và đã được persist, nên
 * nó vừa cho mỗi ván một dòng riêng vừa giữ nguyên tính tái lập.
 */
function room(gameId: string | null): Room {
  return {
    ...ROOM_SCAFFOLD,
    code: "ROOM1",
    hostId: "human",
    status: "IN_GAME",
    members: [
      { playerId: "bot-a", name: "Bot A", ready: true, connected: false, isBot: true },
      { playerId: "human", name: "Người", ready: true, connected: true, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: null,
    chatLog: [],
    createdAt: 1_000,
    gameId,
  };
}

describe("hạt của phiên bot", () => {
  it("hai ván trong CÙNG một phòng có hạt khác nhau", () => {
    const first = startBotSession(room("game-1")).seed;
    clearBotSession("ROOM1");
    const second = startBotSession(room("game-2")).seed;
    clearBotSession("ROOM1");

    expect(first).not.toBe(second);
  });

  it("cùng một gameId thì tái lập đúng hạt cũ", () => {
    const a = startBotSession(room("game-1")).seed;
    clearBotSession("ROOM1");
    const b = startBotSession(room("game-1")).seed;
    clearBotSession("ROOM1");

    expect(a).toBe(b);
  });

  it("phòng chưa có gameId vẫn gieo được - phòng cũ trong Redis không có nó", () => {
    const seed = startBotSession(room(null)).seed;
    clearBotSession("ROOM1");

    expect(seed).toContain("ROOM1");
    expect(seed.length).toBeGreaterThan("ROOM1".length);
  });
});
