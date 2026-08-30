import { Router } from "express";
import { prisma } from "./db";
import { newToken, sha256 } from "./util";
import { nicknameSchema } from "@masoi/shared";
import { redis } from "./redis";
import { buildVersion, healthHttpStatus, redisConnectionHealthy } from "./health";

export const apiRouter = Router();

/** Mốc khởi động, để phân biệt "đã deploy lại" với "chỉ restart". */
const STARTED_AT = Date.now();

/**
 * Đăng ký người chơi khách: nhận playerId + session token.
 * Token lưu dạng SHA-256 trong DB, token gốc chỉ client giữ.
 */
apiRouter.post("/players", async (req, res) => {
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
