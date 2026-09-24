import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";

/**
 * Chạy script CAS trên Redis THẬT. Các test khác mock `redis.eval` bằng một
 * bản dựng lại bằng JS, nên chúng kiểm bản dựng lại chứ không kiểm Lua.
 *
 * Chỉ chạy khi REDIS_INTEGRATION=1. Job `e2e` của CI đặt biến này, dùng Redis
 * service của chính job đó. Chạy tay:
 *   npm run dev:infra
 *   REDIS_INTEGRATION=1 REDIS_URL=redis://127.0.0.1:6380 npx vitest run tests/persistence-cas-redis.test.ts
 *
 * Import động trong `beforeAll`: import tĩnh `../src/redis` sẽ mở kết nối
 * ngay cả khi bộ test bị bỏ qua.
 */
const enabled = process.env.REDIS_INTEGRATION === "1";
const CODE = "ZZCAS";

describe.skipIf(!enabled)("script CAS trên Redis thật", () => {
  let store: typeof import("../src/persistence/redis-store");
  let redis: (typeof import("../src/redis"))["redis"];
  let version: (typeof import("../src/persistence/schema"))["PERSISTENCE_VERSION"];

  beforeAll(async () => {
    store = await import("../src/persistence/redis-store");
    ({ redis } = await import("../src/redis"));
    ({ PERSISTENCE_VERSION: version } = await import("../src/persistence/schema"));
  });

  beforeEach(async () => {
    await redis.del(`room:${CODE}`, `room:${CODE}:seq`);
  });

  afterAll(async () => {
    await redis.del(`room:${CODE}`, `room:${CODE}:seq`);
    await redis.quit();
  });

  function envelope(opSeq: number) {
    return {
      persistenceVersion: version as typeof version,
      savedAt: 1_000,
      opSeq,
      room: {
        code: CODE,
        hostId: "p1",
        status: "LOBBY" as const,
        members: [
          {
            playerId: "p1",
            name: "N1",
            ready: false,
            connected: true,
            disconnectedAt: null,
            isBot: false,
            avatarUrl: null,
          },
        ],
        config: { ...DEFAULT_ROOM_CONFIG },
        chatLog: [],
        createdAt: 1,
        engineState: null,
        gameId: null,
        resultWritten: false,
        pendingStep: null,
        phaseSeq: 0,
        botSession: null,
        governorCalls: 0,
        discussionSkipVotes: [],
        discussionRun: null,
      },
    };
  }

  async function storedOpSeq(): Promise<number | null> {
    const result = await store.loadEnvelope(CODE);
    return result.status === "ok" ? result.envelope.opSeq : null;
  }

  it("bỏ lời ghi mang opSeq cũ hơn", async () => {
    await store.saveEnvelope(envelope(5), 60);
    await store.saveEnvelope(envelope(3), 60);

    expect(await storedOpSeq()).toBe(5);
  });

  it("nhận lời ghi bằng hoặc mới hơn, và khoá seq có TTL", async () => {
    await store.saveEnvelope(envelope(5), 60);
    await store.saveEnvelope(envelope(5), 60);
    await store.saveEnvelope(envelope(6), 60);

    expect(await storedOpSeq()).toBe(6);
    expect(await redis.get(`room:${CODE}:seq`)).toBe("6");
    expect(await redis.ttl(`room:${CODE}:seq`)).toBeGreaterThan(0);
  });

  it("envelope ghi từ trước bản này (chưa có khoá seq) bị lời ghi kế tiếp thay", async () => {
    await redis.set(`room:${CODE}`, JSON.stringify(envelope(40)), "EX", 60);

    await store.saveEnvelope(envelope(41), 60);

    expect(await storedOpSeq()).toBe(41);
  });

  it("xoá phòng xoá cả khoá seq", async () => {
    await store.saveEnvelope(envelope(9), 60);

    await store.deleteEnvelope(CODE);

    expect(await redis.exists(`room:${CODE}`, `room:${CODE}:seq`)).toBe(0);
  });
});
