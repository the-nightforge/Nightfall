import dotenv from "dotenv";
import { resolveObjectStorageConfig } from "./storage/config";

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

/**
 * Số hop proxy tin được cho `app.set("trust proxy", ...)`.
 *
 * KHÔNG ném lỗi như resolvePort: đặt sai biến này chỉ làm rate limit khoá nhầm
 * IP chứ không làm hỏng ván đấu, nên chặn cả server khởi động là phản ứng quá
 * tay. Nhận thêm "true"/"false" vì đó là cách viết ai cũng thử trước tiên.
 */
export function resolveTrustProxy(env: NodeJS.ProcessEnv): number {
  const raw = env.TRUST_PROXY?.trim().toLowerCase();
  if (raw === undefined || raw === "") return 1;
  if (raw === "true") return 1;
  if (raw === "false") return 0;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    console.warn(`[config] TRUST_PROXY="${env.TRUST_PROXY}" không hợp lệ, dùng mặc định 1`);
    return 1;
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
  objectStorage: resolveObjectStorageConfig(process.env),
  redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6380",
  nodeEnv: process.env.NODE_ENV ?? "development",
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  chatMaxLength: Number(process.env.CHAT_MAX_LENGTH ?? 300),
  chatRateLimitCount: Number(process.env.CHAT_RATE_LIMIT_COUNT ?? 5),
  chatRateLimitWindowMs: Number(process.env.CHAT_RATE_LIMIT_WINDOW_MS ?? 5000),
  // Tạo người chơi là endpoint DUY NHẤT không cần đăng nhập, nên nó cũng là cửa
  // duy nhất ai cũng gõ được. Khoá theo IP: xem `trustProxy` bên dưới.
  signupRateLimitCount: Number(process.env.SIGNUP_RATE_LIMIT_COUNT ?? 10),
  signupRateLimitWindowMs: Number(process.env.SIGNUP_RATE_LIMIT_WINDOW_MS ?? 60_000),
  /**
   * Số hop proxy tin được, truyền thẳng cho `app.set("trust proxy", ...)`.
   *
   * Mặc định 1 vì server chạy sau proxy của Render: để 0 ở đó thì `req.ip` là
   * IP của load balancer, cả thiên hạ dùng chung một rổ và người chơi thật chặn
   * lẫn nhau. Ngược lại, nếu bạn tự host và phơi cổng thẳng ra Internet thì đặt
   * 0, vì lúc đó client tự bịa được header X-Forwarded-For.
   *
   * Về 1 khi giá trị không phải số: `TRUST_PROXY=true` là cách viết dễ đoán
   * nhầm, và `Number("true")` cho NaN - Express nhận NaN thì hành vi không xác
   * định, tệ hơn hẳn so với việc quay về mặc định.
   */
  trustProxy: resolveTrustProxy(process.env),
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
