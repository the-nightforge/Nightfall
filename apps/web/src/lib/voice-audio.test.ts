import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attachRemoteAudio,
  detachRemoteAudio,
  type VoiceAudioElement,
  type VoiceAudioSink,
  type VoiceAudioTrack,
} from "./voice-room";

/**
 * Tầng gắn âm thanh - nơi đã để lọt lỗi "không ai nghe được ai" lên production
 * ngày 2026-08-30.
 *
 * Trước đó tầng này không có test nào, vì nó chạm vào SDK và DOM. Nhận `sink`
 * qua tham số làm nó kiểm chứng được bằng node:test mà không cần trình duyệt.
 */

function fakeElement(): VoiceAudioElement & { removed: boolean; attrs: Record<string, string> } {
  return {
    autoplay: false,
    attrs: {},
    removed: false,
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    remove() {
      this.removed = true;
    },
  };
}

function fakeSink() {
  const added: VoiceAudioElement[] = [];
  let cleared = 0;
  const sink: VoiceAudioSink = {
    add: (element) => void added.push(element),
    clear: () => void (cleared += 1),
  };
  return { sink, added, clearedCount: () => cleared };
}

function fakeTrack(kind: string, elements: VoiceAudioElement[]) {
  let attachCount = 0;
  const track: VoiceAudioTrack = {
    kind,
    attach() {
      attachCount += 1;
      return elements[0];
    },
    detach() {
      return elements;
    },
  };
  return { track, attachCount: () => attachCount };
}

describe("attachRemoteAudio", () => {
  it("gắn track âm thanh vào nơi chứa - thiếu bước này thì không ai nghe được ai", () => {
    const element = fakeElement();
    const { track, attachCount } = fakeTrack("audio", [element]);
    const { sink, added } = fakeSink();

    assert.equal(attachRemoteAudio(track, sink), true);
    assert.equal(attachCount(), 1);
    assert.deepEqual(added, [element]);
  });

  it("bật autoplay, nếu không trình duyệt giữ nguyên im lặng", () => {
    const element = fakeElement();
    const { track } = fakeTrack("audio", [element]);
    attachRemoteAudio(track, fakeSink().sink);
    assert.equal(element.autoplay, true);
  });

  it("đặt playsinline cho Safari", () => {
    const element = fakeElement();
    const { track } = fakeTrack("audio", [element]);
    attachRemoteAudio(track, fakeSink().sink);
    assert.equal(element.attrs.playsinline, "");
  });

  it("bỏ qua track không phải âm thanh", () => {
    const { track, attachCount } = fakeTrack("video", [fakeElement()]);
    const { sink, added } = fakeSink();

    assert.equal(attachRemoteAudio(track, sink), false);
    assert.equal(attachCount(), 0);
    assert.deepEqual(added, []);
  });
});

describe("detachRemoteAudio", () => {
  it("gỡ mọi phần tử của track", () => {
    const elements = [fakeElement(), fakeElement()];
    const { track } = fakeTrack("audio", elements);

    assert.equal(detachRemoteAudio(track), 2);
    assert.deepEqual(
      elements.map((e) => e.removed),
      [true, true],
    );
  });

  it("bỏ qua track không phải âm thanh", () => {
    const element = fakeElement();
    const { track } = fakeTrack("video", [element]);

    assert.equal(detachRemoteAudio(track), 0);
    assert.equal(element.removed, false);
  });
});

describe("vào lại phòng nhiều lần", () => {
  /**
   * Mỗi lần vào lại là một lớp <audio> mới. Không dọn thì nghe chồng tiếng, và
   * số phần tử rác lớn dần theo số lần rớt mạng.
   */
  it("gắn nhiều lần thì nơi chứa lớn dần - đó là lý do phải dọn khi rời phòng", () => {
    const { sink, added, clearedCount } = fakeSink();
    for (let i = 0; i < 3; i++) {
      const { track } = fakeTrack("audio", [fakeElement()]);
      attachRemoteAudio(track, sink);
    }
    assert.equal(added.length, 3);
    assert.equal(clearedCount(), 0);

    sink.clear();
    assert.equal(clearedCount(), 1);
  });
});
