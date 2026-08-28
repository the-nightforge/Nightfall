import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_ROOM_CONFIG, type PlayerView, type RoomSnapshot } from "@masoi/shared";
import { NO_ELIMINATION_KEY, voteFlightsFor } from "./vote-motion";

function player(id: string, voteCount?: number): PlayerView {
  return { id, name: id.toUpperCase(), alive: true, isBot: false, voteCount };
}

/** "a>b" là a bỏ phiếu cho b; "a>-" là a chọn không treo ai. */
function ballots(...spec: string[]): NonNullable<RoomSnapshot["openBallots"]> {
  return spec.map((entry) => {
    const [voterId, target] = entry.split(">");
    return {
      voterId,
      choice:
        target === "-"
          ? ({ type: "NO_ELIMINATION" } as const)
          : ({ type: "PLAYER", targetId: target } as const),
    };
  });
}

function snapshot(over: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "ABCDE",
    hostId: "me",
    phase: "VOTING",
    config: { ...DEFAULT_ROOM_CONFIG },
    round: 1,
    phaseEndsAt: null,
    you: { id: "me", name: "Tôi", ready: true, connected: true, role: "VILLAGER", alive: true },
    players: [player("me"), player("a"), player("b")],
    night: null,
    hunterShot: null,
    trial: null,
    lastTrial: null,
    hasVoted: false,
    myVote: null,
    noEliminationVoteCount: 0,
    openBallots: [],
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

describe("voteFlightsFor", () => {
  it("snapshot đầu tiên không bắn gì: vào phòng giữa pha vote là đã có sẵn phiếu", () => {
    assert.deepEqual(voteFlightsFor(null, snapshot({ openBallots: ballots("a>b") })), []);
  });

  it("ngoài pha VOTING không bắn gì", () => {
    const before = snapshot({ phase: "FINAL_VOTE" });
    const after = snapshot({ phase: "FINAL_VOTE", openBallots: ballots("a>b") });
    assert.deepEqual(voteFlightsFor(before, after), []);
  });

  it("sang vòng mới không bắn gì: bảng phiếu về rỗng là reset", () => {
    const before = snapshot({ round: 1, openBallots: ballots("a>b") });
    const after = snapshot({ round: 2, openBallots: ballots("a>me") });
    assert.deepEqual(voteFlightsFor(before, after), []);
  });

  it("lá phiếu mới bay từ ghế người bỏ tới ghế người bị bỏ", () => {
    const before = snapshot({ openBallots: [] });
    const after = snapshot({ openBallots: ballots("a>b") });
    assert.deepEqual(voteFlightsFor(before, after), [{ voterId: "a", targetKey: "b" }]);
  });

  it("đổi phiếu chỉ bay tới ghế mới, không bay ngược về ghế cũ", () => {
    const before = snapshot({ openBallots: ballots("a>b") });
    const after = snapshot({ openBallots: ballots("a>me") });
    assert.deepEqual(voteFlightsFor(before, after), [{ voterId: "a", targetKey: "me" }]);
  });

  it("giữ nguyên ý định thì im, dù snapshot được đẩy lại", () => {
    const view = snapshot({ openBallots: ballots("a>b", "me>b") });
    assert.deepEqual(voteFlightsFor(view, view), []);
  });

  it("nhiều người bỏ cùng lúc thì mỗi người một lá", () => {
    const before = snapshot({ openBallots: ballots("a>b") });
    const after = snapshot({ openBallots: ballots("a>b", "me>b") });
    assert.deepEqual(voteFlightsFor(before, after), [{ voterId: "me", targetKey: "b" }]);
  });

  it('"Không treo ai" có khoá riêng vì nó không có ghế', () => {
    const before = snapshot({ openBallots: [] });
    const after = snapshot({ openBallots: ballots("a>-") });
    assert.deepEqual(voteFlightsFor(before, after), [
      { voterId: "a", targetKey: NO_ELIMINATION_KEY },
    ]);
  });

  describe("server cũ chưa gửi danh tính", () => {
    it("rơi ẩn danh theo phần chênh của số phiếu", () => {
      const before = snapshot({ openBallots: undefined, players: [player("a"), player("b")] });
      const after = snapshot({ openBallots: undefined, players: [player("a"), player("b", 1)] });
      assert.deepEqual(voteFlightsFor(before, after), [{ voterId: null, targetKey: "b" }]);
    });

    it("phiếu Thị Trưởng nặng x2 vẫn chỉ là một lá", () => {
      const before = snapshot({ openBallots: undefined, players: [player("b")] });
      const after = snapshot({ openBallots: undefined, players: [player("b", 2)] });
      assert.deepEqual(voteFlightsFor(before, after), [{ voterId: null, targetKey: "b" }]);
    });

    it("server deploy giữa vòng không bắn lại toàn bộ phiếu đã có", () => {
      const before = snapshot({ openBallots: undefined, players: [player("b", 2)] });
      const after = snapshot({ openBallots: ballots("a>b", "me>b"), players: [player("b", 2)] });
      assert.deepEqual(voteFlightsFor(before, after), []);
    });
  });
});
