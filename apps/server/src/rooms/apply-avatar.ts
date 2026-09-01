import { broadcastRoom } from "./broadcast";
import { getRoomSyncByPlayer } from "./index-helpers";
import { getRoom, persistRoom } from "./store";

/**
 * Đẩy avatar mới vào phòng người chơi đang ở, rồi phát lại snapshot.
 *
 * Nhận URL đã được tầng avatar duyệt, KHÔNG nhận dữ liệu ảnh - đó là điều giữ
 * cho snapshot chỉ mang chuỗi ngắn.
 *
 * Ở file riêng chứ không nằm trong service.ts để tránh vòng import: service.ts
 * cần gọi tầng avatar (di trú data URL cũ), còn tầng avatar cần gọi hàm này.
 */
export async function applyAvatarToRoom(playerId: string, avatarUrl: string | null): Promise<void> {
  const roomCode = getRoomSyncByPlayer(playerId);
  if (!roomCode) return;
  const room = getRoom(roomCode);
  if (!room) return;
  const member = room.members.find((m) => m.playerId === playerId);
  if (!member) return;

  member.avatarUrl = avatarUrl;
  await persistRoom(room);
  broadcastRoom(room.code);
}
