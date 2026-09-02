import type { CaseDeathCause } from "@masoi/shared";

/**
 * Nguyên nhân chết, viết như một MỆNH ĐỀ chứ không phải một cái nhãn.
 *
 * Màn kết thúc kể cùng một cái chết ở hai chỗ - dòng kết mỗi đêm trong
 * `NightRecapTimeline` và dòng thời gian rút gọn trong `CaseFileCard` - nên
 * câu chữ phải ở MỘT chỗ. Hai bảng nhãn song song là hai bảng sẽ trôi khỏi
 * nhau ở lần sửa sau: bản trước có "trúng độc của Phù Thủy" bên này và "trúng
 * độc" bên kia, cùng một cái chết mà đọc ra như hai chuyện.
 *
 * Mọi vế ở đây ghép thẳng được vào khuôn "<tên> <mệnh đề>", nên `priest_backfire`
 * KHÔNG được mang sẵn chữ "chết" của chính nó - chỗ gọi nào cần thì tự nối vế
 * "và đã chết" vào sau.
 */
export function deathCauseClause(cause: CaseDeathCause): string {
  switch (cause) {
    case "wolf":
      return "bị Sói cắn";
    case "poison":
      return "trúng Bình Độc của Phù Thủy";
    case "priest":
      return "bị Linh Mục thanh tẩy bằng Nước thánh";
    case "priest_backfire":
      return "bị Nước thánh phản vệ";
    case "lynch":
      return "bị làng treo cổ";
    case "hunter":
      return "trúng đạn Thợ Săn";
    default:
      return "gặp nạn";
  }
}
