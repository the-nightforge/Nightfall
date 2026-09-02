import type { Phase } from "@masoi/shared";

export interface PhaseMeta {
  label: string;
  /** Màu nhấn cho chấm và tên pha. Nền đã do Backdrop lo, ở đây chỉ cần một điểm nhấn. */
  accent: string;
  dot: string;
}

/**
 * Tên hiển thị của từng pha, dùng chung cho thanh pha và cho vạch ngăn trong
 * khung chat.
 *
 * Tách khỏi `PhaseBanner` khi khung chat bắt đầu chèn vạch "pha vừa đổi": hai
 * bản chép tay của cùng một bảng tên thì sớm muộn cũng có một pha mang hai cái
 * tên trên cùng một màn hình.
 */
export const PHASE_META: Record<Phase, PhaseMeta> = {
  LOBBY: { label: "Phòng chờ", accent: "text-mist", dot: "bg-mist/60" },
  ROLE_REVEAL: { label: "Xem vai trò", accent: "text-indigo-200", dot: "bg-indigo-400" },
  NIGHT: { label: "Ban đêm", accent: "text-indigo-200", dot: "bg-indigo-400" },
  NIGHT_RESULT: { label: "Trời sáng", accent: "text-amber-200", dot: "bg-amber-400" },
  DAY_DISCUSSION: { label: "Thảo luận", accent: "text-amber-100", dot: "bg-amber-300" },
  VOTING: { label: "Bỏ phiếu sơ bộ", accent: "text-blood-400", dot: "bg-blood-500" },
  DEFENSE: { label: "Biện hộ", accent: "text-amber-200", dot: "bg-amber-400" },
  FINAL_VOTE: { label: "Bỏ phiếu xác nhận", accent: "text-blood-400", dot: "bg-blood-500" },
  ELIMINATION: { label: "Công bố loại", accent: "text-blood-400", dot: "bg-blood-500" },
  HUNTER_SHOT: { label: "Thợ Săn phản kích", accent: "text-amber-200", dot: "bg-amber-400" },
  CHECK_WIN: { label: "Kiểm tra thắng", accent: "text-mist", dot: "bg-mist/60" },
  GAME_OVER: { label: "Kết thúc", accent: "text-emerald-300", dot: "bg-emerald-400" },
};
