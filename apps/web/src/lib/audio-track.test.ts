import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PHASES } from "@masoi/shared";
import { trackFor, type Track } from "./audio-track";

describe("trackFor", () => {
  it("ban đêm có track riêng", () => {
    assert.equal(trackFor("NIGHT"), "night");
  });

  it("phòng chờ và các pha ban ngày dùng chung track ngày", () => {
    for (const phase of ["LOBBY", "ROLE_REVEAL", "NIGHT_RESULT", "DAY_DISCUSSION"] as const) {
      assert.equal(trackFor(phase), "day", phase);
    }
  });

  it("các pha quanh bỏ phiếu dùng chung track bỏ phiếu", () => {
    for (const phase of ["VOTING", "ELIMINATION", "CHECK_WIN"] as const) {
      assert.equal(trackFor(phase), "vote", phase);
    }
  });

  it("kết thúc ván thì tắt nhạc để tiếng win/lose vang một mình", () => {
    assert.equal(trackFor("GAME_OVER"), null);
  });

  it("không sót pha nào", () => {
    const allowed: (Track | null)[] = ["night", "day", "vote", null];
    for (const phase of PHASES) {
      assert.ok(allowed.includes(trackFor(phase)), phase);
    }
  });
});
