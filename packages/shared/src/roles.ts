/** Các vai trò trong game. Thêm role mới: bổ sung enum + ROLE_META. */
export const ROLES = [
  "WEREWOLF",
  "WOLF_CUB",
  "SEER",
  "APPRENTICE_SEER",
  "DETECTIVE",
  "GUARD",
  "GUARDIAN_ANGEL",
  "PRIEST",
  "WITCH",
  "HUNTER",
  "MAYOR",
  "CURSED",
  "VILLAGER",
  "JESTER",
  "SERIAL_KILLER",
] as const;
export type Role = (typeof ROLES)[number];

/**
 * Chuỗi này có phải một vai mà bản build HIỆN TẠI hiểu không.
 *
 * Cần cho dữ liệu đọc lên từ những chỗ mà TypeScript không với tới được: cột
 * Json trong DB giữ nguyên hình dạng của bản build đã ghi nó, nên một vai bị
 * đổi tên hay gỡ đi vẫn nằm nguyên trong lịch sử của những ván cũ. Tra thẳng
 * chuỗi đó vào `ROLE_META` sẽ ra undefined, và `.team` trên undefined thì ném
 * lỗi - làm chết cả trang đang render nó.
 */
export function isRole(value: unknown): value is Role {
  return typeof value === "string" && Object.hasOwn(ROLE_META, value);
}

/**
 * Phe của một vai.
 *
 * `neutral` KHÔNG phải "một phe thứ ba có chung điều kiện thắng". Nó chỉ nói
 * đúng một điều: vai này không đứng cùng Dân cũng không đứng cùng Sói, nên mọi
 * phép kiểm tra đồng đội (soi, so phe, chat của bầy Sói, bảng tổng kết) phải
 * trả lời "khác phe" với cả hai bên. Điều kiện thắng của một vai trung lập là
 * chuyện RIÊNG của vai đó, và hai vai trung lập KHÔNG chia nhau luật nào:
 * Thằng Hề thắng bằng `personalWins` mà không kết thúc ván, còn Sát Nhân thắng
 * bằng `Winner`. Xem `sameFaction` cho hệ quả quan trọng nhất của điều đó.
 */
export type Team = "wolves" | "village" | "neutral";

/**
 * Tên phe hiển thị cho người chơi. Một bảng duy nhất vì cả web lẫn hồ sơ vụ án
 * đều phải gọi ba phe bằng đúng ba chữ ấy.
 */
export const TEAM_LABELS: Record<Team, string> = {
  wolves: "Ma Sói",
  village: "Dân Làng",
  neutral: "Trung lập",
};

export function teamName(team: Team): string {
  return TEAM_LABELS[team];
}

export interface RoleMeta {
  id: Role;
  name: string;
  description: string;
  team: Team;
  /** Thứ tự xử lý hành động ban đêm, nhỏ hơn chạy trước. undefined = không có hành động đêm. */
  nightOrder?: number;
}

