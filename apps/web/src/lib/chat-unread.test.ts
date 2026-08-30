import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatMessage } from "@masoi/shared";
import { NOTHING_SEEN, countUnread, markAllRead, unreadLabel } from "./chat-unread";

function msg(id: string, playerId: string): ChatMessage {
  return { id, channel: "day", playerId, playerName: playerId, text: id, at: 0 };
}

describe("countUnread", () => {
  it("chưa có tin nào thì không có gì chưa đọc", () => {
    assert.equal(countUnread([], NOTHING_SEEN, "me"), 0);
  });

  it("chỉ đếm phần đến sau mốc", () => {
    const messages = [msg("a", "x"), msg("b", "y"), msg("c", "z")];
    assert.equal(countUnread(messages, { lastSeenId: "a" }, "me"), 2);
    assert.equal(countUnread(messages, { lastSeenId: "c" }, "me"), 0);
  });

  it("tin của chính mình không phải tin chưa đọc", () => {
    const messages = [msg("a", "x"), msg("b", "me"), msg("c", "z")];
    assert.equal(countUnread(messages, { lastSeenId: "a" }, "me"), 1);
  });

  it("mốc đã trôi khỏi log thì đếm tất, thà báo thừa còn hơn giấu mất", () => {
    const messages = [msg("d", "x"), msg("e", "y")];
    assert.equal(countUnread(messages, { lastSeenId: "a" }, "me"), 2);
  });

  it("chưa đọc gì lần nào thì đếm tất", () => {
    const messages = [msg("a", "x"), msg("b", "y")];
    assert.equal(countUnread(messages, NOTHING_SEEN, "me"), 2);
  });
});

describe("markAllRead", () => {
  it("đặt mốc ở tin cuối", () => {
    assert.deepEqual(markAllRead([msg("a", "x"), msg("b", "y")]), { lastSeenId: "b" });
  });

  it("danh sách rỗng thì mốc rỗng, không phải undefined", () => {
    assert.deepEqual(markAllRead([]), { lastSeenId: null });
  });
});

describe("unreadLabel", () => {
  it("cắt ở 99+ vì con số chính xác không còn nghĩa", () => {
    assert.equal(unreadLabel(7), "7");
    assert.equal(unreadLabel(99), "99");
    assert.equal(unreadLabel(140), "99+");
  });
});
