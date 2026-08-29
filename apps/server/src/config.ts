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

export type VoiceConfigResult =
  | { enabled: false }
  | { enabled: true; url: string; apiKey: string; apiSecret: string; env: string };

/**
 * Cấu hình LiveKit. Thiếu HẾT thì voice tắt và server chạy y như cũ; thiếu MỘT
 * NỬA thì ném lỗi ngay lúc khởi động.
 *
 * Cố ý đi ngược thói quen thoái lui im lặng ở trên: comment về
 * BOT_AI_MAX_CALLS_PER_GAME đã kể vì sao im lặng nuốt cấu hình hỏng là cái bẫy
 * - tính năng tắt ngấm ngầm, không log, không báo lỗi. Người đặt hai trong ba
 * biến rõ ràng là ĐANG MUỐN bật voice, nên im lặng bỏ qua là cách tệ nhất.
 *
 * Chuỗi rỗng tính là hỏng chứ không phải thiếu, cùng lý do với resolvePort.
 */
export function resolveVoiceConfig(env: NodeJS.ProcessEnv): VoiceConfigResult {
  const url = env.LIVEKIT_URL?.trim();
  const apiKey = env.LIVEKIT_API_KEY?.trim();
  const apiSecret = env.LIVEKIT_API_SECRET?.trim();

  // Rỗng tính như chưa đặt, KHÔNG tính là hỏng một nửa: `.env.example` khai báo
  // sẵn ba khoá với giá trị rỗng, nên copy template về mà nổ là hỏng đường vào
  // của người mới. "Hỏng một nửa" là khi có giá trị thật ở một số khoá.
  const filled = [url, apiKey, apiSecret].filter((v) => v).length;
  if (filled === 0) return { enabled: false };

  if (!url || !apiKey || !apiSecret) {
    throw new Error(
      "Cấu hình LiveKit thiếu một nửa: cần đủ LIVEKIT_URL, LIVEKIT_API_KEY và " +
        "LIVEKIT_API_SECRET. Bỏ trống cả ba để tắt hẳn voice chat.",
    );
  }

  return { enabled: true, url, apiKey, apiSecret, env: env.LIVEKIT_ENV || "dev" };
}

export const config = {
  port: resolvePort(process.env),
  voice: resolveVoiceConfig(process.env),
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
