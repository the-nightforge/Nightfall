"use client";

/**
 * Công tắc "Phiên toà sống" - THIẾT LẬP CÁ NHÂN, không phải add-on của phòng.
 *
 * Hai chuyện khác hẳn nhau, và trộn chúng lại là hỏng cả hai: add-on đổi LUẬT
 * chơi nên cả phòng phải cùng một luật và chỉ host mới đổi được; còn cái này chỉ
 * đổi cách MỘT người nhìn thấy đúng những con số mà ai cũng nhận. Vì vậy nó nằm
 * ở localStorage cùng chỗ với "Giảm chuyển cảnh" và âm lượng: hai người cùng
 * phòng chọn khác nhau là chuyện bình thường, và không cần quyền gì để đổi.
 *
 * Khoá RIÊNG chứ không nhét thêm một trường vào `masoi.cinematic`: ai đã tắt
 * chuyển cảnh không có nghĩa là đã chọn gì về phiên toà, và ngược lại. Gộp lại
 * thì một lần ghi của bên này sẽ mang theo giá trị bên kia đọc từ trước.
 */

const KEY = "masoi.live-trial";

/**
 * Tên sự kiện báo cho những component KHÁC biết thiết lập vừa đổi.
 *
 * `storage` của trình duyệt chỉ bắn sang TAB KHÁC chứ không bắn cho chính tab
 * vừa ghi, mà ba nơi cùng đọc thiết lập này (`SoundControl` ghi nó,
 * `useLiveTrial` dựng sân khấu, `CinematicOverlay` nhường hiệu ứng) đều nằm
 * trong CÙNG một tab. Đây là đường duy nhất nối chúng lại.
 */
export const LIVE_TRIAL_SETTINGS_EVENT = "masoi:live-trial-settings";

export interface LiveTrialSettings {
  /**
   * Bật sân khấu phiên toà nâng cao.
   *
   * MẶC ĐỊNH TẮT ở bản phát hành đầu: nó tải thêm Three.js và đổi hẳn bố cục
   * của hai pha quyết định nhất ván, nên nó phải là thứ người chơi CHỌN, không
   * phải thứ họ gặp phải.
   */
  enabled: boolean;
}

export const DEFAULT_LIVE_TRIAL_SETTINGS: LiveTrialSettings = { enabled: false };

export function loadLiveTrialSettings(): LiveTrialSettings {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return DEFAULT_LIVE_TRIAL_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<LiveTrialSettings>;
    // So thẳng với `true`: một giá trị rác trong localStorage (chuỗi, số, null)
    // phải rơi về TẮT chứ không được truthy thành bật.
    return { enabled: parsed?.enabled === true };
  } catch {
    // Safari chế độ riêng tư ném ngay ở getItem, và JSON hỏng cũng vào đây.
    return DEFAULT_LIVE_TRIAL_SETTINGS;
  }
}

export function saveLiveTrialSettings(settings: LiveTrialSettings): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* không lưu được thì thôi, phiên này vẫn đúng ý người chơi */
  }
}

/** Ghi thiết lập rồi báo cho các component khác trong CÙNG tab. */
export function applyLiveTrialSettings(settings: LiveTrialSettings): void {
  saveLiveTrialSettings(settings);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(LIVE_TRIAL_SETTINGS_EVENT));
}
