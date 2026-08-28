import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ROOM_CONFIG, type RoomConfig } from "@masoi/shared";

const stored = vi.hoisted(() => ({ raw: null as string | null }));

vi.mock("../src/redis", () => ({
  redis: {
    get: async () => stored.raw,
    set: async () => "OK",
    del: async () => 1,
  },
}));

import { loadRoomFromRedis, removeRoom } from "../src/rooms/store";

function persistedRoom(config: Record<string, unknown>): string {
  return JSON.stringify({
    code: "CURSE",
    hostId: "host",
    status: "LOBBY",
    members: [{ playerId: "host", name: "Chủ phòng", ready: true, connected: true, isBot: false }],
    config,
    engineState: null,
    chatLog: [],
    createdAt: 0,
  });
}

afterEach(() => {
  removeRoom("CURSE");
  stored.raw = null;
});

describe("Chuẩn hoá config Kẻ Nguyền Rủa từ Redis", () => {
  it("config cũ thiếu cursed được chuẩn hoá thành false", async () => {
    const legacy: Partial<RoomConfig> = { ...DEFAULT_ROOM_CONFIG };
    delete legacy.cursed;
    stored.raw = persistedRoom(legacy as Record<string, unknown>);

    const room = await loadRoomFromRedis("CURSE");
    expect(room?.config.cursed).toBe(false);
    // Các trường cũ không được đụng vào khi chuẩn hoá.
    expect(room?.config.werewolves).toBe(DEFAULT_ROOM_CONFIG.werewolves);
    expect(room?.config.hunter).toBe(DEFAULT_ROOM_CONFIG.hunter);
  });

  it("giữ nguyên cursed đã bật của phòng cũ", async () => {
    stored.raw = persistedRoom({ ...DEFAULT_ROOM_CONFIG, cursed: true });

    const room = await loadRoomFromRedis("CURSE");
    expect(room?.config.cursed).toBe(true);
  });
});
