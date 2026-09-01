import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";

const store = vi.hoisted(() => ({
  data: new Map<string, string>(),
  ttl: new Map<string, number>(),
  down: false,
}));

vi.mock("../src/redis", () => ({
  redis: {
    get: async (key: string) => {
      if (store.down) throw new Error("ECONNREFUSED");
      return store.data.get(key) ?? null;
    },
    set: async (key: string, value: string, _ex: string, seconds: number) => {
      if (store.down) throw new Error("ECONNREFUSED");
      store.data.set(key, value);
      store.ttl.set(key, seconds);
      return "OK";
    },
    del: async (key: string) => {
      if (store.down) throw new Error("ECONNREFUSED");
      return store.data.delete(key) ? 1 : 0;
    },
    eval: async (
      _script: string,
      _keys: number,
      key: string,
      value: string,
      _opSeq: string,
      seconds: string,
    ) => {
      if (store.down) throw new Error("ECONNREFUSED");
      const existing = store.data.get(key);
      if (existing) {
        try {
          const current = JSON.parse(existing) as { opSeq?: number };
          const next = JSON.parse(value) as { opSeq?: number };
          if ((current.opSeq ?? -1) > (next.opSeq ?? -1)) return 0;
        } catch {
          /* bản hỏng thì ghi đè được */
        }
      }
      store.data.set(key, value);
      store.ttl.set(key, Number(seconds));
      return 1;
    },
  },
}));

const {
  ROOM_TTL_SECONDS,
  deleteEnvelope,
  loadEnvelope,
  saveEnvelope,
} = await import("../src/persistence/redis-store");
const { PERSISTENCE_VERSION } = await import("../src/persistence/schema");

function envelope(opSeq = 1, code = "ABCDE") {
  return {
    persistenceVersion: PERSISTENCE_VERSION,
    savedAt: 1_000,
    opSeq,
    room: {
      code,
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

beforeEach(() => {
  store.data.clear();
  store.ttl.clear();
  store.down = false;
});

describe("đọc snapshot", () => {
  it("trả missing khi chưa có gì", async () => {
    expect(await loadEnvelope("ABCDE")).toEqual({ status: "missing" });
  });

  it("trả ok với envelope đã validate", async () => {
    await saveEnvelope(envelope(2), ROOM_TTL_SECONDS);

    const result = await loadEnvelope("ABCDE");

    expect(result.status).toBe("ok");
    expect(result.status === "ok" && result.envelope.opSeq).toBe(2);
  });

  it("phân biệt Redis mất kết nối với phòng không tồn tại", async () => {
    store.down = true;

    expect(await loadEnvelope("ABCDE")).toEqual({ status: "unavailable" });
  });

  it("coi JSON hỏng là corrupt và cách ly key", async () => {
    store.data.set("room:ABCDE", "{ không phải json");

    const result = await loadEnvelope("ABCDE");

    expect(result.status).toBe("corrupt");
    expect(store.data.has("room:ABCDE")).toBe(false);
    expect([...store.data.keys()].some((k) => k.startsWith("room:ABCDE:quarantine"))).toBe(true);
  });

  it("coi version lạ là corrupt và không đoán nghĩa", async () => {
    store.data.set("room:ABCDE", JSON.stringify({ ...envelope(), persistenceVersion: 99 }));

    const result = await loadEnvelope("ABCDE");

    expect(result.status).toBe("corrupt");
    expect([...store.data.keys()].some((k) => k.startsWith("room:ABCDE:quarantine"))).toBe(true);
  });

  it("coi envelope sai hình dạng là corrupt", async () => {
    const broken = envelope();
    (broken.room as unknown as Record<string, unknown>).members = "không phải mảng";
    store.data.set("room:ABCDE", JSON.stringify(broken));

    expect((await loadEnvelope("ABCDE")).status).toBe("corrupt");
  });

  it("bản cũ chưa có persistenceVersion cũng là corrupt, không đoán", async () => {
    store.data.set("room:ABCDE", JSON.stringify({ code: "ABCDE", members: [], chatLog: [] }));

    expect((await loadEnvelope("ABCDE")).status).toBe("corrupt");
  });
});

describe("ghi snapshot", () => {
  it("đặt TTL cho key phòng", async () => {
    await saveEnvelope(envelope(), ROOM_TTL_SECONDS);

    expect(store.ttl.get("room:ABCDE")).toBe(ROOM_TTL_SECONDS);
  });

  it("bỏ qua lời ghi mang opSeq cũ hơn bản đang lưu", async () => {
    await saveEnvelope(envelope(5), ROOM_TTL_SECONDS);
    await saveEnvelope(envelope(3), ROOM_TTL_SECONDS);

    const result = await loadEnvelope("ABCDE");

    expect(result.status === "ok" && result.envelope.opSeq).toBe(5);
  });

  it("Redis lỗi lúc ghi không ném ra ngoài", async () => {
    store.down = true;

    await expect(saveEnvelope(envelope(), ROOM_TTL_SECONDS)).resolves.toBeUndefined();
  });
});

describe("xoá snapshot", () => {
  it("xoá key phòng", async () => {
    await saveEnvelope(envelope(), ROOM_TTL_SECONDS);

    await deleteEnvelope("ABCDE");

    expect(store.data.has("room:ABCDE")).toBe(false);
  });
});
