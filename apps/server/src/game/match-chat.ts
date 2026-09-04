import type { ChatMessage } from "@masoi/shared";
import type { Room } from "../rooms/store";

/**
 * Một tin nhắn đã được ghim vào sổ của ván.
 *
 * Không dùng lại `ChatMessage`: cái đó là hình dạng ĐI TRÊN DÂY tới client và
 * nó không mang `round`/`phase`. Hai trường đó chỉ biết được ngay lúc tin nhắn
 * được đăng - qua GAME_OVER là mất vĩnh viễn, đúng như `caseFile` đã phải dựng
 * tại chỗ vì cùng lý do.
 */
export interface ArchivedChatMessage {
  /** Thứ tự trong ván, đánh từ 0. Nguồn sự thật của thứ tự khi đọc lại. */
  seq: number;
  channel: string;
  actorId: string;
  actorName: string;
  text: string;
  round: number;
  phase: string;
  /** Mốc gõ thật (`ChatMessage.at`). */
  at: number;
}

/**
 * Trần cứng cho sổ chat của một ván.
 *
 * Sổ này KHÔNG bị cắt đầu như `chatLog` (cái đó cắt còn 100 vì nó đi kèm mọi
 * snapshot), nhưng nó cũng không được phép lớn vô hạn: nó nằm trong RAM suốt
 * ván và đi cùng envelope xuống Redis mỗi lần lưu. Một ván 12 người 15 vòng
 * hiếm khi qua nổi vài trăm câu, nên con số này là lưới an toàn cho phòng bị
 * spam chứ không phải một giới hạn mà lối chơi bình thường chạm tới.
 *
 * Chạm trần thì DỪNG GHI, không cắt đầu: một khúc liền mạch từ đầu ván đọc lại
 * còn có nghĩa, chứ một cửa sổ trượt thì `seq` sẽ nhảy cóc và người đọc không
 * còn biết mình đang thiếu đoạn nào.
 */
export const MAX_ARCHIVED_MESSAGES = 2000;

export function resetMatchChat(room: Room): void {
  room.matchChat = [];
}

/**
 * Ghim một tin nhắn vào sổ của ván đang chạy.
 *
 * Chỉ ghim khi CÓ ván: `gameId` là khoá của ván và nó cũng là thứ nối sổ này
 * với dòng `GameResult` sẽ được ghi. Tán gẫu ở sảnh chờ và mọi câu nói sau màn
 * kết thúc đều không thuộc về ván nào, nên chúng đi thẳng qua đây.
 */
export function archiveChatMessage(room: Room, message: ChatMessage): void {
  const state = room.engine?.state;
  if (!state || !room.gameId) return;
  // Ván đã lật bài xong: phần kết quả có thể đã ghi xuống DB rồi, nên thêm vào
  // sổ lúc này chỉ tạo ra một khúc không bao giờ được lưu.
  if (state.phase === "GAME_OVER") return;

  const archive = (room.matchChat ??= []);
  if (archive.length >= MAX_ARCHIVED_MESSAGES) return;

  archive.push({
    seq: archive.length,
    channel: message.channel,
    actorId: message.playerId,
    actorName: message.playerName,
    text: message.text,
    round: state.round,
    phase: state.phase,
    at: message.at,
  });
}
