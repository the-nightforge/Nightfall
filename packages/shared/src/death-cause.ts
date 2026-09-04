import type { CaseDeathCause } from "./case-file/types";

/**
 * Nguyên nhân chết, viết như một MỆNH ĐỀ chứ không phải một cái nhãn.
 *
 * Cùng một cái chết được kể ở BA chỗ - dòng kết mỗi đêm trong
 * `NightRecapTimeline`, dòng thời gian rút gọn trong `CaseFileCard`, và bản tin
 * của sự kiện Bản Tin Bình Minh do engine dựng giữa ván - nên câu chữ phải ở
 * MỘT chỗ. Hai bảng nhãn song song là hai bảng sẽ trôi khỏi nhau ở lần sửa sau:
 * bản trước có "trúng độc của Phù Thủy" bên này và "trúng độc" bên kia, cùng
 * một cái chết mà đọc ra như hai chuyện.
 *
 * Nằm ở `shared` chứ không ở `apps/web` vì lý do đó: engine là chỗ gọi thứ ba,
 * và nó không với tới được thư mục của web.
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
    case "serial_killer":
      // KHÔNG nói ra chữ "Sát Nhân": vế này in ở dòng kết mỗi đêm trong bản
      // tường thuật cuối ván, nhưng cùng một bảng nhãn cũng phục vụ hồ sơ vụ
      // án. Câu tả nhát dao mà không gọi tên vai giữ đúng luật "cái chết không
      // tiết lộ nguồn" ở mọi chỗ dùng lại nó.
      return "bị đâm trong đêm";
    default:
      return "gặp nạn";
  }
}

/**
 * Cùng bảng vế trên, nhưng cho bản tin đọc GIỮA VÁN.
 *
 * Khác biệt duy nhất nằm ở hai cause của Linh Mục, và lý do là ở chỗ chúng
 * không tả một cái chết mà XÁC NHẬN một lá bài: `priestResults` chỉ chính Linh
 * Mục nhìn thấy, nên "bị Linh Mục thanh tẩy" đọc lên giữa ban ngày là cả phòng
 * cùng lúc biết người vừa chết ĐÚNG là Sói và trong làng còn một Linh Mục sống.
 * Không nguyên nhân nào khác trong bảng làm được chuyện đó: Bình Độc chỉ nói
 * Phù Thuỷ đã ra tay, nhát cắn chỉ nói bầy Sói đã ra tay - cả hai đều là hành
 * động, không phải danh tính.
 *
 * Gộp `priest` với `priest_backfire` vào MỘT vế chứ không phải làm mờ từng cái:
 * để riêng thì hai vế khác nhau vẫn chỉ ra ai chết là Sói (mục tiêu ngã) và ai
 * chết là Linh Mục (phản vệ). Cùng một câu thì không suy ngược được.
 *
 * Ở màn kết thúc thì gọi `deathCauseClause` như cũ - ván đã xong, không còn gì
 * để giấu, và bản tường thuật cuối phải kể đúng chuyện đã xảy ra.
 */
export function midGameDeathCauseClause(cause: CaseDeathCause): string {
  if (cause === "priest" || cause === "priest_backfire") return "chết trong một nghi lễ";
  return deathCauseClause(cause);
}
