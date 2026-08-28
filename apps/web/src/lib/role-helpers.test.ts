import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ROLES, ROLE_META, type Role } from "@masoi/shared";
import { getRoleLabel, getRoleDescription, getRoleTeam } from "./role-helpers";

describe("role-helpers", () => {
  it("returns human friendly label and description for all roles", () => {
    for (const role of ROLES) {
      assert.equal(getRoleLabel(role), ROLE_META[role].name);
      assert.equal(getRoleDescription(role), ROLE_META[role].description);
      assert.equal(getRoleTeam(role), ROLE_META[role].team);
    }
  });

  it("handles new roles correctly", () => {
    assert.equal(getRoleLabel("WOLF_CUB"), "Sói Con");
    assert.equal(getRoleLabel("APPRENTICE_SEER"), "Tiên Tri Tập Sự");
    assert.equal(getRoleLabel("DETECTIVE"), "Thám Tử");
    assert.equal(getRoleLabel("GUARDIAN_ANGEL"), "Thiên Thần Hộ Mệnh");
    assert.equal(getRoleLabel("PRIEST"), "Linh Mục");
    assert.equal(getRoleLabel("MAYOR"), "Thị Trưởng");
  });
});
