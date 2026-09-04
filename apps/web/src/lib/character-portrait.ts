/**
 * Hai quyết định thuần của một khuôn mặt: hiện chế độ nào, và lấy hình từ đâu.
 *
 * Tách khỏi component vì cùng lý do `seat-voice.ts` đã tách: một bảng ưu tiên
 * nằm trong JSX thì không ai kiểm chứng được nó có bị một trạng thái mới chen
 * ngang hay không. File này KHÔNG import React và KHÔNG đọc Date.now.
 */

/**
 * Ba chế độ, ưu tiên cứng: `dead` > `talking` > `alive`.
 *
 * Cố ý KHÔNG có chế độ thứ tư cho `prefers-reduced-motion`. `globals.css` đã
 * chốt luật đó từ trước: cái không mang tin thì tắt (nhịp thở), cái mang tin
 * thì ở lại và đứng yên (quầng "đang nói"). Miệng đang nói là thông tin thật,
 * nên reduced-motion vẫn ở chế độ `talking`, chỉ ghim frame lại - và việc ghim
 * là của CSS, không phải của hàm này.
 */
export type PortraitMode = "dead" | "talking" | "alive";

export interface PortraitModeInput {
  alive: boolean;
  /** Đang phát tiếng qua LiveKit. Người thật mới có; bot không bao giờ. */
  speaking: boolean;
  /**
   * Mốc hết mấp máy của BOT, tính bằng ms cùng trục với `nowMs`.
   *
   * Bot không có giọng nên `useSpeakers()` không bao giờ nhắc tới chúng. Thiếu
   * đường này thì phòng nhiều bot không có cái miệng nào động đậy.
   */
  talkingUntilMs: number | null;
  /** Tiêm từ ngoài để cùng đầu vào luôn ra cùng kết quả. */
  nowMs: number;
}

/** Cửa sổ mấp máy của bot sau khi dòng chat của nó vừa hiện. */
export const BOT_TALK_MS = 1_500;

export function portraitMode({
  alive,
  speaking,
  talkingUntilMs,
  nowMs,
}: PortraitModeInput): PortraitMode {
  // Không tin caller: `seatShowsSpeaking` đã lọc người chết, nhưng `TrialStage`
  // gọi `useSpeakers()` thẳng chứ không qua bộ lọc đó.
  if (!alive) return "dead";
  if (speaking) return "talking";
  // Biên ĐÓNG ở mốc: đúng `talkingUntilMs` là đã hết, không phải còn.
  if (talkingUntilMs !== null && nowMs < talkingUntilMs) return "talking";
  return "alive";
}

/**
 * Lấy hình ở đâu. Thang rơi nằm ở đây chứ không nằm trong nhánh `if` của
 * component, vì một nhánh `if` trong JSX là một nhánh không ai kiểm được.
 */
export type PortraitSource = "upload" | "sheet" | "svg";

export interface PortraitSourceInput {
  /** Người chơi đã tự tải ảnh lên object storage. */
  isCustom: boolean;
  /** Nhân vật này đã có sprite sheet trong `character-art.ts` chưa. */
  hasSheet: boolean;
  /** `navigator.connection.saveData`. */
  saveData: boolean;
}

export function portraitSource({
  isCustom,
  hasSheet,
  saveData,
}: PortraitSourceInput): PortraitSource {
  // Ảnh tự tải lên là danh tính người chơi tự đặt, không đánh đổi vì bất cứ gì.
  if (isCustom) return "upload";
  // Save-Data là lý do BĂNG THÔNG nên cấm tải file. Đối lập với
  // prefers-reduced-motion, vốn vẫn tải sheet và chỉ ghim frame lại.
  if (saveData) return "svg";
  return hasSheet ? "sheet" : "svg";
}
