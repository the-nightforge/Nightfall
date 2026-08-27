import dotenv from "dotenv";

dotenv.config();

export function resolvePort(env: NodeJS.ProcessEnv): number {
  const key = env.PORT !== undefined ? "PORT" : env.SERVER_PORT !== undefined ? "SERVER_PORT" : null;
  if (!key) return 4000;

  const value = Number(env[key]);
  if (!Number.isInteger(value) || value <= 0 || value > 65_535) {
    throw new Error(`${key} phải là số nguyên từ 1 đến 65535`);
  }
  return value;
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
