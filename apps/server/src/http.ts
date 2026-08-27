import { Router } from "express";
import { prisma } from "./db";
import { newToken, sha256 } from "./util";
import { nicknameSchema } from "@masoi/shared";
import { redis } from "./redis";
import { healthHttpStatus, redisConnectionHealthy } from "./health";

export const apiRouter = Router();

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
  } catch {
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
  res.status(healthHttpStatus(health)).json({ ok: dbOk, ...health });
});
