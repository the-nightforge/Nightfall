import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PHASES } from "@masoi/shared";
import { MOODS, moodFor } from "./mood";

describe("moodFor", () => {
  it("đêm và lúc lật vai cùng một không khí", () => {
    assert.equal(moodFor("ROLE_REVEAL"), "night");
    assert.equal(moodFor("NIGHT"), "night");
  });

  it("trời sáng sau đêm rồi mới sang ban ngày hẳn", () => {
    assert.equal(moodFor("NIGHT_RESULT"), "dawn");
    assert.equal(moodFor("DAY_DISCUSSION"), "day");
  });

  it("cả mạch từ đề cử tới công bố dùng chung một không khí, không nhấp nháy giữa chừng", () => {
    for (const phase of ["VOTING", "DEFENSE", "FINAL_VOTE", "ELIMINATION", "HUNTER_SHOT", "CHECK_WIN"] as const) {
      assert.equal(moodFor(phase), "trial", phase);
    }
  });

  it("không sót pha nào", () => {
    for (const phase of PHASES) {
      assert.ok(MOODS.includes(moodFor(phase)), phase);
    }
  });
});
