import type { PlayerStats, RoleStat, Team } from "@masoi/shared";
import { getIdentity } from "./identity";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

export type StatsOutcome =
  | { kind: "ok"; stats: PlayerStats }
  /** Chưa đăng nhập, hoặc phiên đã hỏng (401). Giao diện coi là một. */
  | { kind: "anonymous" }
  /** Server cũ chưa có endpoint (404) cũng rơi vào đây: không có gì để vẽ. */
  | { kind: "error" };

/** Cùng khuôn với `fetchMatchHistory`; xem chú thích ở đó. */
export async function fetchPlayerStats(signal?: AbortSignal): Promise<StatsOutcome> {
  const identity = getIdentity();
  if (!identity) return { kind: "anonymous" };
  try {
    const res = await fetch(`${SERVER_URL}/api/players/me/stats`, {
      headers: { Authorization: `Bearer ${identity.token}` },
      signal,
    });
    if (res.status === 401) return { kind: "anonymous" };
    if (!res.ok) return { kind: "error" };
    const data = (await res.json()) as { stats?: PlayerStats };
    return data.stats ? { kind: "ok", stats: data.stats } : { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}

/** "67%": số nguyên, vì hồ sơ vài chục ván không có nghĩa tới phần thập phân. */
export function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/**
 * Những vai thắng nhiều nhất, để đặt lên đầu thẻ.
 *
 * Xếp theo số THẮNG chứ không theo tỉ lệ: một vai thắng 1/1 đứng trên vai
 * thắng 5/8 là tôn vinh may mắn hơn kỹ năng. Tỉ lệ chỉ là tiêu chí phụ. Vai
 * chưa thắng lần nào không có mặt - đây là "tốt nhất", không phải "tất cả".
 */
export function bestRoles(stats: PlayerStats, limit: number): RoleStat[] {
  return stats.byRole
    .filter((r) => r.wins > 0)
    .sort((a, b) => b.wins - a.wins || b.wins / b.games - a.wins / a.games || b.games - a.games)
    .slice(0, limit);
}

export function streakLabel(stats: PlayerStats): string {
  return `${stats.currentStreak} · kỷ lục ${stats.bestStreak}`;
}

const TEAM_ORDER: Array<{ team: Team; label: string }> = [
  { team: "village", label: "Dân" },
  { team: "wolves", label: "Sói" },
  { team: "neutral", label: "Trung lập" },
];

/** Dòng theo phe, chỉ những phe đã từng chơi. */
export function teamLine(
  stats: PlayerStats,
): Array<{ team: Team; label: string; games: number; wins: number }> {
  return TEAM_ORDER.filter(({ team }) => stats.byTeam[team].games > 0).map(({ team, label }) => ({
    team,
    label,
    games: stats.byTeam[team].games,
    wins: stats.byTeam[team].wins,
  }));
}
