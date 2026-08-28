import { afterEach, describe, expect, it } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import {
  clearDiscussionSkipVotes,
  getDiscussionSkipView,
  updateDiscussionSkipVote,
} from "../src/game/discussion-skip";
import { buildSnapshot } from "../src/rooms/snapshot";
import type { Room } from "../src/rooms/store";

function dayRoom(): Room {
  const state: GameState = {
    phase: "DAY_DISCUSSION",
    round: 2,
    phaseEndsAt: Date.now() + 60_000,
    players: [
      { id: "alice", name: "Alice", role: "VILLAGER", alive: true, isBot: false },
      { id: "bob", name: "Bob", role: "SEER", alive: true, isBot: false },
      { id: "offline", name: "Offline", role: "GUARD", alive: true, isBot: false },
      { id: "dead", name: "Dead", role: "VILLAGER", alive: false, isBot: false },
      { id: "bot", name: "Bot", role: "WEREWOLF", alive: true, isBot: true },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    winner: null,
    night: {
      killTarget: null,
      actedWolves: [],
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
    log: [],
  };

  return {
    code: "ABCDE",
    hostId: "alice",
    status: "IN_GAME",
    members: [
      { playerId: "alice", name: "Alice", ready: true, connected: true, isBot: false },
      { playerId: "bob", name: "Bob", ready: true, connected: true, isBot: false },
      { playerId: "offline", name: "Offline", ready: true, connected: false, isBot: false },
      { playerId: "dead", name: "Dead", ready: true, connected: true, isBot: false },
      { playerId: "bot", name: "Bot", ready: true, connected: false, isBot: true },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: new GameEngine(state),
    chatLog: [],
    createdAt: 0,
  };
}

afterEach(() => {
  clearDiscussionSkipVotes("ABCDE");
});

describe("discussion skip state", () => {
  it("chỉ tính người thật còn sống và vẫn tính người mất kết nối", () => {
    const room = dayRoom();

    expect(getDiscussionSkipView(room, "alice")).toEqual({
      votes: 0,
      required: 3,
      hasVoted: false,
      canVote: true,
    });
    expect(getDiscussionSkipView(room, "dead")?.canVote).toBe(false);
    expect(getDiscussionSkipView(room, "bot")?.canVote).toBe(false);
  });

  it("thêm phiếu idempotent và cho phép rút phiếu", () => {
    const room = dayRoom();

    expect(updateDiscussionSkipVote(room, "alice", true)).toEqual({ ok: true, unanimous: false });
    expect(updateDiscussionSkipVote(room, "alice", true)).toEqual({ ok: true, unanimous: false });
    expect(getDiscussionSkipView(room, "bob")?.votes).toBe(1);

    expect(updateDiscussionSkipVote(room, "alice", false)).toEqual({ ok: true, unanimous: false });
    expect(getDiscussionSkipView(room, "alice")?.votes).toBe(0);
  });

  it("từ chối bot, người chết và người ngoài phòng", () => {
    const room = dayRoom();

    expect(updateDiscussionSkipVote(room, "dead", true)).toEqual({
      ok: false,
      error: "Chỉ người chơi còn sống mới được skip thảo luận",
    });
    expect(updateDiscussionSkipVote(room, "bot", true)).toEqual({
      ok: false,
      error: "Bot không thể skip thảo luận",
    });
    expect(updateDiscussionSkipVote(room, "stranger", true)).toEqual({
      ok: false,
      error: "Bạn không ở trong phòng này",
    });
  });

  it("cá nhân hoá phiếu của viewer trong room snapshot", () => {
    const room = dayRoom();
    updateDiscussionSkipVote(room, "alice", true);

    expect(buildSnapshot(room, "alice").discussionSkip).toEqual({
      votes: 1,
      required: 3,
      hasVoted: true,
      canVote: true,
    });
    expect(buildSnapshot(room, "bob").discussionSkip).toEqual({
      votes: 1,
      required: 3,
      hasVoted: false,
      canVote: true,
    });
  });

  it("xoá phiếu tạm và không công bố state ngoài pha thảo luận", () => {
    const room = dayRoom();
    updateDiscussionSkipVote(room, "alice", true);

    clearDiscussionSkipVotes(room.code);
    expect(getDiscussionSkipView(room, "alice")?.votes).toBe(0);

    room.engine!.setPhase("VOTING", 30_000);
    expect(getDiscussionSkipView(room, "alice")).toBeNull();
  });
});
