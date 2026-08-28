import type { BotSpeechIntention } from "@masoi/game-engine";
import type { RoomSnapshot } from "@masoi/shared";

/**
 * Hành động đêm engine chấp nhận.
 *
 * `SKIP` có mặt vì engine nhận nó và vì Phù Thuỷ chủ động bỏ lượt là một nước
 * đi thật. Trước Phase 2 union này thiếu `SKIP` — an toàn khi chỉ có provider
 * sinh hành động, nhưng sai ngay khi lõi deterministic tiếp quản.
 */
export type NightActionType = "KILL" | "SEE" | "GUARD" | "HEAL" | "POISON" | "SKIP";

export interface NightDecision {
  action: NightActionType;
  /** null với HEAL và SKIP, vì engine không nhận mục tiêu cho hai cái đó */
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

/**
 * Một mẩu bằng chứng đã được rút gọn để đọc thành lời. Chỉ có source ID và một
 * câu tóm tắt: LLM không cần - và không được - biết weight hay confidence.
 */
export interface RenderableEvidence {
  sourceId: string;
  summary: string;
}

/**
 * Yêu cầu diễn đạt một quyết định ĐÃ CHỐT.
 *
 * Cố tình KHÔNG chứa `RoomSnapshot`, bảng role hay danh sách mục tiêu hợp lệ:
 * nếu LLM không nhìn thấy lựa chọn nào khác thì nó không có gì để đổi. Mục tiêu
 * và bằng chứng ở đây đã do lõi deterministic quyết xong.
 */
export interface SpeechRequest {
  /** Chỉ để governor tính ngân sách theo phòng; không phải thông tin ván đấu. */
  roomCode: string;
  speaker: { id: string; name: string };
  personalityStyle: string;
  intention: BotSpeechIntention;
  evidence: RenderableEvidence[];
  /** Tên hiển thị của mục tiêu, hoặc null khi ý định không nhắm vào ai. */
  targetName: string | null;
  /** Các source đã dùng ở lượt nói trước, để không lặp lại đúng một luận điểm. */
  recentSpeechSourceIds: string[];
}

/**
 * Kết quả duy nhất mà nhà cung cấp được trả về cho ban ngày: một câu nói.
 * Không có mục tiêu, không có phiếu - gameplay đã được chốt trước khi hỏi.
 */
export interface DaySpeechDecision {
  chat: string | null;
}

/** Lời tự bào chữa của bị cáo, phát vào kênh day. */
export interface DefenseDecision {
  chat: string;
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
 * Bộ não của bot — CHỈ SINH LỜI NÓI.
 *
 * Từ Phase 2, interface này không còn method nào trả về một nước đi. Mọi quyết
 * định gameplay (hành động đêm, phát bắn Thợ Săn, phiếu Treo/Tha, phiếu đề cử)
 * do lõi deterministic trong `@masoi/game-engine` chốt trước, và nhà cung cấp
 * chỉ được diễn đạt lại.
 *
 * Đây là một ràng buộc về KIỂU, không phải một quy ước: không có chữ ký nào để
 * gọi, thì không có đường nào để một mô hình ngôn ngữ lái ván đấu.
 *
 * Đầu vào của `decideDefense` vẫn là snapshot đã lọc theo quyền của chính bot,
 * không bao giờ là state thô của engine.
 */
export interface BotBrain {
  readonly name: string;
  /**
   * Diễn đạt một ý định ban ngày đã chốt. Thay cho `decideDay` cũ: nhà cung cấp
   * không còn được chọn mục tiêu hay lá phiếu nào nữa.
   */
  renderDaySpeech(request: SpeechRequest): Promise<Attempt<DaySpeechDecision>>;
  /** Lời tự bào chữa của bị cáo. Là lời nói, không phải nước đi. */
  decideDefense(view: RoomSnapshot): Promise<Attempt<DefenseDecision>>;
}
