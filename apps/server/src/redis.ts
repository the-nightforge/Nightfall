import Redis from "ioredis";
import { config } from "./config";

export const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6380", {
  lazyConnect: false,
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 500, 5000),
});

// Tránh crash process khi Redis tạm mất kết nối - gameplay chạy trên bộ nhớ
redis.on("error", (err) => {
  if (!isWarned) {
    console.warn("[redis] Mất kết nối (gameplay vẫn tiếp tục):", err.message);
    isWarned = true;
    setTimeout(() => (isWarned = false), 30_000);
  }
});
let isWarned = false;

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface SessionInfo {
  playerId: string;
  roomCode: string | null;
}

export async function saveSession(tokenHash: string, info: SessionInfo): Promise<void> {
  try {
    await redis.set(`sess:${tokenHash}`, JSON.stringify(info), "EX", SESSION_TTL_SECONDS);
  } catch {
    /* Redis lỗi không chặn */
  }
}

export async function getSession(tokenHash: string): Promise<SessionInfo | null> {
  try {
    const raw = await redis.get(`sess:${tokenHash}`);
    return raw ? (JSON.parse(raw) as SessionInfo) : null;
  } catch {
    return null;
  }
}

export async function updateSessionRoom(playerId: string, roomCode: string | null): Promise<void> {
  // Cập nhật phòng cho mọi session của player (key phụ trợ theo playerId)
  try {
    if (roomCode) {
      await redis.set(`player-room:${playerId}`, roomCode, "EX", SESSION_TTL_SECONDS);
    } else {
      await redis.del(`player-room:${playerId}`);
    }
  } catch {
    /* Redis lỗi không chặn */
  }
}

export async function getPlayerRoom(playerId: string): Promise<string | null> {
  try {
    return redis.get(`player-room:${playerId}`);
  } catch {
    return null;
  }
}

export async function pingRedis(): Promise<boolean> {
  try {
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}
