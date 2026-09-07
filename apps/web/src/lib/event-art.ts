import type { GameEventId } from "@masoi/shared";

/**
 * Tên hình của từng sự kiện, không phải bản thân cái hình.
 *
 * Union khai ở đây chứ không ở `EventGlyph.tsx` vì file này là module thuần -
 * `cinematic-transition.ts` chạy trong `node --test` không có DOM lẫn JSX, nên
 * nó không được phép import ngược một file `.tsx` chỉ để lấy một cái tên.
 * `EventGlyph.tsx` nhập lại union này và tự vẽ, nên chỉ có ĐÚNG một danh sách.
 */
export type EventGlyphName =
  | "silence"
  | "flag"
  | "blood"
  | "paw"
  | "shield"
  | "wolf"
  | "eye"
  | "scales"
  | "report"
  | "ghost"
  | "moon"
  | "clock";

/**
 * Ký hiệu của từng sự kiện.
 *
 * Nằm ở `lib` chứ không ở EventBanner như trước: đoạn chuyển cảnh cũng cần đúng
 * ký hiệu này, mà `cinematic-transition.ts` là module thuần - nó chạy trong
 * `node --test` không có DOM lẫn JSX, nên không được phép import một file `.tsx`
 * chỉ để lấy một bảng chữ. Cùng lý do với `role-art.ts` và `avatar-art.ts` bên
 * cạnh.
 *
 * Record<GameEventId, EventGlyphName> chứ không phải Record<string, string>:
 * thêm sự kiện mới mà quên ký hiệu là lỗi biên dịch, thay vì một sự kiện âm thầm
 * hiện dấu mặc định trên toàn bộ giao diện.
 *
 * Trước đây bảng này là emoji: ⏳ 🤫 🕊️ 🌫️ 🛡️ 🗳️ ✨ ⚖️ 🔍 🌑 🩸 🐺 🌕 👤 📰 👻.
 * Chúng đi thẳng ra thanh sự kiện, cột thông tin bên phải và tấm chuyển cảnh
 * giữa hai pha - tức là ba bề mặt trong ván - và mắc đúng cái lỗi mà
 * `WolfMark.tsx` đã viết ra: mỗi hệ điều hành vẽ emoji một kiểu, bản Windows là
 * hoạt hình vui vẻ, Linux thiếu font thì ra ô vuông trống. Giờ chúng chỉ còn là
 * TÊN, và `EventGlyph` vẽ ra hình thật.
 *
 * Tên ở đây khớp với hình mà `EventEnvironment` đã chọn cho cùng sự kiện đó, nên
 * hoa văn phủ toàn màn và cái dấu nhỏ trên thanh sự kiện nói cùng một thứ.
 */
const EVENT_GLYPHS: Record<GameEventId, EventGlyphName> = {
  CURFEW: "clock",
  SILENT_NIGHT: "silence",
  AMNESTY_DAY: "flag",
  // Sương tan = nhìn thấy, cùng hình với Ngày Sự Thật vì cùng một ý.
  CLEARING_MIST: "eye",
  VIGILANT_NIGHT: "shield",
  SECRET_BALLOT: "flag",
  PEACEFUL_NIGHT: "moon",
  JUDGMENT_DAY: "scales",
  LAST_STAND: "shield",
  DAY_OF_TRUTH: "eye",
  MOONLESS_NIGHT: "moon",
  BLOODY_HUNT: "blood",
  HOWL_OF_THE_PACK: "wolf",
  BLOOD_MOON: "moon",
  WOLF_SHADOW: "paw",
  MORNING_REPORT: "report",
  DEAD_CAN_SPEAK: "ghost",
};

/**
 * Tên hình của một sự kiện, kể cả id lạ.
 *
 * Nhận `string` chứ không nhận `GameEventId`: snapshot đi qua socket nên một
 * server mới hơn client có thể gửi về id mà bản build này chưa biết. Ở đó thà
 * hiện một cái khiên còn hơn vỡ trang - "có chuyện gì đó đang tác động lên ván"
 * là điều duy nhất bản build này còn biết chắc về một sự kiện nó chưa từng nghe.
 */
export function eventGlyph(id: string): EventGlyphName {
  return EVENT_GLYPHS[id as GameEventId] ?? "shield";
}
