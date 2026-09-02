/**
 * Bộ biểu tượng cho khung chat.
 *
 * Một bảng CHỌN SẴN chứ không phải cả bộ Unicode. Bảng đầy đủ cần một thư viện
 * dữ liệu tên - vài trăm KB tải về cho một ô chat mà người chơi chỉ ghé vào
 * giữa hai vòng bỏ phiếu - và một ô tìm kiếm, tức là thêm một chỗ gõ chữ ngay
 * cạnh chỗ gõ chữ. Ma Sói nói bằng vài chục nước đi lặp lại: nghi ngờ, tin,
 * cười, chối. Hai hàng sáu ô phủ hết chỗ đó và mở ra là thấy ngay, không phải
 * cuộn.
 *
 * Nhóm chia theo VIỆC người chơi đang làm, không theo phân loại Unicode:
 * "Phản ứng" là thứ ném ra giữa lúc tranh luận, "Ván đấu" là thứ dùng để nói
 * về vai và pha - hai lúc khác nhau, nên không trộn chung một lưới.
 */
export interface EmojiGroup {
  label: string;
  emojis: string[];
}

export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    label: "Phản ứng",
    emojis: ["👍", "👎", "😂", "😱", "🤔", "😡", "😭", "🙏", "👀", "🔥", "❤️", "🎉"],
  },
  {
    label: "Ván đấu",
    emojis: ["🐺", "🌙", "☀️", "🗳️", "💀", "👻", "🔮", "🛡️", "🔫", "✅", "❌", "❓"],
  },
];

export interface Insertion {
  text: string;
  /** Chỗ đặt con trỏ sau khi chèn: ngay SAU biểu tượng vừa thêm. */
  caret: number;
}

/**
 * Chèn một biểu tượng vào đúng chỗ con trỏ đang đứng.
 *
 * Nối vào cuối chuỗi thì hỏng đúng lúc cần nhất: người chơi gõ dở "X là sói"
 * rồi quay lại giữa câu sửa, con trỏ đang ở giữa, và biểu tượng nhảy xuống
 * cuối câu. Có vùng bôi đen thì biểu tượng THAY vùng đó, giống hệt cách gõ một
 * ký tự thường - đó là thứ người dùng đã quen từ mọi ô nhập khác.
 *
 * `maxLength` đếm theo đơn vị UTF-16 y như thuộc tính maxLength của <input>:
 * "❤️" dài 2, "👍" cũng dài 2. Đếm theo ký tự nhìn thấy thì hàm này và trình
 * duyệt sẽ bất đồng, và ô nhập lặng lẽ cắt cụt phần đuôi.
 *
 * Trả `null` khi không còn chỗ - KHÔNG cắt bớt. Cắt một cặp surrogate làm đôi
 * sinh ra nửa ký tự hỏng, và tin nhắn bị xén mất chữ cuối là thứ người gửi chỉ
 * phát hiện sau khi nó đã nằm trên bảng chat của cả phòng.
 */
export function insertEmoji(
  text: string,
  emoji: string,
  selectionStart: number,
  selectionEnd: number,
  maxLength: number,
): Insertion | null {
  const start = clamp(selectionStart, 0, text.length);
  const end = clamp(Math.max(selectionEnd, start), 0, text.length);
  const next = text.slice(0, start) + emoji + text.slice(end);
  if (next.length > maxLength) return null;
  return { text: next, caret: start + emoji.length };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return max;
  return Math.min(Math.max(value, min), max);
}
