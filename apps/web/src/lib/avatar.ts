"use client";

import { AVATAR_IDS, type AvatarId } from "./avatar-art";

/**
 * Gán ảnh đại diện cho người chơi.
 *
 * Không lấy từ server. Engine đóng băng thứ tự players ngay lúc tạo ván và
 * playerId thì cố định vĩnh viễn, nên mọi client tự tính ra cùng một kết quả -
 * thêm trường vào PlayerView chỉ tốn một vòng migration snapshot mà không mua
 * thêm được gì.
 *
 * Cố ý KHÔNG dính dáng gì tới vai trò: vai là bí mật, còn bảng gán này ai cũng
 * tính lại được.
 */

/** FNV-1a 32 bit. Đủ tản cho vài chục id và ngắn hơn mọi lựa chọn khác. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Bảng ảnh đại diện của cả phòng, không ai trùng ai.
 *
 * Duyệt theo id ĐÃ SẮP XẾP chứ không theo thứ tự mảng players: ở phòng chờ mảng
 * đó thay đổi mỗi lần có người vào hay rời, và ảnh đại diện của những người
 * đang ngồi yên không được phép nhảy vì việc đó. Sắp xếp xong thì kết quả chỉ
 * phụ thuộc vào TẬP id, giống hệt nhau trên mọi máy.
 *
 * Một phòng tối đa 15 người mà có 16 hình, nên vòng dò luôn tìm được chỗ trống.
 */
export function assignAvatars(playerIds: string[]): Record<string, AvatarId> {
  const result: Record<string, AvatarId> = {};
  const taken = new Set<AvatarId>();

  for (const id of [...playerIds].sort()) {
    const preferred = hash(id) % AVATAR_IDS.length;
    let chosen = AVATAR_IDS[preferred];
    for (let step = 1; taken.has(chosen) && step < AVATAR_IDS.length; step++) {
      chosen = AVATAR_IDS[(preferred + step) % AVATAR_IDS.length];
    }
    // Nhiều người hơn số hình thì đành để trùng, còn hơn là bỏ trống một ô.
    taken.add(chosen);
    result[id] = chosen;
  }
  return result;
}

/**
 * Sắc nền riêng của từng người, chỉ để nhận mặt nhanh trong lưới.
 *
 * Cố ý rất nhạt và KHÔNG dùng chung dải màu với trạng thái: đỏ là bị bỏ phiếu,
 * xám là đã chết, và nếu màu cá nhân cũng đậm như thế thì hai tầng thông tin đè
 * lên nhau. Bản thân hình chân dung giữ đơn sắc.
 */
const TINTS = [
  "rgba(126, 168, 226, 0.16)",
  "rgba(167, 139, 250, 0.16)",
  "rgba(94, 190, 178, 0.16)",
  "rgba(226, 168, 116, 0.16)",
  "rgba(196, 148, 178, 0.16)",
  "rgba(150, 176, 138, 0.16)",
] as const;

export function tintFor(playerId: string): string {
  // Đảo bit trước khi chia: cùng một hash mà chia cho hai số khác nhau thì hai
  // người trùng hình rất dễ trùng luôn cả sắc nền.
  return TINTS[(hash(playerId) >>> 8) % TINTS.length];
}
