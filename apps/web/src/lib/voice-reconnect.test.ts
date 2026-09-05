import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RECONNECT_COOLDOWN_MS, createReconnectGate, type ReconnectInput } from "./voice-reconnect";

/**
 * Bốn nguồn tín hiệu "app sống lại" bắn gần như cùng lúc.
 *
 * Quay lại một tab đã ngủ trên iOS thường cho cả `visibilitychange`, `pageshow`
 * lẫn `online` trong vài mili giây, rồi socket nối lại ngay sau đó. Bốn tín
 * hiệu, cùng một sự kiện đời thực - nếu mỗi cái tự xin một token thì server ký
 * bốn token và LiveKit nhận bốn lần join cùng danh tính, mà trùng danh tính
 * thì chính nó đá nhau.
 */
function joined(over: Partial<ReconnectInput> = {}): ReconnectInput {
  return {
    connection: "idle",
    joinedByUser: true,
    duplicate: false,
    visible: true,
    online: true,
    canRequest: true,
    ...over,
  };
}

describe("createReconnectGate", () => {
  it("người đã từng vào voice mà đang rớt: cho nối lại", () => {
    const gate = createReconnectGate();
    assert.equal(gate.request(joined(), 0), true);
  });

  it("bốn tín hiệu cùng lúc chỉ sinh MỘT lần xin token", () => {
    const gate = createReconnectGate();
    const fired = [
      gate.request(joined(), 0),
      gate.request(joined(), 1),
      gate.request(joined(), 2),
      gate.request(joined(), 3),
    ];
    assert.deepEqual(fired, [true, false, false, false]);
  });

  it("đang nối hoặc đã nối thì không xin thêm", () => {
    const gate = createReconnectGate();
    assert.equal(gate.request(joined({ connection: "connecting" }), 0), false);
    assert.equal(gate.request(joined({ connection: "connected" }), 0), false);
  });

  it("lần trước hỏng thì vẫn thử lại được, nhưng phải qua thời gian nghỉ", () => {
    const gate = createReconnectGate();
    assert.equal(gate.request(joined(), 0), true);
    gate.settle();
    assert.equal(
      gate.request(joined({ connection: "failed" }), RECONNECT_COOLDOWN_MS - 1),
      false,
      "chưa hết thời gian nghỉ: không được phát token liên tục",
    );
    assert.equal(gate.request(joined({ connection: "failed" }), RECONNECT_COOLDOWN_MS), true);
  });
});

describe("những ai KHÔNG được tự nối lại", () => {
  it("người chưa từng bấm tham gia voice: không bao giờ tự vào", () => {
    const gate = createReconnectGate();
    assert.equal(gate.request(joined({ joinedByUser: false }), 0), false);
  });

  it("bị đá vì mở tab khác: phải chờ người dùng chọn tab nào", () => {
    /*
     * Không có luật này thì hai tab tự nối lại rồi thay nhau đá nhau vô tận -
     * mỗi vòng là một token mới và một lần cả bàn mất tiếng của người đó.
     */
    const gate = createReconnectGate();
    assert.equal(gate.request(joined({ duplicate: true }), 0), false);
  });

  it("chủ động ngắt rồi thì im: `joinedByUser` đã bị xoá cùng lúc", () => {
    const gate = createReconnectGate();
    assert.equal(gate.request(joined({ joinedByUser: false, connection: "idle" }), 0), false);
  });
});

/**
 * Ba điều kiện của MÔI TRƯỜNG, tách khỏi ba điều kiện của trạng thái voice.
 *
 * Chúng nằm trong cổng chứ không nằm rải ở từng listener, vì giờ có tới NĂM
 * đường gọi tới cổng - bốn tín hiệu thức dậy cộng với chính lúc LiveKit báo
 * mất kết nối. Đường thứ năm không đi kèm một sự kiện trình duyệt nào để suy ra
 * "app đang hiện và có mạng", nên nếu điều kiện ấy không nằm ở đây thì nó sẽ
 * không được kiểm ở đâu cả.
 */
describe("điều kiện môi trường", () => {
  it("trang đang ẩn thì chờ: nối lại lúc app nằm nền gần như chắc chắn hỏng", () => {
    const gate = createReconnectGate();
    assert.equal(gate.request(joined({ visible: false }), 0), false);
  });

  it("và khi trang hiện lại thì đi tiếp - không bị thời gian nghỉ chặn nhầm", () => {
    /*
     * Lượt bị từ chối KHÔNG được ghi mốc thời gian: nếu ghi, một lần thử lúc
     * đang ẩn sẽ khoá luôn lần thử thật ngay sau đó khi người dùng mở lại app.
     */
    const gate = createReconnectGate();
    assert.equal(gate.request(joined({ visible: false }), 0), false);
    assert.equal(gate.request(joined({ visible: true }), 1), true);
  });

  it("mất mạng thì chờ sự kiện online", () => {
    const gate = createReconnectGate();
    assert.equal(gate.request(joined({ online: false }), 0), false);
    assert.equal(gate.request(joined({ online: true }), 1), true);
  });

  it("chưa có socket thì không có ai để hỏi xin token", () => {
    const gate = createReconnectGate();
    assert.equal(gate.request(joined({ canRequest: false }), 0), false);
    assert.equal(gate.request(joined({ canRequest: true }), 1), true);
  });
});
