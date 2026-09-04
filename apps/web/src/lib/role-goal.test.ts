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

  it("cả hai phe đều phải nhắc tới Sát Nhân - `checkWin` xét vai đó TRƯỚC", () => {
    /*
     * Còn một Sát Nhân sống thì `checkWin` trả `null`, kể cả khi con Sói cuối
     * vừa ngã (làng lẽ ra đã thắng) hoặc bầy Sói đã hoà quân số (Sói lẽ ra đã
     * thắng). Một thẻ vai bỏ vế đó ra là dạy hai phe chơi theo một luật thắng
     * mà engine không hề chạy.
     */
    assert.match(roleGoal("VILLAGER"), /Sát Nhân/);
    assert.match(roleGoal("WEREWOLF"), /Sát Nhân/);
  });

  it("Thằng Hề KHÔNG phải điều kiện thắng của phe nào", () => {
    // Sổ của Hề là `personalWins`, không phải một vế trong `checkWin`: làng
    // thắng được với một Thằng Hề còn sống nguyên trên bàn.
    assert.doesNotMatch(roleGoal("VILLAGER"), /Hề/);
    assert.doesNotMatch(roleGoal("WEREWOLF"), /Hề/);
  });
});
