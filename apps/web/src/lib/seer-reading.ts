import { TEAM_LABELS, type Team } from "@masoi/shared";

/**
 * Câu chữ và màu cho MỘT kết quả soi.
 *
 * Tách khỏi JSX vì nó không còn là một biểu thức ba ngôi nữa. Bản cũ viết
 * thẳng `isWolf ? "Ma Sói!" : "Phe làng"` ở hai chỗ trong `NightPanel`, và với
 * hai phe thì câu đó đúng. Với một vai TRUNG LẬP nó thành lời nói dối tệ nhất
 * mà giao diện này có thể nói: Tiên Tri đọc "Phe làng" rồi đem uy tín của mình
 * ra bảo lãnh cho một người không chơi cho làng.
 *
 * Kỹ năng chỉ trả lời về PHE, không về vai - nên nhãn ở đây cũng vậy: "Phe
 * trung lập", không phải "Thằng Hề".
 */
export interface SeerReading {
  label: string;
  className: string;
}

const READING: Record<Team, SeerReading> = {
  wolves: { label: `${TEAM_LABELS.wolves}!`, className: "text-blood-400" },
  village: { label: "Phe làng", className: "text-emerald-300" },
  // Hổ phách, cùng sắc mà bộ bài và màn kết thúc dùng cho phe trung lập: một
  // kết quả trung lập KHÔNG được mang màu xanh của "an toàn".
  neutral: { label: `Phe ${TEAM_LABELS.neutral.toLowerCase()}`, className: "text-amber-300" },
};

/**
 * `team` là nguồn sự thật; `isWolf` chỉ là đường lui.
 *
 * Web và server deploy rời nhau, nên một client mới chạy với server cũ sẽ nhận
 * kết quả không có `team`. Ở server cũ thì chưa có vai trung lập nào, nên
 * "không phải Sói" ở đó đúng bằng "phe làng" - đường lui này không đoán bừa,
 * nó đọc lại đúng thứ bản build kia biết.
 */
export function seerReading(team: Team | undefined, isWolf: boolean | undefined): SeerReading {
  if (team) return READING[team];
  return isWolf ? READING.wolves : READING.village;
}
