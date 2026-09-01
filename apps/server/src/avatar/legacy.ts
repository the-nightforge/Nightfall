import { objectStorage } from "../storage";
import { storeAvatar } from "./service";

export interface PlayerAvatarRecord {
  id: string;
  avatarUrl: string | null;
}

/** Tách phần base64 khỏi "data:image/png;base64,xxxx". */
function decodeDataUrl(value: string): Buffer | null {
  const comma = value.indexOf(",");
  if (comma < 0) return null;
  if (!value.slice(0, comma).includes(";base64")) return null;
  const buf = Buffer.from(value.slice(comma + 1), "base64");
  return buf.length > 0 ? buf : null;
}

/**
 * Giá trị avatar để gán cho RoomMember, kèm di trú ngầm cho dữ liệu cũ.
 *
 * Đây là chỗ đúng để di trú vì nó nằm trên đường mọi người chơi đều đi qua khi
 * vào phòng, và vì member được dựng NGAY SAU đó - nên snapshot đầu tiên đã sạch
 * base64 chứ không phải chờ tới lần đổi ảnh kế tiếp.
 *
 * Storage chưa cấu hình thì trả nguyên data URL: ở dev chưa có đường nào tạo
 * URL object, lọc đi chỉ tổ làm mất avatar.
 *
 * Di trú hỏng thì trả null và KHÔNG ném: một cái ảnh không upload lại được
 * không đáng để chặn người ta vào phòng. Lần vào phòng sau sẽ thử lại.
 */
export async function resolveMemberAvatar(player: PlayerAvatarRecord | null): Promise<string | null> {
  const url = player?.avatarUrl ?? null;
  if (!url || !player) return null;
  if (!url.startsWith("data:")) return url;
  if (!objectStorage().configured) return url;

  const decoded = decodeDataUrl(url);
  if (!decoded) {
    console.error(`[avatar] Data URL cũ của ${player.id} không giải mã được, bỏ qua`);
    return null;
  }

  try {
    return await storeAvatar(player.id, decoded);
  } catch (err) {
    console.error(`[avatar] Di trú avatar cũ của ${player.id} thất bại:`, err);
    return null;
  }
}