export const ROLE_META: Record<Role, RoleMeta> = {
  WEREWOLF: {
    id: "WEREWOLF",
    name: "Ma Sói",
    description: "Ban đêm hợp tác với đồng bọn chọn một nạn nhân để cắn.",
    team: "wolves",
    nightOrder: 2,
  },
  WOLF_CUB: {
    id: "WOLF_CUB",
    name: "Sói Con",
    description: "Cùng thức dậy với Sói. Khi Sói Con chết, đêm kế tiếp bầy Sói được cắn 2 mục tiêu.",
    team: "wolves",
    nightOrder: 2,
  },
  SEER: {
    id: "SEER",
    name: "Tiên Tri",
    description: "Mỗi đêm soi một người để biết phe của người đó.",
    team: "village",
    nightOrder: 1,
  },
  APPRENTICE_SEER: {
    id: "APPRENTICE_SEER",
    name: "Tiên Tri Tập Sự",
    description: "Ban đầu không có kỹ năng. Khi Tiên Tri chết, thừa kế kỹ năng soi từ đêm kế tiếp.",
    team: "village",
    nightOrder: 1,
  },
  DETECTIVE: {
    id: "DETECTIVE",
    name: "Thám Tử",
    description: "Mỗi đêm chọn 2 người chơi còn sống để kiểm tra xem họ cùng phe hay khác phe.",
    team: "village",
    nightOrder: 1.5,
  },
  GUARD: {
    id: "GUARD",
    name: "Bảo Vệ",
    // "Đòn giết ban đêm", không phải "đòn cắn của Sói": khiên chặn cả nhát dao
    // của Sát Nhân. Nó KHÔNG chặn độc, phản vệ Nước thánh hay đạn Thợ Săn.
    description:
      "Mỗi đêm bảo vệ một người khỏi mọi đòn giết ban đêm, không thể bảo vệ cùng một người hai đêm liền.",
    team: "village",
    nightOrder: 0,
  },
  GUARDIAN_ANGEL: {
    id: "GUARDIAN_ANGEL",
    name: "Thiên Thần Hộ Mệnh",
    // Cùng lý do với Bảo Vệ ngay trên: khiên chặn cả nhát dao của Sát Nhân.
    description:
      "Tối đa 2 lần cả ván, chọn 1 người để bảo vệ khỏi đòn giết ban đêm (không lặp 2 đêm liền).",
    team: "village",
    nightOrder: 0.5,
  },
  PRIEST: {
    id: "PRIEST",
    name: "Linh Mục",
    // "Không phải Sói", không phải "Dân": ném vào một vai TRUNG LẬP cũng phản
    // vệ, và câu cũ khiến người chơi tưởng mình đang đánh cược với đúng hai phe.
    description:
      "Có 1 bình Nước thánh cả ván: Ném vào Sói thì Sói chết, ném vào người không phải Sói thì Linh mục chết do phản vệ.",
    team: "village",
    nightOrder: 2.5,
  },
  WITCH: {
    id: "WITCH",
    name: "Phù Thủy",
    description: "Có một bình cứu người và một bình độc, mỗi bình chỉ dùng một lần cả ván.",
    team: "village",
    nightOrder: 3,
  },
  HUNTER: {
    id: "HUNTER",
    name: "Thợ Săn",
    description: "Khi chết, có thể bắn một người còn sống hoặc không bắn ai.",
    team: "village",
  },
  MAYOR: {
    id: "MAYOR",
    name: "Thị Trưởng",
    description: "Phiếu biểu quyết ban ngày (đề cử và treo cổ) có trọng số x2 phiếu.",
    team: "village",
  },
  CURSED: {
    id: "CURSED",
    name: "Kẻ Nguyền Rủa",
    description:
      "Ban đêm không có hành động. Nếu bị Ma Sói cắn thành công lần đầu thì không chết mà hoá thành Ma Sói.",
    // Phe lúc chia bài. Sau khi bị nguyền, engine đổi hẳn vai sang WEREWOLF nên
    // mọi kiểm tra phe (soi, đếm thắng, chat) tự động thấy phe mới.
    team: "village",
  },
  VILLAGER: {
    id: "VILLAGER",
    name: "Dân Làng",
    description: "Không có kỹ năng đặc biệt, thảo luận và bỏ phiếu vào ban ngày.",
    team: "village",
  },
  SERIAL_KILLER: {
    id: "SERIAL_KILLER",
    name: "Sát Nhân",
    description: "Mỗi đêm chọn giết một người. Bạn thắng khi trở thành người sống sót cuối cùng.",
    // Trung lập, và chiến đấu MỘT MÌNH: không chung đội với Hề, Dân hay Sói.
    team: "neutral",
    /*
     * 2.2 - sau bầy Sói (2), trước Linh Mục (2.5) và Phù Thuỷ (3).
     *
     * Con số chỉ xếp thứ tự HIỂN THỊ và trả lời `hasNightAction`; nó KHÔNG
     * quyết định ai ra tay trước, vì `resolveNight` gom mọi đòn đã khoá rồi
     * mới áp cái chết một lượt. Đặt sau Sói để bảng hướng dẫn đọc đúng nhịp
     * của một đêm: bầy đi trước, kẻ đi một mình đi sau.
     */
    nightOrder: 2.2,
  },
  JESTER: {
    id: "JESTER",
    name: "Thằng Hề",
    description: "Đánh lừa mọi người để bị treo cổ ban ngày. Bạn chỉ thắng khi bị treo cổ.",
    // Trung lập, và KHÔNG có nightOrder: Thằng Hề không thức dậy, không gây sát
    // thương, không có kỹ năng giết ai. `hasNightAction` suy ra từ đúng trường
    // này nên không chỗ nào phải liệt kê tên vai lần thứ hai.
    team: "neutral",
  },
};

