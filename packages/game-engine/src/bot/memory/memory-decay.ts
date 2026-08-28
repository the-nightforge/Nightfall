import type { BotBrainState } from "../types";

/** Ngân sách memory thường mỗi BOT, theo giới hạn tài nguyên trong spec. */
export const MEMORY_LIMIT = 120;

/** Hệ số giảm ảnh hưởng mỗi round tuổi của một memory thường. */
const DECAY_PER_ROUND = 0.88;

/**
 * Giảm ảnh hưởng của memory cũ rồi cắt bớt theo ngân sách.
 *
 * Pinned fact (role claim, counter-claim, Seer result) không decay và luôn được
 * xếp trước khi cắt: quên mất một lời claim vì hôm nay có nhiều phiếu hơn sẽ
 * làm BOT mâu thuẫn với chính lời nó đã nói.
 */
export function decayAndPrune(
  state: BotBrainState,
  round: number,
  limit = MEMORY_LIMIT,
): void {
  for (const memory of state.memories) {
    if (memory.pinned) continue;
    const age = Math.max(0, round - memory.round);
    memory.importance = memory.importance * DECAY_PER_ROUND ** age;
  }

  state.memories.sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    return right.importance - left.importance;
  });

  // Chỉ memory thường bị cắt. Pinned fact đã bị chặn trần ngay lúc ghi
  // (`enforcePinnedBudget`), nên chúng không thể chiếm hết ngân sách, và ở đây
  // chúng không bao giờ bị bỏ - quên một lời claim là BOT tự mâu thuẫn với
  // chính điều nó đã nói.
  const pinnedCount = state.memories.filter((memory) => memory.pinned).length;
  const keep = Math.max(pinnedCount, limit);
  if (state.memories.length > keep) state.memories.length = keep;
}
