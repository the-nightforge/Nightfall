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
      // Phe TRUNG LẬP là ngoại lệ có chủ đích: nó không có luật thắng chung nào
      // để mà chia sẻ, mỗi vai trung lập thắng theo cách riêng. Xem `role-goal.ts`.
      if (roleTeam(role) === "neutral") continue;
      const expected = roleTeam(role) === "wolves" ? roleGoal("WEREWOLF") : roleGoal("VILLAGER");
      assert.equal(roleGoal(role), expected, role);
    }
  });

  it("hai phe không dùng chung một câu", () => {
    assert.notEqual(roleGoal("WEREWOLF"), roleGoal("SEER"));
  });

  it("Thằng Hề đọc mục tiêu RIÊNG, không phải mục tiêu của phe nào", () => {
    // Đây là chỗ dễ hỏng nhất khi thêm vai trung lập tiếp theo: một nhánh
    // `else` rộng tay sẽ đưa nó về câu của phe làng, và thẻ vai sẽ dạy người
    // chơi chơi ngược hẳn điều kiện thắng của chính họ.
    const goal = roleGoal("JESTER");
    assert.notEqual(goal, roleGoal("VILLAGER"));
    assert.notEqual(goal, roleGoal("WEREWOLF"));
    assert.match(goal, /treo cổ/);
  });

  it("Kẻ Nguyền Rủa khởi đầu ở phe làng nên đọc mục tiêu của làng", () => {
    assert.equal(roleGoal("CURSED"), roleGoal("VILLAGER"));
  });
});
