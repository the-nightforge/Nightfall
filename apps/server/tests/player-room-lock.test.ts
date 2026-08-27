import { describe, expect, it } from "vitest";
import { withPlayerRoomLock } from "../src/rooms/player-room-lock";

describe("withPlayerRoomLock", () => {
  it("serializes concurrent membership changes for the same player", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const holdFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withPlayerRoomLock("player", async () => {
      order.push("first:start");
      firstStarted();
      await holdFirst;
      order.push("first:end");
      return "first";
    });
    await started;

    const second = withPlayerRoomLock("player", async () => {
      order.push("second:start");
      order.push("second:end");
      return "second";
    });
    await Promise.resolve();
    expect(order).toEqual(["first:start"]);

    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
    expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  it("does not block operations for different players", async () => {
    let releaseFirst!: () => void;
    const holdFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = withPlayerRoomLock("player-a", () => holdFirst);

    await expect(withPlayerRoomLock("player-b", async () => "done")).resolves.toBe("done");
    releaseFirst();
    await first;
  });
});
