import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { PHASES } from "@masoi/shared";
import { audioEngine, installUnlockListener } from "./audio-engine";
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

// Các listener của engine (chạm, đổi tab, statechange) cần một `document`
// thật; phần còn lại của bộ giả không đụng tới DOM.
GlobalRegistrator.register();

let sources: FakeSource[] = [];
/** Mọi AudioContext engine dựng ra. Engine giữ một cái duy nhất cho cả đời. */
const contexts: FakeAudioContext[] = [];
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
  /** iOS có thêm giá trị "interrupted" ngoài chuẩn, nên để là string. */
  state = "running";
  resumes = 0;
  private listeners = new Set<() => void>();

  constructor() {
    contexts.push(this);
  }

  addEventListener(type: string, fn: () => void) {
    if (type === "statechange") this.listeners.add(fn);
  }

  /** Giả lập iOS đổi trạng thái context rồi báo qua statechange. */
  becomes(state: string) {
    this.state = state;
    for (const fn of this.listeners) fn();
  }

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
    this.resumes += 1;
    this.state = "running";
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

let removeListeners: () => void = () => undefined;

before(() => {
  (globalThis as { AudioContext?: unknown }).AudioContext = FakeAudioContext;
  (globalThis as { fetch?: unknown }).fetch = fakeFetch;
  removeListeners = installUnlockListener();
});

after(() => {
  removeListeners();
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

/**
 * iOS đưa AudioContext về trạng thái `interrupted` mỗi khi khoá màn hình,
 * chuyển app, có cuộc gọi, bật Siri hay cắm/rút tai nghe - và KHÔNG tự phục
 * hồi một cách đáng tin cậy. Bản trước chỉ gọi `resume()` ở cú chạm đầu tiên
 * và khi ĐỔI track; mà cả ván chỉ có một track, nên sau lần gián đoạn đầu tiên
 * nhạc lẫn hiệu ứng im tới hết ván. Đó là lỗi "lâu lâu mất nhạc nền trên iOS".
 */
describe("audioEngine — iOS ngắt AudioContext giữa ván", () => {
  function ctx(): FakeAudioContext {
    const live = contexts.at(-1);
    assert.ok(live, "engine phải đã dựng một AudioContext");
    return live;
  }

  /** Ép `document.hidden`; happy-dom không có API đổi nó. */
  function hide(hidden: boolean): () => void {
    const original = Object.getOwnPropertyDescriptor(Document.prototype, "hidden");
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    return () => {
      delete (document as unknown as Record<string, unknown>).hidden;
      if (original) Object.defineProperty(Document.prototype, "hidden", original);
    };
  }

  it("trang hiện lại sau khi bị ngắt: gọi resume, KHÔNG dựng lại nhạc", async () => {
    audioEngine.setTrack(trackFor("NIGHT"));
    await settle();
    const live = ctx();
    live.state = "interrupted";
    live.resumes = 0;

    document.dispatchEvent(new Event("visibilitychange"));
    await settle();

    assert.equal(live.resumes, 1, "phải gọi resume khi trang hiện lại");
    assert.equal(sources.length, 1, "nhạc đang chạy phải được giữ nguyên, không tạo nguồn mới");
  });

  it("cú chạm bất kỳ SAU cú chạm mở khoá cũng gọi resume", async () => {
    audioEngine.setTrack(trackFor("NIGHT"));
    await settle();
    const live = ctx();
    live.state = "interrupted";
    live.resumes = 0;

    document.dispatchEvent(new Event("pointerdown"));
    await settle();

    assert.equal(live.resumes, 1, "listener chạm không được tự gỡ sau lần đầu");
  });

  it("context tự báo statechange rời khỏi running: engine gọi resume ngay", async () => {
    audioEngine.setTrack(trackFor("NIGHT"));
    await settle();
    const live = ctx();
    live.resumes = 0;

    live.becomes("suspended");
    await settle();

    assert.equal(live.resumes, 1);
  });

  it("pageshow (iOS khôi phục từ bfcache) cũng gọi resume", async () => {
    audioEngine.setTrack(trackFor("NIGHT"));
    await settle();
    const live = ctx();
    live.state = "interrupted";
    live.resumes = 0;

    window.dispatchEvent(new Event("pageshow"));
    await settle();

    assert.equal(live.resumes, 1);
  });

  it("context vẫn đang chạy thì các tín hiệu này không gọi resume thừa", async () => {
    audioEngine.setTrack(trackFor("NIGHT"));
    await settle();
    const live = ctx();
    live.state = "running";
    live.resumes = 0;

    document.dispatchEvent(new Event("visibilitychange"));
    document.dispatchEvent(new Event("pointerdown"));
    window.dispatchEvent(new Event("pageshow"));
    await settle();

    assert.equal(live.resumes, 0);
  });

  it("trang đang ẩn thì chưa resume - iOS từ chối, và sẽ có lượt khi hiện lại", async () => {
    audioEngine.setTrack(trackFor("NIGHT"));
    await settle();
    const live = ctx();
    live.state = "interrupted";
    live.resumes = 0;
    const restore = hide(true);
    try {
      document.dispatchEvent(new Event("visibilitychange"));
      await settle();
      assert.equal(live.resumes, 0);
    } finally {
      restore();
    }
  });
});
