import { config } from "../config";
import type { BotBrain } from "./types";
import { randomBrain } from "./random-brain";
import { GeminiBrain } from "./gemini-brain";
import { OpenAiCompatBrain } from "./openai-compat-brain";
import { FallbackBrain } from "./fallback-brain";
import { BotGovernor, Cooldown } from "./governor";

export interface BrainChoice {
  enabled: boolean;
  maxCalls: number;
  /** Khớp config.chatMaxLength; mặc định 300 khi không truyền (test tiện lợi). */
  chatMaxLength?: number;

  /** Nhà cung cấp chính: endpoint OpenAI-compatible (proxy/gateway). */
  primaryBaseUrl?: string;
  primaryApiKey?: string;
  primaryModel?: string;

  /** Dự phòng: OpenAI chính chủ. */
  openaiApiKey?: string;
  openaiModel?: string;

  /** Dự phòng cuối: Gemini gọi thẳng Google, định dạng riêng của Google. */
  geminiApiKey?: string;
  geminiModel?: string;
}

/**
 * Governor dùng chung. Phải là cùng một instance với cái nằm trong brain,
 * nếu không resetBotBudget sẽ xoá ngân sách của một object khác và ngắt mạch
 * không bao giờ được gỡ.
 */
const sharedGovernor = new BotGovernor(config.botAiMaxCallsPerGame);

/**
 * Hạn chót từng chặng, không phải cho cả chuỗi.
 *
 * Đo bằng prompt thật, không phải prompt rút gọn: proxy mất 6.5-7s, OpenAI ~2.9s.
 * Đặt chặng đầu 7s thì nó timeout ngay ở lượt đo đầu tiên (7016ms) - vừa mất
 * tiền cho lời gọi bỏ đi, vừa cộng thêm cả chặng dự phòng vào tổng thời gian.
 * Nới lên 9s để nhà cung cấp chính thường xuyên kịp về; chặng dự phòng 4s là đủ
 * rộng so với 2.9s đo được. Tổng xấu nhất 13s.
 *
 * Vẫn có thể tràn qua pha thảo luận ngắn nhất (discussionSeconds nhỏ nhất là 30s
 * và bot cuối được xếp lịch gần cuối khung). Chuyện đó an toàn: scheduleDayBots
 * kiểm tra lại pha trước khi phát lời thoại, nên kết quả về muộn bị bỏ chứ không
 * lọt sang pha sau.
 */
const PRIMARY_TIMEOUT_MS = 9_000;
const FALLBACK_TIMEOUT_MS = 4_000;

/** Tách khỏi config để test được mà không đụng biến môi trường. */
export function chooseBrain(choice: BrainChoice, governor?: BotGovernor): BotBrain {
  if (!choice.enabled) return randomBrain;

  const gov = governor ?? new BotGovernor(choice.maxCalls);
  const chain: BotBrain[] = [];

  if (choice.primaryBaseUrl && choice.primaryApiKey && choice.primaryModel) {
    chain.push(
      new OpenAiCompatBrain({
        baseUrl: choice.primaryBaseUrl.replace(/\/+$/, ""),
        apiKey: choice.primaryApiKey,
        model: choice.primaryModel,
        governor: gov,
        // Mỗi nhà cung cấp một hạn nghỉ riêng: 429 ở bên này không được khoá bên kia.
        cooldown: new Cooldown(),
        timeoutMs: PRIMARY_TIMEOUT_MS,
        // Proxy nhận response_format nhưng bỏ qua lặng lẽ rồi trả văn xuôi, nên
        // phải dỗ JSON bằng chính lời nhắc. Đo 5/5 lượt parse được.
        jsonMode: "prompt",
        chatMaxLength: choice.chatMaxLength,
        label: `primary:${choice.primaryModel}`,
      }),
    );
  }

  if (choice.openaiApiKey && choice.openaiModel) {
    chain.push(
      new OpenAiCompatBrain({
        baseUrl: "https://api.openai.com/v1",
        apiKey: choice.openaiApiKey,
        model: choice.openaiModel,
        governor: gov,
        cooldown: new Cooldown(),
        timeoutMs: FALLBACK_TIMEOUT_MS,
        // OpenAI cài đặt json_schema thật: dùng nó thay vì dỗ bằng prompt.
        jsonMode: "json_schema",
        chatMaxLength: choice.chatMaxLength,
        label: `openai:${choice.openaiModel}`,
      }),
    );
  }

  if (choice.geminiApiKey && choice.geminiModel) {
    chain.push(
      new GeminiBrain({
        apiKey: choice.geminiApiKey,
        model: choice.geminiModel,
        governor: gov,
        cooldown: new Cooldown(),
        timeoutMs: FALLBACK_TIMEOUT_MS,
        chatMaxLength: choice.chatMaxLength,
      }),
    );
  }

  if (chain.length === 0) return randomBrain;
  return chain.length === 1 ? chain[0] : new FallbackBrain(chain);
}

const brain = chooseBrain(
  {
    enabled: config.botAiEnabled,
    maxCalls: config.botAiMaxCallsPerGame,
    chatMaxLength: config.chatMaxLength,
    primaryBaseUrl: config.botAiBaseUrl,
    primaryApiKey: config.botAiApiKey,
    primaryModel: config.botAiModel,
    openaiApiKey: config.openaiApiKey,
    openaiModel: config.openaiModel,
    geminiApiKey: config.geminiApiKey,
    geminiModel: config.geminiModel,
  },
  sharedGovernor,
);

export function botBrain(): BotBrain {
  return brain;
}

export { randomBrain };

export function resetBotBudget(roomCode: string): void {
  sharedGovernor.reset(roomCode);
}
