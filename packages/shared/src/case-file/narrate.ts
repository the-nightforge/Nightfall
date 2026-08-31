import { ROLE_META } from "../roles";
import type { CaseFilePlayer } from "./types";

/**
 * Tên hiển thị của một người trong hồ sơ.
 *
 * Lịch sử đêm/ngày nhắc tới người theo id, mà roster có thể thiếu người đó nếu
 * dữ liệu tới từ một server cũ hơn. Trả về một nhãn trung tính thay vì để
 * `undefined` rơi vào câu văn.
 */
export const UNKNOWN_PLAYER = "một người không rõ";

export function nameOf(players: Map<string, CaseFilePlayer>, id: string): string {
  return players.get(id)?.name ?? UNKNOWN_PLAYER;
}

/**
 * Nhãn vai để kể lại. Kẻ Nguyền Rủa đã hoá Sói phải kể được cả hai đầu câu
 * chuyện: nó vốn là gì và nó đã thành gì.
 */
export function roleLabelOf(player: CaseFilePlayer | undefined): string {
  if (!player) return "chưa rõ vai";
  if (player.originRole === "CURSED" && player.role !== "CURSED") {
    return `${ROLE_META.CURSED.name} (đã hoá ${ROLE_META[player.role].name})`;
  }
  return ROLE_META[player.role].name;
}

export function teamLabel(team: "wolves" | "village"): string {
  return team === "wolves" ? "Ma Sói" : "Dân Làng";
}

/** "Đêm 2" / "Ngày 3" - nhãn ngắn dùng chung cho hồ sơ, thẻ chia sẻ và timeline. */
export function momentLabel(round: number, phase: "night" | "day"): string {
  return `${phase === "night" ? "Đêm" : "Ngày"} ${round}`;
}

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} và ${names[names.length - 1]}`;
}
