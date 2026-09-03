import type { RoomMember } from "../rooms/store";
import { DISCONNECT_GRACE_MS } from "./discussion-skip";

/**
 * Ghế này có đang do máy cầm không.
 *
 * BOT thì luôn luôn. Người thì chỉ khi họ đã rớt đủ lâu để không còn là một lần
 * tải lại trang - cùng đúng ngưỡng mà ngưỡng đồng thuận skip thảo luận dùng để
 * ngừng chờ họ, vì đó là cùng một câu hỏi: "còn đáng chờ người này nữa không".
 *
 * Có mặt vì trước đó mọi scheduler đều gác bằng `member.isBot`, nên một ghế bị
 * bỏ giữa ván là một ghế câm cho tới hết ván: một Tiên Tri đóng tab ở đêm 2
 * nghĩa là phe làng mất soi vĩnh viễn, và không ai trong phòng hiểu vì sao.
 *
 * CHỈ dùng cho hành động cơ học - đi đêm, bỏ phiếu, phát súng Thợ Săn. Lời nói
 * thì không: phong thư sau cùng, lời biện hộ và lời nhắn của người chết đều là
 * chữ ký của một con người cụ thể, và để máy viết thay họ dưới tên họ là một
 * chuyện khác hẳn với việc bấm hộ một nút.
 *
 * ponytail: các scheduler chỉ đọc hàm này lúc pha MỞ RA, nên người rớt giữa một
 * pha đang chạy chỉ được cầm hộ từ pha kế tiếp. Với ân hạn 20s trên một đêm 30s
 * thì khoảng hở đó gần như luôn tồn tại nhưng chỉ tốn đúng một lượt. Muốn bịt
 * hẳn thì hẹn một mốc `DISCONNECT_GRACE_MS` ngay trong handler `disconnect` và
 * chạy lại scheduler của pha hiện tại cho riêng ghế đó.
 */
export function isBotControlled(member: RoomMember, now = Date.now()): boolean {
  if (member.isBot) return true;
  if (member.connected) return false;
  // Không rõ rớt từ lúc nào thì cho hưởng trọn ân hạn, không cướp ghế oan.
  return now - (member.disconnectedAt ?? now) >= DISCONNECT_GRACE_MS;
}
