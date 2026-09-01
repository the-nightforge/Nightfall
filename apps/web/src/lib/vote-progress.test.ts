import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RoomSnapshot } from "@masoi/shared";
import { leaderLabel, voteProgressOf } from "./vote-progress";

type Player = RoomSnapshot["players"][number];

function player(patch: Partial<Player> & { id: string }): Player {
  return { name: patch.id, alive: true, isBot: false, ...patch };
}

function snapshot(patch: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    players: [],
    ...patch,
  } as unknown as RoomSnapshot;
}

describe("voteProgressOf", () => {
  it("chỉ đếm người còn sống vào mẫu số", () => {
    const progress = voteProgressOf(
      snapshot({
        players: [
          player({ id: "a" }),
          player({ id: "b" }),
          player({ id: "c", alive: false }),
        ],
      }),
    );
    assert.equal(progress.eligible, 2);
  });

  it("cast là SỐ NGƯỜI đã bỏ, không phải tổng trọng số phiếu", () => {
    // Thị Trưởng có phiếu x2: tổng voteCount là 3 trong khi chỉ có 2 người bỏ.
    const progress = voteProgressOf(
      snapshot({
        players: [player({ id: "a", voteCount: 3 }), player({ id: "b" })],
        openBallots: [
          { voterId: "mayor", choice: { type: "PLAYER", targetId: "a" } },
          { voterId: "b", choice: { type: "PLAYER", targetId: "a" } },
        ],
      }),
    );
    assert.equal(progress.cast, 2);
  });

  it("phiếu không treo ai vẫn là một người đã bỏ phiếu", () => {
    const progress = voteProgressOf(
      snapshot({
        players: [player({ id: "a" })],
        openBallots: [{ voterId: "a", choice: { type: "NO_ELIMINATION" } }],
      }),
    );
    assert.equal(progress.cast, 1);
  });

  it("server cũ không gửi openBallots thì nói không biết, không đoán", () => {
    const progress = voteProgressOf(snapshot({ players: [player({ id: "a", voteCount: 2 })] }));
    assert.equal(progress.cast, null);
  });

  it("chưa ai có phiếu thì không có người dẫn đầu", () => {
    const progress = voteProgressOf(snapshot({ players: [player({ id: "a" }), player({ id: "b" })] }));
    assert.equal(progress.leader, null);
    assert.equal(leaderLabel(progress), null);
  });

  it("người nhiều phiếu nhất là người dẫn đầu", () => {
    const progress = voteProgressOf(
      snapshot({
        players: [
          player({ id: "a", name: "An", voteCount: 1 }),
          player({ id: "b", name: "Bình", voteCount: 3 }),
        ],
      }),
    );
    assert.deepEqual(progress.leader, { name: "Bình", votes: 3, tied: false });
    assert.match(leaderLabel(progress)!, /Bình/);
  });

  it("bằng phiếu thì nói là hoà chứ không chọn bừa một tên", () => {
    const progress = voteProgressOf(
      snapshot({
        players: [
          player({ id: "a", name: "An", voteCount: 2 }),
          player({ id: "b", name: "Bình", voteCount: 2 }),
        ],
      }),
    );
    assert.equal(progress.leader?.tied, true);
    const label = leaderLabel(progress)!;
    assert.match(label, /hoà/);
    assert.doesNotMatch(label, /An|Bình/);
  });
});
