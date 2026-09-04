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

/**
 * Ý ĐỊNH của người dùng và mic ĐANG PHÁT là hai thứ khác nhau.
 *
 * Bản trước gộp làm một trong `holding`, nên mọi đường thu quyền đều xoá luôn
 * ý định: đêm xuống server thu quyền, sáng hôm sau người bật mic ở chế độ chạm
 * bật/tắt phải chạm lại - dù họ chưa hề tắt. Cùng một chỗ hỏng làm mất mic khi
 * chuyển tab và sau mỗi lần rớt mạng.
 *
 * Tách ra thì bất biến an toàn vẫn nguyên: `micShouldBeOpen` vẫn đòi LiveKit
 * xác nhận `canPublish`, ý định chỉ là điều kiện CẦN.
 */
describe("ý định mic sống qua đêm", () => {
  it("đang bật ở chế độ chạm: bị thu quyền thì mic tắt thật nhưng ý định còn", () => {
    const state = run([
      ...READY,
      { type: "mic_intent_toggle" },
      { type: "snapshot_can_publish", canPublish: false },
      { type: "livekit_permission", canPublish: false },
    ]);
    assert.equal(micShouldBeOpen(state), false, "đêm xuống là câm ngay");
    assert.equal(state.micIntent, true, "nhưng ý định bật mic phải còn nguyên");
  });

  it("được cấp quyền lại ban ngày thì mic tự mở, không bắt chạm lại", () => {
    const state = run([
      ...READY,
      { type: "mic_intent_toggle" },
      { type: "snapshot_can_publish", canPublish: false },
      { type: "livekit_permission", canPublish: false },
      { type: "snapshot_can_publish", canPublish: true },
      { type: "livekit_permission", canPublish: true },
    ]);
    assert.equal(micShouldBeOpen(state), true);
  });

  it("người dùng đã chủ động tắt thì sang ngày vẫn tắt", () => {
    const state = run([
      ...READY,
      { type: "mic_intent_toggle" },
      { type: "mic_intent_toggle" },
      { type: "snapshot_can_publish", canPublish: false },
      { type: "livekit_permission", canPublish: false },
      { type: "snapshot_can_publish", canPublish: true },
      { type: "livekit_permission", canPublish: true },
    ]);
    assert.equal(micShouldBeOpen(state), false);
  });

  it("giữ để nói KHÔNG bao giờ tự phát lại: người dùng đã nhả tay từ lâu", () => {
    const state = run([
      ...READY,
      { type: "hold_start" },
      { type: "snapshot_can_publish", canPublish: false },
      { type: "livekit_permission", canPublish: false },
      { type: "snapshot_can_publish", canPublish: true },
      { type: "livekit_permission", canPublish: true },
    ]);
    assert.equal(state.holding, false);
    assert.equal(micShouldBeOpen(state), false);
  });

  it("đổi chế độ thao tác thì xoá ý định - người dùng vừa đổi cách bấm", () => {
    const state = run([...READY, { type: "mic_intent_toggle" }, { type: "mic_intent_clear" }]);
    assert.equal(micShouldBeOpen(state), false);
  });
});

describe("ý định mic sống qua một lần rớt mạng", () => {
  it("mất kết nối rồi nối lại thì mic tự mở lại theo ý định cũ", () => {
    const state = run([
      ...READY,
      { type: "mic_intent_toggle" },
      { type: "disconnected" },
      // Vòng đời nối lại: token mới, vào phòng, server cấp quyền theo pha.
      { type: "connect_requested" },
      { type: "connected" },
      { type: "livekit_permission", canPublish: true },
    ]);
    assert.equal(micShouldBeOpen(state), true);
  });

  it("nhưng chỉ sau khi LiveKit thực sự cấp quyền, không phải ngay lúc nối xong", () => {
    const state = run([
      ...READY,
      { type: "mic_intent_toggle" },
      { type: "disconnected" },
      { type: "connect_requested" },
      { type: "connected" },
    ]);
    assert.equal(state.livekitCanPublish, false, "mất kết nối là mất quyền đã biết");
    assert.equal(micShouldBeOpen(state), false);
  });

  it("người dùng chủ động ngắt thì xoá cả ý định lẫn quyền tự nối lại", () => {
    const state = run([...READY, { type: "mic_intent_toggle" }, { type: "leave_requested" }]);
    assert.equal(state.micIntent, false);
    assert.equal(state.joinedByUser, false);
  });

  it("bị đá vì trùng danh tính cũng xoá quyền tự nối lại", () => {
    const state = run([...READY, { type: "mic_intent_toggle" }, { type: "duplicate_session" }]);
    assert.equal(state.micIntent, false);
    assert.equal(state.joinedByUser, false);
  });

  it("host tắt voice thì xoá sạch, không có gì để nối lại", () => {
    const state = run([...READY, { type: "mic_intent_toggle" }, { type: "voice_disabled" }]);
    assert.equal(state.micIntent, false);
    assert.equal(state.joinedByUser, false);
    assert.equal(state.connection, "idle");
  });
});

