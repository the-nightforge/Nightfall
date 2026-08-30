import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceConfig } from "../src/voice/livekit";
import {
  markVoiceJoined,
  resetVoiceState,
  setVoiceAdmin,
  type VoiceAdmin,
} from "../src/voice/service";

/**
 * File riêng vì `store.ts` phải là hàng THẬT ở đây.
 *
 * Mọi test vòng đời khác đều mock `../src/rooms/store`, nên nhánh
 * `removeRoom -> destroyVoiceRoom` không quan sát được từ chúng - đó chính là
 * lỗ hổng kiểm chứng mà file này bịt lại.
 */
vi.mock("../src/redis", () => ({
  redis: { set: async () => undefined, del: async () => undefined, get: async () => null },
}));

const { createRoom, removeRoom } = await import("../src/rooms/store");

const CONFIG: VoiceConfig = {
  url: "wss://demo.livekit.cloud",
  apiKey: "k",
  apiSecret: "sssssssssssssssssssssssssssssss",
  env: "prod",
};

function fakeAdmin() {
  const deleted: string[] = [];
  const admin: VoiceAdmin = {
    createRoom: async () => undefined,
    updateParticipant: async () => undefined,
    removeParticipant: async () => undefined,
    deleteRoom: async (name) => {
      deleted.push(name);
    },
  };
  return { admin, deleted };
}

beforeEach(() => resetVoiceState());
afterEach(() => {
  resetVoiceState();
  setVoiceAdmin(null);
});

describe("removeRoom là chốt chặn cuối của việc xoá phòng", () => {
  it("phòng biến mất thì room voice cũng biến mất", async () => {
    const { admin, deleted } = fakeAdmin();
    setVoiceAdmin(admin, CONFIG);

    createRoom("ZZZZZ", {
      playerId: "host",
      name: "Host",
      ready: true,
      connected: true,
      isBot: false,
    });
    markVoiceJoined("ZZZZZ", "host");

    removeRoom("ZZZZZ");
    await new Promise((resolve) => setImmediate(resolve));

    expect(deleted).toEqual(["masoi-prod-ZZZZZ"]);
  });

  it("chưa cấu hình voice thì xoá phòng vẫn chạy bình thường", async () => {
    setVoiceAdmin(null);
    createRoom("YYYYY", {
      playerId: "host",
      name: "Host",
      ready: true,
      connected: true,
      isBot: false,
    });
    expect(() => removeRoom("YYYYY")).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
  });
});
