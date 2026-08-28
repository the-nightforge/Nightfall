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

/**
 * Giá trị hỏng (không phải số, kể cả chuỗi rỗng - "??" chỉ bắt null/undefined,
 * không bắt "") sẽ ra NaN hoặc 0. Cả hai đều khiến canCall() của BotGovernor
 * luôn false - Gemini âm thầm không bao giờ chạy ở bất kỳ phòng nào, không
 * log, không báo lỗi. 0 không được coi là "tắt Gemini có chủ đích": ý đó đã
 * có BOT_AI_ENABLED=false riêng, rõ ràng hơn một trần bằng không. Vì vậy giá
 * trị hợp lệ duy nhất là số nguyên dương, cùng kiểu chặn với resolvePort ở trên.
 */
export function resolveBotAiMaxCallsPerGame(env: NodeJS.ProcessEnv): number {
  // 180 chứ không phải 60 kể từ khi có phiên toà. Ước lượng phòng 8 bot × 6
  // vòng: ~24 lượt đêm + ~48 lời thoại ngày + ~48 phiếu xác nhận + ~6 lời biện
  // hộ ≈ 126. Giữ 60 thì governor ngắt mạch từ giữa ván và bot hoá câm ở đúng
  // những vòng quan trọng nhất.
  if (env.BOT_AI_MAX_CALLS_PER_GAME === undefined) return 180;

  const value = Number(env.BOT_AI_MAX_CALLS_PER_GAME);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("BOT_AI_MAX_CALLS_PER_GAME phải là số nguyên dương");
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
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite",
  // Nhà cung cấp chính: endpoint OpenAI-compatible. Thiếu bất kỳ mảnh nào thì
  // chặng này bị bỏ qua và chuỗi bắt đầu từ nhà cung cấp kế tiếp.
  botAiBaseUrl: process.env.BOT_AI_BASE_URL ?? "",
  botAiApiKey: process.env.BOT_AI_API_KEY ?? "",
  botAiModel: process.env.BOT_AI_MODEL ?? "gemini-3.7-flash",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-5.6-luna",
  botAiEnabled: process.env.BOT_AI_ENABLED !== "false",
  botAiMaxCallsPerGame: resolveBotAiMaxCallsPerGame(process.env),
};

export const isProd = config.nodeEnv === "production";
