import type { BotBrainState, BotDecisionContext } from "../types";

/** Người mà linh hồn sẽ nói tới, hoặc `null` là không nói gì. */
export interface BotGhostWhisperIntention {
  targetId: string | null;
  reason: string;
}

/**
 * Linh hồn nói về AI, trong Tiếng Vọng Người Chết.
 *
 * Chỉ đọc `suspicion` - tức thứ dựng từ bằng chứng CÔNG KHAI mà cả làng cũng
 * thấy. Cố tình KHÔNG chạm `knownInformation`: một con ma đọc kết quả soi hay
 * danh sách đồng bọn ra giữa ban ngày sẽ biến "chết là hết thông tin" thành
 * vô nghĩa, và lời nhắn ẩn danh thì không ai phản bác được.
 *
 * Người chết bị loại vì chỉ vào họ chẳng treo được ai; chính mình bị loại vì
 * một lời tự tố ẩn danh không nói lên điều gì.
 *
 * `null` khi chưa nghi ai: một lời buộc tội không có cơ sở vẫn đủ sức đẩy làng
 * treo nhầm, mà linh hồn thì không phải chịu hậu quả nào. Im lặng rẻ hơn.
 */
export function decideGhostWhisper(
  context: BotDecisionContext,
  state: BotBrainState,
): BotGhostWhisperIntention {
  const scored = context.knowledge.players
    .filter((player) => player.alive && player.id !== context.knowledge.botId)
    .map((player) => ({ id: player.id, score: state.suspicion[player.id]?.score ?? 0 }))
    // Tie-break theo id để hai lần chạy cùng seed không đảo thứ tự.
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const top = scored[0];
  if (!top || top.score <= 0) {
    return { targetId: null, reason: "chưa nghi ai đủ để nói ra" };
  }
  return { targetId: top.id, reason: "người bị nghi nhất trong số còn sống" };
}