describe("đã chủ động vào voice hay chưa", () => {
  it("chưa bấm gì thì không", () => {
    assert.equal(initialVoiceState.joinedByUser, false);
  });

  it("bấm vào voice là ghi nhận, và một lần rớt mạng không xoá nó", () => {
    const state = run([...READY, { type: "disconnected" }]);
    assert.equal(state.joinedByUser, true);
  });
});

describe("voiceUi: trạng thái kết nối phải đọc được", () => {
  const view = { available: true, enabled: true, canPublish: true, roomName: "r" };

  it("lần đầu bấm vào: đang kết nối, chưa phải nối LẠI", () => {
    const ui = voiceUi(run([{ type: "connect_requested" }]), view);
    assert.equal(ui.mode, "connecting");
    assert.equal(ui.reconnecting, false);
  });

  it("đã từng nối rồi mà đang connecting: đó là nối lại", () => {
    const ui = voiceUi(run([...READY, { type: "disconnected" }, { type: "connect_requested" }]), view);
    assert.equal(ui.mode, "connecting");
    assert.equal(ui.reconnecting, true);
  });

  it("LiveKit tự nối lại giữa phiên: vẫn ở chế độ nói nhưng báo đang nối lại", () => {
    const ui = voiceUi(run([...READY, { type: "reconnecting" }]), view);
    assert.equal(ui.mode, "talk");
    assert.equal(ui.reconnecting, true);
  });

  /*
   * Hai đường ra khỏi "đang nối lại", và chúng KHÁC nhau. Bản trước gộp cả hai
   * vào một test dùng `connected` - action của một phiên MỚI - nên nó vẫn xanh
   * suốt trong khi ca thật (SDK tự vá trong cùng phiên) không có action nào
   * dispatch cả, và dock đứng mãi ở "Đang kết nối lại".
   */
  it("LiveKit vá xong đường truyền trong cùng phiên thì hết báo", () => {
    const ui = voiceUi(run([...READY, { type: "reconnecting" }, { type: "reconnected" }]), view);
    assert.equal(ui.mode, "talk");
    assert.equal(ui.reconnecting, false);
  });

  it("vá không nổi, phải xin token vào lại: nối xong cũng hết báo", () => {
    const ui = voiceUi(
      run([
        ...READY,
        { type: "reconnecting" },
        { type: "disconnected" },
        { type: "connect_requested" },
        { type: "connected" },
      ]),
      view,
    );
    assert.equal(ui.mode, "talk");
    assert.equal(ui.reconnecting, false);
  });
});

/**
 * Nhánh `reconnected`: đường DUY NHẤT đưa `reconnecting` về false khi LiveKit
 * tự vá xong đường truyền.
 *
 * Cố ý không dùng `connected` để giả lập ca này. `connected` là lối vào của một
 * phiên MỚI - dùng nó ở đây thì test vẫn xanh trong khi hook ngoài đời chẳng
 * dispatch gì cả, và dock đứng mãi ở "Đang kết nối lại". Đúng cái bẫy ấy đã
 * giấu lỗi này đi.
 */
