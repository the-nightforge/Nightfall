"use client";

import type { Cue } from "./audio-cues";
import type { Track } from "./audio-track";
import { DEFAULT_SETTINGS, type AudioSettings } from "./audio-settings";

const MUSIC_SRC: Record<Track, string> = {
  theme: "/audio/music/werewolf-theme.mp3",
};

const SFX_SRC: Record<Cue, string> = {
  howl: "/audio/sfx/howl.mp3",
  turn: "/audio/sfx/turn.mp3",
  death: "/audio/sfx/death.mp3",
  ballot: "/audio/sfx/ballot.mp3",
  win: "/audio/sfx/win.mp3",
  lose: "/audio/sfx/lose.mp3",
};

const LOOP_POINTS_URL = "/audio/loop-points.json";
const FADE_SEC = 0.6;

interface LoopPoint {
  loopStart: number;
  loopEnd: number;
}

interface Playing {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

let ctx: AudioContext | null = null;
let musicBus: GainNode | null = null;
let sfxBus: GainNode | null = null;

let settings: AudioSettings = DEFAULT_SETTINGS;
let unlocked = false;
/** Track đã cam kết phát. Đặt đồng bộ trong setTrack, không đợi decode. */
let current: Track | null = null;
/** Track muốn phát khi trình duyệt còn chặn autoplay. */
let wanted: Track | null = null;
/** Tăng mỗi lần đổi ý; lần decode nào về trễ hơn thế hệ hiện tại thì bỏ. */
let generation = 0;

let playing: Playing | null = null;
let loopPoints: Promise<Record<string, LoopPoint>> | null = null;
const sfxCache = new Map<Cue, AudioBuffer>();
const broken = new Set<string>();
const unlockListeners = new Set<() => void>();

type AudioContextCtor = typeof AudioContext;

function context(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor: AudioContextCtor | undefined =
    globalThis.AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!Ctor) return null;

  ctx = new Ctor();
  musicBus = ctx.createGain();
  sfxBus = ctx.createGain();
  musicBus.connect(ctx.destination);
  sfxBus.connect(ctx.destination);
  applyBusGains();
  // iOS đổi trạng thái context mà không cần ai hỏi (xem `resume`). Bắt ngay
  // tại nguồn là đường ngắn nhất; các listener trên document là lưới dự phòng.
  ctx.addEventListener("statechange", () => audioEngine.resume());
  return ctx;
}

/**
 * Context có đang thực sự phát hay không.
 *
 * iOS có thêm trạng thái "interrupted" ngoài chuẩn (không nằm trong kiểu của
 * TypeScript) cho cuộc gọi, Siri, khoá màn hình, chuyển app, cắm/rút tai nghe.
 * So với "running" thay vì liệt kê từng trạng thái khác để không bỏ sót nó.
 */
function isRunning(audio: AudioContext): boolean {
  return (audio.state as string) === "running";
}

/** Hai bus tách biệt là lý do applySettings chỉ còn hai dòng. */
function applyBusGains(): void {
  if (musicBus) musicBus.gain.value = settings.muted ? 0 : settings.musicVolume;
  if (sfxBus) sfxBus.gain.value = settings.muted ? 0 : settings.sfxVolume;
}

function fetchLoopPoints(): Promise<Record<string, LoopPoint>> {
  loopPoints ??= fetch(LOOP_POINTS_URL)
    .then((res) => (res.ok ? (res.json() as Promise<Record<string, LoopPoint>>) : {}))
    .catch(() => ({}));
  return loopPoints;
}

async function decode(audio: AudioContext, src: string): Promise<AudioBuffer | null> {
  if (broken.has(src)) return null;
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error(String(res.status));
    return await audio.decodeAudioData(await res.arrayBuffer());
  } catch {
    // Hỏng một lần là hỏng mãi: đánh dấu để không thử lại mỗi lần chuyển pha.
    broken.add(src);
    return null;
  }
}

function fadeOutPlaying(audio: AudioContext): void {
  const previous = playing;
  playing = null;
  if (!previous) return;

  const now = audio.currentTime;
  previous.gain.gain.cancelScheduledValues(now);
  previous.gain.gain.setValueAtTime(previous.gain.gain.value, now);
  previous.gain.gain.linearRampToValueAtTime(0, now + FADE_SEC);
  previous.source.stop(now + FADE_SEC);
  // Ngắt kết nối để buffer PCM được thu hồi. Một vòng 48 giây giải nén ra hơn
  // 30 MB float trong bộ nhớ; giữ lại nguồn đã tắt là giữ luôn chỗ đó.
  previous.source.onended = () => {
    previous.source.disconnect();
    previous.gain.disconnect();
  };
}

async function startTrack(track: Track): Promise<void> {
  const audio = context();
  if (!audio) return;
  const mine = ++generation;

  const [buffer, points] = await Promise.all([
    decode(audio, MUSIC_SRC[track]),
    fetchLoopPoints(),
  ]);
  // Đã chuyển pha khác trong lúc decode thì bỏ kết quả này.
  if (!buffer || mine !== generation || !musicBus) return;

  const gain = audio.createGain();
  gain.gain.value = 0;
  gain.connect(musicBus);

  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.loop = true;

  const point = points[track];
  if (point) {
    source.loopStart = point.loopStart;
    source.loopEnd = point.loopEnd;
  }
  source.connect(gain);
  // Bắt đầu ngay tại loopStart để bỏ qua vùng đệm đầu file.
  source.start(0, point ? point.loopStart : 0);

  fadeOutPlaying(audio);
  gain.gain.linearRampToValueAtTime(1, audio.currentTime + FADE_SEC);
  playing = { source, gain };
}

