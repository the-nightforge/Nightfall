import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.SERVER_PORT ?? 4000),
  redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6380",
  nodeEnv: process.env.NODE_ENV ?? "development",
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  chatMaxLength: Number(process.env.CHAT_MAX_LENGTH ?? 300),
  chatRateLimitCount: Number(process.env.CHAT_RATE_LIMIT_COUNT ?? 5),
  chatRateLimitWindowMs: Number(process.env.CHAT_RATE_LIMIT_WINDOW_MS ?? 5000),
};

export const isProd = config.nodeEnv === "production";