describe("LiveKit tự vá đường truyền trong cùng một phiên", () => {
  const view = { available: true, enabled: true, canPublish: true, roomName: "r" };
  /** Đang nói ở chế độ chạm bật/tắt, mic đã mở thật - tức là có gì đó để mất. */
  const TALKING: Parameters<typeof voiceReducer>[1][] = [
    ...READY,
    { type: "snapshot_can_publish", canPublish: true },
    { type: "mic_intent_toggle" },
    { type: "mic_opened" },
  ];

  it("đang nối lại thì báo, nối lại xong thì thôi", () => {
    const dropped = run([...TALKING, { type: "reconnecting" }]);
    assert.equal(dropped.reconnecting, true);

    const back = voiceReducer(dropped, { type: "reconnected" });
    assert.equal(back.reconnecting, false);
    assert.equal(back.connection, "connected", "chưa hề rời phiên, không được hạ về idle");
    assert.equal(voiceUi(back, view).mode, "talk");
    assert.equal(voiceUi(back, view).reconnecting, false);
  });

  it("không đụng tới mic, ý định mic, hay quyền publish", () => {
    const dropped = run([...TALKING, { type: "reconnecting" }]);
    const back = voiceReducer(dropped, { type: "reconnected" });

    assert.equal(back.micIntent, true, "người dùng chưa hề tắt mic");
    assert.equal(back.micOpen, true);
    assert.equal(back.joinedByUser, true);
    assert.equal(back.livekitCanPublish, true);
    assert.equal(back.snapshotCanPublish, true);
    assert.equal(micShouldBeOpen(back), true, "mic vẫn phải đang mở sau khi nối lại");
  });

  it("giữ nguyên cả `holding` của giữ-để-nói", () => {
    const dropped = run([...READY, { type: "hold_start" }, { type: "reconnecting" }]);
    const back = voiceReducer(dropped, { type: "reconnected" });
    assert.equal(back.holding, true, "ngón tay vẫn đang trên nút");
  });

  it("xoá lỗi kết nối cũ nhưng KHÔNG xoá lỗi mic", () => {
    const dropped = run([
      ...READY,
      { type: "mic_intent_toggle" },
      { type: "mic_failed", error: "Không bật được mic", wanted: true },
      { type: "reconnecting" },
    ]);
    const back = voiceReducer(dropped, { type: "reconnected" });

    assert.equal(back.error, null);
    assert.equal(
      back.micError,
      "Không bật được mic",
      "lỗi mic thuộc về thiết bị người dùng, chỉ họ mới xoá được",
    );
  });
});

/**
 * `setMic` ném lỗi. Hai hướng, hai mức nghiêm trọng khác hẳn nhau.
 *
 * MỞ hỏng thì hậu quả là im lặng - khó chịu, không hại ai. ĐÓNG hỏng thì mic có
 * thể VẪN ĐANG PHÁT trong khi giao diện tưởng đã tắt, và đó đúng là thứ cả tính
 * năng này sinh ra để tránh trong một game mà nói hớ một câu là mất ván.
 */
