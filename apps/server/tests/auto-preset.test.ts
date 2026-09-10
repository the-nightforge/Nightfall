import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PRESET_DECKS, applyDeck, sameDeck } from "@masoi/shared";

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

const CODE = "AUTOPRESET";
const HOST = "host-auto";

function member(id: string, name: string, isBot = false) {
  return {
    playerId: id,
    name,
    ready: false,
    connected: true,
    disconnectedAt: null,
    isBot,
  } as never;
}

beforeEach(() => {
  createRoom(CODE, {
    playerId: HOST,
    name: "Chu phong",
    ready: false,
    connected: true,
    disconnectedAt: null,
    isBot: false,
  } as never);
});

afterEach(() => {
  removeRoom(CODE);
});

function fillTo(n: number) {
  const room = getRoom(CODE)!;
  while (room.members.length < n) {
    const i = room.members.length;
    room.members.push(member(`p${i}`, `Nguoi ${i}`));
  }
}

describe("auto-preset theo si so", () => {
  it("addBot 8 -> 9 nguoi thi ap preset 9 va giu mode/voice/giay", () => {
    const room = getRoom(CODE)!;
    fillTo(8);
    room.config = {
      ...applyDeck(room.config, PRESET_DECKS[8]!),
      mode: "chaos",
      voice: false,
      discussionSeconds: 99,
    };

    roomService.addBot(HOST);

    expect(room.members.length).toBe(9);
    expect(sameDeck(room.config, PRESET_DECKS[9]!)).toBe(true);
    expect(room.config.mode).toBe("chaos");
    expect(room.config.discussionSeconds).toBe(99);
  });

  it("deck custom van bi ghi de sang preset moi", () => {
    const room = getRoom(CODE)!;
    fillTo(8);
    room.config = {
      ...applyDeck(room.config, PRESET_DECKS[8]!),
      mode: "chaos",
    };
    room.config = { ...room.config, hunter: false, villagers: (room.config.villagers ?? 0) + 1 };

    roomService.addBot(HOST);

    expect(room.members.length).toBe(9);
    expect(sameDeck(room.config, PRESET_DECKS[9]!)).toBe(true);
  });

  it("kick 9 -> 8 nguoi thi lui ve preset 8", async () => {
    const room = getRoom(CODE)!;
    fillTo(9);
    room.config = applyDeck(room.config, PRESET_DECKS[9]!);
    const target = room.members[room.members.length - 1].playerId;

    await roomService.kick(HOST, target);

    expect(room.members.length).toBe(8);
    expect(sameDeck(room.config, PRESET_DECKS[8]!)).toBe(true);
  });

  it("nguoi moi join 8 -> 9 nguoi thi ap preset 9", async () => {
    const room = getRoom(CODE)!;
    fillTo(8);
    room.config = applyDeck(room.config, PRESET_DECKS[8]!);

    await roomService.join("newbie-1", "Nguoi moi", CODE);

    expect(room.members.length).toBe(9);
    expect(sameDeck(room.config, PRESET_DECKS[9]!)).toBe(true);
  });

  it("reconnect khong doi si so thi khong ghi de deck custom", async () => {
    const room = getRoom(CODE)!;
    fillTo(8);
    room.config = applyDeck(room.config, PRESET_DECKS[8]!);
    room.config = { ...room.config, hunter: false, villagers: (room.config.villagers ?? 0) + 1 };
    const before = { ...room.config };

    await roomService.join(HOST, "Chu phong", CODE);

    expect(room.members.length).toBe(8);
    expect(room.config).toEqual(before);
  });

  it("leave 9 -> 8 nguoi thi lui ve preset 8", async () => {
    const room = getRoom(CODE)!;
    fillTo(9);
    room.config = applyDeck(room.config, PRESET_DECKS[9]!);
    const leaver = room.members[room.members.length - 1].playerId;

    await roomService.leave(leaver);

    expect(room.members.length).toBe(8);
    expect(sameDeck(room.config, PRESET_DECKS[8]!)).toBe(true);
  });

  it("ngoai range preset (duoi 8) thi giu nguyen config", () => {
    const room = getRoom(CODE)!;
    fillTo(5);
    room.config = { ...room.config, hunter: false, villagers: 5 };
    const before = { ...room.config };

    roomService.addBot(HOST);

    expect(room.members.length).toBe(6);
    expect(room.config).toEqual(before);
  });
});
