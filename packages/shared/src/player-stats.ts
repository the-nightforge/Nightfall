import { roleWonOutcome } from "./outcome";
import { roleTeam, type Role, type Team } from "./roles";
import type { MatchHistoryEntry } from "./snapshot";

/**
 * Hồ sơ của MỘT người chơi, gộp từ lịch sử ván của họ.
 *
 * Ở `shared` chứ không ở server, vì hai lý do: đầu vào đúng là
 * `MatchHistoryEntry` mà server đã dựng cho trang lịch sử - cùng cái sàng lọc
 * vai lạ, kết cục lạ - nên không có một phép đọc "ai thắng" thứ hai để mà
 * lệch; và web có thể tính lại từ lịch sử đang có trong tay nếu server cũ
 * chưa có endpoint này.
 */
export interface RoleStat {
  role: Role;
  games: number;
  wins: number;
}

export interface TeamStat {
  games: number;
  wins: number;
}

export interface PlayerStats {
  /** Số ván tính được: có vai của mình và kết cục đọc được. */
  games: number;
  wins: number;
  /** 0 đến 1; 0 khi chưa có ván. */
  winRate: number;
  /** Ván còn sống tới cuối, trên mẫu là những ván biết được sống hay chết. */
  survived: number;
  survivalRate: number;
  /** Số ván thắng liên tiếp tính từ ván MỚI NHẤT; 0 nếu ván mới nhất thua. */
  currentStreak: number;
  bestStreak: number;
  /** Thắng lợi cá nhân (Hề bị treo, Báo Thù đúng mục tiêu). */
  personalWins: number;
  byTeam: Record<Team, TeamStat>;
  /** Xếp theo số ván giảm dần, rồi số thắng giảm dần, rồi tên vai. */
  byRole: RoleStat[];
  /** epoch ms của ván mới nhất; null khi chưa có ván. */
  lastPlayedAt: number | null;
}

/**
 * Một ván là THẮNG khi có thắng lợi cá nhân, hoặc phe của vai mình về nhất.
 * Đúng bằng `personalOutcome` ở màn kết thúc và `cuesFor` bên âm thanh.
 */
export function matchWon(entry: MatchHistoryEntry): boolean | null {
  // `winner` là `Winner | "unknown"`, và `Winner` chứa null (ván chưa xong).
  // Lịch sử chỉ ghi ván đã xong, nhưng kiểu thì không hứa, nên null cũng là
  // "không đọc được" chứ không phải một kết cục.
  if (!entry.myRole || entry.winner === "unknown" || entry.winner === null) return null;
  if (entry.myPersonalWin) return true;
  return roleWonOutcome(entry.myRole, entry.winner);
}

export function computePlayerStats(entries: MatchHistoryEntry[]): PlayerStats {
  // Chỉ giữ ván đọc được, và sắp theo thời gian tăng dần để đếm chuỗi. Không
  // tin thứ tự đầu vào: endpoint trả mới nhất trước, còn web có thể ghép thêm.
  const played = entries
    .map((entry) => ({ entry, won: matchWon(entry) }))
    .filter((item): item is { entry: MatchHistoryEntry; won: boolean } => item.won !== null)
    .sort((a, b) => a.entry.endedAt - b.entry.endedAt);

  const byTeam: Record<Team, TeamStat> = {
    village: { games: 0, wins: 0 },
    wolves: { games: 0, wins: 0 },
    neutral: { games: 0, wins: 0 },
  };
  const roleMap = new Map<Role, RoleStat>();
  let wins = 0;
  let survived = 0;
  let survivalSample = 0;
  let personalWins = 0;
  let run = 0;
  let bestStreak = 0;

  for (const { entry, won } of played) {
    const role = entry.myRole as Role;
    const team = roleTeam(role);
    byTeam[team].games += 1;
    const stat = roleMap.get(role) ?? { role, games: 0, wins: 0 };
    stat.games += 1;
    if (won) {
      wins += 1;
      byTeam[team].wins += 1;
      stat.wins += 1;
      run += 1;
      if (run > bestStreak) bestStreak = run;
    } else {
      run = 0;
    }
    roleMap.set(role, stat);
    if (entry.myPersonalWin) personalWins += 1;
    if (entry.mySurvived !== null) {
      survivalSample += 1;
      if (entry.mySurvived) survived += 1;
    }
  }

  const byRole = [...roleMap.values()].sort(
    (a, b) => b.games - a.games || b.wins - a.wins || a.role.localeCompare(b.role),
  );

  return {
    games: played.length,
    wins,
    winRate: played.length ? wins / played.length : 0,
    survived,
    survivalRate: survivalSample ? survived / survivalSample : 0,
    // `run` sau vòng lặp chính là chuỗi kết thúc ở ván mới nhất.
    currentStreak: run,
    bestStreak,
    personalWins,
    byTeam,
    byRole,
    lastPlayedAt: played.length ? played[played.length - 1]!.entry.endedAt : null,
  };
}
