/** Các vai trò trong game. Thêm role mới: bổ sung enum + ROLE_META. */
export const ROLES = [
  "WEREWOLF",
  "WOLF_CUB",
  "SORCERER",
  "ALPHA_WOLF",
  "TRAITOR",
  "SEER",
  "APPRENTICE_SEER",
  "DETECTIVE",
  "GUARD",
  "GUARDIAN_ANGEL",
  "WITCH",
  "ELDER",
  "DOPPELGANGER",
  "HUNTER",
  "MAYOR",
  "CURSED",
  "VILLAGER",
  "JESTER",
  "SERIAL_KILLER",
  "EXECUTIONER",
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
  ALPHA_WOLF: {
    id: "ALPHA_WOLF",
    name: "Sói Alpha",
    description: "Cắn cùng bầy mỗi đêm. Lần bị Tiên Tri soi đầu tiên hiện ra là Dân, từ lần sau hiện nguyên hình.",
    team: "wolves",
    nightOrder: 2,
  },
  TRAITOR: {
    id: "TRAITOR",
    name: "Kẻ Phản Bội",
    description:
      "Thắng cùng phe Sói nhưng KHÔNG thuộc bầy: không có hành động đêm, không biết Sói là ai và Sói cũng không biết bạn. Tiên Tri soi ra bạn KHÔNG phải Sói. Khi con Sói cuối cùng chết, bạn hoá thành Ma Sói.",
    /*
     * `wolves`, và đây là toàn bộ vai trò của lá này: nó THẮNG cùng phe Sói.
     *
     * Nhưng "cùng phe" KHÔNG có nghĩa "trong bầy", và mọi chỗ trong engine từng
     * dùng `roleTeam(...) === "wolves"` để trả lời câu hỏi thứ hai giờ phải hỏi
     * `isWolfPack` - xem chú thích ở hàm đó. Đây là lá đầu tiên trong bộ bài
     * làm hai câu hỏi ấy tách nhau ra.
     */
    team: "wolves",
    /*
     * KHÔNG có `nightOrder`: nó không thức dậy, không giết ai, không soi ai.
     * `hasNightAction` suy ra từ đúng trường này - cùng cách Thằng Hề và Kẻ Báo
     * Thù được khai báo - nên không chỗ nào phải liệt kê tên vai lần thứ hai.
     */
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
    description:
      "Biết Tiên Tri là ai ngay từ đầu ván. Khi Tiên Tri chết, thừa kế kỹ năng soi từ đêm kế tiếp.",
    team: "village",
    nightOrder: 1,
  },
  SORCERER: {
    id: "SORCERER",
    name: "Sói Pháp Sư",
    description: "Mỗi đêm soi một người còn sống để biết họ có thuộc dòng Tiên Tri (Tiên Tri, Tiên Tri Tập Sự) không.",
    team: "wolves",
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
  DOPPELGANGER: {
    id: "DOPPELGANGER",
    name: "Kẻ Song Trùng",
    description:
      "Khi người ĐẦU TIÊN của ván qua đời, bạn hoá thành đúng vai của họ - kể cả khi đó là một vai phe Sói.",
    /*
     * `village` là phe LÚC CHIA BÀI, và nó chỉ đúng cho tới cái chết đầu tiên.
     *
     * Không có phe riêng cho lá này: sau khi hoá, `role` bị ghi đè hẳn nên mọi
     * phép hỏi phe đều tự đọc ra vai MỚI - đúng cách Kẻ Nguyền Rủa, Kẻ Phản Bội
     * và Kẻ Báo Thù đã làm. Đây là lá thứ tư của khuôn đó, không phải một cơ
     * chế mới.
     */
    team: "village",
    /*
     * KHÔNG có `nightOrder`: trước khi hoá vai nó không thức dậy, và sau khi
     * hoá thì `nightOrder` được tra theo vai MỚI chứ không phải dòng này.
     */
  },
  ELDER: {
    id: "ELDER",
    name: "Trưởng Lão",
    description:
      "Sống sót nhát cắn đầu tiên của bầy Sói. Nếu chính làng giết bạn (treo cổ, bình độc, đạn Thợ Săn) thì mọi kỹ năng đặc biệt của phe làng mất hiệu lực suốt đêm và ngày kế tiếp.",
    /*
     * KHÔNG có `nightOrder`: nó không thức dậy. Cả hai vế của lá này đều là
     * phản ứng - một tấm đệm trước nhát cắn, và một cái bẫy dưới chân phe làng.
     */
    team: "village",
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
  EXECUTIONER: {
    id: "EXECUTIONER",
    name: "Kẻ Báo Thù",
    description:
      "Ban đêm không có hành động. Bạn có một mục tiêu bí mật thuộc phe Dân và chỉ thắng khi người đó bị treo cổ.",
    /*
     * Trung lập, và ĐỘC LẬP với tất cả - kể cả hai vai trung lập kia. Nó không
     * đi cùng làng dù mục tiêu của nó nằm trong làng: thứ nó cần là một bản án
     * treo cổ dành cho một người vô tội, đúng thứ làng tồn tại để tránh.
     */
    team: "neutral",
    /*
     * KHÔNG có `nightOrder`, cùng lý do với Thằng Hề: nó không thức dậy, không
     * gây sát thương và không có miễn nhiễm nào. `hasNightAction` suy ra từ
     * đúng trường này nên không chỗ nào phải liệt kê tên vai lần thứ hai.
     */
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
 * phải một phe có thật: Thằng Hề đi tìm giá treo, Sát Nhân đi tìm cái chết của
 * tất cả mọi người, và Kẻ Báo Thù chỉ đi tìm bản án của đúng một người. Trả lời
 * "cùng phe" cho hai lá bất kỳ trong số đó là đưa cho Thám Tử một kết luận sai
 * về đúng những lá nguy hiểm nhất bàn.
 *
 * Một vai TRUNG LẬP không đứng cùng ai, kể cả người cầm CÙNG MỘT lá với nó -
 * và đó là lý do nhánh cuối trả `false` chứ không còn là `a === b`. Bản cũ đúng
 * chừng nào mỗi vai trung lập tối đa một lá mỗi ván; từ khi Kẻ Báo Thù có thể
 * hoá Thằng Hề giữa ván, một bàn có thể có HAI Thằng Hề - hai người thắng bằng
 * hai cái chết khác nhau, không thắng cùng nhau, và không được Thám Tử báo về
 * là đồng đội chỉ vì trùng tên vai.
 *
 * Mọi chỗ gọi đều so hai NGƯỜI khác nhau, nên không có ca "so một người với
 * chính họ" để mà trả lời.
 */
export function sameFaction(a: Role, b: Role): boolean {
  const teamA = ROLE_META[a].team;
  const teamB = ROLE_META[b].team;
  if (teamA !== teamB) return false;
  if (teamA === "neutral") return false;
  return true;
}

/**
 * Lá này có nằm trong BẦY SÓI không - tức có thức dậy cùng bầy, biết mặt đồng
 * bọn, và bị bầy coi là người nhà.
 *
 * KHÔNG phải `roleTeam(role) === "wolves"`, và đó là toàn bộ lý do hàm này tồn
 * tại. Trước khi có Kẻ Phản Bội, hai câu hỏi ấy trùng kết quả ở mọi lá bài, nên
 * engine dùng lẫn lộn chúng ở hơn hai chục chỗ: kênh chat đêm, danh sách mục
 * tiêu không được cắn, bảng `knownRoles` phát cho từng con Sói, phiếu cắn, và
 * phép đếm thế cân bằng của `checkWin`. Chỉ chỗ CUỐI hỏi về phe; tất cả những
 * chỗ còn lại hỏi về bầy.
 *
 * Kẻ Phản Bội trả lời `false` ở đây và `"wolves"` ở `roleTeam`. Nó thắng cùng
 * bầy mà không được bầy biết tới - đó là cả lá bài, và trộn hai câu hỏi lại sẽ
 * xoá sạch nó: nó sẽ vào chat đêm của Sói ngay vòng một và nhìn thấy toàn bộ
 * danh sách bầy.
 */
export function isWolfPack(role: Role): boolean {
  return role === "WEREWOLF" || role === "WOLF_CUB" || role === "SORCERER" || role === "ALPHA_WOLF";
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