export const audioEngine = {
  /**
   * Gọi bên trong handler của cử chỉ người dùng. AudioContext phải được tạo
   * ngay trong stack đó, đặt sau await là iOS vẫn chặn.
   */
  unlock(): void {
    if (unlocked) return;
    unlocked = true;
    const audio = context();
    void audio?.resume().catch(() => undefined);

    const pending = wanted;
    for (const listener of unlockListeners) listener();
    if (pending !== null) audioEngine.setTrack(pending);
  },

  isUnlocked(): boolean {
    return unlocked;
  },

  /**
   * Đánh thức context sau khi iOS ngắt nó.
   *
   * iOS đưa AudioContext về "interrupted" ở mỗi lần khoá màn hình, chuyển app,
   * có cuộc gọi hay bật Siri, và không tự phục hồi một cách đáng tin cậy. Bản
   * trước chỉ gọi `resume()` ở cú chạm đầu tiên và khi ĐỔI track - mà cả ván
   * chỉ có một track - nên sau lần gián đoạn đầu tiên, nhạc lẫn hiệu ứng im
   * tới hết ván.
   *
   * Không đụng tới nguồn đang chạy: `AudioBufferSourceNode` sống qua lần ngắt
   * và tự chạy tiếp khi context chạy lại, nên chỉ cần `resume()`.
   *
   * Chỉ gọi khi trang đang hiện: iOS từ chối resume lúc trang ẩn, và sẽ có
   * lượt gọi khác ở `visibilitychange` khi trang hiện lại.
   */
  resume(): void {
    if (!unlocked || !ctx || isRunning(ctx)) return;
    if (typeof document !== "undefined" && document.hidden) return;
    void ctx.resume().catch(() => undefined);
  },

  onUnlock(listener: () => void): () => void {
    unlockListeners.add(listener);
    return () => unlockListeners.delete(listener);
  },

  setTrack(track: Track | null): void {
    wanted = track;
    // Chưa có cử chỉ nào thì chỉ ghi nhớ; unlock() sẽ phát track đang chờ.
    // `track === current` là chỗ giữ lời hứa "chuyển pha không phát lại nhạc":
    // mọi pha chơi được đều trả về cùng một track, nên lời gọi thứ hai trở đi
    // không đụng gì tới nguồn đang chạy.
    if (!unlocked || track === current) return;
    current = track;

    const audio = context();
    if (!audio) return;
    void audio.resume().catch(() => undefined);

    if (track === null) {
      generation += 1;
      fadeOutPlaying(audio);
      return;
    }
    void startTrack(track);
  },

  playCue(cue: Cue): void {
    if (!unlocked || settings.muted || settings.sfxVolume === 0) return;
    void (async () => {
      const audio = context();
      if (!audio || !sfxBus) return;

      // Sáu file hiệu ứng đều dưới 2 giây nên giữ hết trong cache vẫn nhẹ,
      // đổi lại lần phát sau không có độ trễ mạng.
      let buffer = sfxCache.get(cue);
      if (!buffer) {
        const decoded = await decode(audio, SFX_SRC[cue]);
        if (!decoded) return;
        buffer = decoded;
        sfxCache.set(cue, buffer);
      }

      const source = audio.createBufferSource();
      source.buffer = buffer;
      source.connect(sfxBus);
      source.onended = () => source.disconnect();
      source.start();
    })();
  },

  applySettings(next: AudioSettings): void {
    settings = next;
    applyBusGains();
  },

  stop(): void {
    generation += 1;
    if (ctx) fadeOutPlaying(ctx);
    current = null;
    wanted = null;
  },
};

/**
 * Mở khoá ở cú chạm đầu tiên bất kỳ trên trang, nhờ vậy không cần bắt người
 * chơi bấm thêm một nút "bật tiếng" riêng. Trả về hàm gỡ listener.
 *
 * Listener chạm KHÔNG tự gỡ sau lần đầu như bản trước: mọi cú chạm sau đó là
 * một cơ hội gọi `resume()` trong stack của cử chỉ - thứ iOS đòi hỏi ở một số
 * lần ngắt. `visibilitychange` và `pageshow` lo phần còn lại: người chơi quay
 * lại app, hoặc iOS khôi phục trang từ bfcache mà không bắn `visibilitychange`.
 */
export function installUnlockListener(): () => void {
  if (typeof document === "undefined") return () => undefined;

  function onGesture(): void {
    audioEngine.unlock();
    audioEngine.resume();
  }
  function onWake(): void {
    audioEngine.resume();
  }

  document.addEventListener("pointerdown", onGesture);
  document.addEventListener("keydown", onGesture);
  document.addEventListener("visibilitychange", onWake);
  window.addEventListener("pageshow", onWake);
  return (): void => {
    document.removeEventListener("pointerdown", onGesture);
    document.removeEventListener("keydown", onGesture);
    document.removeEventListener("visibilitychange", onWake);
    window.removeEventListener("pageshow", onWake);
  };
}
