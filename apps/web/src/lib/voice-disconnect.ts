import { DisconnectReason } from "livekit-client";

/**
 * Dịch lý do ngắt kết nối của LiveKit sang thứ hook thực sự cần biết.
 *
 * Bản trước bóp toàn bộ chuyện này xuống MỘT boolean - `duplicate` hay không -
 * và đó là một lỗi có hậu quả thật: `PARTICIPANT_REMOVED` (rời phòng, bị đuổi)
 * cùng `ROOM_DELETED` (host tắt voice, phòng biến mất) rơi vào chung một rổ với
 * "rớt mạng", nên client tự động xin token vào lại đúng cái phòng vừa tống mình
 * ra - rồi lặp lại ở mỗi lần thức dậy.
 *
 * Câu hỏi mà hook cần trả lời không phải "có phải duplicate không" mà là **"lần
 * ngắt này có chủ đích hay không"**. Ba nhóm đầu là CÓ: server đã quyết định
 * người này không còn thuộc về kênh thoại, và tự nối lại là đi ngược lại quyết
 * định đó. Nhóm cuối là mọi thứ còn lại - mạng, tín hiệu, server restart - nơi
 * người chơi vẫn thuộc về phòng và việc vào lại là đúng.
 *
 * Tách khỏi `voice-room.ts` để kiểm chứng được bằng `node:test` mà không phải
 * dựng cả một `Room`, và quan trọng hơn: để tầng hook test được với **chính
 * enum thật** của SDK thay vì một bản giả. Chính việc thiếu đường đó đã giấu lỗi
 * boolean đi trong suốt thời gian nó tồn tại.
 */

export type VoiceDisconnectKind =
  /** Chính người này vừa mở kênh thoại ở tab khác. */
  | "duplicate"
  /** Bị gỡ khỏi room: rời phòng hoặc bị đuổi. */
  | "participant_removed"
  /** Room bị xoá: host tắt voice, hoặc phòng game biến mất. */
  | "room_deleted"
  /** Mạng, tín hiệu, server restart - vào lại là đúng. */
  | "recoverable";

/**
 * @param reason lý do SDK báo; `undefined` khi nó không nói gì
 *
 * So sánh tường minh từng hằng số chứ không dùng `switch` có `default` im lặng
 * ở tầng này - bảng kỳ vọng đủ nằm trong test, nên thêm một lý do mới vào SDK
 * sẽ làm test đỏ và buộc phải quyết định, thay vì lặng lẽ thành "cứ nối lại đi".
 */
export function classifyDisconnect(reason: DisconnectReason | undefined): VoiceDisconnectKind {
  if (reason === DisconnectReason.DUPLICATE_IDENTITY) return "duplicate";
  if (reason === DisconnectReason.PARTICIPANT_REMOVED) return "participant_removed";
  if (reason === DisconnectReason.ROOM_DELETED) return "room_deleted";
  return "recoverable";
}

/** Lần ngắt này là quyết định của server, không phải sự cố. */
export function isTerminalDisconnect(kind: VoiceDisconnectKind): boolean {
  return kind === "participant_removed" || kind === "room_deleted";
}
