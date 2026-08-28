import type { PlannedVote } from "./types";

/**
 * Dạng engine hiểu. null ở đây là phiếu "Không treo ai" chứ không phải phiếu
 * trống - submitVote phân biệt hai thứ đó bằng undefined và null.
 *
 * Không còn helper "mục tiêu hợp lệ" nào ở đây: từ Phase 2, mọi nước đi - phiếu
 * ban ngày, hành động đêm, phát bắn Thợ Săn, phiếu Treo/Tha - do lõi
 * deterministic trong `@masoi/game-engine` chốt, nên một bản sao luật ở tầng
 * server chỉ là thứ để trôi lệch.
 */
export function engineVote(vote: PlannedVote): string | null {
  return vote.type === "PLAYER" ? vote.targetId : null;
}
