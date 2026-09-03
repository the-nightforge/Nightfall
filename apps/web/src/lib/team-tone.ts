import type { Team } from "@masoi/shared";

/**
 * Sắc của thẻ VAI theo phe, dùng ở mọi chỗ vai đã được phép lộ.
 *
 * Một bảng, không phải một biểu thức ba ngôi chép lại ở từng component. Với hai
 * phe thì `team === "wolves" ? đỏ : xanh` còn đúng, nhưng mỗi bản chép đó là
 * một chỗ để phe thứ ba lặng lẽ mượn màu của phe Dân Làng - và ở đây màu chính
 * là thứ nói cho người xem biết ai đứng về phía nào.
 *
 * Hổ phách cho trung lập, cùng sắc mà bộ bài, thẻ vai, kết quả soi và màn kết
 * thúc đang dùng.
 */
export const TEAM_TAG_CLASS: Record<Team, string> = {
  wolves: "bg-blood-600/80 text-white",
  village: "bg-emerald-900/80 text-emerald-200",
  neutral: "bg-amber-900/80 text-amber-200",
};
