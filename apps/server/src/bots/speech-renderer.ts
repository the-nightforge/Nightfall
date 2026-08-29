import { renderSpeechTemplate, speechTextFingerprint } from "@masoi/game-engine";
import { botBrain } from "./index";
import { DEFAULT_CHAT_MAX } from "./decide";
import type { BotBrain, RenderedSpeech, SpeechRequest } from "./types";

/**
 * Câu chữ cho một ý định đã chốt, không cần nhà cung cấp.
 *
 * KHÔNG dùng RNG: đây là đường lui, và một đường lui ngẫu nhiên sẽ làm hỏng
 * chính tính tái lập mà Phase 1 và Phase 3 được xây để có. Biến thiên đến từ
 * hàm băm của `(phòng, bot, vòng, lượt nói, vân tay ý định)`, nên hai lần chạy
 * cùng đầu vào cho cùng một câu, mà hai BOT cùng ý vẫn nói khác nhau.
 *
 * Bảng mẫu sống trong `@masoi/game-engine` chứ không ở đây: self-play cũng cần
 * nó, và engine phải thuần nên nó không thể import ngược lên server.
 */
/**
 * Loại ý định KHÔNG nói được nếu thiếu người để nói tới.
 *
 * Lõi luôn gắn mục tiêu cho những loại này, nên nhánh dưới là phòng thủ. Nhưng
 * phòng thủ đúng chỗ: im lặng còn hơn phát ra "Tôi nghi người đó." - một câu
 * đọc lên như phần mềm hỏng, ngay giữa một ván đấu.
 */
const NEEDS_SOMEONE = new Set([
  "ACCUSE",
  "QUESTION",
  "AGREE",
  "DISAGREE",
  "DEFEND",
  "CHANGE_MIND",
  "REPLY",
  "CHALLENGE",
  "ASK_EVIDENCE",
]);

export function speechTemplate(request: SpeechRequest): string | null {
  if (
    NEEDS_SOMEONE.has(request.intention.kind) &&
    request.targetName === null &&
    request.replyTo === null
  ) {
    return null;
  }

  return renderSpeechTemplate({
    intention: request.intention,
    targetName: request.targetName,
    replyToName: request.replyTo?.actorName ?? null,
    seedTag: request.roomCode,
    botId: request.speaker.id,
    round: request.round,
    seq: request.seq,
    // Vân tay của chính những câu BOT vừa nói: mẫu trùng sẽ bị bỏ qua.
    avoidFingerprints: request.recentOwnLines.map(speechTextFingerprint),
  });
}

/**
 * Diễn đạt một ý định đã chốt thành một câu chat.
 *
 * Nhà cung cấp được ưu tiên vì nó nói tự nhiên hơn, nhưng nó chỉ đổi được CÂU
 * CHỮ: mục tiêu, loại ý định và bằng chứng nằm trong `request` và không bao giờ
 * được đọc ngược lại từ output. Mọi lỗi - timeout, JSON hỏng, hết quota,
 * provider ném - đều rơi về bảng mẫu, nên quyết định gameplay không đổi dù nhà
 * cung cấp có tồn tại hay không.
 *
 * Trả về cả `fromTemplate` để tầng đo biết bao nhiêu phần trăm lời thoại của
 * production đến từ đường lui. Không có con số đó thì một nhà cung cấp hỏng
 * lặng lẽ suốt một tuần trông y hệt một nhà cung cấp đang chạy tốt.
 */
export async function renderBotSpeech(
  request: SpeechRequest,
  brain: BotBrain = botBrain(),
  chatMaxLength = DEFAULT_CHAT_MAX,
): Promise<RenderedSpeech> {
  try {
    const attempt = await brain.renderDaySpeech(request);
    const chat = attempt.ok ? attempt.value?.chat : null;
    if (chat) return { text: chat.slice(0, chatMaxLength), fromTemplate: false };
  } catch {
    // Não ném lỗi ngoài dự kiến cũng chỉ là một lượt hỏng.
  }
  return { text: speechTemplate(request), fromTemplate: true };
}
