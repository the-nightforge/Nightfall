import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";
import type { VoiceConfig } from "../src/voice/livekit";
import {
  issueVoiceToken,
  resetVoiceState,
  setVoiceAdmin,
  voiceViewFor,
  type VoiceAdmin,
} from "../src/voice/service";

const CONFIG: VoiceConfig = {
  url: "wss://demo.livekit.cloud",
  apiKey: "APIkey123",
  apiSecret: "secret-value-long-enough-for-hmac",
  env: "prod",
};

function fakeAdmin(overrides: Partial<VoiceAdmin> = {}) {
  const created: string[] = [];
  const admin: VoiceAdmin = {
    createRoom: async (name) => {
      created.push(name);
    },
    updateParticipant: async () => undefined,
    removeParticipant: async () => undefined,
    deleteRoom: async () => undefined,
    ...overrides,
  };
  return { admin, created };
}

function gameState(phase: string): GameState {
  return {
    phase,
    round: 1,
    phaseEndsAt: null,
    players: [
      { id: "alive", name: "Sống", role: "VILLAGER", alive: true, isBot: false },
      { id: "ghost", name: "Ma", role: "SEER", alive: false, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG, voice: true },
    winner: null,
    night: {
      killTarget: null,
      actedWolves: [],
      skippedWolves: [],
      guardTarget: null,
      healTonight: false,
      poisonTarget: null,
      witchSkipped: false,
      seerResults: {},
    },
    votes: {},
    guardPrevious: null,
    healUsed: false,
    poisonUsed: false,
    lastNightDeaths: [],
    nightHistory: [],
    lastEliminated: null,
    trial: null,
    log: [],
  } as unknown as GameState;
}

function room(voice = true, phase = "DAY_DISCUSSION"): Room {
  return {
    code: "ABCDE",
    hostId: "alive",
    status: "IN_GAME",
    members: [
      { playerId: "alive", name: "Sống", ready: true, connected: true, isBot: false },
      { playerId: "ghost", name: "Ma", ready: true, connected: true, isBot: false },
      { playerId: "bot-1", name: "Bot", ready: true, connected: false, isBot: true },
    ],
    config: { ...DEFAULT_ROOM_CONFIG, voice },
    engine: new GameEngine(gameState(phase)),
    chatLog: [],
    createdAt: 0,
  } as unknown as Room;
}

beforeEach(() => resetVoiceState());
afterEach(() => {
  resetVoiceState();
  setVoiceAdmin(null);
});

describe("issueVoiceToken - các cửa kiểm tra", () => {
  it("server chưa cấu hình LiveKit", async () => {
    setVoiceAdmin(null);
    const result = await issueVoiceToken(room(), "alive");
    expect(result).toEqual({ ok: false, error: "Máy chủ chưa bật voice chat" });
  });

  it("phòng chưa bật voice", async () => {
    const { admin } = fakeAdmin();
    setVoiceAdmin(admin, CONFIG);
    const result = await issueVoiceToken(room(false), "alive");
    expect(result.ok).toBe(false);
  });

  it("không phải thành viên phòng", async () => {
    const { admin } = fakeAdmin();
    setVoiceAdmin(admin, CONFIG);
    const result = await issueVoiceToken(room(), "người-lạ");
    expect(result).toEqual({ ok: false, error: "Bạn không ở trong phòng này" });
  });

  it("bot không bao giờ được cấp token", async () => {
    const { admin } = fakeAdmin();
    setVoiceAdmin(admin, CONFIG);
    const result = await issueVoiceToken(room(), "bot-1");
    expect(result.ok).toBe(false);
  });
});

describe("issueVoiceToken - đường thành công", () => {
  it("tạo room tường minh trước khi cấp token", async () => {
    const { admin, created } = fakeAdmin();
    setVoiceAdmin(admin, CONFIG);

    const result = await issueVoiceToken(room(), "alive");

    // Tạo tường minh là BẮT BUỘC: LiveKit tự tạo room khi người đầu tiên vào,
    // và đường tự tạo đó không áp emptyTimeout mình muốn.
    expect(created).toEqual(["masoi-prod-ABCDE"]);
    expect(result.ok).toBe(true);
  });

  it("trả wss:// cho trình duyệt, không phải https://", async () => {
    const { admin } = fakeAdmin();
    setVoiceAdmin(admin, { ...CONFIG, url: "https://demo.livekit.cloud" });

    const result = await issueVoiceToken(room(), "alive");
    expect(result.ok && result.url).toBe("wss://demo.livekit.cloud");
  });

  it("token cấp cho NGƯỜI CHẾT vẫn ký được - nó không mang quyền nói", async () => {
    const { admin } = fakeAdmin();
    setVoiceAdmin(admin, CONFIG);

    // Người chết vẫn cần vào room để NGHE. Chặn ở khâu cấp token là chặn nhầm
    // chỗ; quyền nói bị chặn ở updateParticipant, không phải ở đây.
    const result = await issueVoiceToken(room(), "ghost");
    expect(result.ok).toBe(true);
  });

  it("tạo room hỏng thì báo lỗi chứ không cấp token cụt", async () => {
    const { admin } = fakeAdmin({
      createRoom: async () => {
        throw new Error("503 upstream");
      },
    });
    setVoiceAdmin(admin, CONFIG);

    const result = await issueVoiceToken(room(), "alive");
    expect(result.ok).toBe(false);
  });
});

describe("voiceViewFor - trường voice trong snapshot", () => {
  it("chưa cấu hình server thì enabled=false", () => {
    setVoiceAdmin(null);
    expect(voiceViewFor(room(), "alive").enabled).toBe(false);
  });

  it("ban ngày: người sống canPublish, người chết thì không", () => {
    const { admin } = fakeAdmin();
    setVoiceAdmin(admin, CONFIG);

    expect(voiceViewFor(room(), "alive")).toEqual({
      enabled: true,
      canPublish: true,
      roomName: "masoi-prod-ABCDE",
    });
    expect(voiceViewFor(room(), "ghost").canPublish).toBe(false);
  });

  it("phòng tắt voice thì canPublish luôn false dù còn sống", () => {
    const { admin } = fakeAdmin();
    setVoiceAdmin(admin, CONFIG);
    expect(voiceViewFor(room(false), "alive")).toMatchObject({
      enabled: false,
      canPublish: false,
    });
  });

  it("GAME_OVER: cả người chết cũng được nói", () => {
    const { admin } = fakeAdmin();
    setVoiceAdmin(admin, CONFIG);
    expect(voiceViewFor(room(true, "GAME_OVER"), "ghost").canPublish).toBe(true);
  });
});
