import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  initialVoiceState,
  micShouldBeOpen,
  voiceReducer,
  voiceUi,
  type VoiceState,
} from "./voice-state";

function run(actions: Parameters<typeof voiceReducer>[1][]): VoiceState {
  return actions.reduce(voiceReducer, initialVoiceState);
}

/** Trạng thái đã nối xong và LiveKit đã cấp quyền nói. */
const READY: Parameters<typeof voiceReducer>[1][] = [
  { type: "connect_requested" },
  { type: "connected" },
  { type: "livekit_permission", canPublish: true },
];

describe("micShouldBeOpen", () => {
  it("chưa nối thì giữ nút cũng không mở mic", () => {
    const state = run([{ type: "hold_start" }]);
    assert.equal(micShouldBeOpen(state), false);
  });

  it("nối rồi nhưng LiveKit chưa cấp quyền thì vẫn không mở", () => {
    const state = run([{ type: "connect_requested" }, { type: "connected" }, { type: "hold_start" }]);
    assert.equal(micShouldBeOpen(state), false);
  });

  it("đủ ba điều kiện mới mở: đã nối, LiveKit cho phép, đang giữ nút", () => {
    const state = run([...READY, { type: "hold_start" }]);
    assert.equal(micShouldBeOpen(state), true);
  });

  it("nhả nút là đóng ngay", () => {
    const state = run([...READY, { type: "hold_start" }, { type: "hold_end" }]);
    assert.equal(micShouldBeOpen(state), false);
  });
});

describe("quyền chỉ đến từ LiveKit, không từ snapshot", () => {
  /**
   * Đây là điều kiện sống còn của cả thiết kế: token không mang quyền nói, nên
   * client tin snapshot để MỞ mic là mở vào lúc LiveKit còn đang từ chối.
   */
  it("snapshot nói được nói cũng không đủ để mở mic", () => {
    const state = run([
      { type: "connect_requested" },
      { type: "connected" },
      { type: "snapshot_can_publish", canPublish: true },
      { type: "hold_start" },
    ]);
    assert.equal(micShouldBeOpen(state), false);
  });

  it("nhưng snapshot nói KHÔNG được nói thì đóng mic ngay, không đợi LiveKit", () => {
    // Chiều thu quyền dùng lớp nhanh: client tự tắt trước, server vẫn là lớp chắc.
    const state = run([
      ...READY,
      { type: "hold_start" },
      { type: "snapshot_can_publish", canPublish: false },
    ]);
    assert.equal(micShouldBeOpen(state), false);
  });
});

describe("đua giữa nhả nút và promise mở mic", () => {
  it("nhả nút trước khi mic kịp mở thì kết quả cuối vẫn là đóng", () => {
    const state = run([
      ...READY,
      { type: "hold_start" },
      { type: "hold_end" },
      // Promise mở mic về muộn, sau khi người dùng đã nhả.
      { type: "mic_opened" },
    ]);
    assert.equal(state.micOpen, true, "mic đã thực sự mở ở tầng SDK");
    assert.equal(micShouldBeOpen(state), false, "nhưng phải bị đóng lại ngay");
  });

  it("bị thu quyền giữa lúc đang giữ nút", () => {
    const state = run([
      ...READY,
      { type: "hold_start" },
      { type: "livekit_permission", canPublish: false },
    ]);
    assert.equal(micShouldBeOpen(state), false);
  });
});

describe("các đường nhả nút ngoài pointerup", () => {
  for (const reason of ["pointercancel", "blur", "hidden"] as const) {
    it(`${reason} cũng phải nhả nút, nếu không mic kẹt mở`, () => {
      const state = run([...READY, { type: "hold_start" }, { type: "hold_end", reason }]);
      assert.equal(state.holding, false);
      assert.equal(micShouldBeOpen(state), false);
    });
  }

  it("mất kết nối giữa lúc đang giữ nút thì nhả luôn", () => {
    const state = run([...READY, { type: "hold_start" }, { type: "disconnected" }]);
    assert.equal(state.holding, false);
    assert.equal(micShouldBeOpen(state), false);
  });
});

describe("phát tiếng trên iOS", () => {
  it("bị chặn thì đánh dấu cần một cử chỉ nữa", () => {
    const state = run([...READY, { type: "audio_playback_blocked" }]);
    assert.equal(state.needsAudioGesture, true);
  });

  /**
   * `Room.canPlaybackAudio` có thể chuyển từ true về false GIỮA phiên, nên một
   * nút bấm lúc vào là chưa đủ - phải dựng lại được lời mời bấm.
   */
  it("mở khoá xong rồi vẫn có thể bị chặn lại lần nữa", () => {
    const state = run([
      ...READY,
      { type: "audio_playback_blocked" },
      { type: "audio_playback_ok" },
      { type: "audio_playback_blocked" },
    ]);
    assert.equal(state.needsAudioGesture, true);
  });
});

describe("voiceUi", () => {
  it("phòng chưa bật voice thì không hiện gì", () => {
    const ui = voiceUi(initialVoiceState, { available: true, enabled: false, canPublish: false, roomName: "r" });
    assert.equal(ui.visible, false);
  });

  it("server cũ không gửi trường voice thì không vỡ", () => {
    const ui = voiceUi(initialVoiceState, undefined);
    assert.equal(ui.visible, false);
  });

  it("bật voice nhưng chưa nối thì mời bấm để vào", () => {
    const ui = voiceUi(initialVoiceState, { available: true, enabled: true, canPublish: true, roomName: "r" });
    assert.equal(ui.visible, true);
    assert.equal(ui.mode, "join");
  });

  it("đã nối và được nói thì hiện nút giữ để nói", () => {
    const ui = voiceUi(run(READY), { available: true, enabled: true, canPublish: true, roomName: "r" });
    assert.equal(ui.mode, "talk");
  });

  it("đã nối nhưng không được nói thì nói rõ là chỉ nghe", () => {
    const ui = voiceUi(run([{ type: "connect_requested" }, { type: "connected" }]), {
      available: true,
      enabled: true,
      canPublish: false,
      roomName: "r",
    });
    assert.equal(ui.mode, "listen");
  });

  it("bị chặn phát tiếng thì lời mời bấm được ưu tiên hơn mọi thứ khác", () => {
    const ui = voiceUi(run([...READY, { type: "audio_playback_blocked" }]), {
      available: true,
      enabled: true,
      canPublish: true,
      roomName: "r",
    });
    assert.equal(ui.mode, "unblock-audio");
  });

  it("bị đá vì mở tab khác thì báo đúng lý do, không để người chơi tưởng mạng hỏng", () => {
    const ui = voiceUi(run([...READY, { type: "duplicate_session" }]), {
      available: true,
      enabled: true,
      canPublish: true,
      roomName: "r",
    });
    assert.equal(ui.mode, "duplicate");
  });
});

describe("ai đang nói", () => {
  it("ghi nhận danh sách từ LiveKit", () => {
    const state = run([...READY, { type: "speakers_changed", identities: ["p1", "p2"] }]);
    assert.deepEqual(state.speakers, ["p1", "p2"]);
  });

  it("mất kết nối thì danh sách phải rỗng, không để vòng sáng đứng yên mãi", () => {
    const state = run([
      ...READY,
      { type: "speakers_changed", identities: ["p1"] },
      { type: "disconnected" },
    ]);
    assert.deepEqual(state.speakers, []);
  });

  it("bị đá vì trùng danh tính cũng vậy", () => {
    const state = run([
      ...READY,
      { type: "speakers_changed", identities: ["p1"] },
      { type: "duplicate_session" },
    ]);
    assert.deepEqual(state.speakers, []);
  });
});
