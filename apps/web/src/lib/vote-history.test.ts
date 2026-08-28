import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DayVoteRecap } from "@masoi/shared";
import { formatVoteMutations } from "./vote-history";

const recap: DayVoteRecap = {
  round: 1,
  mutations: [
    {
      id: "1:nomination:1",
      round: 1,
      voterId: "a",
      previousChoice: null,
      choice: { type: "PLAYER", targetId: "b" },
      castAt: 1_000,
      phaseStartedAt: 0,
      phaseEndsAt: 30_000,
      sequence: 1,
    },
    {
      id: "1:nomination:2",
      round: 1,
      voterId: "a",
      previousChoice: { type: "PLAYER", targetId: "b" },
      choice: { type: "PLAYER", targetId: "c" },
      castAt: 2_000,
      phaseStartedAt: 0,
      phaseEndsAt: 30_000,
      sequence: 2,
    },
  ],
  finalBallots: [],
  nomination: { kind: "TRIAL", accusedId: "c" },
  finalJudgment: null,
};

describe("formatVoteMutations", () => {
  it("formats vote changes with player names", () => {
    const lines = formatVoteMutations(
      recap,
      new Map([
        ["a", "An"],
        ["b", "Bình"],
        ["c", "Chi"],
      ]),
    );

    assert.deepEqual(lines, ["An → Bình", "An: Bình → Chi"]);
  });

  it("uses a safe placeholder for players who left the room", () => {
    const lines = formatVoteMutations(recap, new Map());

    assert.deepEqual(lines, [
      "Người chơi đã rời phòng → Người chơi đã rời phòng",
      "Người chơi đã rời phòng: Người chơi đã rời phòng → Người chơi đã rời phòng",
    ]);
  });
});
