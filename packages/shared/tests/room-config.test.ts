import { describe, expect, it } from "vitest";
import { gameActionPayload, roomConfigSchema } from "../src/schemas";
import { DEFAULT_ROOM_CONFIG } from "../src/phases";

describe("RoomConfig voice mặc định", () => {
  it("phòng mới bật voice chat ngay từ đầu", () => {
    expect(DEFAULT_ROOM_CONFIG.voice).toBe(true);
  });
});

describe("RoomConfig SORCERER", () => {
  it("rejects priest/medium keys (strict schema)", () => {
    expect(() => roomConfigSchema.parse({ ...DEFAULT_ROOM_CONFIG, priest: true })).toThrow();
    expect(() => roomConfigSchema.parse({ ...DEFAULT_ROOM_CONFIG, medium: true })).toThrow();
  });

  it("accepts sorcerer key", () => {
    expect(() =>
      roomConfigSchema.parse({ ...DEFAULT_ROOM_CONFIG, sorcerer: true }),
    ).not.toThrow();
  });

  it("accepts SORCERER_CHECK and rejects HOLY_WATER", () => {
    expect(() =>
      gameActionPayload.parse({ type: "SORCERER_CHECK", targetId: "p1" }),
    ).not.toThrow();
    expect(() => gameActionPayload.parse({ type: "HOLY_WATER", targetId: "p1" })).toThrow();
  });

  it("rejects the removed alphaWolf key", () => {
    expect(roomConfigSchema.safeParse({ ...DEFAULT_ROOM_CONFIG, alphaWolf: true }).success).toBe(false);
  });
});
