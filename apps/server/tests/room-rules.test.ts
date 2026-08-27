import { describe, expect, it } from "vitest";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { allRequiredPlayersReady, roomEntryError } from "../src/rooms/rules";
import type { Room } from "../src/rooms/store";

function lobbyRoom(): Room {
  return {
    code: "ABCDE",
    hostId: "host",
    status: "LOBBY",
    members: [
      { playerId: "host", name: "Chủ phòng", ready: false, connected: true, isBot: false },
      { playerId: "guest", name: "Khách", ready: false, connected: true, isBot: false },
      { playerId: "bot", name: "Bot", ready: true, connected: false, isBot: true },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: null,
    chatLog: [],
    createdAt: 0,
  };
}

describe("roomEntryError", () => {
  it("requires leaving the current room before entering another", () => {
    expect(roomEntryError("OLD01", "NEW01", "LOBBY", false)).toBe(
      "Bạn phải rời phòng hiện tại trước khi vào phòng khác",
    );
  });

  it("blocks a new player from joining a game in progress", () => {
    expect(roomEntryError(null, "ABCDE", "IN_GAME", false)).toBe("Trận đấu đã bắt đầu");
  });

  it("allows an existing member to reconnect to a game in progress", () => {
    expect(roomEntryError("ABCDE", "ABCDE", "IN_GAME", true)).toBeNull();
  });

  it("allows a player without a room to join a lobby", () => {
    expect(roomEntryError(null, "ABCDE", "LOBBY", false)).toBeNull();
  });
});

describe("allRequiredPlayersReady", () => {
  it("does not require the host or bots to toggle ready", () => {
    const room = lobbyRoom();
    room.members.find((member) => member.playerId === "guest")!.ready = true;
    expect(allRequiredPlayersReady(room)).toBe(true);
  });

  it("returns false while a human guest is not ready", () => {
    expect(allRequiredPlayersReady(lobbyRoom())).toBe(false);
  });
});
