import { roleTeam, type Role } from "@masoi/shared";

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
export function roleGoal(role: Role): string {
  return roleTeam(role) === "wolves"
    ? "Cùng đồng bọn loại dần dân làng, cho tới khi số Sói còn sống bằng hoặc hơn phần còn lại."
    : "Tìm ra và loại hết Ma Sói. Làng chỉ thắng khi không còn con Sói nào sống sót.";
}
