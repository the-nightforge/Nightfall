import { roleTeam, type Role, type Team } from "@masoi/shared";

/**
 * Mục tiêu của vai, nói theo ĐIỀU KIỆN THẮNG thật.
 *
 * Hai câu này chép lại đúng phép kiểm tra trong engine (`checkWin`), không phải
 * một lời khuyên chơi hay. Người mới hay tưởng phe Sói phải giết bằng hết cả
 * làng và cứ thế kéo dài ván ra, trong khi thực tế Sói đã thắng từ lúc hoà
 * quân số.
 *
 * `checkWin` xét Sát Nhân TRƯỚC cả hai phe: còn một Sát Nhân sống thì không
 * phe nào được tuyên thắng, kể cả khi con Sói cuối vừa ngã hoặc bầy Sói đã hoà
 * quân số. Bỏ vế đó ra khỏi hai câu dưới là dạy người chơi một luật thắng mà
 * engine không hề chạy - và dạy sai đúng chỗ đắt nhất, vì đó là chỗ một ván có
 * Sát Nhân được quyết. Viết "nếu có" thay vì hai bảng câu chữ theo cấu hình
 * phòng: câu vẫn đúng ở phòng không bật vai này, và một bảng thứ hai là một
 * bảng nữa phải giữ cho khớp.
 *
 * Thằng Hề KHÔNG có mặt trong hai câu này, và đó là chủ ý: sổ thắng của nó là
 * một sổ RIÊNG (`personalWins`), không phải một vế trong `checkWin`. Làng thắng
 * được với một Thằng Hề còn sống nguyên trên bàn, nên bắt người chơi phải loại
 * nó là bịa thêm một điều kiện không tồn tại.
 *
 * Nói theo phe chứ không theo từng vai: kỹ năng riêng của mỗi vai đã nằm trong
 * `ROLE_META.description` ngay bên trên, và viết thêm một câu mục tiêu riêng
 * cho từng vai chỉ đẻ ra mười ba câu phải giữ cho khớp với hai dòng luật thắng
 * duy nhất ở engine.
 */
const TEAM_GOALS: Record<Team, string> = {
  wolves:
    "Cùng đồng bọn loại dần dân làng, cho tới khi số Sói còn sống bằng hoặc hơn phần còn lại - và Sát Nhân, nếu có, phải chết trước đã.",
  village:
    "Tìm ra và loại hết Ma Sói, cùng Sát Nhân nếu phòng có vai đó. Làng chỉ thắng khi không còn con Sói nào lẫn Sát Nhân nào sống sót.",
  /*
   * Phe trung lập KHÔNG nói theo phe, và đây là ngoại lệ có lý do chứ không
   * phải một lỗ hổng của quy tắc trên: vai trung lập không có luật thắng chung
   * nào để mà tóm tắt - mỗi vai có luật riêng. Hôm nay chỉ có một vai như vậy,
   * nên bảng dưới đây ghi thẳng luật của nó; vai trung lập thứ hai sẽ cần một
   * bảng theo VAI, không phải theo phe.
   */
  neutral: "",
};

/**
 * Mục tiêu riêng của từng vai trung lập; xem chú thích `neutral` ở trên.
 *
 * Câu của Kẻ Báo Thù cố ý KHÔNG nói mục tiêu là ai: danh tính đó nằm ở khu
 * nhiệm vụ riêng (`ExecutionerMission`), còn đây là bảng LUẬT dùng chung cho
 * mọi người cầm lá đó. Nó cũng nói thẳng đường hoá Hề, vì một người chơi không
 * được biết trước điều đó sẽ tưởng mình vừa mất trắng cả ván.
 */
const NEUTRAL_ROLE_GOALS: Partial<Record<Role, string>> = {
  SERIAL_KILLER:
    "Sống sót tới khi chỉ còn lại một mình bạn. Mỗi đêm bạn được giết một người - kể cả Ma Sói - và bạn KHÔNG đứng cùng phe với ai, kể cả vai trung lập khác. Bị treo cổ là thua.",
  JESTER:
    "Khiến cả làng tin bạn là Sói và treo cổ bạn giữa ban ngày. Bạn CHỈ thắng khi chết vì phán quyết treo cổ - chết vì Sói, độc hay Thợ Săn đều không tính, và sống tới cuối ván là thua.",
  EXECUTIONER:
    "Khiến cả làng treo cổ đúng MỘT người: mục tiêu bí mật của bạn. Bạn phải còn sống vào lúc bản án được thi hành - không cần chính bạn đề cử hay bỏ phiếu kết tội. Nếu mục tiêu chết vì một nguyên nhân khác, bạn hoá thành Thằng Hề và từ đó chỉ thắng khi CHÍNH BẠN bị treo.",
};

export function roleGoal(role: Role): string {
  const team = roleTeam(role);
  if (team === "neutral") {
    return NEUTRAL_ROLE_GOALS[role] ?? "Đạt điều kiện thắng riêng của vai này.";
  }
  return TEAM_GOALS[team];
}
