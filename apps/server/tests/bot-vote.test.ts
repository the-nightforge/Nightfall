import { describe, expect, it } from "vitest";
import type { RoomSnapshot } from "@masoi/shared";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { usablePlannedVote } from "../src/bots/targets";

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
    myVote: null,
    votesRevealed: false,
    lastNightDeaths: [],
    lastEliminated: null,
    winner: null,
    chatLog: [],
    log: [],
  };
}

describe("usablePlannedVote", () => {
  it("giữ phiếu đã định khi mục tiêu còn sống", () => {
    expect(usablePlannedVote(votingView(), "b")).toBe("b");
  });

  it("bỏ phiếu đã định khi mục tiêu đã chết giữa chừng", () => {
    expect(usablePlannedVote(votingView(), "c")).toBeNull();
  });

  it("bỏ phiếu đã định trỏ vào người không tồn tại", () => {
    expect(usablePlannedVote(votingView(), "khong-co")).toBeNull();
  });

  it("bỏ phiếu tự bầu chính mình", () => {
    expect(usablePlannedVote(votingView(), "a")).toBeNull();
  });

  it("trả null khi bot chưa định phiếu nào", () => {
    expect(usablePlannedVote(votingView(), undefined)).toBeNull();
  });
});
