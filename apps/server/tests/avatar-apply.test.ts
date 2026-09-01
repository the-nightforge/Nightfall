import { afterEach, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({
  persist: vi.fn(async () => undefined),
  broadcast: vi.fn(),
}));

vi.mock("../src/redis", () => ({
  redis: { get: async () => null, set: async () => "OK", del: async () => 1 },
  getPlayerRoom: async () => null,
  updateSessionRoom: async () => undefined,
}));

vi.mock("../src/rooms/broadcast", () => ({ broadcastRoom: spies.broadcast }));

import { applyAvatarToRoom } from "../src/rooms/apply-avatar";
import { createRoom, getRoom, removeRoom, type RoomMember } from "../src/rooms/store";

function member(playerId: string): RoomMember {
  return {
    playerId,
    name: playerId,
    ready: false,
    connected: true,
    disconnectedAt: null,
    isBot: false,
    avatarUrl: null,
  };
}

afterEach(() => {
  removeRoom("AVATR");
  spies.broadcast.mockClear();
});

describe("applyAvatarToRoom", () => {
  it("cập nhật member rồi phát lại snapshot cho cả phòng", async () => {
    createRoom("AVATR", member("p1"));

    await applyAvatarToRoom("p1", "https://cdn.test/a.webp");

    expect(getRoom("AVATR")!.members[0].avatarUrl).toBe("https://cdn.test/a.webp");
    expect(spies.broadcast).toHaveBeenCalledWith("AVATR");
  });

  it("xoá avatar đặt member về null và vẫn phát lại", async () => {
    const host = member("p1");
    host.avatarUrl = "https://cdn.test/a.webp";
    createRoom("AVATR", host);

    await applyAvatarToRoom("p1", null);

    expect(getRoom("AVATR")!.members[0].avatarUrl).toBeNull();
    expect(spies.broadcast).toHaveBeenCalledWith("AVATR");
  });

  it("người chơi không ở phòng nào thì không làm gì, không ném lỗi", async () => {
    await expect(applyAvatarToRoom("ngoài-phòng", "https://cdn.test/a.webp")).resolves.toBeUndefined();
    expect(spies.broadcast).not.toHaveBeenCalled();
  });
});
