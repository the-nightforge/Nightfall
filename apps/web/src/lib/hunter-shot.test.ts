import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_ROOM_CONFIG, type RoomSnapshot } from "@masoi/shared";
import { hunterShotOutcomeText, legalHunterShotTargets } from "./hunter-shot";

function snapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "HUNT1",
    hostId: "hunter",
    phase: "HUNTER_SHOT",
    config: DEFAULT_ROOM_CONFIG,
    round: 2,
    phaseEndsAt: 20_000,
    you: {
      id: "hunter",
      name: "Thợ Săn",
      ready: true,
      connected: true,
      role: "HUNTER",
      alive: false,
    },
    players: [
      { id: "hunter", name: "Thợ Săn", alive: false, isBot: false, role: "HUNTER" },
      { id: "wolf", name: "Sói", alive: true, isBot: false },
      { id: "dead", name: "Đã chết", alive: false, isBot: false },
      { id: "villager", name: "Dân Làng", alive: true, isBot: false },
    ],
    night: null,
    hunterShot: {
      hunterId: "hunter",
      hunterName: "Thợ Săn",
      canAct: true,
      resolved: false,
      target: null,
    },
    hasVoted: false,
    myVote: null,
    noEliminationVoteCount: 0,
    discussionSkip: null,
    votesRevealed: false,
    nightHistory: [],
    hunterShots: [],
    lastNightDeaths: [],
    lastEliminated: null,
    winner: null,
    chatLog: [],
    log: [],
    ...overrides,
  };
}

describe("legalHunterShotTargets", () => {
  it("chỉ cho Thợ Săn chọn người còn sống khác chính mình", () => {
    assert.deepEqual(
      legalHunterShotTargets(snapshot()).map((player) => player.id),
      ["wolf", "villager"],
    );
  });

  it("không trả mục tiêu cho người xem không phải Thợ Săn đang hành động", () => {
    const view = snapshot({
      you: {
        id: "wolf",
        name: "Sói",
        ready: true,
        connected: true,
        role: "WEREWOLF",
        alive: true,
      },
      hunterShot: {
        hunterId: "hunter",
        hunterName: "Thợ Săn",
        canAct: false,
        resolved: false,
        target: null,
      },
    });

    assert.deepEqual(legalHunterShotTargets(view), []);
  });

  it("không khôi phục thao tác khi snapshot reconnect đã xử lý xong", () => {
    const view = snapshot({
      hunterShot: {
        hunterId: "hunter",
        hunterName: "Thợ Săn",
        canAct: false,
        resolved: true,
        target: null,
      },
    });

    assert.deepEqual(legalHunterShotTargets(view), []);
  });
});

describe("hunterShotOutcomeText", () => {
  it("hiển thị công khai người bị Thợ Săn bắn", () => {
    assert.equal(
      hunterShotOutcomeText({
        hunterId: "hunter",
        hunterName: "An",
        canAct: false,
        resolved: true,
        target: { id: "wolf", name: "Bình" },
      }),
      "Thợ Săn An đã bắn Bình.",
    );
  });

  it("hiển thị rõ khi Thợ Săn không bắn ai", () => {
    assert.equal(
      hunterShotOutcomeText({
        hunterId: "hunter",
        hunterName: "An",
        canAct: false,
        resolved: true,
        target: null,
      }),
      "Thợ Săn An đã không bắn ai.",
    );
  });
});
