import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ROLES, type Role } from "@masoi/shared";
import { ROLE_ICON_PATHS } from "./role-art";

describe("role-art", () => {
  it("provides SVG path for all roles", () => {
    for (const role of ROLES) {
      const path = ROLE_ICON_PATHS[role];
      assert.ok(path, `Missing path for role: ${role}`);
      assert.ok(path.length > 20, `Path too short for role: ${role}`);
      assert.ok(path.startsWith("M") || path.startsWith("m"), `Path should start with M/m: ${role}`);
    }
  });

  it("hard-deleted roles have no art left", () => {
    assert.equal((ROLE_ICON_PATHS as Partial<Record<string, string>>)["PRIEST"], undefined);
    assert.equal((ROLE_ICON_PATHS as Partial<Record<string, string>>)["MEDIUM"], undefined);
  });

  it("new wolves have hand-drawn art, no emoji", () => {
    for (const role of ["SORCERER", "ALPHA_WOLF"] as Role[]) {
      const path = ROLE_ICON_PATHS[role];
      assert.ok(path.length > 20, `Path too short for role: ${role}`);
      for (const ch of path) {
        assert.ok(ch.codePointAt(0)! < 256, `Non-path char in art for ${role}`);
      }
    }
  });
});
