import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/redis", () => ({
  redis: { get: async () => null, set: async () => "OK", del: async () => 1 },
  getPlayerRoom: async () => null,
  updateSessionRoom: async () => undefined,
}));

import { buildSnapshot } from "../src/rooms/snapshot";
import { createRoom, removeRoom, type RoomMember } from "../src/rooms/store";
import { createMemoryStorage } from "../src/storage/memory";
import { resetObjectStorage, setObjectStorage } from "../src/storage";

const DATA_URL = "data:image/webp;base64,UklGRhwAAABXRUJQ";

function member(playerId: string, avatarUrl: string | null): RoomMember {
  return {
    playerId,
    name: playerId,
    ready: false,
    connected: true,
    disconnectedAt: null,
    isBot: false,
    avatarUrl,
  };
}

beforeEach(() => {
  resetObjectStorage();
});

afterEach(() => {
  removeRoom("SNAPS");
  resetObjectStorage();
});

describe("Snapshot không mang base64 khi storage đã bật", () => {
  it("data URL bị lọc khỏi cả you lẫn players", () => {
    setObjectStorage(createMemoryStorage());
    const room = createRoom("SNAPS", member("p1", DATA_URL));
    room.members.push(member("p2", DATA_URL));

    const snapshot = buildSnapshot(room, "p1");

    expect(snapshot.you?.avatarUrl ?? null).toBeNull();
    expect(snapshot.players.map((p) => p.avatarUrl ?? null)).toEqual([null, null]);
  });

  it("URL https đi qua nguyên vẹn", () => {
    setObjectStorage(createMemoryStorage());
    const room = createRoom("SNAPS", member("p1", "https://cdn.test/masoi/a.webp"));

    const snapshot = buildSnapshot(room, "p1");

    expect(snapshot.you?.avatarUrl).toBe("https://cdn.test/masoi/a.webp");
  });

  it("storage CHƯA cấu hình thì data URL cũ vẫn hiện - dev không mất avatar", () => {
    const room = createRoom("SNAPS", member("p1", DATA_URL));

    const snapshot = buildSnapshot(room, "p1");

    expect(snapshot.you?.avatarUrl).toBe(DATA_URL);
  });
});
