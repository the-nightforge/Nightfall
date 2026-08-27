import type { RoomSnapshot } from "@masoi/shared";

export type NightActionType = "KILL" | "SEE" | "GUARD" | "HEAL" | "POISON";

export interface NightDecision {
  action: NightActionType;
  /** null với HEAL, vì engine không nhận mục tiêu cho bình cứu */
  targetId: string | null;
}

export interface DayDecision {
  /** null nghĩa là bot không nói gì vòng này */
  chat: string | null;
  /** null nghĩa là chưa quyết, chỗ gọi sẽ tự chốt hộ */
  voteTargetId: string | null;
}

/**
 * Bộ não của bot. Đầu vào luôn là snapshot đã lọc theo quyền của chính bot đó,
 * không bao giờ là state thô của engine.
 */
export interface BotBrain {
  readonly name: string;
  decideNight(view: RoomSnapshot): Promise<NightDecision | null>;
  decideDay(view: RoomSnapshot): Promise<DayDecision | null>;
}