export function roleTeam(role: Role): Team {
  return ROLE_META[role].team;
}

/**
 * Hai vai này có đứng CÙNG MỘT PHÍA không.
 *
 * KHÔNG phải `roleTeam(a) === roleTeam(b)`, và đó là toàn bộ lý do hàm này tồn
 * tại. `neutral` là một cái NHÃN nói "không thuộc Dân, không thuộc Sói", không
 * phải một phe có thật: Thằng Hề đi tìm giá treo còn Sát Nhân đi tìm cái chết
 * của tất cả mọi người, kể cả của Thằng Hề. Trả lời "cùng phe" cho cặp đó là
 * đưa cho Thám Tử một kết luận sai về đúng hai lá bài nguy hiểm nhất bàn.
 *
 * Mỗi vai trung lập tối đa một lá mỗi ván, nên `a === b` ở nhánh cuối chỉ đúng
 * khi hai bên là CÙNG MỘT người - trường hợp mà mọi chỗ gọi đã loại từ trước.
 */
export function sameFaction(a: Role, b: Role): boolean {
  const teamA = ROLE_META[a].team;
  const teamB = ROLE_META[b].team;
  if (teamA !== teamB) return false;
  if (teamA === "neutral") return a === b;
  return true;
}

/**
 * "Vai quyền lực": vai phe làng có một sức nặng riêng ngoài lá phiếu.
 *
 * Định nghĩa suy ra từ `ROLE_META` chứ không phải một danh sách chép tay, nên
 * thêm một vai làng mới vào `ROLES` là nó tự vào đây - không có cái danh sách
 * thứ hai nào để quên cập nhật.
 *
 * Vai TRUNG LẬP không bao giờ vào đây, và đó là hệ quả của chính điều kiện
 * `team === "village"` chứ không phải một loại trừ chép tay: Thằng Hề không
 * giữ thông tin nào của làng, nên bầy Sói không có lý do phải cắn nó khi nó lộ
 * mặt - đúng câu hỏi mà tập này trả lời.
 *
 * Hai loại trừ trong phe làng, và cả hai đều có lý do:
 * - `VILLAGER`: không có gì để lộ, nên khai ra cũng không đặt cược gì.
 * - `CURSED`: ban đêm không làm gì và bầy Sói KHÔNG có lý do giết nó (cắn trúng
 *   thì nó thành Sói). Nó nằm phe làng lúc chia bài nhưng không mang rủi ro của
 *   một vai chức năng.
 *
 * Đọc tập này là "những vai mà bầy Sói có lý do phải cắn ngay khi lộ mặt" -
 * đúng giả định mà tín hiệu kiểm chứng bằng đêm của mô hình uy tín dựa vào, và
 * cũng đúng câu hỏi "khai ra thì có đang đặt cược gì không" của lõi quyết định.
 * Một định nghĩa, hai nơi dùng: hai tập trùng nhau hôm nay là hai tập lệch nhau
 * vào ngày mai.
 */
export function isPowerRole(role: Role): boolean {
  return ROLE_META[role].team === "village" && role !== "VILLAGER" && role !== "CURSED";
}

export const ROLE_ORDER_FOR_NIGHT = (Object.values(ROLE_META) as RoleMeta[])
  .filter((r) => r.nightOrder !== undefined)
  .sort((a, b) => a.nightOrder! - b.nightOrder!)
  .map((r) => r.id);
