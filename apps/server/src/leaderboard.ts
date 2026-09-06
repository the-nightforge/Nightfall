import {
  LEADERBOARD_MIN_GAMES,
  LEADERBOARD_MIN_HUMANS,
  LEADERBOARD_POINTS,
  LEADERBOARD_TOP,
  LEADERBOARD_WINDOW_DAYS,
  buildLeaderboard,
  countedGamesOf,
  type LeaderboardEntry,
  type LeaderboardHuman,
  type LeaderboardMatch,
  type LeaderboardView,
} from "@masoi/shared";
import { prisma } from "./db";

/**
 * Bảng xếp hạng: đọc ván trong cửa sổ, tra ai là người thật, gộp, rồi giữ
 * kết quả một lúc.
 *
 * Cache vì hai lý do. Một: bảng là thứ mọi người thấy trên trang chủ, và mỗi
 * lượt mở trang mà quét lại 30 ngày ván thì DB làm việc cho một con số không
 * đổi trong 60 giây. Hai: nó làm cho endpoint công khai không thể bị dùng để
 * kéo tải DB - bao nhiêu request trong một phút cũng chỉ là một câu truy vấn.
 *
 * Cache giữ CẢ BẢNG đã xếp hạng và dữ liệu thô, chứ không chỉ top 20: dòng
 * "của bạn" cần tìm trong cả bảng, còn "còn N ván nữa" cần đếm lại trên ván.
 */
const CACHE_TTL_MS = 60_000;

interface Cached {
  builtAt: number;
  rows: LeaderboardEntry[];
  matches: LeaderboardMatch[];
  humans: Map<string, LeaderboardHuman>;
}

let cached: Cached | null = null;

/** Để test và để một nơi khác (ghi kết quả ván) làm mới sớm nếu muốn. */
export function invalidateLeaderboard(): void {
  cached = null;
}

async function load(now: number): Promise<Cached> {
  if (cached && now - cached.builtAt < CACHE_TTL_MS) return cached;

  const since = new Date(now - LEADERBOARD_WINDOW_DAYS * 86_400_000);
  const matches = await prisma.gameResult.findMany({
    where: { createdAt: { gte: since } },
    select: { id: true, winner: true, createdAt: true, playerRoles: true },
  });

  // Người thật là người CÓ trong bảng Player: bot chỉ tồn tại trong RAM của
  // phòng, nên id của chúng không bao giờ khớp. Chỉ hỏi về những id có mặt
  // trong ván thay vì kéo cả bảng Player.
  const ids = new Set<string>();
  for (const match of matches) {
    if (!Array.isArray(match.playerRoles)) continue;
    for (const seat of match.playerRoles as Array<{ id?: unknown }>) {
      if (seat && typeof seat.id === "string") ids.add(seat.id);
    }
  }
  const players = ids.size
    ? await prisma.player.findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, nickname: true, avatarUrl: true },
      })
    : [];
  const humans = new Map<string, LeaderboardHuman>(
    players.map((p) => [p.id, { nickname: p.nickname, avatarUrl: p.avatarUrl ?? null }]),
  );

  cached = { builtAt: now, matches, humans, rows: buildLeaderboard(matches, humans, { now }) };
  return cached;
}

export async function leaderboardView(viewerId: string | null, now = Date.now()): Promise<LeaderboardView> {
  const data = await load(now);
  const me = viewerId ? (data.rows.find((row) => row.playerId === viewerId) ?? null) : null;
  return {
    entries: data.rows.slice(0, LEADERBOARD_TOP),
    me,
    myGames: viewerId ? countedGamesOf(viewerId, data.matches, data.humans, { now }) : 0,
    windowDays: LEADERBOARD_WINDOW_DAYS,
    minGames: LEADERBOARD_MIN_GAMES,
    minHumans: LEADERBOARD_MIN_HUMANS,
    points: LEADERBOARD_POINTS,
    generatedAt: data.builtAt,
  };
}
