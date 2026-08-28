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
] as const;
export type Role = (typeof ROLES)[number];

export type Team = "wolves" | "village";

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
    description: "Mỗi đêm bảo vệ một người, không thể bảo vệ cùng một người hai đêm liền.",
    team: "village",
    nightOrder: 0,
  },
  GUARDIAN_ANGEL: {
    id: "GUARDIAN_ANGEL",
    name: "Thiên Thần Hộ Mệnh",
    description: "Tối đa 2 lần cả ván, chọn 1 người để bảo vệ khỏi đòn cắn của Sói (không lặp 2 đêm liền).",
    team: "village",
    nightOrder: 0.5,
  },
  PRIEST: {
    id: "PRIEST",
    name: "Linh Mục",
    description: "Có 1 bình Nước thánh cả ván: Ném vào Sói thì Sói chết, ném vào Dân thì Linh mục chết do phản phệ.",
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
};

export function roleTeam(role: Role): Team {
  return ROLE_META[role].team;
}

export const ROLE_ORDER_FOR_NIGHT = (Object.values(ROLE_META) as RoleMeta[])
  .filter((r) => r.nightOrder !== undefined)
  .sort((a, b) => a.nightOrder! - b.nightOrder!)
  .map((r) => r.id);
