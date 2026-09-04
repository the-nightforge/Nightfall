import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DisconnectReason } from "livekit-client";
import { classifyDisconnect, type VoiceDisconnectKind } from "./voice-disconnect";

/**
 * Phân loại lý do LiveKit ngắt kết nối.
 *
 * Bản trước bóp toàn bộ chuyện này xuống MỘT boolean - `duplicate` hay không -
 * nên `PARTICIPANT_REMOVED` (bị đuổi khỏi phòng) và `ROOM_DELETED` (host tắt
 * voice) rơi vào cùng một rổ với "rớt mạng". Hậu quả: người vừa bị đuổi khỏi
 * phòng lập tức được client tự động xin token vào lại, lặp mỗi lần thức dậy.
 *
 * Bộ test này chạy trên `DisconnectReason` THẬT của SDK chứ không phải một bản
 * giả, vì chính việc thay enum bằng boolean là thứ đã giấu lỗi đi.
 */

/**
 * Kỳ vọng cho TỪNG thành viên của enum, liệt kê đủ.
 *
 * Cố ý không dùng "mặc định là recoverable" ở đây: bảng đủ nghĩa là khi SDK
 * thêm một lý do mới, test dưới cùng sẽ đỏ và buộc người nâng cấp phải quyết
 * định nó thuộc nhóm nào - thay vì lặng lẽ để nó thành "cứ nối lại đi".
 */
const EXPECTED: Record<string, VoiceDisconnectKind> = {
  UNKNOWN_REASON: "recoverable",
  CLIENT_INITIATED: "recoverable",
  DUPLICATE_IDENTITY: "duplicate",
  SERVER_SHUTDOWN: "recoverable",
  PARTICIPANT_REMOVED: "participant_removed",
  ROOM_DELETED: "room_deleted",
  STATE_MISMATCH: "recoverable",
  JOIN_FAILURE: "recoverable",
  MIGRATION: "recoverable",
  SIGNAL_CLOSE: "recoverable",
  ROOM_CLOSED: "recoverable",
  USER_UNAVAILABLE: "recoverable",
  USER_REJECTED: "recoverable",
  SIP_TRUNK_FAILURE: "recoverable",
  CONNECTION_TIMEOUT: "recoverable",
  MEDIA_FAILURE: "recoverable",
  AGENT_ERROR: "recoverable",
};

/** Chỉ lấy nhánh tên -> số; enum của TypeScript ánh xạ cả hai chiều. */
function members(): Array<[string, DisconnectReason]> {
  return Object.entries(DisconnectReason).filter(
    (entry): entry is [string, DisconnectReason] => typeof entry[1] === "number",
  );
}

describe("ba lý do NGẮT CÓ CHỦ ĐÍCH, không phải rớt mạng", () => {
  it("trùng danh tính: chính người này vừa mở tab khác", () => {
    assert.equal(classifyDisconnect(DisconnectReason.DUPLICATE_IDENTITY), "duplicate");
  });

  it("bị gỡ khỏi room: rời phòng hoặc bị đuổi", () => {
    assert.equal(
      classifyDisconnect(DisconnectReason.PARTICIPANT_REMOVED),
      "participant_removed",
    );
  });

  it("room bị xoá: host tắt voice, hoặc phòng game biến mất", () => {
    assert.equal(classifyDisconnect(DisconnectReason.ROOM_DELETED), "room_deleted");
  });
});

describe("mọi lý do còn lại đều là mất kết nối phục hồi được", () => {
  it("tín hiệu đứt - ca thường gặp nhất khi app ra nền", () => {
    assert.equal(classifyDisconnect(DisconnectReason.SIGNAL_CLOSE), "recoverable");
  });

  it("server khởi động lại: người chơi vẫn thuộc về phòng, cứ vào lại", () => {
    assert.equal(classifyDisconnect(DisconnectReason.SERVER_SHUTDOWN), "recoverable");
  });

  it("không có lý do nào cả thì cũng vậy", () => {
    assert.equal(classifyDisconnect(undefined), "recoverable");
  });

  it("UNKNOWN_REASON là 0 - không được rơi vào bẫy giá trị falsy", () => {
    /*
     * `UNKNOWN_REASON === 0`, nên mọi kiểm tra kiểu `if (reason)` đều coi nó là
     * "không có lý do". Ở đây hai đường cùng ra `recoverable` nên vô hại, nhưng
     * bẫy này đáng được ghim lại trước khi ai đó thêm một nhánh mới.
     */
    assert.equal(DisconnectReason.UNKNOWN_REASON, 0);
    assert.equal(classifyDisconnect(DisconnectReason.UNKNOWN_REASON), "recoverable");
  });
});

describe("phủ kín enum của SDK", () => {
  it("mọi lý do SDK có đều đã được phân loại tường minh", () => {
    for (const [name, value] of members()) {
      const expected = EXPECTED[name];
      assert.ok(
        expected,
        `SDK có thêm lý do "${name}" mà chưa ai quyết định nó là ngắt có chủ đích hay rớt mạng`,
      );
      assert.equal(classifyDisconnect(value), expected, `phân loại sai cho ${name}`);
    }
  });

  it("và bảng kỳ vọng không nhắc tới lý do SDK đã bỏ đi", () => {
    const live = new Set(members().map(([name]) => name));
    for (const name of Object.keys(EXPECTED)) {
      assert.ok(live.has(name), `"${name}" không còn trong SDK - bỏ khỏi bảng kỳ vọng`);
    }
  });
});
