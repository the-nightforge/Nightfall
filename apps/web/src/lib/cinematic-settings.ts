"use client";

const KEY = "masoi.cinematic";

export interface CinematicSettings {
  /**
   * Người chơi tự tắt chuyển cảnh lớn.
   *
   * Khác với `prefers-reduced-motion`: cờ hệ thống là thiết lập cho mọi trang,
   * còn cờ này là "riêng game này thì thôi". Có người không hề say chuyển động
   * nhưng vẫn muốn vào bàn nhanh nhất có thể.
   */
  reduced: boolean;
}

export const DEFAULT_CINEMATIC_SETTINGS: CinematicSettings = { reduced: false };

export function loadCinematicSettings(): CinematicSettings {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return DEFAULT_CINEMATIC_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<CinematicSettings>;
    return { reduced: parsed.reduced === true };
  } catch {
    // Safari chế độ riêng tư ném ngay ở getItem; mất thiết lập còn hơn vỡ trang.
    return DEFAULT_CINEMATIC_SETTINGS;
  }
}

export function saveCinematicSettings(settings: CinematicSettings): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* không lưu được thì thôi, phiên này vẫn đúng ý người chơi */
  }
}

export interface PlaybackInputs {
  reducedSetting: boolean;
  prefersReducedMotion: boolean;
  saveData: boolean;
}

/**
 * Cách dựng một đoạn chuyển cảnh trên máy này.
 *
 * - "video": phát clip, có bản dựng CSS nằm dưới làm nền.
 * - "css":   chỉ bản dựng CSS - vẫn có chuyển cảnh, chỉ là không tải file nào.
 * - "none":  không chuyển cảnh, đổi thẳng sang pha mới.
 *
 * Ba đầu vào ba lý do khác nhau nên không gộp được: `prefers-reduced-motion` là
 * lý do sức khoẻ và phải tắt hẳn chuyển động lớn; Save-Data là lý do băng thông
 * nên vẫn cho chuyển cảnh, chỉ cấm tải; còn công tắc trong game là ý muốn của
 * người chơi, và họ nói là không muốn xem.
 */
export function playbackMode(inputs: PlaybackInputs): "video" | "css" | "none" {
  if (inputs.prefersReducedMotion) return "none";
  if (inputs.reducedSetting) return "none";
  if (inputs.saveData) return "css";
  return "video";
}

export interface NetworkHints {
  saveData: boolean;
  /** "slow-2g" | "2g" | "3g" | "4g", hoặc null nếu trình duyệt không báo. */
  effectiveType: string | null;
}

/**
 * Những gì trình duyệt chịu nói về đường truyền.
 *
 * `navigator.connection` chỉ có ở Chromium. Thiếu nó thì coi như người dùng
 * KHÔNG bật tiết kiệm dữ liệu và đường truyền là bình thường - đoán ngược lại
 * sẽ tắt clip trên toàn bộ Safari và Firefox, tức là tắt vì thiếu một API chứ
 * không phải vì mạng có vấn đề thật.
 */
export function readNetworkHints(): NetworkHints {
  const connection = (
    globalThis.navigator as
      | (Navigator & { connection?: { saveData?: boolean; effectiveType?: string } })
      | undefined
  )?.connection;

  return {
    saveData: connection?.saveData === true,
    effectiveType: connection?.effectiveType ?? null,
  };
}

/** Đọc ba đầu vào trên từ trình duyệt hiện tại. */
export function readPlaybackInputs(): PlaybackInputs {
  const settings = loadCinematicSettings();
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return {
    reducedSetting: settings.reduced,
    prefersReducedMotion,
    saveData: readNetworkHints().saveData,
  };
}
