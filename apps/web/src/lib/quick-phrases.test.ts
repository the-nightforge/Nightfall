import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_ROOM_CONFIG, type RoomSnapshot } from "@masoi/shared";
import { applyQuickPhrase, mentionNamesFor, quickPhrasesFor } from "./quick-phrases";

function snapshot(over: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "ABCDE",
    hostId: "me",
    phase: "DAY_DISCUSSION",
    config: { ...DEFAULT_ROOM_CONFIG },
    round: 1,
    phaseEndsAt: null,
    you: { id: "me", name: "Tôi", ready: true, connected: true, role: "VILLAGER", alive: true },
    players: [
      { id: "me", name: "Tôi", alive: true, isBot: false },
      { id: "a", name: "An", alive: true, isBot: true },
      { id: "b", name: "Bình", alive: false, isBot: true },
      { id: "c", name: "Chi", alive: true, isBot: true },
    ],
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
  } as RoomSnapshot;
}

const labels = (s: RoomSnapshot, ch: "lobby" | "day" | "wolves" | "dead" | null) =>
  quickPhrasesFor(s, ch).map((p) => p.label);

describe("quickPhrasesFor", () => {
  it("phòng chờ và lúc không gửi được: không có chip", () => {
    assert.deepEqual(labels(snapshot({ phase: "LOBBY" }), "lobby"), []);
    assert.deepEqual(labels(snapshot(), null), []);
  });

  it("thảo luận ban ngày: tối đa 5 chip, có 'Nghi @' mở nhắc tên", () => {
    const phrases = quickPhrasesFor(snapshot(), "day");
    assert.ok(phrases.length > 0 && phrases.length <= 5);
    const suspect = phrases.find((p) => p.label === "Nghi @");
    assert.ok(suspect);
    assert.equal(suspect.text, "Nghi @");
    assert.equal(suspect.wantsMention, true);
  });

  it("bỏ phiếu dùng cùng bộ với thảo luận", () => {
    assert.deepEqual(labels(snapshot({ phase: "VOTING" }), "day"), labels(snapshot(), "day"));
  });

  it("bị cáo trong pha bào chữa có câu bào chữa; người khác có câu chất vấn", () => {
    const trial = {
      accusedId: "me",
      accusedName: "Tôi",
      guiltyVotes: 0,
      innocentVotes: 0,
      guiltyRequired: 2,
      canVote: false,
      hasVoted: false,
      myVote: null,
      canSpeak: true,
    };
    const accused = labels(snapshot({ phase: "DEFENSE", trial }), "day");
    assert.ok(accused.includes("Tôi không phải Sói"));
    const other = labels(
      snapshot({ phase: "DEFENSE", trial: { ...trial, accusedId: "a", canSpeak: false } }),
      "day",
    );
    assert.ok(other.includes("Khai vai đi"));
    assert.ok(!other.includes("Tôi không phải Sói"));
  });

  it("kênh Sói ban đêm: 'Cắn @'", () => {
    const phrases = quickPhrasesFor(snapshot({ phase: "NIGHT" }), "wolves");
    assert.ok(phrases.some((p) => p.label === "Cắn @" && p.wantsMention));
  });

  it("kênh người chết có vài câu riêng", () => {
    const phrases = labels(snapshot(), "dead");
    assert.ok(phrases.length > 0);
    assert.ok(!phrases.includes("Tôi là dân"));
  });

  it("mọi chip đều có text không rỗng và không quá 40 ký tự", () => {
    for (const ch of ["day", "wolves", "dead"] as const) {
      for (const p of quickPhrasesFor(snapshot({ phase: "NIGHT" }), ch)) {
        assert.ok(p.text.length > 0 && p.text.length <= 40, p.text);
      }
    }
  });
});

describe("applyQuickPhrase", () => {
  it("ô trống thì đặt nguyên câu; con trỏ ở cuối", () => {
    assert.deepEqual(applyQuickPhrase("", "Tôi là dân"), { text: "Tôi là dân", caret: 10 });
  });
  it("đã có chữ thì nối sau một dấu cách", () => {
    assert.deepEqual(applyQuickPhrase("này ", "Nghi @"), { text: "này Nghi @", caret: 10 });
    assert.deepEqual(applyQuickPhrase("này", "Nghi @"), { text: "này Nghi @", caret: 10 });
  });
  it("vượt trần thì null", () => {
    assert.equal(applyQuickPhrase("x".repeat(295), "Tôi là dân", 300), null);
  });
});

describe("mentionNamesFor", () => {
  it("mọi người trừ mình, người sống trước người chết", () => {
    assert.deepEqual(mentionNamesFor(snapshot()), ["An", "Chi", "Bình"]);
  });
  it("không có snapshot thì rỗng", () => {
    assert.deepEqual(mentionNamesFor(null), []);
  });
});
