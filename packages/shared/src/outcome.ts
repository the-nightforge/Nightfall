import type { MatchOutcome } from "./phases";
import { ROLE_META, TEAM_LABELS } from "./roles";
import type { Role, Team } from "./roles";

/**
 * Câu chữ của một KẾT CỤC, ở một chỗ duy nhất.
 *
 * Bốn nơi cùng phải gọi tên kết cục của một ván: màn kết thúc, hồ sơ vụ án, thẻ
 * chia sẻ và lịch sử trận. Khi chỉ có hai kết cục thì mỗi nơi tự viết
 * `winner === "wolves" ? "Ma Sói" : "Dân Làng"` mà vẫn đúng - và đó chính là
 * hình dạng đã phải sửa ở cả bốn nơi khi phe thứ ba xuất hiện. Một bảng chung
 * là cách để lần thứ ba không phải sửa bốn chỗ nữa.
 *
 * `outcomeTeam` trả `null` cho hai kết cục KHÔNG thuộc phe nào:
 *  - `draw`: không ai thắng, nên không có phe nào để tô màu.
 *  - `serial_killer` thì có: Sát Nhân đứng ở nhãn `neutral`, nên màu và nhãn
 *    phe của nó là màu và nhãn của phe trung lập - còn TÊN thì là tên vai, vì
 *    "Phe Trung lập chiến thắng" nói sai chuyện đã xảy ra (Thằng Hề cũng mang
 *    nhãn đó và nó không thắng gì ở đây).
 */
export function outcomeTeam(outcome: MatchOutcome): Team | null {
  switch (outcome) {
    case "wolves":
      return "wolves";
    case "village":
      return "village";
    case "serial_killer":
      return "neutral";
    case "draw":
      return null;
  }
}

/**
 * Tên của bên thắng, đủ để ghép vào một câu.
 *
 * "Phe Ma Sói" / "Phe Dân Làng" cho hai phe, và TÊN VAI cho Sát Nhân - nó thắng
 * một mình, không dẫn theo ai. `draw` không có bên thắng nào để gọi tên.
 */
export function outcomeName(outcome: MatchOutcome): string | null {
  switch (outcome) {
    case "wolves":
    case "village":
      return `Phe ${TEAM_LABELS[outcome]}`;
    case "serial_killer":
      return ROLE_META.SERIAL_KILLER.name;
    case "draw":
      return null;
  }
}

/** Tiêu đề đầy đủ của màn kết thúc. */
export function outcomeHeadline(outcome: MatchOutcome): string {
  const name = outcomeName(outcome);
  return name === null ? "Không ai còn sống - ván đấu hoà" : `${name} chiến thắng`;
}

/**
 * Vai này có thuộc bên thắng của ván không.
 *
 * KHÔNG suy được bằng `roleTeam(role) === winner`: `serial_killer` không phải
 * một giá trị `Team`, nên phép so sánh đó trả `false` cho chính kẻ vừa thắng.
 * Và với `draw` thì câu trả lời là `false` cho MỌI vai - hoà không được ghi
 * thành thắng theo phe cho bất kỳ ai.
 *
 * Thắng lợi CÁ NHÂN (Thằng Hề) không đi qua đây: nó là một sổ riêng, và chỗ
 * gọi phải cộng nó vào bằng `personalWins` chứ không bằng vai.
 */
export function roleWonOutcome(role: Role, outcome: MatchOutcome): boolean {
  if (outcome === "draw") return false;
  if (outcome === "serial_killer") return role === "SERIAL_KILLER";
  return ROLE_META[role].team === outcome;
}
