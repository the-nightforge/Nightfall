import { deriveSpeechStyle, describeSpeechStyle } from "@masoi/game-engine";
import type { BotPersonality } from "@masoi/game-engine";
import type { SpeechRequest } from "../../src/bots/types";

/**
 * Phần "khung" của một `SpeechRequest`, dùng chung cho mọi fixture test.
 *
 * Tồn tại vì Phase 4 nới `SpeechRequest` từ 7 lên 15 trường (nay là 16, sau khi
 * Task 5 thêm `players`), và sáu file test đang dựng nó bằng tay. Một helper
 * chung nghĩa là lần nới tiếp theo sửa một chỗ, chứ không phải sáu chỗ mà năm
 * chỗ trong đó sẽ bị quên.
 */
const PERSONALITY: BotPersonality = {
  aggressiveness: 0.5,
  talkativeness: 0.6,
  riskTolerance: 0.5,
  deceptionSkill: 0.5,
  analyticalSkill: 0.6,
  loyalty: 0.5,
  stubbornness: 0.4,
};

export const TEST_SPEECH_STYLE = deriveSpeechStyle(PERSONALITY);

export function speechDefaults(): Omit<
  SpeechRequest,
  "roomCode" | "speaker" | "intention" | "evidence" | "targetName"
> {
  return {
    style: TEST_SPEECH_STYLE,
    styleDescription: describeSpeechStyle(TEST_SPEECH_STYLE),
    replyTo: null,
    recentOwnLines: [],
    chatWindow: [],
    avoidOpenings: [],
    recentSpeechSourceIds: [],
    priorStance: null,
    listener: null,
    seq: 0,
    round: 1,
    // Khớp id/tên mà các fixture đang dùng cho speaker ("bot") và mục tiêu
    // ("c" → "Chi"), để cổng CLAIM_INTEGRITY nhận ra actor khi chạy analyzeChat.
    players: [
      { id: "bot", name: "Bot", alive: true },
      { id: "c", name: "Chi", alive: true },
    ],
    // Chỉ khác null ở lượt tự bào chữa; fixture nào cần nó tự ghi đè.
    defense: null,
  };
}
