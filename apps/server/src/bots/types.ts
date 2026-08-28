import type { RoomSnapshot } from "@masoi/shared";

export type NightActionType = "KILL" | "SEE" | "GUARD" | "HEAL" | "POISON";

export interface NightDecision {
  action: NightActionType;
  /** null với HEAL, vì engine không nhận mục tiêu cho bình cứu */
  targetId: string | null;
}

/**
 * Lá phiếu bot định bỏ. Là union chứ không phải một string nullable vì
 * "không treo ai" là một lựa chọn có chủ ý, ngang hàng với việc chọn một
 * người - gộp nó vào null sẽ lẫn với "chưa quyết được", và chỗ gọi phải xử
 * lý hai thứ đó khác nhau.
 */
export type PlannedVote =
  | { type: "PLAYER"; targetId: string }
  | { type: "NO_ELIMINATION" };

export interface DayDecision {
  /** null nghĩa là bot không nói gì vòng này */
  chat: string | null;
  /** null nghĩa là chưa quyết, chỗ gọi sẽ tự chốt hộ */
  vote: PlannedVote | null;
}

/**
 * Quyết định phản kích của Thợ Săn. targetId null là lựa chọn không bắn có
 * chủ ý, nên phải nằm trong object thay vì dùng Attempt.value null.
 */
export interface HunterShotDecision {
  targetId: string | null;
}

/** Lời tự bào chữa của bị cáo, phát vào kênh day. */
export interface DefenseDecision {
  chat: string;
}

/**
 * Lá phiếu xác nhận. Object chứ không phải boolean trần vì cùng lý do với
 * HunterShotDecision: Attempt<boolean> không phân biệt được "chọn Tha" với
 * "không quyết được", và hai thứ đó phải đi hai đường khác nhau.
 */
export interface FinalVoteDecision {
  guilty: boolean;
}

/**
 * Kết quả một lượt hỏi não bot.
 *
 * Trước đây cả hai tình huống dưới đây đều trả null, nên chỗ gọi không phân biệt
 * được. Điều đó vô hại khi chỉ có một não, nhưng thành sai ngay khi có não dự
 * phòng: "bot đã chết, không cần nói" mà bị coi là hỏng thì bot chết vẫn được
 * mang đi hỏi nhà cung cấp thứ hai - tốn tiền, thêm độ trễ, và có thể phát ra
 * lời thoại của người đáng lẽ im lặng.
 *
 *  - { ok: true, value: X }    quyết định được X
 *  - { ok: true, value: null } chủ động không làm gì (đã chết, không còn mục
 *                              tiêu hợp lệ, Phù Thuỷ chọn SKIP) - KHÔNG fallback
 *  - { ok: false }             gọi hỏng (429, timeout, JSON hỏng, mục tiêu bậy)
 *                              - chỗ gọi nên thử não kế tiếp
 */
export type Attempt<T> = { ok: true; value: T | null } | { ok: false };

/**
 * Kết quả của một não không thể hỏng (không gọi mạng). Vẫn gán được vào
 * BotBrain, nhưng chỗ gọi trực tiếp khỏi phải kiểm tra một nhánh không tồn tại.
 */
export type Always<T> = { ok: true; value: T | null };

// Trả Always chứ không phải Attempt: cả hai đều là nhánh thành công, nên não
// không thể hỏng vẫn dùng lại được chúng mà giữ nguyên kiểu hẹp.
export const nothingToDo = <T>(): Always<T> => ({ ok: true, value: null });
export const decided = <T>(value: T): Always<T> => ({ ok: true, value });
export const failed = <T>(): Attempt<T> => ({ ok: false });

/**
 * Bộ não của bot. Đầu vào luôn là snapshot đã lọc theo quyền của chính bot đó,
 * không bao giờ là state thô của engine.
 */
export interface BotBrain {
  readonly name: string;
  decideNight(view: RoomSnapshot): Promise<Attempt<NightDecision>>;
  decideDay(view: RoomSnapshot): Promise<Attempt<DayDecision>>;
  decideHunterShot(view: RoomSnapshot): Promise<Attempt<HunterShotDecision>>;
  decideDefense(view: RoomSnapshot): Promise<Attempt<DefenseDecision>>;
  decideFinalVote(view: RoomSnapshot): Promise<Attempt<FinalVoteDecision>>;
}
