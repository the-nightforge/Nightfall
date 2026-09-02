import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DayVoteRecap, RoomSnapshot } from "@masoi/shared";
import { nominationRecapFor, summarizeDefenseVotes } from "./defense-votes";

const players: RoomSnapshot["players"] = [
  { id: "accused", name: "Bị Cáo", alive: true, isBot: false, voteCount: 3 },
  { id: "a", name: "An", alive: true, isBot: false, voteCount: 0 },
  { id: "b", name: "Bình", alive: true, isBot: false, voteCount: 0 },
  { id: "c", name: "Chi", alive: true, isBot: false, voteCount: 0 },
];

function recap(overrides: Partial<DayVoteRecap> = {}): DayVoteRecap {
  return {
    round: 2,
    mutations: [],
    finalBallots: [
      { voterId: "a", choice: { type: "PLAYER", targetId: "accused" } },
      { voterId: "b", choice: { type: "PLAYER", targetId: "accused" } },
      { voterId: "c", choice: { type: "NO_ELIMINATION" } },
    ],
    nomination: { kind: "TRIAL", accusedId: "accused" },
    finalJudgment: null,
    ...overrides,
  };
}

describe("summarizeDefenseVotes", () => {
  it("chỉ đếm phiếu nhắm vào bị cáo", () => {
    const summary = summarizeDefenseVotes(recap(), "accused", players);

    assert.equal(summary.votes, 2);
    assert.deepEqual(summary.voterIds, ["a", "b"]);
    assert.equal(summary.hasVoters, true);
    assert.equal(summary.round, 2);
  });

  it("đếm theo phiếu CHỐT, không theo số lần đổi phiếu", () => {
    // Một người đổi ý ba lần vẫn chỉ là một phiếu; đếm ở mutations sẽ ra ba.
    const summary = summarizeDefenseVotes(
      recap({
        finalBallots: [{ voterId: "a", choice: { type: "PLAYER", targetId: "accused" } }],
        mutations: [1, 2, 3].map((sequence) => ({
          id: `2:nomination:${sequence}`,
          round: 2,
          voterId: "a",
          previousChoice: null,
          choice: { type: "PLAYER" as const, targetId: "accused" },
          castAt: sequence * 1_000,
          phaseStartedAt: 0,
          phaseEndsAt: 30_000,
          sequence,
        })),
      }),
      "accused",
      players,
    );

    assert.equal(summary.votes, 1);
  });

  it("lùi về voteCount của snapshot khi server không gửi danh tính", () => {
    const summary = summarizeDefenseVotes(recap({ finalBallots: [] }), "accused", players);

    assert.equal(summary.votes, 3);
    assert.deepEqual(summary.voterIds, []);
    assert.equal(summary.hasVoters, false);
  });

  it("không có recap nào thì vẫn in được con số", () => {
    const summary = summarizeDefenseVotes(undefined, "accused", players);

    assert.equal(summary.votes, 3);
    assert.equal(summary.hasVoters, false);
    assert.equal(summary.round, null);
  });

  it("bị cáo lạ hoắc thì trả 0 chứ không nổ", () => {
    assert.deepEqual(summarizeDefenseVotes(recap(), "ai-do", players), {
      votes: 0,
      voterIds: [],
      hasVoters: false,
      round: 2,
    });
  });
});

describe("nominationRecapFor", () => {
  it("lấy vòng đã đề cử ĐÚNG bị cáo đang xử", () => {
    const first = recap({ round: 1, nomination: { kind: "TRIAL", accusedId: "accused" } });
    const second = recap({ round: 1, nomination: { kind: "NONE", reason: "tie" } });

    assert.equal(nominationRecapFor([first, second], "accused"), first);
  });

  it("lùi về vòng gần nhất khi không vòng nào khớp", () => {
    const only = recap({ nomination: { kind: "NONE", reason: "no-votes" } });

    assert.equal(nominationRecapFor([only], "accused"), only);
  });

  it("lịch sử rỗng thì trả undefined", () => {
    assert.equal(nominationRecapFor([], "accused"), undefined);
  });
});
