import { describe, expect, it, vi } from "vitest";

/*
 * Redis chết là chuyện thường ngày, và `redis.ts` cam kết nuốt nó: mọi hàm ở
 * đó bọc try/catch để một lần chớp mắt của Redis không làm hỏng thao tác đang
 * chạy. Test này gác chính lời cam kết đó.
 */
const behavior = vi.hoisted(() => ({ down: true }));

vi.mock("ioredis", () => {
  class FakeRedis {
    status = "ready";
    on(): this {
      return this;
    }
    async get(): Promise<string | null> {
      if (behavior.down) throw new Error("ECONNREFUSED");
      return "ABCDE";
    }
    async set(): Promise<string> {
      if (behavior.down) throw new Error("ECONNREFUSED");
      return "OK";
    }
    async del(): Promise<number> {
      if (behavior.down) throw new Error("ECONNREFUSED");
      return 1;
    }
  }
  return { default: FakeRedis };
});

const { getPlayerRoom, getSession, updateSessionRoom } = await import("../src/redis");

describe("Redis không kết nối được", () => {
  it("getPlayerRoom trả null thay vì ném — findRoomOf dựa vào điều đó", async () => {
    behavior.down = true;
    await expect(getPlayerRoom("player-1")).resolves.toBeNull();
  });

  it("getSession trả null thay vì ném", async () => {
    behavior.down = true;
    await expect(getSession("hash")).resolves.toBeNull();
  });

  it("updateSessionRoom không ném", async () => {
    behavior.down = true;
    await expect(updateSessionRoom("player-1", "ABCDE")).resolves.toBeUndefined();
  });

  it("getPlayerRoom vẫn trả mã phòng khi Redis khoẻ", async () => {
    behavior.down = false;
    await expect(getPlayerRoom("player-1")).resolves.toBe("ABCDE");
  });
});
