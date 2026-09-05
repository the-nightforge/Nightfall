import type { LeaderboardView } from "@masoi/shared";
import { getIdentity } from "./identity";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

export type LeaderboardOutcome =
  | { kind: "ok"; view: LeaderboardView; loggedIn: boolean }
  /** Server cũ (404) hay lỗi mạng: không có gì để vẽ, và không đáng một dòng đỏ. */
  | { kind: "error" };

/**
 * Bảng là công khai; token chỉ để server nói thêm dòng "của bạn". Gửi token
 * nếu có, nhưng token hỏng không làm mất bảng - server đã hứa như vậy.
 */
export async function fetchLeaderboard(signal?: AbortSignal): Promise<LeaderboardOutcome> {
  const identity = getIdentity();
  try {
    const res = await fetch(`${SERVER_URL}/api/leaderboard`, {
      headers: identity ? { Authorization: `Bearer ${identity.token}` } : {},
      signal,
    });
    if (!res.ok) return { kind: "error" };
    const view = (await res.json()) as LeaderboardView;
    if (!Array.isArray(view.entries)) return { kind: "error" };
    return { kind: "ok", view, loggedIn: identity !== null };
  } catch {
    return { kind: "error" };
  }
}

/** Câu dưới bảng nói về chính người xem; null khi ẩn danh. */
export function myStanding(view: LeaderboardView, loggedIn: boolean): string | null {
  if (!loggedIn) return null;
  if (view.me) return `Bạn đang ở hạng ${view.me.rank} với ${view.me.points} điểm.`;
  if (view.myGames === 0) {
    return `Chơi ${view.minGames} ván có ít nhất ${view.minHumans} người thật trong ${view.windowDays} ngày để lên bảng.`;
  }
  const left = Math.max(0, view.minGames - view.myGames);
  return `Bạn đã có ${view.myGames} ván tính được, còn ${left} ván nữa là lên bảng.`;
}

/** "Cách tính": in từ hằng số server gửi, để không bao giờ lệch với luật thật. */
export function pointsRule(view: LeaderboardView): string {
  return `Thắng +${view.points.win}, thắng cá nhân +${view.points.personalWin}, sống sót tới cuối +${view.points.survived}. Tính ván có từ ${view.minHumans} người thật trong ${view.windowDays} ngày gần nhất.`;
}

/** Chữ cái đầu cho người chưa có ảnh. */
export function initialOf(nickname: string): string {
  const first = nickname.trim()[0];
  return first ? first.toLocaleUpperCase("vi") : "?";
}
