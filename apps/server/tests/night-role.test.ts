import { describe, expect, it } from "vitest";
import { canActAtNight } from "../../web/src/lib/night-role";

describe("canActAtNight", () => {
  it("recognizes Guard even though its action order is zero", () => {
    expect(canActAtNight("GUARD")).toBe(true);
  });

  it("handles Apprentice Seer awakening state", () => {
    expect(canActAtNight("APPRENTICE_SEER", false)).toBe(false);
    expect(canActAtNight("APPRENTICE_SEER", true)).toBe(true);
  });

  it("recognizes new night roles Detective, Guardian Angel, Sorcerer, Wolf Cub, Alpha Wolf", () => {
    expect(canActAtNight("DETECTIVE")).toBe(true);
    expect(canActAtNight("GUARDIAN_ANGEL")).toBe(true);
    expect(canActAtNight("SORCERER")).toBe(true);
    expect(canActAtNight("WOLF_CUB")).toBe(true);
    expect(canActAtNight("ALPHA_WOLF")).toBe(true);
  });

  it("keeps Villager and Mayor asleep", () => {
    expect(canActAtNight("VILLAGER")).toBe(false);
    expect(canActAtNight("MAYOR")).toBe(false);
  });

  it("returns false before a role is known", () => {
    expect(canActAtNight(undefined)).toBe(false);
  });
});