describe("lỗi mic: cắt vòng lặp mà không nói dối", () => {
  it("mở hỏng thì hạ ý định xuống - đó là thứ cắt vòng retry", () => {
    const state = run([
      ...READY,
      { type: "mic_intent_toggle" },
      { type: "mic_failed", error: "hỏng", wanted: true },
    ]);
    assert.equal(state.micIntent, false, "ý định còn thì vòng đối chiếu sau lại gọi setMic");
    assert.equal(state.micOpen, false, "mở hỏng thì mic chắc chắn chưa mở");
    assert.equal(micShouldBeOpen(state), false);
    assert.equal(state.micError, "hỏng");
  });

  it("và giữ-để-nói cũng phải nhả cờ, không để mic kẹt ở trạng thái đang giữ", () => {
    const state = run([
      ...READY,
      { type: "hold_start" },
      { type: "mic_failed", error: "hỏng", wanted: true },
    ]);
    assert.equal(state.holding, false);
    assert.equal(micShouldBeOpen(state), false);
  });

  it("ĐÓNG hỏng mà vẫn còn quyền phát: KHÔNG được tuyên bố mic đã tắt", () => {
    /*
     * Ghi `micOpen: false` ở đây cho đỡ khó xử là nói dối đúng vào hướng nguy
     * hiểm: người chơi đọc "đã tắt" rồi nói thoải mái, trong khi mic vẫn đi.
     */
    const state = run([
      ...READY,
      { type: "mic_intent_toggle" },
      { type: "mic_opened" },
      { type: "mic_failed", error: "không tắt được", wanted: false },
    ]);
    assert.equal(state.micOpen, true, "SDK chưa xác nhận tắt thì không được nói là đã tắt");
    assert.equal(state.micIntent, false, "nhưng ý định thì phải hạ - không ai còn muốn nó bật");
  });

  it("ĐÓNG hỏng sau khi quyền publish đã bị thu: trạng thái an toàn là sự thật", () => {
    /*
     * Quyền bị thu nghĩa là chính LiveKit đã gỡ track. Im lặng lúc này là chắc
     * chắn chứ không phải phỏng đoán, nên `micOpen: false` mới là bản ghi đúng.
     */
    const state = run([
      ...READY,
      { type: "mic_intent_toggle" },
      { type: "mic_opened" },
      { type: "livekit_permission", canPublish: false },
      { type: "mic_failed", error: "không tắt được", wanted: false },
    ]);
    assert.equal(state.micOpen, false);
  });

  it("chuyển pha KHÔNG xoá lỗi - đêm rồi sáng không phải là một lần thử lại", () => {
    const state = run([
      ...READY,
      { type: "mic_intent_toggle" },
      { type: "mic_failed", error: "hỏng", wanted: true },
      { type: "livekit_permission", canPublish: false },
      { type: "livekit_permission", canPublish: true },
    ]);
    assert.equal(state.micError, "hỏng");
    assert.equal(micShouldBeOpen(state), false);
  });

  it("nhưng người dùng chạm lại thì xoá lỗi và thử lại", () => {
    const state = run([
      ...READY,
      { type: "mic_intent_toggle" },
      { type: "mic_failed", error: "hỏng", wanted: true },
      { type: "mic_intent_toggle" },
    ]);
    assert.equal(state.micError, null);
    assert.equal(micShouldBeOpen(state), true);
  });

  it("vào lại phiên mới cũng xoá: lỗi của phiên cũ không còn nghĩa lý", () => {
    const state = run([
      ...READY,
      { type: "mic_intent_toggle" },
      { type: "mic_failed", error: "hỏng", wanted: true },
      { type: "connect_requested" },
    ]);
    assert.equal(state.micError, null);
  });
});

describe("ra khỏi phòng thì mic không còn phát gì", () => {
  it("mất kết nối là hết phát, kể cả khi trước đó đang mở", () => {
    const state = run([
      ...READY,
      { type: "mic_intent_toggle" },
      { type: "mic_opened" },
      { type: "disconnected" },
    ]);
    assert.equal(state.micOpen, false);
    assert.equal(state.micIntent, true, "nhưng ý định vẫn sống để tự khôi phục sau khi nối lại");
  });
});

/**
 * Bị gỡ khỏi kênh thoại: bị đuổi, rời phòng, host tắt voice, phòng biến mất.
 *
 * Là action RIÊNG chứ không mượn `voice_disabled`, dù hiệu ứng trùng nhau.
 * `voice_disabled` mang nghĩa "phòng này không còn tính năng voice" - sai với
 * ca bị đuổi, nơi voice vẫn đang bật bình thường cho mọi người khác.
 */
describe("bị gỡ khỏi kênh thoại", () => {
  const REMOVED = run([
    ...READY,
    { type: "mic_intent_toggle" },
    { type: "mic_opened" },
    { type: "speakers_changed", identities: ["p1", "p2"] },
    { type: "removed_from_voice" },
  ]);

  it("dọn sạch trong MỘT bước, không để lại nửa trạng thái nào", () => {
    assert.equal(REMOVED.micOpen, false);
    assert.equal(REMOVED.micIntent, false);
    assert.equal(REMOVED.holding, false);
    assert.equal(REMOVED.joinedByUser, false, "đây là thứ chặn mọi lần tự nối lại");
    assert.equal(REMOVED.reconnecting, false);
    assert.deepEqual(REMOVED.speakers, []);
    assert.equal(REMOVED.connection, "idle");
    assert.equal(REMOVED.livekitCanPublish, false);
  });

  it("KHÔNG báo là trùng danh tính - người bị đuổi sẽ đi đóng nhầm một tab vô can", () => {
    assert.equal(REMOVED.duplicate, false);
    const ui = voiceUi(REMOVED, { available: true, enabled: true, canPublish: true, roomName: "r" });
    assert.notEqual(ui.mode, "duplicate");
  });

  it("nhưng vẫn mời vào lại được: không tự vào khác với khoá cửa", () => {
    const ui = voiceUi(REMOVED, { available: true, enabled: true, canPublish: true, roomName: "r" });
    assert.equal(ui.mode, "join");
  });
});
