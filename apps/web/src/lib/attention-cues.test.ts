import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_ROOM_CONFIG, type RoomSnapshot } from "@masoi/shared";
import { attentionFor } from "./attention-cues";

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

function trial(over: Partial<NonNullable<RoomSnapshot["trial"]>> = {}) {
  return {
    accusedId: "a",
    accusedName: "An",
    guiltyVotes: 0,
    innocentVotes: 0,
    guiltyRequired: 3,
    canVote: false,
    hasVoted: false,
    myVote: null,
    canSpeak: false,
    ...over,
  };
}

const kinds = (prev: RoomSnapshot | null, next: RoomSnapshot) =>
  attentionFor(prev, next).map((a) => a.kind);

describe("attentionFor", () => {
  it("snapshot đầu tiên không báo gì: vào phòng hay nối lại đều im lặng", () => {
    assert.deepEqual(attentionFor(null, snapshot({ phase: "VOTING" })), []);
  });

  it("nhận lại đúng snapshot cũ thì không báo gì", () => {
    const view = snapshot({ phase: "VOTING" });
    assert.deepEqual(attentionFor(view, view), []);
  });

  it("tới lượt hành động đêm của chính mình", () => {
    const before = snapshot({ phase: "NIGHT", round: 2, night: { canAct: false, acted: false } });
    const after = snapshot({ phase: "NIGHT", round: 2, night: { canAct: true, acted: false } });
    const [cue] = attentionFor(before, after);
    assert.equal(cue.kind, "NIGHT_TURN");
    assert.match(cue.title, /Tới lượt/);
  });

  it("không báo lượt đêm cho người không có hành động", () => {
    const before = snapshot({ phase: "DAY_DISCUSSION", round: 1 });
    const after = snapshot({ phase: "NIGHT", round: 2, night: null });
    assert.deepEqual(kinds(before, after), []);
  });

  it("mở bỏ phiếu cho người còn sống", () => {
    const before = snapshot({ phase: "DAY_DISCUSSION" });
    const after = snapshot({ phase: "VOTING" });
    assert.deepEqual(kinds(before, after), ["VOTE_OPEN"]);
  });

  it("người chết không được báo mở bỏ phiếu", () => {
    const dead = { id: "me", name: "Tôi", ready: true, connected: true, alive: false };
    const before = snapshot({ phase: "DAY_DISCUSSION", you: dead });
    const after = snapshot({ phase: "VOTING", you: dead });
    assert.deepEqual(kinds(before, after), []);
  });

  it("chính mình bị đưa ra xét xử", () => {
    const before = snapshot({ phase: "VOTING" });
    const after = snapshot({
      phase: "DEFENSE",
      trial: trial({ accusedId: "me", accusedName: "Tôi", canSpeak: true }),
    });
    const [cue] = attentionFor(before, after);
    assert.equal(cue.kind, "ACCUSED");
    assert.match(cue.title, /xét xử/);
  });

  it("người khác bị xét xử thì không báo ở pha bào chữa", () => {
    const before = snapshot({ phase: "VOTING" });
    const after = snapshot({ phase: "DEFENSE", trial: trial() });
    assert.deepEqual(kinds(before, after), []);
  });

  it("mở phán quyết Treo/Tha khi mình có quyền bỏ phiếu, nêu tên bị cáo", () => {
    const before = snapshot({ phase: "DEFENSE", trial: trial() });
    const after = snapshot({ phase: "FINAL_VOTE", trial: trial({ canVote: true }) });
    const [cue] = attentionFor(before, after);
    assert.equal(cue.kind, "TRIAL_VOTE");
    assert.match(cue.body, /An/);
  });

  it("bị cáo không được báo phán quyết vì không bỏ phiếu được", () => {
    const before = snapshot({ phase: "DEFENSE", trial: trial({ accusedId: "me" }) });
    const after = snapshot({
      phase: "FINAL_VOTE",
      trial: trial({ accusedId: "me", canVote: false }),
    });
    assert.deepEqual(kinds(before, after), []);
  });

  it("Thợ Săn được gọi bắn", () => {
    const before = snapshot({ phase: "ELIMINATION" });
    const after = snapshot({
      phase: "HUNTER_SHOT",
      hunterShot: { canAct: true, resolved: false, hunterId: "me", hunterName: "Tôi", target: null },
    });
    assert.deepEqual(kinds(before, after), ["HUNTER_TURN"]);
  });

  it("sáng ra có người chết: nêu tên", () => {
    const before = snapshot({ phase: "NIGHT", round: 2 });
    const after = snapshot({
      phase: "NIGHT_RESULT",
      round: 2,
      lastNightDeaths: [{ playerId: "a", name: "An" }],
    });
    const [cue] = attentionFor(before, after);
    assert.equal(cue.kind, "DEATH");
    assert.match(cue.body, /An/);
  });

  it("chính mình chết đêm qua thì nói thẳng", () => {
    const before = snapshot({ phase: "NIGHT", round: 2 });
    const after = snapshot({
      phase: "NIGHT_RESULT",
      round: 2,
      you: { id: "me", name: "Tôi", ready: true, connected: true, alive: false },
      lastNightDeaths: [{ playerId: "me", name: "Tôi" }],
    });
    const [cue] = attentionFor(before, after);
    assert.equal(cue.kind, "DEATH");
    assert.match(cue.title, /Bạn đã chết/);
  });

  it("sáng yên bình thì không báo", () => {
    const before = snapshot({ phase: "NIGHT", round: 2 });
    const after = snapshot({ phase: "NIGHT_RESULT", round: 2, lastNightDeaths: [] });
    assert.deepEqual(kinds(before, after), []);
  });

  it("ván kết thúc", () => {
    const before = snapshot({ phase: "ELIMINATION" });
    const after = snapshot({ phase: "GAME_OVER", winner: "village" });
    assert.deepEqual(kinds(before, after), ["GAME_OVER"]);
  });

  it("resync giữa pha không sinh cạnh: cùng pha, chỉ khác phiếu người khác", () => {
    const before = snapshot({ phase: "VOTING", players: [] });
    const after = snapshot({ phase: "VOTING", noEliminationVoteCount: 2 });
    assert.deepEqual(kinds(before, after), []);
  });
});
