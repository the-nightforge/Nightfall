import { describe, expect, it } from "vitest";
import type { RoomSnapshot } from "@masoi/shared";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { engineVote, usablePlannedVote } from "../src/bots/targets";
import type { PlannedVote } from "../src/bots/types";

const forPlayer = (targetId: string): PlannedVote => ({ type: "PLAYER", targetId });

function votingView(): RoomSnapshot {
  return {
    code: "ABCDE",
    hostId: "a",
    phase: "VOTING",
    config: { ...DEFAULT_ROOM_CONFIG },
    round: 2,
    phaseEndsAt: null,
    you: { id: "a", name: "A", ready: true, connected: true, role: "VILLAGER", alive: true },
    players: [
      { id: "a", name: "A", alive: true, isBot: true },
      { id: "b", name: "B", alive: true, isBot: false },
      { id: "c", name: "C", alive: false, isBot: false },
    ],
    night: null,
    hasVoted: false,
    myVote: null,
    noEliminationVoteCount: 0,
    discussionSkip: null,
    votesRevealed: false,
    nightHistory: [],
    lastNightDeaths: [],
    lastEliminated: null,
    winner: null,
    chatLog: [],
    log: [],
  };
}

describe("usablePlannedVote", () => {
  it("giữ phiếu đã định khi mục tiêu còn sống", () => {
    expect(usablePlannedVote(votingView(), forPlayer("b"))).toEqual(forPlayer("b"));
  });

  it("bỏ phiếu đã định khi mục tiêu đã chết giữa chừng", () => {
    expect(usablePlannedVote(votingView(), forPlayer("c"))).toBeNull();
  });

  it("bỏ phiếu đã định trỏ vào người không tồn tại", () => {
    expect(usablePlannedVote(votingView(), forPlayer("khong-co"))).toBeNull();
  });

  it("bỏ phiếu tự bầu chính mình", () => {
    expect(usablePlannedVote(votingView(), forPlayer("a"))).toBeNull();
  });

  it("trả null khi bot chưa định phiếu nào", () => {
    expect(usablePlannedVote(votingView(), undefined)).toBeNull();
  });

  it("giữ phiếu không treo ai: không có mục tiêu để mà hết hợp lệ", () => {
    expect(usablePlannedVote(votingView(), { type: "NO_ELIMINATION" })).toEqual({
      type: "NO_ELIMINATION",
    });
  });
});

describe("engineVote", () => {
  it("phiếu cho người chơi giữ nguyên id", () => {
    expect(engineVote(forPlayer("b"))).toBe("b");
  });

  it("phiếu không treo ai thành null, đúng cách engine mã hoá lựa chọn đó", () => {
    expect(engineVote({ type: "NO_ELIMINATION" })).toBeNull();
  });
});
