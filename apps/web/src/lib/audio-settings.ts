"use client";

const KEY = "masoi.audio";

export interface AudioSettings {
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
}

/** Nhạc thấp hơn hiệu ứng rõ rệt để tiếng báo lượt không bị nhạc nuốt. */
export const DEFAULT_SETTINGS: AudioSettings = {
  musicVolume: 0.4,
  sfxVolume: 0.8,
  muted: false,
};

function clamp(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

export function loadSettings(): AudioSettings {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      musicVolume: clamp(parsed.musicVolume, DEFAULT_SETTINGS.musicVolume),
      sfxVolume: clamp(parsed.sfxVolume, DEFAULT_SETTINGS.sfxVolume),
      muted: parsed.muted === true,
    };
  } catch {
    // Safari chế độ riêng tư ném ngay ở getItem; mất thiết lập còn hơn vỡ trang.
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AudioSettings): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* không lưu được thì thôi, phiên này vẫn nghe đúng âm lượng */
  }
}
