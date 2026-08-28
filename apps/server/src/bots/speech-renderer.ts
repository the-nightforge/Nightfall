import { botBrain } from "./index";
import { DEFAULT_CHAT_MAX } from "./decide";
import type { BotBrain, SpeechRequest } from "./types";

/**
 * Câu mẫu cho một ý định đã chốt.
 *
 * KHÔNG dùng RNG: đây là đường lui, và một đường lui ngẫu nhiên sẽ làm hỏng
 * chính tính tái lập mà cả Phase 1 được xây để có. Mẫu chỉ nói lại đúng mục
 * tiêu và bằng chứng trong request - nó không bao giờ thêm sự kiện mới.
 */
export function speechTemplate(request: SpeechRequest): string | null {
  if (request.intention.kind === "WITHHOLD") {
    return "Hiện tại tôi chưa thấy đủ bằng chứng để treo ai.";
  }
  if (!request.targetName) return null;

  const first = request.evidence[0];
  if (request.intention.kind === "QUESTION" || !first) {
    // KHÔNG nhắc tới "lá phiếu vừa rồi": ý định QUESTION xuất hiện nhiều nhất ở
    // vòng thảo luận đầu tiên, khi chưa ai bỏ phiếu lần nào. Một câu hỏi về
    // một sự kiện chưa xảy ra là lời nói dối, và nó lặp lại y hệt ở mọi bot.
    return `${request.targetName} nghĩ sao về tình hình hiện tại?`;
  }
  return `Tôi đang nghi ${request.targetName} vì ${first.summary}.`;
}

/**
 * Diễn đạt một ý định đã chốt thành một câu chat.
 *
 * Nhà cung cấp được ưu tiên vì nó nói tự nhiên hơn, nhưng nó chỉ đổi được CÂU
 * CHỮ: mục tiêu và bằng chứng nằm trong `request` và không bao giờ được đọc
 * ngược lại từ output. Mọi lỗi - timeout, JSON hỏng, hết quota, provider ném -
 * đều rơi về mẫu cố định, nên quyết định gameplay không đổi.
 */
export async function renderBotSpeech(
  request: SpeechRequest,
  brain: BotBrain = botBrain(),
  chatMaxLength = DEFAULT_CHAT_MAX,
): Promise<string | null> {
  try {
    const attempt = await brain.renderDaySpeech(request);
    const chat = attempt.ok ? attempt.value?.chat : null;
    if (chat) return chat.slice(0, chatMaxLength);
  } catch {
    // Não ném lỗi ngoài dự kiến cũng chỉ là một lượt hỏng.
  }
  return speechTemplate(request);
}
