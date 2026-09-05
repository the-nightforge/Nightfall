import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RoomSnapshot } from "@masoi/shared";
import { phaseActionFor } from "./phase-action";

function snapshot(over: Partial<RoomSnapshot>): RoomSnapshot {
  return {
    code: "ABCDE",
    hostId: "me",
    phase: "VOTING",
    config: {} as RoomSnapshot["config"],
    round: 2,
    phaseEndsAt: 1_000,
    serverNow: 0,
    you: { id: "me", name: "Minh", ready: true, connected: true, alive: true },
    players: [],
    night: null,
    hunterShot: null,
    trial: null,
    lastTrial: null,
    hasVoted: false,
    myVote: null,
    noEliminationVoteCount: 0,
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

describe("phaseActionFor", () => {
  it("không có snapshot hay không có người xem thì không có hành động", () => {
    assert.equal(phaseActionFor(null), null);
    assert.equal(phaseActionFor(snapshot({ you: null })), null);
  });

  it("bỏ phiếu sơ bộ: còn sống thì có, đã bỏ thì đổi nhãn và bớt khẩn", () => {
    assert.deepEqual(phaseActionFor(snapshot({ phase: "VOTING" })), {
      kind: "VOTE",
      label: "Bỏ phiếu ngay",
      urgent: true,
    });
    assert.deepEqual(phaseActionFor(snapshot({ phase: "VOTING", hasVoted: true })), {
      kind: "VOTE",
      label: "Xem hoặc đổi phiếu",
      urgent: false,
    });
    // Người chết chỉ theo dõi - panel không hiện nút, nên đây cũng không dẫn tới đâu.
    assert.equal(
      phaseActionFor(
        snapshot({
          phase: "VOTING",
          you: { id: "me", name: "Minh", ready: true, connected: true, alive: false },
        }),
      ),
      null,
    );
  });

  it("phán quyết: chỉ khi server nói còn quyền bỏ phiếu", () => {
    const trial = {
      accusedId: "a",
      accusedName: "An",
      guiltyVotes: 0,
      innocentVotes: 0,
      guiltyRequired: 3,
      canVote: true,
      hasVoted: false,
      myVote: null,
      canSpeak: false,
    };
    assert.deepEqual(phaseActionFor(snapshot({ phase: "FINAL_VOTE", trial })), {
      kind: "TRIAL",
      label: "Treo hay Tha",
      urgent: true,
    });
    assert.equal(
      phaseActionFor(snapshot({ phase: "FINAL_VOTE", trial: { ...trial, canVote: false, hasVoted: true } })),
      null,
    );
    // Biện hộ: không có nút nào, bào chữa đi qua chat.
    assert.equal(phaseActionFor(snapshot({ phase: "DEFENSE", trial })), null);
  });

  it("Thợ Săn và đêm: theo cờ canAct, tắt khi đã xử/đã hành động", () => {
    const shot = { hunterId: "me", hunterName: "Minh", canAct: true, resolved: false, target: null };
    assert.equal(phaseActionFor(snapshot({ phase: "HUNTER_SHOT", hunterShot: shot }))?.kind, "HUNTER");
    assert.equal(
      phaseActionFor(snapshot({ phase: "HUNTER_SHOT", hunterShot: { ...shot, resolved: true } })),
      null,
    );
    assert.equal(
      phaseActionFor(snapshot({ phase: "HUNTER_SHOT", hunterShot: { ...shot, canAct: false } })),
      null,
    );
    const night = { canAct: true, acted: false } as NonNullable<RoomSnapshot["night"]>;
    assert.equal(phaseActionFor(snapshot({ phase: "NIGHT", night }))?.kind, "NIGHT");
    assert.equal(phaseActionFor(snapshot({ phase: "NIGHT", night: { ...night, acted: true } })), null);
  });

  it("thảo luận và các pha không có nút: null", () => {
    for (const phase of ["DAY_DISCUSSION", "NIGHT_RESULT", "ELIMINATION", "GAME_OVER", "LOBBY"] as const) {
      assert.equal(phaseActionFor(snapshot({ phase })), null, phase);
    }
  });
});
