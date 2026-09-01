import { describe, expect, it, vi } from "vitest";
import { GameEngine } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG, type ChatMessage } from "@masoi/shared";
import { startGame } from "../src/game/machine";
import { discussionSkipVotes } from "../src/game/discussion-skip";
import type { Room } from "../src/rooms/store";
import { ROOM_SCAFFOLD } from "./helpers/room";

vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: () => undefined,
  persistRoom: async () => undefined,
  setRoomTimer: () => undefined,
}));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));

vi.mock("../src/db", () => ({
  prisma: {},
}));

const oldMessages: ChatMessage[] = [
  { id: "lobby", channel: "lobby", playerId: "p1", playerName: "Người 1", text: "lobby cũ", at: 1 },
  { id: "day", channel: "day", playerId: "p2", playerName: "Người 2", text: "ban ngày cũ", at: 2 },
  { id: "wolves", channel: "wolves", playerId: "p3", playerName: "Người 3", text: "sói cũ", at: 3 },
  { id: "dead", channel: "dead", playerId: "p4", playerName: "Người 4", text: "người chết cũ", at: 4 },
];

function lobbyWithOldChat(): Room {
  return {
    ...ROOM_SCAFFOLD,
    code: "ABCDE",
    hostId: "p1",
    status: "LOBBY",
    members: Array.from({ length: 6 }, (_, index) => ({
      playerId: `p${index + 1}`,
      name: `Người ${index + 1}`,
      ready: true,
      connected: true,
      isBot: false,
    })),
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: null,
    chatLog: [...oldMessages],
    createdAt: 0,
  };
}

describe("vòng đời chat giữa các ván", () => {
  it("xoá toàn bộ chat của ván cũ khi bắt đầu ván mới", () => {
    const room = lobbyWithOldChat();
    discussionSkipVotes.set(room.code, new Set(["p1"]));

    startGame(room);

    expect(room.chatLog).toEqual([]);
    expect(discussionSkipVotes.has(room.code)).toBe(false);
  });

  it("tạo engine mới không mang phản ứng và recap Thợ Săn từ ván trước", () => {
    const room = lobbyWithOldChat();
    const previousEngine = GameEngine.create(
      room.members.map((member) => ({
        id: member.playerId,
        name: member.name,
        isBot: member.isBot,
      })),
      room.config,
    );
    previousEngine.state.hunterReaction = {
      hunterId: "p1",
      source: "night",
      resolved: true,
    };
    previousEngine.state.hunterShots = [
      {
        round: 4,
        hunter: { id: "p1", name: "Người 1" },
        target: { id: "p2", name: "Người 2" },
        source: "night",
      },
    ];
    room.engine = previousEngine;

    startGame(room);

    expect(room.engine).not.toBe(previousEngine);
    expect(room.engine?.state.hunterReaction).toBeNull();
    expect(room.engine?.state.hunterShots).toEqual([]);
  });
});
