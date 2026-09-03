import { roleTeam, type Role, type Team } from "@masoi/shared";

/**
 * Mục tiêu của vai, nói theo ĐIỀU KIỆN THẮNG thật.
 *
 * Hai câu này chép lại đúng phép kiểm tra trong engine (`engine.ts`: hết Sói thì
 * làng thắng; số Sói còn sống bằng hoặc hơn phần còn lại thì Sói thắng), không
 * phải một lời khuyên chơi hay. Người mới hay tưởng phe Sói phải giết bằng hết
 * cả làng và cứ thế kéo dài ván ra, trong khi thực tế Sói đã thắng từ lúc hoà
 * quân số.
 *
 * Nói theo phe chứ không theo từng vai: kỹ năng riêng của mỗi vai đã nằm trong
 * `ROLE_META.description` ngay bên trên, và viết thêm một câu mục tiêu riêng
 * cho từng vai chỉ đẻ ra mười ba câu phải giữ cho khớp với hai dòng luật thắng
 * duy nhất ở engine.
 */
const TEAM_GOALS: Record<Team, string> = {
  wolves:
    "Cùng đồng bọn loại dần dân làng, cho tới khi số Sói còn sống bằng hoặc hơn phần còn lại.",
  village: "Tìm ra và loại hết Ma Sói. Làng chỉ thắng khi không còn con Sói nào sống sót.",
  /*
   * Phe trung lập KHÔNG nói theo phe, và đây là ngoại lệ có lý do chứ không
   * phải một lỗ hổng của quy tắc trên: vai trung lập không có luật thắng chung
   * nào để mà tóm tắt - mỗi vai có luật riêng. Hôm nay chỉ có một vai như vậy,
   * nên bảng dưới đây ghi thẳng luật của nó; vai trung lập thứ hai sẽ cần một
   * bảng theo VAI, không phải theo phe.
   */
  neutral: "",
};

/** Mục tiêu riêng của từng vai trung lập; xem chú thích `neutral` ở trên. */
const NEUTRAL_ROLE_GOALS: Partial<Record<Role, string>> = {
  JESTER:
    "Khiến cả làng tin bạn là Sói và treo cổ bạn giữa ban ngày. Bạn CHỈ thắng khi chết vì phán quyết treo cổ - chết vì Sói, độc hay Thợ Săn đều không tính, và sống tới cuối ván là thua.",
};

export function roleGoal(role: Role): string {
  const team = roleTeam(role);
  if (team === "neutral") {
    return NEUTRAL_ROLE_GOALS[role] ?? "Đạt điều kiện thắng riêng của vai này.";
  }
  return TEAM_GOALS[team];
}
