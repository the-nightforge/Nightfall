import { config } from "../config";
import type { BotBrain } from "./types";
import { randomBrain } from "./random-brain";
import { GeminiBrain } from "./gemini-brain";
import { BotGovernor } from "./governor";

export interface BrainChoice {
  enabled: boolean;
  apiKey: string;
  model: string;
  maxCalls: number;
  /** Khớp config.chatMaxLength; mặc định 300 khi không truyền (test tiện lợi). */
  chatMaxLength?: number;
}

/**
 * Governor dùng chung. Phải là cùng một instance với cái nằm trong brain,
 * nếu không resetBotBudget sẽ xoá ngân sách của một object khác và ngắt mạch
 * không bao giờ được gỡ.
 */
const sharedGovernor = new BotGovernor(config.botAiMaxCallsPerGame);

/** Tách khỏi config để test được mà không đụng biến môi trường. */
export function chooseBrain(choice: BrainChoice, governor?: BotGovernor): BotBrain {
  if (!choice.enabled || !choice.apiKey) return randomBrain;
  return new GeminiBrain({
    apiKey: choice.apiKey,
    model: choice.model,
    governor: governor ?? new BotGovernor(choice.maxCalls),
    timeoutMs: 8_000,
    chatMaxLength: choice.chatMaxLength,
  });
}

const brain = chooseBrain(
  {
    enabled: config.botAiEnabled,
    apiKey: config.geminiApiKey,
    model: config.geminiModel,
    maxCalls: config.botAiMaxCallsPerGame,
    chatMaxLength: config.chatMaxLength,
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
