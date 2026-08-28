import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_ROOM_CONFIG, type NightRecap, type RoomSnapshot } from "@masoi/shared";
import { cursedTurnedText, myCursedNote, roleLabel } from "./cursed";

function night(over: Partial<NightRecap> = {}): NightRecap {
  return {
    round: 1,
    wolfTarget: null,
    guardTarget: null,
    seerChecks: [],
    witch: { usedHeal: false, healedTarget: null, poisonTarget: null },
    deaths: [],
    cursedTurned: null,
    ...over,
  };
}

function snapshot(you: RoomSnapshot["you"]): RoomSnapshot {
  return {
    code: "CURSE",
    hostId: "cursed",
    phase: "DAY_DISCUSSION",
    config: { ...DEFAULT_ROOM_CONFIG, cursed: true },
    round: 2,
    phaseEndsAt: null,
    you,
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
    nightHistory: [],
    hunterShots: [],
    lastNightDeaths: [],
    lastEliminated: null,
    winner: null,
    chatLog: [],
    log: [],
  };
}

const me = (over: Partial<NonNullable<RoomSnapshot["you"]>> = {}) => ({
  id: "cursed",
  name: "Nguyền",
  ready: true,
  connected: true,
  alive: true,
  ...over,
});

describe("roleLabel", () => {
  it("gọi đúng tên Kẻ Nguyền Rủa chưa chuyển phe", () => {
    assert.equal(roleLabel({ role: "CURSED", cursedTurned: false }), "Kẻ Nguyền Rủa");
  });

  it("nêu rõ gốc nguyền rủa của người đã hoá Ma Sói", () => {
    assert.equal(
      roleLabel({ role: "WEREWOLF", cursedTurned: true }),
      "Kẻ Nguyền Rủa (đã hoá Ma Sói)",
    );
  });

  it("giữ nguyên tên các vai khác", () => {
    assert.equal(roleLabel({ role: "WEREWOLF" }), "Ma Sói");
    assert.equal(roleLabel({ role: "SEER" }), "Tiên Tri");
  });

  it("không đoán vai khi snapshot chưa được phép lộ", () => {
    assert.equal(roleLabel({}), "Chưa rõ");
  });
});

describe("cursedTurnedText", () => {
  it("mô tả diễn biến chuyển phe trong đêm", () => {
    assert.equal(
      cursedTurnedText(night({ cursedTurned: { id: "cursed", name: "Nguyền" } })),
      "Kẻ Nguyền Rủa Nguyền đã chuyển thành Ma Sói.",
    );
  });

  it("không nói gì khi đêm đó không ai bị nguyền", () => {
    assert.equal(cursedTurnedText(night()), null);
  });

  it("chịu được diễn biến cũ thiếu hẳn trường cursedTurned", () => {
    const legacy = night();
    delete (legacy as { cursedTurned?: unknown }).cursedTurned;
    assert.equal(cursedTurnedText(legacy), null);
  });
});

describe("myCursedNote", () => {
  it("nhắc luật cho Kẻ Nguyền Rủa chưa bị cắn", () => {
    const note = myCursedNote(snapshot(me({ role: "CURSED", cursedTurned: false })));
    assert.match(note ?? "", /hoá thành Ma Sói/);
  });

  it("báo cho người đã bị nguyền biết mình đổi phe", () => {
    const note = myCursedNote(snapshot(me({ role: "WEREWOLF", cursedTurned: true })));
    assert.match(note ?? "", /phe Ma Sói/);
  });

  it("không nói gì với các vai khác", () => {
    assert.equal(myCursedNote(snapshot(me({ role: "VILLAGER" }))), null);
    assert.equal(myCursedNote(snapshot(me({ role: "WEREWOLF" }))), null);
    assert.equal(myCursedNote(snapshot(null)), null);
  });
});
