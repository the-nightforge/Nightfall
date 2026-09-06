import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_ROOM_CONFIG, type RoomSnapshot } from "@masoi/shared";
import { phaseHint, rulesLookup } from "./rules-lookup";

function snapshot(over: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "ABCDE",
    hostId: "me",
    phase: "DAY_DISCUSSION",
    config: { ...DEFAULT_ROOM_CONFIG, werewolves: 2, seer: true, guard: true, witch: false, villagers: 4 },
    round: 1,
    phaseEndsAt: null,
    you: { id: "me", name: "Tôi", ready: true, connected: true, role: "SEER", alive: true },
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

describe("rulesLookup", () => {
  it("vai của mình: tên, mô tả, mục tiêu và có hành động đêm hay không", () => {
    const r = rulesLookup(snapshot());
    assert.ok(r.myRole);
    assert.equal(r.myRole.name, "Tiên Tri");
    assert.match(r.myRole.description, /soi|kiểm tra|xem/i);
    assert.match(r.myRole.goal, /Sói/);
    assert.equal(r.myRole.actsAtNight, true);
    assert.equal(r.myRole.team, "village");
  });

  it("chưa được chia vai thì không có mục vai của mình", () => {
    const r = rulesLookup(
      snapshot({ you: { id: "me", name: "Tôi", ready: true, connected: true, alive: true } }),
    );
    assert.equal(r.myRole, null);
  });

  it("Dân Làng: không hành động đêm", () => {
    const r = rulesLookup(
      snapshot({
        you: { id: "me", name: "Tôi", ready: true, connected: true, role: "VILLAGER", alive: true },
      }),
    );
    assert.equal(r.myRole?.actsAtNight, false);
  });

  it("Kẻ Nguyền Rủa đã hoá Sói được ghi chú thẳng", () => {
    const r = rulesLookup(
      snapshot({
        you: {
          id: "me",
          name: "Tôi",
          ready: true,
          connected: true,
          role: "WEREWOLF",
          alive: true,
          cursedTurned: true,
        },
      }),
    );
    assert.ok(r.myRole?.note);
    assert.match(r.myRole.note, /bị nguyền/);
  });

  it("bộ bài: Sói theo số, vai đặc biệt đã bật, Dân Làng phần còn lại; vai tắt không xuất hiện", () => {
    const deck = rulesLookup(snapshot()).deck;
    const byRole = Object.fromEntries(deck.map((d) => [d.role, d.count]));
    assert.equal(byRole.WEREWOLF, 2);
    assert.equal(byRole.SEER, 1);
    assert.equal(byRole.GUARD, 1);
    assert.equal(byRole.VILLAGER, 4);
    assert.equal(byRole.WITCH, undefined);
  });

  it("bộ bài xếp Sói trước, rồi làng, rồi trung lập, Dân Làng cuối", () => {
    const deck = rulesLookup(
      snapshot({
        config: {
          ...DEFAULT_ROOM_CONFIG,
          werewolves: 1,
          seer: true,
          guard: false,
          witch: false,
          jester: true,
          villagers: 2,
        },
      }),
    ).deck;
    assert.deepEqual(
      deck.map((d) => d.role),
      ["WEREWOLF", "SEER", "JESTER", "VILLAGER"],
    );
  });

  it("phòng xếp hạng không có sự kiện; phòng hỗn loạn hiện sự kiện đang chạy", () => {
    const event = {
      id: "CURFEW" as const,
      name: "Giới nghiêm",
      description: "Không ai được nói.",
      targetPhase: "DAY" as const,
      round: 1,
      beneficiary: "wolves" as const,
      power: 1,
    };
    const ranked = rulesLookup(snapshot({ activeEvent: event }));
    assert.equal(ranked.event, null);
    const chaos = rulesLookup(
      snapshot({ config: { ...DEFAULT_ROOM_CONFIG, mode: "chaos" }, activeEvent: event }),
    );
    assert.equal(chaos.event?.name, "Giới nghiêm");
  });

  it("pha hiện tại có nhãn và một câu chỉ việc", () => {
    const r = rulesLookup(snapshot({ phase: "VOTING" }));
    assert.equal(r.phase.label, "Bỏ phiếu sơ bộ");
    assert.match(r.phase.hint, /phiếu/);
  });
});

describe("phaseHint", () => {
  it("mọi pha đều có câu chỉ việc, không pha nào rỗng", () => {
    const phases = [
      "LOBBY",
      "ROLE_REVEAL",
      "NIGHT",
      "NIGHT_RESULT",
      "DAY_DISCUSSION",
      "VOTING",
      "DEFENSE",
      "FINAL_VOTE",
      "ELIMINATION",
      "HUNTER_SHOT",
      "CHECK_WIN",
      "GAME_OVER",
    ] as const;
    for (const phase of phases) assert.ok(phaseHint(phase).length > 10, phase);
  });
});
