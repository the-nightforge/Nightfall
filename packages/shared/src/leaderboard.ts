import { roleWonOutcome } from "./outcome";
import { isMatchOutcome } from "./phases";
import { isRole, type Role } from "./roles";
import { isPersonalWinCondition, type MatchHistoryPlayer, type PersonalWinCondition } from "./snapshot";

/**
 * Bảng xếp hạng 30 ngày.
 *
 * Luật tính điểm nằm ở `shared` để trang web in "cách tính" ĐÚNG bằng thứ
 * server dùng, và để test được mà không cần DB. Server chỉ làm hai việc quanh
 * nó: kéo ván trong cửa sổ và tra bảng Player để biết ai là người thật.
 *
 * Vì sao là điểm 30 ngày chứ không phải tỉ lệ thắng trọn đời: một bảng không
 * bao giờ đổi ngôi thì không ai nhìn lần thứ hai, và một bảng thưởng số ván
 * thì người chơi ít không bao giờ lên. Điểm cộng dồn trong một cửa sổ trượt
 * là thứ người mới còn với tới được mà vẫn phải THẮNG mới lên.
 */
export const LEADERBOARD_WINDOW_DAYS = 30;
/** Dưới mức này thì một ván may mắn là đủ để đứng đầu. */
export const LEADERBOARD_MIN_GAMES = 3;
/**
 * Ván toàn bot với một người thật là ván tập, không phải ván đấu: bot không
 * bao giờ nói dối giỏi bằng người, và điểm ở đó không nói gì về kỹ năng.
 */
export const LEADERBOARD_MIN_HUMANS = 4;
export interface LeaderboardPoints {
  win: number;
  personalWin: number;
  survived: number;
}
export const LEADERBOARD_POINTS: LeaderboardPoints = { win: 10, personalWin: 5, survived: 2 };
export const LEADERBOARD_TOP = 20;

export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  nickname: string;
  avatarUrl: string | null;
  points: number;
  games: number;
  wins: number;
  /** 0 đến 1. */
  winRate: number;
}

export interface LeaderboardView {
  entries: LeaderboardEntry[];
  /** Dòng của người hỏi, kể cả khi ngoài top; null khi chưa đủ ván hoặc ẩn danh. */
  me: LeaderboardEntry | null;
  /** Số ván tính được của người hỏi trong cửa sổ, để nói "còn N ván nữa". */
  myGames: number;
  windowDays: number;
  minGames: number;
  minHumans: number;
  points: LeaderboardPoints;
  /** epoch ms lúc dựng; bảng được cache ngắn phía server. */
  generatedAt: number;
}

/** Một dòng GameResult, đúng những cột bảng này cần. */
export interface LeaderboardMatch {
  id: string;
  winner: string;
  createdAt: Date;
  playerRoles: unknown;
}

export interface LeaderboardHuman {
  nickname: string;
  avatarUrl: string | null;
}

/** Điểm của MỘT người trong MỘT ván. `winner` là chuỗi tự do từ DB. */
export function matchPoints(input: {
  role: Role;
  alive: boolean;
  winner: string;
  personalWin: { condition: PersonalWinCondition; round: number } | null;
}): number {
  if (!isMatchOutcome(input.winner)) return 0;
  const won = input.personalWin !== null || roleWonOutcome(input.role, input.winner);
  let points = 0;
  if (won) points += LEADERBOARD_POINTS.win;
  if (input.personalWin) points += LEADERBOARD_POINTS.personalWin;
  if (input.alive) points += LEADERBOARD_POINTS.survived;
  return points;
}

/**
 * Gộp mọi ván trong cửa sổ thành bảng đã xếp hạng, ĐẦY ĐỦ chứ không cắt top:
 * server cần cả bảng để tìm dòng của người hỏi nằm ngoài top 20.
 */
export function buildLeaderboard(
  matches: LeaderboardMatch[],
  humans: Map<string, LeaderboardHuman>,
  opts: { now: number; windowDays?: number; minGames?: number; minHumans?: number },
): LeaderboardEntry[] {
  const windowDays = opts.windowDays ?? LEADERBOARD_WINDOW_DAYS;
  const minGames = opts.minGames ?? LEADERBOARD_MIN_GAMES;
  const minHumans = opts.minHumans ?? LEADERBOARD_MIN_HUMANS;
  const since = opts.now - windowDays * 86_400_000;

  const totals = new Map<string, { points: number; games: number; wins: number }>();

  for (const match of matches) {
    if (match.createdAt.getTime() < since) continue;
    const seats = readableSeats(match.playerRoles).filter((seat) => humans.has(seat.id));
    if (seats.length < minHumans) continue;
    for (const seat of seats) {
      const points = matchPoints({ role: seat.role, alive: seat.alive, winner: match.winner, personalWin: seat.personalWin });
      const won = isMatchOutcome(match.winner) && (seat.personalWin !== null || roleWonOutcome(seat.role, match.winner));
      const total = totals.get(seat.id) ?? { points: 0, games: 0, wins: 0 };
      total.points += points;
      total.games += 1;
      if (won) total.wins += 1;
      totals.set(seat.id, total);
    }
  }

  const rows = [...totals]
    .filter(([, t]) => t.games >= minGames)
    .map(([playerId, t]) => {
      const who = humans.get(playerId)!;
      return {
        rank: 0,
        playerId,
        nickname: who.nickname,
        avatarUrl: who.avatarUrl,
        points: t.points,
        games: t.games,
        wins: t.wins,
        winRate: t.wins / t.games,
      };
    })
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.winRate - a.winRate ||
        b.games - a.games ||
        a.nickname.localeCompare(b.nickname, "vi"),
    );
  rows.forEach((row, index) => {
    row.rank = index + 1;
  });
  return rows;
}

/** Số ván tính được của một người trong cửa sổ, kể cả khi chưa đủ để lên bảng. */
export function countedGamesOf(
  playerId: string,
  matches: LeaderboardMatch[],
  humans: Map<string, LeaderboardHuman>,
  opts: { now: number; windowDays?: number; minHumans?: number },
): number {
  const since = opts.now - (opts.windowDays ?? LEADERBOARD_WINDOW_DAYS) * 86_400_000;
  const minHumans = opts.minHumans ?? LEADERBOARD_MIN_HUMANS;
  let games = 0;
  for (const match of matches) {
    if (match.createdAt.getTime() < since) continue;
    const seats = readableSeats(match.playerRoles).filter((seat) => humans.has(seat.id));
    if (seats.length >= minHumans && seats.some((seat) => seat.id === playerId)) games += 1;
  }
  return games;
}

interface Seat {
  id: string;
  role: Role;
  alive: boolean;
  personalWin: { condition: PersonalWinCondition; round: number } | null;
}

/**
 * Cùng cái sàng với `toHistoryEntry`: cột Json giữ hình dạng của bản build đã
 * ghi nó, nên ghế không id, vai lạ hay điều kiện thắng lạ đều bị bỏ chứ không
 * được đoán.
 */
function readableSeats(playerRoles: unknown): Seat[] {
  if (!Array.isArray(playerRoles)) return [];
  const seats: Seat[] = [];
  for (const raw of playerRoles as Array<Partial<MatchHistoryPlayer>>) {
    if (!raw || typeof raw.id !== "string" || !isRole(raw.role)) continue;
    const win = raw.personalWin;
    seats.push({
      id: raw.id,
      role: raw.role,
      alive: raw.alive === true,
      personalWin:
        win && isPersonalWinCondition(win.condition) && typeof win.round === "number"
          ? { condition: win.condition, round: win.round }
          : null,
    });
  }
  return seats;
}
