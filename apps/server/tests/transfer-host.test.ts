import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/redis", () => ({
  redis: { get: async () => null, set: async () => "OK", del: async () => 1 },
  getPlayerRoom: async () => null,
  updateSessionRoom: async () => undefined,
}));
vi.mock("../src/db", () => ({
  prisma: { player: { findUnique: async () => null }, gameResult: { create: async () => undefined } },
}));
vi.mock("../src/voice/service", () => ({
  destroyVoiceRoom: async () => undefined,
  syncVoicePermissions: async () => undefined,
  voiceViewFor: () => undefined,
  dropVoiceParticipant: async () => undefined,
}));

const { createRoom, getRoom, removeRoom } = await import("../src/rooms/store");
const { roomService } = await import("../src/rooms/service");

const CODE = "TRANSFER";
const HOST = "host-1";
const GUEST = "guest-2";

function member(id: string, name: string, isBot = false) {
  return {
    playerId: id,
    name,
    ready: true,
    connected: true,
    disconnectedAt: null,
    isBot,
  } as never;
}

beforeEach(() => {
  createRoom(CODE, {
    playerId: HOST,
    name: "Chu phong",
    ready: true,
    connected: true,
    disconnectedAt: null,
    isBot: false,
  } as never);
  getRoom(CODE)!.members.push(member(GUEST, "Khach"));
});

afterEach(() => {
  removeRoom(CODE);
});

describe("transferHost", () => {
  it("chu phong chuyen cho thanh vien that thi hostId doi", () => {
    roomService.transferHost(HOST, GUEST);
    expect(getRoom(CODE)!.hostId).toBe(GUEST);
  });

  it("nguoi khong phai chu phong khong chuyen duoc", () => {
    expect(() => roomService.transferHost(GUEST, HOST)).toThrow(/chủ phòng/i);
    expect(getRoom(CODE)!.hostId).toBe(HOST);
  });

  it("khong chuyen cho bot", () => {
    const room = getRoom(CODE)!;
    room.members.push(member("bot-1", "Bot", true));
    expect(() => roomService.transferHost(HOST, "bot-1")).toThrow(/bot/i);
    expect(room.hostId).toBe(HOST);
  });

  it("khong tu chuyen cho chinh minh", () => {
    expect(() => roomService.transferHost(HOST, HOST)).toThrow();
    expect(getRoom(CODE)!.hostId).toBe(HOST);
  });

  it("tu choi nguoi khong trong phong", () => {
    expect(() => roomService.transferHost(HOST, "ghost")).toThrow(/tồn tại|trong phòng/i);
    expect(getRoom(CODE)!.hostId).toBe(HOST);
  });

  it("giua van khong chuyen duoc", () => {
    getRoom(CODE)!.status = "IN_GAME";
    expect(() => roomService.transferHost(HOST, GUEST)).toThrow(/bắt đầu|trước khi/i);
    expect(getRoom(CODE)!.hostId).toBe(HOST);
  });
});
