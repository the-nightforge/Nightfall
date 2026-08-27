import { describe, expect, it } from "vitest";
import { CLIENT_EVENTS, skipDiscussionPayload } from "@masoi/shared";

describe("skip discussion contract", () => {
  it("dùng một tên Socket.IO ổn định cho client và server", () => {
    expect(CLIENT_EVENTS.GAME_SKIP_DISCUSSION).toBe("game:skip-discussion");
  });

  it("chỉ nhận payload boolean nghiêm ngặt", () => {
    expect(skipDiscussionPayload.parse({ skip: true })).toEqual({ skip: true });
    expect(skipDiscussionPayload.parse({ skip: false })).toEqual({ skip: false });
    expect(skipDiscussionPayload.safeParse({ skip: "true" }).success).toBe(false);
    expect(skipDiscussionPayload.safeParse({ skip: true, votes: 3 }).success).toBe(false);
  });
});
