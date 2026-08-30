import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ROLES, roleTeam } from "@masoi/shared";
import { roleGoal } from "./role-goal";

describe("roleGoal", () => {
  it("mọi vai đều có mục tiêu, không vai nào rơi ra ngoài", () => {
    for (const role of ROLES) {
      assert.ok(roleGoal(role).length > 0, role);
    }
  });

  it("cùng phe thì cùng mục tiêu - luật thắng tính theo phe, không theo vai", () => {
    for (const role of ROLES) {
      const expected = roleTeam(role) === "wolves" ? roleGoal("WEREWOLF") : roleGoal("VILLAGER");
      assert.equal(roleGoal(role), expected, role);
    }
  });

  it("hai phe không dùng chung một câu", () => {
    assert.notEqual(roleGoal("WEREWOLF"), roleGoal("SEER"));
  });

  it("Kẻ Nguyền Rủa khởi đầu ở phe làng nên đọc mục tiêu của làng", () => {
    assert.equal(roleGoal("CURSED"), roleGoal("VILLAGER"));
  });
});
