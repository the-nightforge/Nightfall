import type { Role, Team } from "@masoi/shared";
import { ROLE_ICON_PATHS } from "@/lib/role-art";

const GLYPH_TONE: Record<Team, string> = {
  wolves: "text-blood-400",
  village: "text-emerald-300",
  neutral: "text-amber-300",
};

/**
 * Biểu tượng vai trong một ô vuông tô màu theo phe.
 *
 * Dùng cho mọi chỗ liệt kê vai ngoài bàn chơi - bảng tra luật, hồ sơ - nơi
 * biểu tượng ĐÚNG theo vai là an toàn vì không nói về ai đang cầm lá đó.
 * Trang trí thuần, nên `aria-hidden`: tên vai luôn đứng cạnh dưới dạng chữ.
 */
export function RoleGlyph({ role, team, size = "md" }: { role: Role; team: Team; size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-11 w-11" : "h-9 w-9";
  const icon = size === "lg" ? "h-6 w-6" : "h-5 w-5";
  return (
    <span
      aria-hidden="true"
      className={`grid ${box} shrink-0 place-items-center rounded-lg bg-white/[0.06] ${GLYPH_TONE[team]}`}
    >
      <svg viewBox="0 0 512 512" className={`${icon} fill-current`}>
        <path d={ROLE_ICON_PATHS[role]} />
      </svg>
    </span>
  );
}
