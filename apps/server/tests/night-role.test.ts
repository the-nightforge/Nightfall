import { describe, expect, it } from "vitest";
import { canActAtNight } from "../../web/src/lib/night-role";

describe("canActAtNight", () => {
  it("recognizes Guard even though its action order is zero", () => {
    expect(canActAtNight("GUARD")).toBe(true);
  });

  it("keeps Villager asleep", () => {
    expect(canActAtNight("VILLAGER")).toBe(false);
  });

  it("returns false before a role is known", () => {
    expect(canActAtNight(undefined)).toBe(false);
  });
});
