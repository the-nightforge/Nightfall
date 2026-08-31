import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { PHASES } from "@masoi/shared";
import { audioEngine } from "./audio-engine";
import { DEFAULT_SETTINGS } from "./audio-settings";
import { trackFor } from "./audio-track";

/**
 * Engine là nơi duy nhất chạm Web Audio, và ba lời hứa của thiết kế một track
 * đều nằm ở đây chứ không nằm trong `trackFor`: chuyển pha KHÔNG khởi động lại
 * nhạc, GAME_OVER dừng nhạc, hiệu ứng và hai thanh âm lượng vẫn chạy.
 *
 * `trackFor` một mình không chứng minh được điều đầu tiên: nó chỉ nói mọi pha
 * cùng tên track, còn việc "cùng tên thì không tạo nguồn mới" là hành vi của
 * `setTrack`. Bộ giả dưới đây đếm số nguồn được tạo và số lần `start`, nên một
 * lần khởi động lại thừa sẽ hiện thành con số sai chứ không phải im lặng.
 */

interface FakeParam {
  value: number;
  cancelScheduledValues(when: number): void;
  setValueAtTime(value: number, when: number): void;
  linearRampToValueAtTime(value: number, when: number): void;
}

interface FakeNode {
  connect(target: unknown): void;
  disconnect(): void;
}

interface FakeSource extends FakeNode {
  buffer: unknown;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  onended: (() => void) | null;
  start(when?: number, offset?: number): void;
  stop(when?: number): void;
  started: number;
  stopped: number;
  startOffset: number | undefined;
}

const LOOP_POINTS = { theme: { loopStart: 0.5, loopEnd: 48.975011 } };

let sources: FakeSource[] = [];
let gains: (FakeNode & { gain: FakeParam })[] = [];
let musicBus: (FakeNode & { gain: FakeParam }) | null = null;
let sfxBus: (FakeNode & { gain: FakeParam }) | null = null;
let fetched: string[] = [];

function param(): FakeParam {
  return {
    value: 1,
    cancelScheduledValues() {},
    setValueAtTime(value) {
      this.value = value;
    },
    linearRampToValueAtTime(value) {
      this.value = value;
    },
  };
}

class FakeAudioContext {
  currentTime = 0;
  destination = { kind: "destination" };

  createGain() {
    const node = { gain: param(), connect() {}, disconnect() {} };
    gains.push(node);
    // Hai node gain đầu tiên engine tạo ra là hai bus, và thứ tự đó do
    // `context()` quyết định: nhạc trước, hiệu ứng sau.
    if (!musicBus) musicBus = node;
    else if (!sfxBus) sfxBus = node;
    return node;
  }

  createBufferSource(): FakeSource {
    const source: FakeSource = {
      buffer: null,
      loop: false,
      loopStart: 0,
      loopEnd: 0,
      onended: null,
      started: 0,
      stopped: 0,
      startOffset: undefined,
      connect() {},
      disconnect() {},
      start(_when?: number, offset?: number) {
        this.started += 1;
        this.startOffset = offset;
      },
      stop() {
        this.stopped += 1;
      },
    };
    sources.push(source);
    return source;
  }

  decodeAudioData(data: ArrayBuffer) {
    return Promise.resolve({ duration: 49.5, byteLength: data.byteLength } as unknown);
  }

  resume() {
    return Promise.resolve();
  }
}

function fakeFetch(url: string) {
  fetched.push(url);
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(LOOP_POINTS),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
  });
}

