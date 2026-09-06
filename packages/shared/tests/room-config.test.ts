import { describe, expect, it } from "vitest";
import { gameActionPayload, roomConfigSchema, validateRoomConfig } from "../src/schemas";
import { DEFAULT_ROOM_CONFIG } from "../src/phases";

describe("RoomConfig SORCERER+ALPHA_WOLF", () => {
  it("rejects priest/medium keys (strict schema)", () => {
    expect(() => roomConfigSchema.parse({ ...DEFAULT_ROOM_CONFIG, priest: true })).toThrow();
    expect(() => roomConfigSchema.parse({ ...DEFAULT_ROOM_CONFIG, medium: true })).toThrow();
  });

  it("accepts sorcerer/alphaWolf keys", () => {
    expect(() =>
      roomConfigSchema.parse({ ...DEFAULT_ROOM_CONFIG, sorcerer: true, alphaWolf: true }),
    ).not.toThrow();
  });

  it("accepts SORCERER_CHECK and rejects HOLY_WATER", () => {
    expect(() =>
      gameActionPayload.parse({ type: "SORCERER_CHECK", targetId: "p1" }),
    ).not.toThrow();
    expect(() => gameActionPayload.parse({ type: "HOLY_WATER", targetId: "p1" })).toThrow();
  });

  it("counts alphaWolf in wolfCount but not sorcerer", () => {
    // 2 werewolves + alphaWolf = 3 wolves; sorcerer occupies a seat but is not a biter.
    // 8 players: 3 wolves + seer/guard/witch + sorcerer = 7 seats, 1 villager.
    const config = {
      ...DEFAULT_ROOM_CONFIG,
      werewolves: 2,
      villagers: 1,
      alphaWolf: true,
      sorcerer: true,
    };
    expect(validateRoomConfig(config, 8)).toBeNull();

    // Without alphaWolf the same deck needs 7 players, so 8 mismatches.
    const withoutAlpha = { ...config, alphaWolf: false };
    expect(validateRoomConfig(withoutAlpha, 8)).not.toBeNull();
  });
});
