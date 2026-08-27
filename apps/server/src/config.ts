import dotenv from "dotenv";

dotenv.config();

export function resolvePort(env: NodeJS.ProcessEnv): number {
  const value = Number(env.PORT ?? env.SERVER_PORT ?? 4000);
  return Number.isInteger(value) && value > 0 && value <= 65_535 ? value : 4000;
}

export const config = {
  port: resolvePort(process.env),
  redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6380",
  nodeEnv: process.env.NODE_ENV ?? "development",
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  chatMaxLength: Number(process.env.CHAT_MAX_LENGTH ?? 300),
  chatRateLimitCount: Number(process.env.CHAT_RATE_LIMIT_COUNT ?? 5),
  chatRateLimitWindowMs: Number(process.env.CHAT_RATE_LIMIT_WINDOW_MS ?? 5000),
};

export const isProd = config.nodeEnv === "production";
