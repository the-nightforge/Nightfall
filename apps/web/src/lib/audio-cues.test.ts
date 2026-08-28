import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_ROOM_CONFIG, type RoomSnapshot } from "@masoi/shared";
import { cuesFor } from "./audio-cues";

function snapshot(over: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "ABCDE",
    hostId: "me",
    phase: "DAY_DISCUSSION",
    config: { ...DEFAULT_ROOM_CONFIG },
    round: 1,
    phaseEndsAt: null,
    you: { id: "me", name: "Tôi", ready: true, connected: true, role: "VILLAGER", alive: true },
    players: [],
    night: null,
    hunterShot: null,
    trial: null,
    lastTrial: null,
    hasVoted: false,
    myVote: null,
    noEliminationVoteCount: 0,
    serverNow: 0,
    discussionSkip: null,
    votesRevealed: false,
    dayVoteHistory: [],
    nightHistory: [],
    hunterShots: [],
    lastNightDeaths: [],
    lastEliminated: null,
    winner: null,
    chatLog: [],
    log: [],
    ...over,
  };
}

describe("cuesFor", () => {
  it("snapshot đầu tiên không phát gì: vào phòng hay nối lại đều im lặng", () => {
    assert.deepEqual(cuesFor(null, snapshot({ phase: "NIGHT", round: 1 })), []);
  });

  it("nhận lại đúng snapshot cũ thì không phát gì", () => {
    const view = snapshot({
      phase: "NIGHT_RESULT",
      lastNightDeaths: [{ playerId: "a", name: "A" }],
    });
    assert.deepEqual(cuesFor(view, view), []);
  });

  it("hú khi trời vào đêm", () => {
    const before = snapshot({ phase: "DAY_DISCUSSION", round: 1 });
    const after = snapshot({ phase: "NIGHT", round: 2 });
    assert.deepEqual(cuesFor(before, after), ["howl"]);
  });

  it("báo khi tới lượt hành động của chính mình", () => {
    const before = snapshot({ phase: "NIGHT", round: 2, night: { canAct: false, acted: false } });
    const after = snapshot({ phase: "NIGHT", round: 2, night: { canAct: true, acted: false } });
    assert.deepEqual(cuesFor(before, after), ["turn"]);
  });

  it("Thợ Săn được gọi bắn cũng là tới lượt", () => {
    const before = snapshot({ phase: "ELIMINATION", round: 2 });
    const after = snapshot({
      phase: "HUNTER_SHOT",
      round: 2,
      hunterShot: {
        hunterId: "me",
        hunterName: "Tôi",
        canAct: true,
        resolved: false,
        target: null,
      },
    });
    assert.deepEqual(cuesFor(before, after), ["turn"]);
  });

  it("người khác nhìn Thợ Săn bắn thì không nghe tiếng tới lượt", () => {
    const watching = {
      hunterId: "khac",
      hunterName: "Người khác",
      canAct: false,
      resolved: false,
      target: null,
    };
    const before = snapshot({ phase: "ELIMINATION", round: 2 });
    const after = snapshot({ phase: "HUNTER_SHOT", round: 2, hunterShot: watching });
    assert.deepEqual(cuesFor(before, after), []);
  });

  it("có người chết trong đêm", () => {
    const before = snapshot({ phase: "NIGHT", round: 2 });
    const after = snapshot({
      phase: "NIGHT_RESULT",
      round: 2,
      lastNightDeaths: [{ playerId: "a", name: "A" }],
    });
    assert.deepEqual(cuesFor(before, after), ["death"]);
  });

  it("đêm bình yên thì không có tiếng chết", () => {
    const before = snapshot({ phase: "NIGHT", round: 2 });
    const after = snapshot({ phase: "NIGHT_RESULT", round: 2, lastNightDeaths: [] });
    assert.deepEqual(cuesFor(before, after), []);
  });

  it("có người bị treo cổ", () => {
    const before = snapshot({ phase: "VOTING", round: 2 });
    const after = snapshot({
      phase: "ELIMINATION",
      round: 2,
      lastEliminated: { playerId: "a", name: "A" },
    });
    assert.deepEqual(cuesFor(before, after), ["death"]);
  });

  it("hoà phiếu không treo ai thì im lặng", () => {
    const before = snapshot({ phase: "VOTING", round: 2 });
    const after = snapshot({ phase: "ELIMINATION", round: 2, lastEliminated: null });
    assert.deepEqual(cuesFor(before, after), []);
  });

  it("xác nhận khi chính mình vừa bỏ phiếu", () => {
    const before = snapshot({ phase: "VOTING", hasVoted: false });
    const after = snapshot({ phase: "VOTING", hasVoted: true });
    assert.deepEqual(cuesFor(before, after), ["ballot"]);
  });

  it("thắng khi phe mình thắng", () => {
    const before = snapshot({ phase: "ELIMINATION", round: 3 });
    const after = snapshot({ phase: "GAME_OVER", round: 3, winner: "village" });
    assert.deepEqual(cuesFor(before, after), ["win"]);
  });

  it("thua khi phe kia thắng", () => {
    const before = snapshot({ phase: "ELIMINATION", round: 3 });
    const after = snapshot({ phase: "GAME_OVER", round: 3, winner: "wolves" });
    assert.deepEqual(cuesFor(before, after), ["lose"]);
  });

  it("sói thắng thì chính sói nghe tiếng thắng", () => {
    const wolf = {
      id: "me",
      name: "Tôi",
      ready: true,
      connected: true,
      role: "WEREWOLF" as const,
      alive: true,
    };
    const before = snapshot({ phase: "ELIMINATION", round: 3, you: wolf });
    const after = snapshot({ phase: "GAME_OVER", round: 3, winner: "wolves", you: wolf });
    assert.deepEqual(cuesFor(before, after), ["win"]);
  });

  it("không biết vai của mình thì không phát tiếng kết cục", () => {
    const nobody = { id: "me", name: "Tôi", ready: true, connected: true, alive: true };
    const before = snapshot({ phase: "ELIMINATION", round: 3, you: nobody });
    const after = snapshot({ phase: "GAME_OVER", round: 3, winner: "village", you: nobody });
    assert.deepEqual(cuesFor(before, after), []);
  });

  it("nối lại giữa pha kết quả đêm không phát lại tiếng chết", () => {
    const view = snapshot({
      phase: "NIGHT_RESULT",
      round: 2,
      lastNightDeaths: [{ playerId: "a", name: "A" }],
    });
    const resync = snapshot({
      phase: "NIGHT_RESULT",
      round: 2,
      lastNightDeaths: [{ playerId: "a", name: "A" }],
    });
    assert.deepEqual(cuesFor(view, resync), []);
  });

  it("cùng một pha ở vòng sau vẫn là cạnh mới", () => {
    const before = snapshot({ phase: "NIGHT", round: 2 });
    const after = snapshot({ phase: "NIGHT", round: 3 });
    assert.deepEqual(cuesFor(before, after), ["howl"]);
  });
});
