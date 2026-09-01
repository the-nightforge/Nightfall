import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ROOM_CONFIG, type RoomConfig } from "@masoi/shared";

const stored = vi.hoisted(() => ({ raw: null as string | null, quarantined: [] as string[] }));

vi.mock("../src/redis", () => ({
  redis: {
    get: async () => stored.raw,
    set: async (key: string, value: string) => {
      if (key.includes("quarantine")) stored.quarantined.push(value);
      return "OK";
    },
    del: async () => {
      stored.raw = null;
      return 1;
    },
    eval: async () => 1,
    exists: async () => (stored.raw ? 1 : 0),
  },
}));

vi.mock("../src/voice/service", () => ({
  destroyVoiceRoom: async () => undefined,
  syncVoicePermissions: async () => undefined,
  voiceViewFor: () => null,
}));

import { PERSISTENCE_VERSION } from "../src/persistence/schema";
import { loadRoomSnapshot, removeRoom } from "../src/rooms/store";

function envelope(config: Record<string, unknown>): string {
  return JSON.stringify({
    persistenceVersion: PERSISTENCE_VERSION,
    savedAt: 0,
    opSeq: 1,
    room: {
      code: "CURSE",
      hostId: "host",
      status: "LOBBY",
      members: [
        { playerId: "host", name: "Chủ phòng", ready: true, connected: true, isBot: false },
      ],
      config,
      engineState: null,
      chatLog: [],
      createdAt: 0,
      gameId: null,
      resultWritten: false,
      pendingStep: null,
      phaseSeq: 0,
      botSession: null,
      governorCalls: 0,
      discussionSkipVotes: [],
      discussionRun: null,
    },
  });
}

afterEach(() => {
  removeRoom("CURSE");
  stored.raw = null;
  stored.quarantined.length = 0;
});

describe("config Kẻ Nguyền Rủa trong snapshot", () => {
  it("giữ nguyên cursed đã bật của phòng", async () => {
    stored.raw = envelope({ ...DEFAULT_ROOM_CONFIG, cursed: true });

    const result = await loadRoomSnapshot("CURSE");

    expect(result.status).toBe("ok");
    expect(result.status === "ok" && result.room.config.cursed).toBe(true);
  });

  it("config thiếu trường bắt buộc là snapshot hỏng, không phải chỗ để đoán", async () => {
    const legacy: Partial<RoomConfig> = { ...DEFAULT_ROOM_CONFIG };
    delete legacy.cursed;
    stored.raw = envelope(legacy as Record<string, unknown>);

    const result = await loadRoomSnapshot("CURSE");

    // Trước đây chỗ này im lặng lấp `false`. Với snapshot có version thì một
    // trường bắt buộc bị thiếu nghĩa là dữ liệu không còn tin được, và đoán bừa
    // ở tầng này là cách một ván chạy tiếp bằng luật sai.
    expect(result.status).toBe("corrupt");
    expect(stored.quarantined).toHaveLength(1);
  });

  it("payload không có persistenceVersion bị cách ly chứ không được nạp", async () => {
    stored.raw = JSON.stringify({
      code: "CURSE",
      hostId: "host",
      status: "LOBBY",
      members: [],
      config: { ...DEFAULT_ROOM_CONFIG },
      engineState: null,
      chatLog: [],
      createdAt: 0,
    });

    const result = await loadRoomSnapshot("CURSE");

    expect(result.status).toBe("corrupt");
    expect(stored.quarantined).toHaveLength(1);
  });
});
