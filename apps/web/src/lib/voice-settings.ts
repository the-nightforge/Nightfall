"use client";

const KEY = "masoi.voice";

/**
 * Cách dùng mic. Đây là thiết lập của TỪNG MÁY, không phải của phòng: nó nói
 * bạn thao tác thế nào, không phải luật chơi. Người khác không cần biết, và chủ
 * phòng không nên áp đặt.
 */
export type MicMode = "ptt" | "toggle";

export interface VoiceSettings {
  micMode: MicMode;
}

/**
 * Mặc định là push-to-talk, có chủ ý.
 *
 * Người đang chơi không bị đổi hành vi dưới chân khi bản mới lên. Và với một
 * game mà nói hớ một câu là mất ván, "phải chủ động giữ mới phát" là lựa chọn
 * an toàn hơn để làm mặc định. Latch tiện hơn trên điện thoại, nhưng đó là thứ
 * người chơi tự chọn chứ không phải thứ áp cho họ.
 */
export const DEFAULT_VOICE_SETTINGS: VoiceSettings = { micMode: "ptt" };

const MODES: readonly MicMode[] = ["ptt", "toggle"];

function parseMode(value: unknown): MicMode {
  return MODES.includes(value as MicMode) ? (value as MicMode) : DEFAULT_VOICE_SETTINGS.micMode;
}

export function loadVoiceSettings(): VoiceSettings {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return DEFAULT_VOICE_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<VoiceSettings>;
    return { micMode: parseMode(parsed.micMode) };
  } catch {
    // Safari chế độ riêng tư ném ngay ở getItem; mất thiết lập còn hơn vỡ trang.
    return DEFAULT_VOICE_SETTINGS;
  }
}

export function saveVoiceSettings(settings: VoiceSettings): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* không lưu được thì thôi, phiên này vẫn dùng đúng chế độ */
  }
}
