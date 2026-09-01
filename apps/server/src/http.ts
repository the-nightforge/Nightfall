import { Router } from "express";
import { prisma } from "./db";
import { newToken, sha256 } from "./util";
import { nicknameSchema, type MatchHistoryEntry, type MatchHistoryPlayer } from "@masoi/shared";
import { redis } from "./redis";
import { config } from "./config";
import { allowAction } from "./rate-limit";
import { buildVersion, healthHttpStatus, redisConnectionHealthy } from "./health";

export const apiRouter = Router();

/** Mốc khởi động, để phân biệt "đã deploy lại" với "chỉ restart". */
const STARTED_AT = Date.now();

interface GameResultRow {
  roomCode: string;
  winner: string;
  round: number;
  durationSec: number;
  playerRoles: unknown;
  caseFile: unknown;
  createdAt: Date;
}

export function toHistoryEntry(row: GameResultRow, viewerId: string): MatchHistoryEntry {
  // Cột Json nên hình dạng do bản ghi lúc đó quyết định, không do type hiện tại:
  // ván lưu trước khi có `id` vẫn phải đọc được thay vì làm hỏng cả trang.
  const players: MatchHistoryPlayer[] = Array.isArray(row.playerRoles)
    ? (row.playerRoles as MatchHistoryPlayer[])
    : [];
  const me = players.find((p) => p.id === viewerId) ?? null;

  return {
    roomCode: row.roomCode,
    winner: row.winner as MatchHistoryEntry["winner"],
    rounds: row.round,
    durationSec: row.durationSec,
    endedAt: row.createdAt.getTime(),
    myRole: me?.role ?? null,
    mySurvived: me ? me.alive : null,
    players,
    caseFile: row.caseFile ?? null,
  };
}

/**
 * Đăng ký người chơi khách: nhận playerId + session token.
 * Token lưu dạng SHA-256 trong DB, token gốc chỉ client giữ.
 */
apiRouter.post("/players", async (req, res) => {
  /*
   * Đây là endpoint DUY NHẤT không cần đăng nhập, nên không chặn ở đây thì:
   * 1) bảng Player phình vô hạn bằng một vòng lặp curl, và
   * 2) MỌI rate limit của socket bị vô hiệu - tất cả đều khoá theo playerId,
   *    mà playerId mới thì lấy bao nhiêu cũng có.
   * Vế (2) mới là vế đáng sợ: nó biến các giới hạn kia thành trang trí.
   */
  if (!allowAction(`signup:${req.ip}`, config.signupRateLimitCount, config.signupRateLimitWindowMs)) {
    res.status(429).json({ error: "Tạo người chơi quá nhanh, thử lại sau ít phút" });
    return;
  }

  const parsed = nicknameSchema.safeParse(req.body?.nickname);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Biệt danh không hợp lệ" });
    return;
  }

  const token = newToken();
  const tokenHash = sha256(token);
  try {
    const player = await prisma.player.create({
      data: { nickname: parsed.data, tokenHash },
    });
    res.json({ playerId: player.id, token, nickname: player.nickname });
  } catch (err) {
    /*
     * Bắt buộc phải log: catch rỗng ở đây từng làm mọi lần "Tạo phòng" trả 500
     * mà log Render trắng tinh - schema.prisma thêm cột avatarUrl nhưng thiếu
     * migration, Prisma báo "column does not exist" và không ai nhìn thấy.
     * Client vẫn chỉ nhận thông báo chung chung, chi tiết chỉ nằm ở server.
     */
    console.error("[api] Tạo người chơi thất bại:", err);
    res.status(500).json({ error: "Không thể tạo người chơi lúc này" });
  }
});

/**
 * Lịch sử ván của chính người gọi.
 *
 * `GameResult` được ghi ở mỗi lần kết thúc ván ngay từ đầu dự án nhưng chưa
 * từng có đường đọc ra - đây là đường đó.
 *
 * Lọc bằng toán tử `@>` của jsonb chứ không lấy N ván gần nhất rồi lọc trong
 * JS: cách sau nhìn thì gọn hơn nhưng sai ở mọi quy mô thật - N ván gần nhất
 * của TOÀN SERVER có thể không chứa ván nào của người đang hỏi, và giao diện
 * sẽ lặng lẽ báo "chưa có ván nào".
 */
apiRouter.get("/players/me/matches", async (req, res) => {
  const auth = req.header("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) {
    res.status(401).json({ error: "Thiếu thông tin xác thực" });
    return;
  }

  try {
    const player = await prisma.player.findUnique({ where: { tokenHash: sha256(token) } });
    if (!player) {
      res.status(401).json({ error: "Phiên đăng nhập không hợp lệ" });
      return;
    }

    const rows = await prisma.$queryRaw<GameResultRow[]>`
      SELECT "roomCode", "winner", "round", "durationSec", "playerRoles", "caseFile", "createdAt"
      FROM "GameResult"
      WHERE "playerRoles" @> ${JSON.stringify([{ id: player.id }])}::jsonb
      ORDER BY "createdAt" DESC
      LIMIT 20
    `;

    res.json({ matches: rows.map((row) => toHistoryEntry(row, player.id)) });
  } catch (err) {
    console.error("[api] Đọc lịch sử ván thất bại:", err);
    res.status(500).json({ error: "Không thể đọc lịch sử lúc này" });
  }
});

apiRouter.get("/health", async (_req, res) => {
  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }
  const redisOk = redisConnectionHealthy(redis.status);
  const health = { db: dbOk, redis: redisOk };
  res.status(healthHttpStatus(health)).json({
    ok: dbOk,
    ...health,
    version: buildVersion(process.env),
    startedAt: new Date(STARTED_AT).toISOString(),
  });
});
