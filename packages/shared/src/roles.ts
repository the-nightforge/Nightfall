/** Các vai trò trong game. Thêm role mới: bổ sung enum + ROLE_META. */
export const ROLES = ["WEREWOLF", "SEER", "GUARD", "WITCH", "VILLAGER"] as const;
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
  SEER: {
    id: "SEER",
    name: "Tiên Tri",
    description: "Mỗi đêm soi một người để biết phe của người đó.",
    team: "village",
    nightOrder: 1,
  },
  GUARD: {
    id: "GUARD",
    name: "Bảo Vệ",
    description: "Mỗi đêm bảo vệ một người, không thể bảo vệ cùng một người hai đêm liền.",
    team: "village",
    nightOrder: 0,
  },
  WITCH: {
    id: "WITCH",
    name: "Phù Thủy",
    description: "Có một bình cứu người và một bình độc, mỗi bình chỉ dùng một lần cả ván.",
    team: "village",
    nightOrder: 3,
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
