import { describe, expect, it } from "vitest";
import { DEFAULT_ROOM_CONFIG, hunterShotPayload, roomConfigSchema } from "@masoi/shared";

describe("Hunter schemas", () => {
  it("accepts the toggle, a target, and an intentional skip", () => {
    expect(roomConfigSchema.parse({ ...DEFAULT_ROOM_CONFIG, hunter: true }).hunter).toBe(true);
    expect(hunterShotPayload.parse({ targetId: "p2" })).toEqual({ targetId: "p2" });
    expect(hunterShotPayload.parse({ targetId: null })).toEqual({ targetId: null });
  });
});