/** Engine decode bất đồng bộ; nhường vài lượt cho chuỗi promise chạy xong. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

const realAudioContext = globalThis.AudioContext;
const realFetch = globalThis.fetch;

before(() => {
  (globalThis as { AudioContext?: unknown }).AudioContext = FakeAudioContext;
  (globalThis as { fetch?: unknown }).fetch = fakeFetch;
});

after(() => {
  (globalThis as { AudioContext?: unknown }).AudioContext = realAudioContext;
  (globalThis as { fetch?: unknown }).fetch = realFetch;
});

beforeEach(async () => {
  // `stop()` là cách engine tự dọn khi hook unmount, nên dùng chính nó để tách
  // các ca khỏi nhau thay vì nạp lại module: cái được kiểm vẫn là code thật.
  audioEngine.stop();
  await settle();
  sources = [];
  gains = [];
  fetched = [];
  audioEngine.applySettings(DEFAULT_SETTINGS);
  audioEngine.unlock();
});

describe("audioEngine — nhạc nền một track", () => {
  it("chỉ tạo một nguồn nhạc cho cả chuỗi pha từ LOBBY tới CHECK_WIN", async () => {
    for (const phase of PHASES) {
      if (phase === "GAME_OVER") continue;
      audioEngine.setTrack(trackFor(phase));
      await settle();
    }

    assert.equal(sources.length, 1, "mỗi lần chuyển pha không được tạo nguồn mới");
    assert.equal(sources[0].started, 1, "nhạc chỉ được start đúng một lần");
    assert.equal(sources[0].stopped, 0, "chuyển pha không được dừng nhạc đang chạy");
  });

  it("tải đúng một file nhạc, không tải lại ở mỗi pha", async () => {
    for (const phase of PHASES) {
      if (phase === "GAME_OVER") continue;
      audioEngine.setTrack(trackFor(phase));
      await settle();
    }

    const music = fetched.filter((url) => url.startsWith("/audio/music/"));
    assert.deepEqual(music, ["/audio/music/werewolf-theme.mp3"]);
  });

  it("lặp theo loopStart/loopEnd và vào nhạc ngay tại loopStart", async () => {
    audioEngine.setTrack(trackFor("LOBBY"));
    await settle();

    const source = sources[0];
    assert.equal(source.loop, true);
    assert.equal(source.loopStart, LOOP_POINTS.theme.loopStart);
    assert.equal(source.loopEnd, LOOP_POINTS.theme.loopEnd);
    assert.equal(source.startOffset, LOOP_POINTS.theme.loopStart);
  });

  it("GAME_OVER dừng nhạc", async () => {
    audioEngine.setTrack(trackFor("CHECK_WIN"));
    await settle();
    assert.equal(sources.length, 1);

    audioEngine.setTrack(trackFor("GAME_OVER"));
    await settle();

    assert.equal(sources[0].stopped, 1, "nguồn nhạc phải được hẹn dừng");
    assert.equal(sources.length, 1, "GAME_OVER không được mở nguồn nhạc nào khác");
  });

  it("sau GAME_OVER, ván mới lại phát được nhạc", async () => {
    audioEngine.setTrack(trackFor("DAY_DISCUSSION"));
    await settle();
    audioEngine.setTrack(trackFor("GAME_OVER"));
    await settle();
    audioEngine.setTrack(trackFor("LOBBY"));
    await settle();

    assert.equal(sources.length, 2);
    assert.equal(sources[1].started, 1);
  });
});

describe("audioEngine — hiệu ứng và âm lượng", () => {
  it("phát hiệu ứng bằng nguồn riêng, không đụng vào nhạc", async () => {
    audioEngine.setTrack(trackFor("NIGHT"));
    await settle();

    audioEngine.playCue("howl");
    await settle();

    assert.equal(sources.length, 2, "hiệu ứng phải là một nguồn riêng");
    assert.equal(sources[0].stopped, 0, "hiệu ứng không được cắt nhạc nền");
    assert.ok(fetched.includes("/audio/sfx/howl.mp3"));
  });

  it("hai thanh âm lượng đi vào hai bus tách biệt", async () => {
    audioEngine.setTrack(trackFor("NIGHT"));
    await settle();

    audioEngine.applySettings({ musicVolume: 0.25, sfxVolume: 0.9, muted: false });

    assert.equal(musicBus?.gain.value, 0.25);
    assert.equal(sfxBus?.gain.value, 0.9);
  });

  it("tắt tiếng đưa cả hai bus về 0 rồi bật lại trả đúng mức đã lưu", async () => {
    audioEngine.setTrack(trackFor("NIGHT"));
    await settle();

    audioEngine.applySettings({ musicVolume: 0.4, sfxVolume: 0.8, muted: true });
    assert.equal(musicBus?.gain.value, 0);
    assert.equal(sfxBus?.gain.value, 0);

    audioEngine.applySettings({ musicVolume: 0.4, sfxVolume: 0.8, muted: false });
    assert.equal(musicBus?.gain.value, 0.4);
    assert.equal(sfxBus?.gain.value, 0.8);
  });

  it("đang tắt tiếng thì không tải file hiệu ứng nào", async () => {
    audioEngine.applySettings({ ...DEFAULT_SETTINGS, muted: true });

    audioEngine.playCue("ballot");
    await settle();

    assert.deepEqual(fetched.filter((url) => url.startsWith("/audio/sfx/")), []);
  });
});
