import type { ChannelGlyphName } from "@/lib/chat-channels";

/**
 * Dấu hiệu của từng kênh chat, vẽ bằng SVG.
 *
 * Trước đây bốn kênh mang bốn emoji trong `chat-channels.ts`: 🏠 ☀️ 🐺 💀, cộng
 * 👻 cho tin nhắn của người đã chết. Cùng một lỗi mà `WolfMark.tsx` và
 * `EventGlyph.tsx` đã viết ra và giải thích - mỗi hệ điều hành vẽ emoji một
 * kiểu, bản Windows là hoạt hình vui vẻ, Linux thiếu font thì ra ô vuông trống -
 * nhưng ở đây nó đắt hơn hẳn: kênh chat là thông tin AN TOÀN quan trọng nhất
 * trong cả ván. Một người chết nhìn kênh làng, hang Sói và kênh người chết trong
 * cùng một dòng thời gian, và cái dấu 12px này là thứ phân biệt chúng.
 *
 * Cùng lưới 24 / stroke 2 với `MessageCircleIcon` và `LockIcon` ngay trong
 * `ChatBox`, nên cả khung chat đọc ra là một bộ nét chứ không phải ba bộ trộn
 * lẫn. Toàn bộ dùng `currentColor` để hang Sói còn đỏ lên được theo
 * `text-blood-400` như bản emoji không làm được.
 *
 * KHÔNG dùng `EventGlyph` cho chỗ này dù nó đã có `wolf` và `ghost`: những hình
 * đó là silhouette đặc trên lưới 100, dựng để nằm ở nền với độ mờ 15-25%. Thu
 * xuống 12px cạnh chữ thì chúng thành một vệt đặc, và đứng cạnh nét mảnh của
 * `LockIcon` thì lệch hẳn trọng lượng.
 */
export function ChannelGlyph({ name, className }: { name: ChannelGlyphName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {/* Mái nhà: phòng chờ. */}
      {name === "house" && <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9.5Z" />}
      {/* Mặt trời: pha ngày, cả làng nói chuyện. */}
      {name === "sun" && (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
        </>
      )}
      {/* Đầu sói: hai tai nhọn, mõm nhọn, hai mắt. */}
      {name === "wolf" && (
        <>
          <path d="M4 4l3.2 4.2A8 8 0 0 1 12 7a8 8 0 0 1 4.8 1.2L20 4l-.8 6.2A7.5 7.5 0 0 1 12 21a7.5 7.5 0 0 1-7.2-10.8L4 4Z" />
          <path d="M9.5 12.5h.01M14.5 12.5h.01" />
        </>
      )}
      {/* Đầu lâu: kênh người chết. */}
      {name === "skull" && (
        <>
          <path d="M5 11a7 7 0 1 1 14 0v3.5l-2 1V19H7v-3.5l-2-1V11Z" />
          <path d="M9.2 10.5h.01M14.8 10.5h.01" />
        </>
      )}
      {/* Bóng ma: vòm trên và viền dưới lượn sóng - tin nhắn của người đã chết. */}
      {name === "ghost" && (
        <path d="M4 21v-9a8 8 0 1 1 16 0v9l-2.7-2-2.65 2L12 19l-2.65 2-2.65-2L4 21Z" />
      )}
      {/* Bong bóng hội thoại: hình dự phòng cho một kênh lạ. Cùng dựng hình với
        * `MessageCircleIcon` trong `ChatBox` - đó là CÙNG một ý nghĩa. */}
      {name === "chat" && <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />}
    </svg>
  );
}
