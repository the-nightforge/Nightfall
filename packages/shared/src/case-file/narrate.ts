import { ROLE_META, TEAM_LABELS } from "../roles";
import type { Team } from "../roles";
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
 * Nhãn vai để kể lại. Một người đã ĐỔI VAI giữa ván phải kể được cả hai đầu câu
 * chuyện: nó vốn là gì và nó đã thành gì.
 *
 * Hai phép đổi vai của engine (Kẻ Nguyền Rủa hoá Sói, Kẻ Báo Thù hoá Thằng Hề)
 * đi qua CÙNG một nhánh vì chúng cùng một hình dạng: `originRole` khác `role`.
 * Viết theo hình dạng chứ không liệt kê tên vai, nên phép đổi vai thứ ba - nếu
 * có - không cần sửa hàm này.
 */
export function roleLabelOf(player: CaseFilePlayer | undefined): string {
  if (!player) return "chưa rõ vai";
  if (player.originRole !== player.role) {
    return `${ROLE_META[player.originRole].name} (đã hoá ${ROLE_META[player.role].name})`;
  }
  return ROLE_META[player.role].name;
}

/**
 * Nhận cả ba phe chứ không chỉ hai: `CaseFilePlayer.team` là `Team` đầy đủ, nên
 * một chữ ký hai phe ở đây chỉ đúng cho tới lá bài trung lập đầu tiên. Bảng nhãn
 * dùng chung với giao diện để hồ sơ và màn kết thúc không gọi cùng một phe bằng
 * hai cái tên.
 */
export function teamLabel(team: Team): string {
  return TEAM_LABELS[team];
}

/**
 * "Đêm 2" / "Ngày 3" - nhãn ngắn dùng chung cho hồ sơ, thẻ chia sẻ và timeline.
 *
 * ĐÂY là từ vựng chính thức cho trục thời gian của một ván, và `round` của
 * snapshot chính là con số trong nhãn này. Vì vậy mọi câu tóm tắt phải đếm bằng
 * NGÀY chứ không phải "vòng": bản cũ gọi cùng một con số là "3 vòng" ở dòng quy
 * mô rồi "Ngày 3" ngay dòng dưới, và người đọc phải tự đoán hai cụm đó có phải
 * một hay không. Xem `roundsLabel`.
 */
export function momentLabel(round: number, phase: "night" | "day"): string {
  return `${phase === "night" ? "Đêm" : "Ngày"} ${round}`;
}

/** "3 ngày" - độ dài một ván, đếm bằng đúng đơn vị mà `momentLabel` đánh số. */
export function roundsLabel(rounds: number): string {
  return `${rounds} ngày`;
}

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} và ${names[names.length - 1]}`;
}
