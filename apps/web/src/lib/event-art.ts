import type { GameEventId } from "@masoi/shared";

/**
 * Ký hiệu của từng sự kiện.
 *
 * Nằm ở `lib` chứ không ở EventBanner như trước: đoạn chuyển cảnh cũng cần đúng
 * ký hiệu này, mà `cinematic-transition.ts` là module thuần - nó chạy trong
 * `node --test` không có DOM lẫn JSX, nên không được phép import một file `.tsx`
 * chỉ để lấy một bảng chữ. Cùng lý do với `role-art.ts` và `avatar-art.ts` bên
 * cạnh.
 *
 * Record<GameEventId, string> chứ không phải Record<string, string>: thêm sự
 * kiện mới mà quên ký hiệu là lỗi biên dịch, thay vì một sự kiện âm thầm hiện
 * dấu "⚡" mặc định trên toàn bộ giao diện.
 */
const EVENT_ICONS: Record<GameEventId, string> = {
  CURFEW: "⏳",
  SILENT_NIGHT: "🤫",
  AMNESTY_DAY: "🕊️",
  CLEARING_MIST: "🌫️",
  PEACEFUL_NIGHT: "✨",
  JUDGMENT_DAY: "⚖️",
  LAST_STAND: "🛡️",
  DAY_OF_TRUTH: "🔍",
  MOONLESS_NIGHT: "🌑",
  BLOODY_HUNT: "🩸",
  HOWL_OF_THE_PACK: "🐺",
  BLOOD_MOON: "🌕",
  WOLF_SHADOW: "👤",
  MORNING_REPORT: "📰",
  DEAD_CAN_SPEAK: "👻",
};

/**
 * Ký hiệu của một sự kiện, kể cả id lạ.
 *
 * Nhận `string` chứ không nhận `GameEventId`: snapshot đi qua socket nên một
 * server mới hơn client có thể gửi về id mà bản build này chưa biết. Ở đó thà
 * hiện "⚡" còn hơn vỡ trang.
 */
export function eventIcon(id: string): string {
  return EVENT_ICONS[id as GameEventId] ?? "⚡";
}
