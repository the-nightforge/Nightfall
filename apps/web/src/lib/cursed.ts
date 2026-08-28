import { ROLE_META, type NightRecap, type Role, type RoomSnapshot } from "@masoi/shared";

interface RoleHolder {
  role?: Role;
  cursedTurned?: boolean;
}

/**
 * Tên vai để hiển thị. Kẻ Nguyền Rủa đã hoá Sói có role là WEREWOLF trong
 * snapshot, nên chỉ cờ cursedTurned mới kể lại được họ vốn là ai - và cờ đó chỉ
 * có mặt khi server đã cho phép lộ toàn bộ vai trò.
 */
export function roleLabel(player: RoleHolder): string {
  if (player.cursedTurned) return `${ROLE_META.CURSED.name} (đã hoá Ma Sói)`;
  if (!player.role) return "Chưa rõ";
  return ROLE_META[player.role].name;
}

/** Diễn biến "đã bị nguyền" của một đêm; null khi đêm đó không có ai bị nguyền. */
export function cursedTurnedText(night: NightRecap): string | null {
  // Lịch sử đêm lưu từ trước khi có role này không có trường cursedTurned.
  const turned = night.cursedTurned ?? null;
  return turned ? `${ROLE_META.CURSED.name} ${turned.name} đã chuyển thành Ma Sói.` : null;
}

/** Nhắc luật riêng cho chính Kẻ Nguyền Rủa; không bao giờ nói về người khác. */
export function myCursedNote(snapshot: RoomSnapshot): string | null {
  const you = snapshot.you;
  if (!you) return null;
  if (you.cursedTurned) {
    return "Bạn đã bị Ma Sói cắn và bị nguyền: từ giờ bạn thuộc phe Ma Sói. Đừng để lộ điều này.";
  }
  if (you.role === "CURSED") {
    return "Nếu bị Ma Sói cắn lần đầu, bạn không chết mà hoá thành Ma Sói và chơi tiếp cho phe Sói.";
  }
  return null;
}
