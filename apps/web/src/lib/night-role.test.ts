import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canActAtNight } from "./night-role";

describe("night-role canActAtNight", () => {
  it("allows roles with night actions to act", () => {
    expectAct("WEREWOLF", true);
    expectAct("WOLF_CUB", true);
    expectAct("SEER", true);
    expectAct("APPRENTICE_SEER", false); // unawakened
    expectAct("APPRENTICE_SEER", true, true); // awakened
    expectAct("GUARD", true);
    expectAct("GUARDIAN_ANGEL", true);
    expectAct("DETECTIVE", true);
    expectAct("PRIEST", true);
    expectAct("WITCH", true);
  });

  it("does not allow passive/day roles to act at night", () => {
    expectAct("HUNTER", false);
    expectAct("MAYOR", false);
    expectAct("CURSED", false);
    expectAct("VILLAGER", false);
    expectAct(undefined, false);
  });

  function expectAct(role: Parameters<typeof canActAtNight>[0], expected: boolean, awakened = false) {
    assert.equal(canActAtNight(role, awakened), expected, `Failed for role ${role} (awakened=${awakened})`);
  }
});
